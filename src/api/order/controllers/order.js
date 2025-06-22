'use strict';


const stripe = require('stripe')(process.env.STRIPE_KEY);
const { v4: uuidv4 } = require('uuid');
const { createCoreController } = require('@strapi/strapi').factories;
const generateUniqueID = require('../../../scripts/generateUniqueID');


const retryQueue = [];
const MAX_RETRIES = 3; // Número máximo de reintentos
const RETRY_DELAY = 5000; // Tiempo en milisegundos entre reintentos




module.exports = createCoreController('api::order.order', ({ strapi }) => ({

    async createFreeOrder(ctx) {
        const { dataOrder } = ctx.request.body;
        const { products, user, coupon_used } = dataOrder;
        const clientReferenceId = user?.id || uuidv4();

        const orderData = {
            products,
            total: 0,
            status_order: 'completed',
            stripe_id: 'free-order-user-' + clientReferenceId,
            user: user?.id,
            coupon_used: coupon_used?.id,
        };

        //REVisar si el usuario tiene un cupom y si es valido

        try {
            const order = await strapi.service('api::order.order').create({
                data: orderData,
            });

            //bajar stock de productos
            for (const product of products) {
                try {
                    const { slug_variant, stockSelected, productId } = product;
                    if (slug_variant) {
                        // Buscar la variante del producto
                        const [variantData] = await strapi.entityService.findMany('api::variation.variation', {
                            filters: { slug: slug_variant },
                            limit: 1,
                        });

                        if (!variantData) {
                            return ctx.notFound(`La variante "${slug_variant}" no existe para el producto.`);
                        }

                        //bajar stock de la variante
                        await strapi.entityService.update('api::variation.variation', variantData.id, {
                            data: { stock: variantData.stock - stockSelected },
                        });
                    } else {
                        const [productData] = await strapi.entityService.findMany('api::product.product', {
                            filters: { slug: productId },
                            limit: 1,
                        });

                        //bajar stock del producto
                        await strapi.entityService.update('api::product.product', productData.id, {
                            data: { stock: productData.stock - stockSelected },
                        });
                    }

                } catch (error) {
                    console.error('Error al actualizar el stock del producto:', error);
                }
            }


            //guardar user en cupon
            if (coupon_used) {
                try {
                    // Nota: El campo 'users' puede no existir en el schema del cupón
                    // await strapi.entityService.update('api::coupon.coupon', coupon_used.id, {
                    //     data: { users: user.id },
                    // });
                    console.log(`Cupón ${coupon_used.id} usado por usuario ${user.id}`);
                } catch (error) {
                    console.error('Error al actualizar el cupón:', error);
                }
            }



            // Enviar email de confirmación para orden gratuita
            if (user?.email) {
                try {
                    await sendOrderConfirmationEmail(
                        user.username || 'Cliente',
                        user.email,
                        strapi,
                        products,
                        'Compra Everblack recibida - Orden Gratuita',
                        'free',
                        false
                    );
                    console.log('Email de confirmación de orden gratuita enviado con éxito');
                } catch (emailError) {
                    console.error("Error al enviar el email de confirmación: ", emailError);
                    // No lanzar error - la orden ya fue procesada
                }
            }

            return { order };
        } catch (orderError) {
            console.error('Error al crear la orden:', orderError);
            ctx.response.status = 500;
            return { error: 'Error al crear la orden' };
        }
    },

    //obtener todas las ordenes
    async getAllOrders(ctx) {
        try {
            const orders = await strapi.entityService.findMany('api::order.order', {
                populate: {
                    coupon_used: true, // Incluye los datos de 'coupon_used'
                    user: { // Carga los datos del usuario relacionado
                        populate: ['addresses'], // Incluye las direcciones relacionadas con el usuario
                    },
                },
            });

            ctx.response.status = 200;
            return (ctx.body = orders);
        } catch (error) {
            console.error('Error al obtener las órdenes:', error);
            ctx.response.status = 500;
            return (ctx.body = { error: 'Error interno al intentar obtener las órdenes.' });
        }
    },

    // Obtener órdenes por userId
    async getOrders(ctx) {
        const { userId } = ctx.query;

        if (!userId) {
            ctx.response.status = 400;
            return (ctx.body = { error: 'Debes proporcionar un userId o un email para filtrar las órdenes.' });
        }

        try {
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: { user: userId },
                populate: ['coupon_used', 'user', 'payment_intent'],
            });

            ctx.response.status = 200;
            return (ctx.body = orders);
        } catch (error) {
            console.error('Error al obtener las órdenes:', error);
            ctx.response.status = 500;
            return (ctx.body = { error: 'Error interno al intentar obtener las órdenes.' });
        }
    },

    // Crear nueva orden y sesión de Stripe
    async create(ctx) {
        const { products, user, coupon_used, summary, address } = ctx.request.body;
        const order_id = 'MX-' + generateUniqueID();


        try {
            const productItems = summary.products.map(product => {
                // Crear nombre del producto incluyendo variación si existe
                let productName = product.product_name;
                if (product.size && product.size.trim() !== '') {
                    // Extraer solo el nombre de la talla (antes del primer guión si existe)
                    const sizeName = product.size.split('-')[0];
                    productName = `${product.product_name} - Talla: ${sizeName}`;
                }

                return {
                    price_data: {
                        currency: 'mxn',
                        product_data: {
                            name: productName,
                        },
                        unit_amount: product.discount > 0 ? product.discountPrice : product.realPrice,
                    },
                    quantity: product.stockSelected,
                };
            });

            const shipping_cost = summary.shipping_cost;
            const clientReferenceId = user.id;

            const sessionData = {
                payment_method_types: ['card', 'oxxo',],
                payment_method_options: {
                    oxxo: {
                        expires_after_days: 2,
                    },
                },
                mode: 'payment',
                // URLs configuradas para manejar correctamente los diferentes métodos de pago
                success_url: `${process.env.PUBLIC_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.PUBLIC_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}&cancelled=true`,
                line_items: productItems,
                client_reference_id: clientReferenceId,
                customer_email: user.email,
                metadata: { order_id, user_id: user.id },
                // Configurar para que OXXO no redirija automáticamente al voucher
                payment_intent_data: {
                    metadata: {
                        order_id: order_id,
                        user_id: user.id,
                        skip_voucher_redirect: 'true' // Flag para nuestro webhook
                    },
                    receipt_email: user.email
                    // Removido setup_future_usage ya que causaba error con valor null
                },
                // Desabilitar la página de éxito automática de Stripe para OXXO
                allow_promotion_codes: false,
                billing_address_collection: 'auto',
                shipping_options: [
                    {
                        shipping_rate_data: {
                            display_name: 'Costo de envío',
                            type: 'fixed_amount',
                            fixed_amount: {
                                amount: shipping_cost,
                                currency: 'mxn',
                            },
                        },
                    },
                ],
            };

            let subtotal = products.reduce((sum, product) => sum + product.realPrice * product.stockSelected, 0);


            if (coupon_used && coupon_used.is_active) {
                sessionData.discounts = [
                    {
                        coupon: await stripe.coupons.create({
                            name: coupon_used.code,
                            percent_off: coupon_used.discount,
                            duration: 'once',
                        }).then(coupon => coupon.id),
                    },
                ];
            }

            const session = await stripe.checkout.sessions.create(sessionData);
            const discount = coupon_used && coupon_used.is_active
                ? (subtotal * coupon_used.discount) / 100
                : 0;

            const total = subtotal + summary.shipping_cost - discount;

            const orderDatas = {
                products,
                order_id,
                total,
                stripe_id: session.id,
                user: user.id,
                address,
                order_status: 'pending',
                shipping_status: 'pending',
                order_date: new Date(),
                customer_email: user.email,
                customer_name: user.username || user.firstName || user.email.split('@')[0],
            };

            if (coupon_used) {
                orderDatas.coupon_used = coupon_used.id;
            }

            const order = await strapi.service('api::order.order').create({ data: orderDatas });

            //actualizar stock de productos
            updateStockProducts(orderDatas.products, "minus");


            return { stripeSession: session, order };
        } catch (e) {
            console.error(e);
            ctx.response.status = 500;
            return { error: e.message };
        }
    },

    // Verificar el estado del pago de Stripe
    async checkPaymentStatus(ctx) {
        const { session_id } = ctx.query;

        if (!session_id) {
            ctx.response.status = 400;
            return ctx.body = { error: 'session_id es requerido' };
        }

        try {
            const session = await stripe.checkout.sessions.retrieve(session_id);
            
            // Obtener información del método de pago
            const paymentMethod = session.payment_method_types?.[0] || 'unknown';
            const isOxxoPayment = paymentMethod === 'oxxo';

            if (session.payment_status === 'paid') {
                const orders = await strapi.entityService.findMany('api::order.order', {
                    filters: { stripe_id: session.id },
                });
                if (orders.length > 0) {
                    //obtener metodo de pago
                    const orderId = orders[0].id;
                    await strapi.entityService.update('api::order.order', orderId, {
                        data: { 
                            order_status: 'completed',
                            payment_method: paymentMethod
                        },
                    });
                }
                ctx.body = { 
                    status: 'completed',
                    payment_method: paymentMethod,
                    is_oxxo: isOxxoPayment
                };
            } else if (isOxxoPayment && session.payment_status === 'unpaid') {
                // Para OXXO, mostrar estado pendiente en lugar de fallido
                ctx.body = { 
                    status: 'pending',
                    payment_method: paymentMethod,
                    is_oxxo: isOxxoPayment,
                    message: 'Pago OXXO pendiente. Recibirás confirmación por email una vez completado.'
                };
            } else {
                ctx.body = { 
                    status: 'failed',
                    payment_method: paymentMethod,
                    is_oxxo: isOxxoPayment
                };
            }
        } catch (error) {
            console.error('Error al verificar la sesión de pago:', error);
            ctx.response.status = 500;
            ctx.body = { error: 'Error al verificar el estado del pago' };
        }
    },


    // Manejo de webhook de Stripe optimizado
    async handleWebhook(ctx) {
        const rawBody = ctx.request.body[Symbol.for('unparsedBody')];
        const signature = ctx.request.headers['stripe-signature'];
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

        // Logging de diagnóstico
        console.log('=== WEBHOOK DEBUG INFO ===');
        console.log('Raw body available:', !!rawBody);
        console.log('Signature available:', !!signature);
        console.log('Endpoint secret configured:', !!endpointSecret);
        console.log('Email plugin available:', !!(strapi.plugins['email'] && strapi.plugins['email'].services && strapi.plugins['email'].services.email));
        console.log('Resend API key configured:', !!process.env.RESEND_API_KEY);

        if (!rawBody || !signature) {
            ctx.status = 400;
            ctx.body = 'Cuerpo o firma faltantes';
            return;
        }

        let event;
        try {
            console.log('Verificando la firma del webhook...');
            event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
        } catch (err) {
            console.error('Error verificando la firma del webhook:', err.message);
            ctx.status = 400;
            ctx.body = { error: 'Verificación de firma fallida del webhook' };
            return;
        }

        // Verifica si el evento ya ha sido procesado
        const existingEvent = await strapi.entityService.findMany('api::processed-event.processed-event', {
            filters: { event_id: event.id }
        });

        if (existingEvent.length > 0) {
            console.log(`Evento ya procesado: ${event.id}`);
            ctx.status = 200;
            ctx.body = { received: true };
            return;
        }

        // Procesa el evento con manejo mejorado de errores
        try {
            console.log(`Procesando evento: ${event.id} (${event.type}) - Timestamp: ${event.created}`);
            await processEventWithRetry(event);

            // Marca el evento como procesado
            await strapi.entityService.create('api::processed-event.processed-event', {
                data: {
                    event_id: event.id,
                    event_type: event.type,
                    event_created_at: new Date(event.created * 1000),
                    processed_at: new Date(),
                },
            });

            console.log(`Evento procesado exitosamente: ${event.id}`);
        } catch (err) {
            console.error(`Error procesando el evento ${event.id}:`, err.message);
            // No marcamos como procesado para permitir reintentos
        }

        ctx.status = 200;
        ctx.body = { received: true };
    },




}));








// Mapa para controlar concurrencia por payment_intent_id
const processingEvents = new Map();

/**
 * Procesa eventos con reintentos y control de concurrencia
 */
async function processEventWithRetry(event, maxRetries = 3) {
    const paymentData = event.data?.object;
    if (!paymentData) {
        console.error("Missing payment data in event:", event);
        return;
    }

    const paymentIntentId = paymentData.id;
    
    // Control de concurrencia - evita procesar eventos simultáneos del mismo payment_intent
    if (processingEvents.has(paymentIntentId)) {
        console.log(`Evento ${event.id} en espera - otro evento del mismo payment_intent está siendo procesado`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo
        
        if (processingEvents.has(paymentIntentId)) {
            console.log(`Saltando evento ${event.id} - ya hay uno en proceso para payment_intent ${paymentIntentId}`);
            return;
        }
    }

    processingEvents.set(paymentIntentId, event.id);

    try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await processEventOptimized(event);
                console.log(`Evento ${event.id} procesado exitosamente en intento ${attempt}`);
                break;
            } catch (error) {
                console.error(`Error en intento ${attempt} para evento ${event.id}:`, error.message);
                
                if (attempt === maxRetries) {
                    throw error;
                }
                
                // Esperar antes del siguiente intento (backoff exponencial)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    } finally {
        processingEvents.delete(paymentIntentId);
    }
}

/**
 * Máquina de estados para validar transiciones válidas
 */
const VALID_STATE_TRANSITIONS = {
    'pending': ['processing', 'completed', 'failed', 'canceled', 'expired'],
    'processing': ['completed', 'failed', 'canceled', 'pending'], // Permitir volver a pending
    'completed': ['refunded', 'canceled', 'pending'], // Para casos especiales como OXXO
    'failed': ['pending', 'processing'], // Reintentos
    'canceled': ['pending'], // Permitir reactivación
    'expired': ['pending'], // Reintentos
    'refunded': [] // Estado final
};

/**
 * Valida si una transición de estado es válida
 */
function isValidStateTransition(currentState, newState) {
    if (!currentState) return true; // Primera asignación de estado
    return VALID_STATE_TRANSITIONS[currentState]?.includes(newState) ?? false;
}

/**
 * Procesamiento optimizado de eventos con manejo de estados
 */
async function processEventOptimized(event) {
    console.log(`Procesando evento: ${event.type} (${event.id}) - Created: ${new Date(event.created * 1000).toISOString()}`);
    
    const paymentData = event.data?.object;
    if (!paymentData) {
        throw new Error("Missing payment data in event");
    }

    const created_at = paymentData.created ? new Date(paymentData.created * 1000) : new Date();

    switch (event.type) {
        case 'payment_intent.created':
            await handlePaymentIntentEvent(paymentData, 'created', created_at);
            break;

        case 'payment_intent.succeeded':
            await handlePaymentIntentEvent(paymentData, 'succeeded', created_at);
            break;

        case 'payment_intent.payment_failed':
            await handlePaymentIntentEvent(paymentData, 'failed', created_at);
            break;

        case 'payment_intent.canceled':
            await handlePaymentIntentEvent(paymentData, 'canceled', created_at);
            break;

        case 'payment_intent.requires_action':
            await handlePaymentIntentEvent(paymentData, 'requires_action', created_at);
            
            // Manejo especial para OXXO
            if (paymentData.payment_method_types?.[0] === 'oxxo' && paymentData.status === 'requires_action') {
                console.log(`🏪 Procesando pago OXXO que requiere acción: ${paymentData.id}`);
                
                // NO actualizar orden a completed aquí, solo manejar el voucher
                await handleOxxoPaymentOptimized(paymentData);
                
                console.log(`✅ Pago OXXO procesado - Email enviado, orden mantiene estado pending`);
            }
            break;

        case 'checkout.session.completed':
            // Para OXXO, no procesar como completado hasta que realmente se pague
            const sessionData = await stripe.checkout.sessions.retrieve(paymentData.id);
            const isOxxoSession = sessionData.payment_method_types?.[0] === 'oxxo';
            
            if (isOxxoSession && sessionData.payment_status !== 'paid') {
                console.log(`Sesión OXXO completada pero no pagada: ${paymentData.id} - Manteniendo estado pending`);
                // Solo actualizar que la sesión fue completada, pero mantener orden pending
                await updateOrderStatusOptimized(paymentData.id, 'pending', 'oxxo', true);
            } else {
                await handleCheckoutSessionEvent(paymentData, 'completed', false);
            }
            break;

        case 'checkout.session.async_payment_succeeded':
            await handleCheckoutSessionEvent(paymentData, 'completed', true);
            break;

        case 'checkout.session.async_payment_failed':
            await handleCheckoutSessionEvent(paymentData, 'failed', false);
            break;

        case 'checkout.session.expired':
            await handleCheckoutSessionEvent(paymentData, 'expired', false);
            break;

        default:
            console.log(`Evento no manejado: ${event.type}`);
    }
}



/**
 * Manejo optimizado de eventos de Payment Intent
 */
async function handlePaymentIntentEvent(paymentData, eventType, created_at) {
    console.log(`Procesando Payment Intent: ${paymentData.id} - Evento: ${eventType} - Estado: ${paymentData.status}`);
    
    // Crear o actualizar Payment Intent con control de concurrencia
    const paymentIntent = await createOrUpdatePaymentIntentOptimized(paymentData, created_at);
    
    // Mapear estados de evento a estados de orden
    const orderStatusMap = {
        'created': 'pending',
        'requires_action': 'pending',
        'succeeded': 'completed',
        'failed': 'failed',
        'canceled': 'canceled'
    };

    const newOrderStatus = orderStatusMap[eventType] || paymentData.status;
    
    // Actualizar orden solo si es necesario
    if (newOrderStatus) {
        await updateOrderStatusOptimized(paymentData.id, newOrderStatus, paymentData.payment_method_types?.[0]);
    }
}

/**
 * Manejo optimizado de eventos de Checkout Session
 */
async function handleCheckoutSessionEvent(sessionData, eventType, isAsyncPayment) {
    console.log(`Procesando Checkout Session: ${sessionData.id} - Evento: ${eventType} - Async: ${isAsyncPayment}`);
    
    const statusMap = {
        'completed': 'completed',
        'failed': 'failed',
        'expired': 'expired'
    };

    const newStatus = statusMap[eventType];
    
    if (newStatus === 'completed') {
        await fulfillCheckoutOptimized(sessionData.id, isAsyncPayment);
    } else {
        await updateOrderStatusOptimized(sessionData.id, newStatus, null, true); // isCheckoutSession = true
    }
}

/**
 * Creación/actualización optimizada de Payment Intent con control de duplicados
 */
async function createOrUpdatePaymentIntentOptimized(paymentData, created_at) {
    const paymentIntentId = paymentData.id;
    
    try {
        // Buscar Payment Intent existente
        const existingPaymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
            filters: { paymentintent_id: paymentIntentId },
            limit: 1,
        });

        const paymentIntentData = {
            amount: paymentData.amount,
            pi_status: paymentData.status,
            payment_method: paymentData.payment_method_types?.[0],
            created_at: created_at,
            payment_status: paymentData.status,
            payment_details: paymentData,
            waiting_payment_accreditation: paymentData.status === 'requires_action',
            last_updated: new Date()
        };

        if (existingPaymentIntents.length > 0) {
            const existingPI = existingPaymentIntents[0];
            
            // Solo actualizar si ha cambiado el estado o hay nueva información relevante
            if (existingPI.pi_status !== paymentData.status || 
                existingPI.payment_method !== paymentData.payment_method_types?.[0] ||
                existingPI.amount !== paymentData.amount) {
                
                console.log(`Actualizando Payment Intent ${paymentIntentId}: ${existingPI.pi_status} -> ${paymentData.status}`);
                
                await strapi.service('api::payment-intent.payment-intent').update(existingPI.id, {
                    data: paymentIntentData
                });
                
                return existingPI.id;
            }
            
            return existingPI.id;
        } else {
            console.log(`Creando nuevo Payment Intent: ${paymentIntentId}`);
            
            const newPI = await strapi.service('api::payment-intent.payment-intent').create({
                data: {
                    paymentintent_id: paymentIntentId,
                    ...paymentIntentData
                }
            });
            
            return newPI.id;
        }
    } catch (error) {
        console.error(`Error creando/actualizando payment intent ${paymentIntentId}:`, error);
        throw error;
    }
}

/**
 * Actualización optimizada de estado de orden con validación de transiciones
 */
async function updateOrderStatusOptimized(stripeId, newStatus, paymentMethod = null, isCheckoutSession = false) {
    try {
        let orders = [];
        
        // Primero buscar por stripe_id directamente
        orders = await strapi.entityService.findMany('api::order.order', {
            filters: { stripe_id: stripeId },
            limit: 1,
        });

        // Si no se encuentra y no es una checkout session, buscar por payment_intent asociado
        if (orders.length === 0 && !isCheckoutSession) {
            try {
                // Obtener detalles del payment intent desde Stripe
                const paymentIntent = await stripe.paymentIntents.retrieve(stripeId);
                
                // Si el payment intent tiene invoice, usar ese ID
                if (paymentIntent.invoice) {
                    orders = await strapi.entityService.findMany('api::order.order', {
                        filters: { stripe_id: paymentIntent.invoice },
                        limit: 1,
                    });
                }
                
                // Si aún no se encuentra, buscar usando metadata o client_reference_id del checkout session
                if (orders.length === 0 && paymentIntent.metadata?.order_id) {
                    orders = await strapi.entityService.findMany('api::order.order', {
                        filters: { order_id: paymentIntent.metadata.order_id },
                        limit: 1,
                    });
                }
                
                // Como último recurso, buscar por customer_email si disponible
                if (orders.length === 0 && paymentIntent.receipt_email) {
                    orders = await strapi.entityService.findMany('api::order.order', {
                        filters: { 
                            customer_email: paymentIntent.receipt_email,
                            order_status: { $in: ['pending', 'processing'] } // Solo órdenes que puedan estar esperando pago
                        },
                        sort: { createdAt: 'desc' }, // La más reciente
                        limit: 1,
                    });
                }
            } catch (stripeError) {
                console.error(`Error obteniendo detalles del payment intent ${stripeId}:`, stripeError.message);
            }
        }

        if (orders.length === 0) {
            console.log(`Orden no encontrada para stripe_id: ${stripeId}`);
            return;
        }

        const order = orders[0];
        const currentStatus = order.order_status;
        
        // Validar transición de estado
        if (!isValidStateTransition(currentStatus, newStatus)) {
            console.warn(`Transición de estado inválida para orden ${order.id}: ${currentStatus} -> ${newStatus}`);
            return;
        }

        // Solo actualizar si realmente ha cambiado el estado
        if (currentStatus === newStatus) {
            console.log(`Estado de orden ${order.id} ya es ${newStatus}, saltando actualización`);
            return;
        }

        console.log(`Actualizando orden ${order.id}: ${currentStatus} -> ${newStatus}`);

        const updateData = {
            order_status: newStatus,
            last_updated: new Date(),
        };

        // Actualizar método de pago si se proporciona
        if (paymentMethod) {
            updateData.payment_method = paymentMethod;
        }

        // Configurar campos específicos según el estado
        switch (newStatus) {
            case 'completed':
                updateData.refund_requested = false;
                updateData.order_canceled = false;
                if (!order.order_date) {
                    updateData.order_date = new Date();
                }
                break;
                
            case 'failed':
            case 'canceled':
            case 'expired':
                updateData.order_canceled = true;
                updateData.refund_requested = false;
                
                // Restaurar stock si la orden se cancela
                if (order.products && currentStatus === 'completed') {
                    await updateStockProducts(order.products, "plus");
                }
                break;
        }

        await strapi.entityService.update('api::order.order', order.id, {
            data: updateData
        });

        console.log(`Orden ${order.id} actualizada exitosamente a estado: ${newStatus}`);
        
    } catch (error) {
        console.error(`Error actualizando estado de orden para stripe_id ${stripeId}:`, error);
        throw error;
    }
}


/**
 * Template base para todos los emails con diseño profesional
 */
function createEmailTemplate(content, title = "EverBlack Store") {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f5f5f5;
                line-height: 1.6;
            }
            .email-container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
                background: linear-gradient(135deg, #000000 0%, #333333 100%);
                color: white;
                padding: 30px 40px;
                text-align: center;
            }
            .header h1 {
                margin: 0;
                font-size: 28px;
                font-weight: 300;
                letter-spacing: 2px;
            }
            .content {
                padding: 40px;
                color: #333333;
            }
            .footer {
                background-color: #f8f9fa;
                padding: 30px 40px;
                text-align: center;
                border-top: 1px solid #e9ecef;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h1>EVERBLACK</h1>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <p><strong>EverBlack Store</strong></p>
                <p>Gracias por confiar en nosotros</p>
                <p style="font-size: 12px; color: #999;">
                    Este es un email automático, por favor no responder directamente.<br>
                    Si tienes dudas, contáctanos en <a href="mailto:info@everblack.store" style="color: #000;">info@everblack.store</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Crea template de email para OXXO
 */
function createOxxoEmailTemplate(voucher_url, expire_date) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #000; color: white; padding: 20px; text-align: center;">
                <h1>🏪 Tu pago OXXO está listo</h1>
            </div>
            <div style="padding: 20px;">
                <h2>Instrucciones de pago:</h2>
                <ol>
                    <li><strong>Descarga tu comprobante</strong> haciendo clic en el botón de abajo</li>
                    <li><strong>Ve a cualquier tienda OXXO</strong></li>
                    <li><strong>Presenta el comprobante</strong> en caja</li>
                    <li><strong>Realiza el pago</strong> en efectivo</li>
                    <li><strong>¡Listo!</strong> Recibirás confirmación automática</li>
                </ol>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${voucher_url}" style="background: #ff6600; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        📄 Descargar Comprobante OXXO
                    </a>
                </div>
                
                <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <strong>⚠️ Fecha límite:</strong> ${expire_date}<br>
                    Si no pagas antes de esta fecha, tu pedido será cancelado.
                </div>
                
                <p><strong>Gracias por elegir EverBlack Store 🖤</strong></p>
            </div>
        </div>
    `;
}

/**
 * Email optimizado para voucher OXXO con diseño profesional
 */
async function sendEmailVoucherUrl(email, strapi, mainMessage, voucher_url, expire_date) {
    if (!email || !voucher_url || !expire_date) {
        console.error("Datos incompletos para envío de email OXXO:", {
            email: !!email,
            voucher_url: !!voucher_url,
            expire_date: !!expire_date
        });
        return;
    }

    const formatDate = new Date(expire_date).toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const content = `
        <h2>🏪 Tu voucher de pago OXXO está listo</h2>
        <p>Hola,</p>
        <p>Tu pedido ha sido registrado exitosamente. Para completar tu compra, necesitas realizar el pago en cualquier tienda OXXO.</p>
        
        <div class="alert warning">
            <strong>⚠️ Importante:</strong> Este voucher expira el <strong>${formatDate}</strong>
        </div>

        <div style="text-align: center; margin: 30px 0;">
            <a href="${voucher_url}" class="button">
                📄 Ver mi voucher de pago
            </a>
        </div>

        <div class="alert info">
            <strong>💡 ¿Cómo pagar en OXXO?</strong><br>
            1. Presenta tu voucher (impreso o en tu celular)<br>
            2. Realiza el pago en caja<br>
            3. Recibirás confirmación por email una vez acreditado
        </div>

        <div class="divider"></div>
        
        <p><strong>Detalles importantes:</strong></p>
        <ul style="color: #555;">
            <li>El pago puede tardar hasta 24 horas en acreditarse</li>
            <li>Conserva tu comprobante de pago</li>
            <li>Te notificaremos cuando procese el pago</li>
        </ul>

        <p style="font-size: 14px; color: #666; margin-top: 30px;">
            <strong>¿Problemas con el enlace?</strong><br>
            Copia y pega esta URL en tu navegador:<br>
            <span style="word-break: break-all; background-color: #f8f9fa; padding: 8px; border-radius: 4px; display: inline-block; margin-top: 5px;">${voucher_url}</span>
        </p>
    `;

    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: "🏪 Tu voucher OXXO - EverBlack Store",
            html: createEmailTemplate(content, "Voucher OXXO - EverBlack Store"),
        });
        console.log(`Email voucher OXXO enviado exitosamente a: ${email}`);
    } catch (error) {
        console.error(`Error enviando email voucher OXXO a ${email}:`, error);
        throw error;
    }
}

/**
 * Email de confirmación con diferentes templates según el tipo de pago
 */
async function sendEmailConfirmation(name, email, strapi, products, mainMessage, paymentType = 'card', isAsyncPayment = false) {
    if (!email || !products || products.length === 0) {
        console.error("Datos incompletos para email de confirmación:", {
            email: !!email,
            products: products?.length || 0,
            name: !!name
        });
        return;
    }

    const customerName = name || 'Cliente';
    const totalProducts = products.reduce((sum, product) => sum + (product.stockSelected || 1), 0);
    
    // Generar lista de productos con diseño mejorado
    const productsList = products.map(product => `
        <div class="product-item">
            <div>
                <div class="product-name">${product.product_name || product.slug}</div>
                ${product.size ? `<div style="font-size: 14px; color: #666;">Talla: ${product.size}</div>` : ''}
            </div>
            <div>
                <span class="product-quantity">${product.stockSelected || product.quantity || 1}</span>
            </div>
        </div>
    `).join('');

    // Generar contenido según el tipo de pago
    let content = '';
    let subject = '';
    let alertType = 'success';
    let statusIcon = '✅';
    let statusMessage = '';

    if (paymentType === 'oxxo' && isAsyncPayment) {
        // OXXO - Pago acreditado (asíncrono)
        subject = "🎉 ¡Pago confirmado! Tu pedido está en proceso";
        statusIcon = '🎉';
        statusMessage = 'Tu pago OXXO ha sido confirmado exitosamente';
        alertType = 'success';
        
        content = `
            <h2>${statusIcon} ¡Excelente! Tu pago fue confirmado</h2>
            <p>Hola <strong>${customerName}</strong>,</p>
            <p>Te confirmamos que tu pago via OXXO ha sido acreditado exitosamente. Tu pedido ahora está siendo preparado para envío.</p>
            
            <div class="alert ${alertType}">
                <strong>Estado del pedido:</strong> En preparación 📦<br>
                <strong>Método de pago:</strong> OXXO ✅ Confirmado<br>
                <strong>Próximo paso:</strong> Te notificaremos cuando sea enviado
            </div>
        `;
    } else if (paymentType === 'card') {
        // Tarjeta - Pago inmediato
        subject = "✅ ¡Compra confirmada! Gracias por tu pedido";
        statusIcon = '✅';
        statusMessage = 'Tu pago con tarjeta fue procesado exitosamente';
        alertType = 'success';
        
        content = `
            <h2>${statusIcon} ¡Gracias por tu compra!</h2>
            <p>Hola <strong>${customerName}</strong>,</p>
            <p>Tu pedido ha sido confirmado y el pago procesado exitosamente. Estamos preparando tu pedido para envío.</p>
            
            <div class="alert ${alertType}">
                <strong>Estado del pedido:</strong> Confirmado y en preparación 📦<br>
                <strong>Método de pago:</strong> Tarjeta ✅ Procesado<br>
                <strong>Tiempo estimado:</strong> 24-48 horas para envío
            </div>
        `;
    } else {
        // Genérico o casos especiales
        subject = "📦 Confirmación de pedido - EverBlack Store";
        statusIcon = '📦';
        statusMessage = 'Tu pedido ha sido registrado';
        alertType = 'info';
        
        content = `
            <h2>${statusIcon} Tu pedido ha sido confirmado</h2>
            <p>Hola <strong>${customerName}</strong>,</p>
            <p>${mainMessage}</p>
            
            <div class="alert ${alertType}">
                <strong>Estado:</strong> Pedido confirmado<br>
                <strong>Próximos pasos:</strong> Te mantendremos informado del progreso
            </div>
        `;
    }

    // Continuar con el contenido común
    content += `
        <div class="divider"></div>
        
        <h3 style="color: #000; margin-bottom: 20px;">📋 Resumen de tu pedido</h3>
        <div class="products-list">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #dee2e6;">
                <strong style="color: #000;">Productos (${totalProducts} ${totalProducts === 1 ? 'artículo' : 'artículos'})</strong>
                <strong style="color: #000;">Cantidad</strong>
            </div>
            ${productsList}
        </div>

        <div class="alert info">
            <strong>📱 Seguimiento de pedido:</strong><br>
            Te enviaremos actualizaciones por email sobre el estado de tu pedido.<br>
            También puedes revisar el estado en tu cuenta de EverBlack Store.
        </div>

        <div class="divider"></div>
        
        <h3 style="color: #000;">📞 ¿Necesitas ayuda?</h3>
        <p>Si tienes alguna pregunta sobre tu pedido, no dudes en contactarnos:</p>
        <ul style="color: #555;">
            <li>📧 Email: <a href="mailto:info@everblack.store" style="color: #000;">info@everblack.store</a></li>
            <li>📧 Ventas: <a href="mailto:ventas@everblack.store" style="color: #000;">ventas@everblack.store</a></li>
        </ul>

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 18px; color: #000;"><strong>¡Gracias por elegir EverBlack Store! 🖤</strong></p>
        </div>
    `;

    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: subject,
            html: createEmailTemplate(content, "Confirmación de Pedido - EverBlack Store"),
        });
        console.log(`Email de confirmación enviado exitosamente a: ${email} (${paymentType}, async: ${isAsyncPayment})`);
    } catch (error) {
        console.error(`Error enviando email de confirmación a ${email}:`, error);
        throw error;
    }
}

/**
 * Envía email de confirmación de compra con diseño profesional y rate limiting
 */
async function sendOrderConfirmationEmail(customerName, email, strapi, products, subject = "¡Compra confirmada!", paymentMethod = 'card', isAsyncPayment = false) {
    if (!email || !products || products.length === 0) {
        console.error("Datos incompletos para email de confirmación:", {
            email: !!email,
            products: products?.length || 0,
            name: !!customerName
        });
        return;
    }

    const customerDisplayName = customerName || 'Cliente';
    const totalProducts = products.reduce((sum, product) => sum + (product.stockSelected || 1), 0);
    
    // Generar lista de productos con diseño mejorado
    const productsList = products.map(product => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e9ecef;">
            <div>
                <div style="font-weight: 500; color: #000000;">${product.product_name}</div>
                ${product.size ? `<div style="font-size: 14px; color: #666;">Talla: ${product.size}</div>` : ''}
            </div>
            <div style="background-color: #000000; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">${product.stockSelected || 1}</div>
        </div>
    `).join('');

    // Generar contenido según el tipo de pago
    let statusIcon = '✅';
    let statusMessage = '';
    let alertType = 'success';

    if (paymentMethod === 'oxxo' && isAsyncPayment) {
        statusIcon = '🏪';
        statusMessage = 'Tu pago OXXO fue acreditado exitosamente';
        alertType = 'success';
    } else if (paymentMethod === 'oxxo') {
        statusIcon = '⏳';
        statusMessage = 'Tu pedido está confirmado, pendiente de pago OXXO';
        alertType = 'warning';
    } else {
        statusMessage = isAsyncPayment ? 'Tu pago fue procesado exitosamente' : 'Tu compra fue procesada exitosamente';
    }

    const content = `
        <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #000000; font-size: 28px; margin: 0;">${statusIcon} ${subject}</h2>
        </div>

        <div style="background-color: ${alertType === 'success' ? '#d4edda' : '#fff3cd'}; 
                    border: 1px solid ${alertType === 'success' ? '#c3e6cb' : '#ffeaa7'}; 
                    border-radius: 5px; padding: 20px; margin: 20px 0; 
                    color: ${alertType === 'success' ? '#155724' : '#856404'};">
            <strong>${statusMessage}</strong>
        </div>

        <p>Hola <strong>${customerDisplayName}</strong>,</p>
        <p>Tu pedido ha sido ${paymentMethod === 'oxxo' && !isAsyncPayment ? 'registrado' : 'confirmado'} exitosamente.</p>

        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #000000; margin-top: 0;">📦 Productos de tu pedido (${totalProducts} ${totalProducts === 1 ? 'artículo' : 'artículos'})</h3>
            ${productsList}
        </div>

        ${paymentMethod === 'oxxo' && !isAsyncPayment ? `
            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <strong>⚠️ Pendiente de pago OXXO</strong><br>
                Tu pedido será procesado una vez que completes el pago en OXXO. 
                Revisa tu email para el comprobante de pago.
            </div>
        ` : `
            <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <strong>✅ ¿Qué sigue?</strong><br>
                Nuestro equipo preparará tu pedido y te notificaremos cuando esté listo para envío.
            </div>
        `}

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 18px; color: #000000; margin: 10px 0;">
                <strong>¡Gracias por elegir EverBlack Store! 🖤</strong>
            </p>
            <p style="font-size: 14px; color: #666;">
                Cualquier duda, responde a este email o contáctanos
            </p>
        </div>
    `;

    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: subject,
            html: createEmailTemplate(content, "Confirmación de Compra - EverBlack Store"),
        });
        console.log(`Email de confirmación enviado exitosamente a: ${email}`);
    } catch (error) {
        console.error(`Error enviando email de confirmación a ${email}:`, error);
        throw error;
    }
}

/**
 * Actualiza el stock de productos (suma o resta)
 */
async function updateStockProducts(products, operation = "minus") {
    if (!products || products.length === 0) {
        console.log("No hay productos para actualizar stock");
        return;
    }

    console.log(`Actualizando stock de ${products.length} productos - Operación: ${operation}`);

    for (const product of products) {
        try {
            const { slug_variant, stockSelected, productId } = product;
            const stockAmount = stockSelected || 1;

            if (slug_variant) {
                // Buscar la variante del producto
                const [variantData] = await strapi.entityService.findMany('api::variation.variation', {
                    filters: { slug: slug_variant },
                    limit: 1,
                });

                if (!variantData) {
                    console.error(`La variante "${slug_variant}" no existe para el producto.`);
                    continue;
                }

                // Calcular nuevo stock
                const currentStock = variantData.stock || 0;
                const newStock = operation === "minus" 
                    ? Math.max(0, currentStock - stockAmount)
                    : currentStock + stockAmount;

                // Actualizar stock de la variante
                await strapi.entityService.update('api::variation.variation', variantData.id, {
                    data: { stock: newStock },
                });

                console.log(`Stock variante ${slug_variant}: ${currentStock} -> ${newStock} (${operation} ${stockAmount})`);

            } else if (productId) {
                // Buscar el producto principal
                const [productData] = await strapi.entityService.findMany('api::product.product', {
                    filters: { slug: productId },
                    limit: 1,
                });

                if (!productData) {
                    console.error(`El producto "${productId}" no existe.`);
                    continue;
                }

                // Calcular nuevo stock
                const currentStock = productData.stock || 0;
                const newStock = operation === "minus" 
                    ? Math.max(0, currentStock - stockAmount)
                    : currentStock + stockAmount;

                // Actualizar stock del producto
                await strapi.entityService.update('api::product.product', productData.id, {
                    data: { stock: newStock },
                });

                console.log(`Stock producto ${productId}: ${currentStock} -> ${newStock} (${operation} ${stockAmount})`);
            }

        } catch (error) {
            console.error(`Error actualizando stock del producto:`, error);
            // Continuar con el siguiente producto en caso de error
        }
    }
}

/**
 * Manejo optimizado de pagos OXXO con validación mejorada y rate limiting
 */
async function handleOxxoPaymentOptimized(paymentData) {
    try {
        console.log(`=== PROCESANDO PAGO OXXO ===`);
        console.log(`Payment Intent ID: ${paymentData.id}`);
        console.log(`Payment Intent Status: ${paymentData.status}`);
        console.log(`Receipt Email: ${paymentData.receipt_email}`);
        console.log(`Payment Method Types:`, paymentData.payment_method_types);
        console.log(`Next Action:`, paymentData.next_action);
        
        const voucher_url = paymentData.next_action?.oxxo_display_details?.hosted_voucher_url;
        const expire_days = paymentData.payment_method_options?.oxxo?.expires_after_days;
        const receipt_email = paymentData.receipt_email;

        console.log(`Voucher URL: ${voucher_url}`);
        console.log(`Expire days: ${expire_days}`);
        console.log(`Receipt email: ${receipt_email}`);

        if (!voucher_url || !expire_days) {
            console.error("❌ Datos incompletos para pago OXXO:", {
                voucher_url: !!voucher_url,
                expire_days: !!expire_days,
                paymentIntentId: paymentData.id,
                next_action: paymentData.next_action,
                payment_method_options: paymentData.payment_method_options
            });
            return;
        }

        const expire_date = new Date(Date.now() + expire_days * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0];

        console.log(`Procesando pago OXXO para Payment Intent: ${paymentData.id}`);
        console.log(`Voucher URL generado, expira: ${expire_date}`);

        // Buscar la orden usando el payment intent ID
        const orders = await strapi.entityService.findMany('api::order.order', {
            filters: { stripe_id: paymentData.id },
            limit: 1,
        });

        // Si no se encuentra por payment intent, buscar por checkout session
        let order = null;
        if (orders.length === 0) {
            // Buscar usando metadata del payment intent
            if (paymentData.metadata?.order_id) {
                const ordersByOrderId = await strapi.entityService.findMany('api::order.order', {
                    filters: { order_id: paymentData.metadata.order_id },
                    limit: 1,
                });
                order = ordersByOrderId[0];
            }
        } else {
            order = orders[0];
        }

        // Enviar email con voucher SOLO si hay email y aún no se ha enviado
        if (receipt_email && order) {
            try {
                console.log(`🔄 Enviando email OXXO con rate limiting a: ${receipt_email}`);
                
                // Aplicar delay para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const emailConfig = {
                    to: receipt_email,
                    from: "noreply@everblack.store",
                    subject: "🏪 Tu ficha de pago OXXO - EverBlack Store",
                    html: createOxxoEmailTemplate(voucher_url, expire_date)
                };

                // Intentar envío directo primero, si falla por rate limit, usar reintento
                try {
                    await strapi.plugins['email'].services.email.send(emailConfig);
                    console.log(`✅ Email OXXO enviado exitosamente a: ${receipt_email}`);
                } catch (directError) {
                    if (directError.statusCode === 429) {
                        console.log(`⏱️ Rate limit detectado, programando reintento en 3 segundos`);
                        setTimeout(async () => {
                            try {
                                await strapi.plugins['email'].services.email.send(emailConfig);
                                console.log(`✅ Email OXXO enviado exitosamente (reintento) a: ${receipt_email}`);
                            } catch (retryError) {
                                console.error(`❌ Error en reintento de email OXXO:`, retryError.message);
                            }
                        }, 3000);
                    } else {
                        throw directError;
                    }
                }
                
                // Marcar que el email fue enviado para evitar duplicados
                if (order) {
                    // Solo actualizar si es necesario, sin campos que no existen en el schema
                    console.log(`Email OXXO procesado para orden ${order.id}`);
                }
                
            } catch (emailError) {
                console.error(`❌ Error enviando email OXXO a ${receipt_email}:`, emailError.message || emailError);
                
                // Si es rate limiting, programar reintento
                if (emailError.statusCode === 429) {
                    console.log(`⏱️ Rate limit detectado, programando reintento en 5 segundos`);                        setTimeout(async () => {
                            try {
                                const retryEmailConfig = {
                                    to: receipt_email,
                                    from: "noreply@everblack.store",
                                    subject: "🏪 Tu ficha de pago OXXO - EverBlack Store",
                                    html: createOxxoEmailTemplate(voucher_url, expire_date)
                                };
                                await strapi.plugins['email'].services.email.send(retryEmailConfig);
                                console.log(`✅ Email OXXO enviado exitosamente (reintento) a: ${receipt_email}`);
                            } catch (retryError) {
                                console.error(`❌ Error en reintento de email OXXO:`, retryError.message);
                            }
                        }, 5000);
                }
            }
        } else {
            console.warn(`⚠️ No se puede enviar email OXXO - Email: ${!!receipt_email}, Orden encontrada: ${!!order}`);
        }

        // SOLO actualizar la fecha de última actualización, NO cambiar estado a completed
        console.log(`🔄 Procesamiento OXXO completado para payment intent: ${paymentData.id}`);
        if (order) {
            console.log(`Orden ${order.id} procesada para OXXO`);
        }
        
        console.log(`✅ Procesamiento OXXO completado para Payment Intent: ${paymentData.id}`);
        
    } catch (error) {
        console.error(`❌ Error procesando pago OXXO para ${paymentData.id}:`, error);
        throw error;
    }
}

/**
 * Fulfillment optimizado de checkout con validación mejorada
 */
async function fulfillCheckoutOptimized(sessionId, isAsyncPayment) {
    try {
        console.log(`Iniciando fulfillment para sesión: ${sessionId}, async: ${isAsyncPayment}`);
        
        // Retrieve the Checkout Session
        const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items'],
        });

        const payment_intent_id = checkoutSession.payment_intent;

        if (!payment_intent_id) {
            console.error(`No se encontró payment_intent para sesión: ${sessionId}`);
            return;
        }

        // Buscar Payment Intent en la base de datos
        const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
            filters: { paymentintent_id: payment_intent_id },
            limit: 1,
        });

        // Buscar orden
        const orders = await strapi.entityService.findMany('api::order.order', {
            filters: { stripe_id: sessionId },
            limit: 1,
        });

        if (orders.length === 0) {
            console.error(`Orden no encontrada para sesión: ${sessionId}`);
            return;
        }

        const order = orders[0];

        // Para pagos OXXO, es normal que la sesión esté "unpaid" hasta completar el pago en tienda
        const paymentMethodFromSession = checkoutSession.payment_method_types?.[0];
        const isOxxoPayment = paymentMethodFromSession === 'oxxo' || 
                              checkoutSession.payment_method_options?.oxxo ||
                              order['payment_method'] === 'oxxo';

        // Para OXXO, solo procesar como completado si realmente está pagado
        if (isOxxoPayment) {
            console.log(`Sesión OXXO ${sessionId}. Estado de pago: ${checkoutSession.payment_status}`);
            
            if (checkoutSession.payment_status !== 'paid') {
                console.log(`Sesión OXXO no pagada - NO completando orden. Estado: ${checkoutSession.payment_status}`);
                // Mantener orden pending sin actualizar campos inexistentes
                console.log(`Manteniendo orden ${order.id} en estado pending para OXXO`);
                return;
            } else {
                console.log(`Sesión OXXO completada y pagada - Procesando fulfillment`);
            }
        }

        // Verificar estado de pago - Para otros métodos de pago
        if (checkoutSession.payment_status !== 'paid' && !isOxxoPayment) {
            console.log(`Sesión ${sessionId} no está pagada. Estado: ${checkoutSession.payment_status}`);
            return;
        }

        // Evitar procesar la misma orden múltiples veces
        if (order.order_status === 'completed' && order['payment_credited']) {
            console.log(`Orden ${order.id} ya fue completada previamente`);
            return;
        }

        console.log(`Completando orden ${order.id} para sesión ${sessionId}`);

        // Actualizar orden como completada
        const updateData = {
            shipping_status: 'pending',
            order_status: 'completed',
            payment_credited: true,
            order_canceled: false,
            refund_requested: false,
            order_date: new Date(),
            last_updated: new Date(),
            payment_method: order['payment_method'] || paymentMethodFromSession || 'card'
        };

        // Guardar datos del cliente si están disponibles
        const { name: customerName, email: customerEmail } = checkoutSession.customer_details || {};
        if (customerName) updateData.customer_name = customerName;
        if (customerEmail) updateData.customer_email = customerEmail;

        // Vincular con Payment Intent si existe
        if (paymentIntents.length > 0) {
            updateData.payment_intent = paymentIntents[0].id;
        }

        await strapi.entityService.update('api::order.order', order.id, {
            data: updateData
        });

        console.log(`Orden ${order.id} completada exitosamente`);

        // Enviar email de confirmación con delay para evitar rate limiting
        const { name: emailCustomerName, email: emailCustomerEmail } = checkoutSession.customer_details || {};
        if (emailCustomerEmail && order.products) {
            try {
                // Delay para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Detectar tipo de pago
                const paymentMethod = updateData.payment_method || 'card';
                
                await sendOrderConfirmationEmail(
                    emailCustomerName || order['customer_name'] || 'Cliente', 
                    emailCustomerEmail, 
                    strapi, 
                    order.products, 
                    isAsyncPayment ? "¡Compra confirmada! Tu pago se acreditó con éxito" : "¡Compra confirmada!",
                    paymentMethod,
                    isAsyncPayment
                );
                console.log(`Email de confirmación enviado a: ${emailCustomerEmail} (${paymentMethod}, async: ${isAsyncPayment})`);
            } catch (emailError) {
                console.error(`Error enviando email de confirmación:`, emailError);
                // No lanzar error - la orden ya fue procesada
            }
        }

    } catch (error) {
        console.error(`Error en fulfillment para sesión ${sessionId}:`, error);
        
        // Marcar orden como fallida en caso de error crítico
        try {
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: { stripe_id: sessionId },
                limit: 1,
            });
            
            if (orders.length > 0) {
                await strapi.entityService.update('api::order.order', orders[0].id, {
                    data: { 
                        order_status: 'failed',
                        last_updated: new Date()
                    }
                });
            }
        } catch (updateError) {
            console.error(`Error actualizando orden a fallida:`, updateError);
        }
        
        throw error;
    }
}