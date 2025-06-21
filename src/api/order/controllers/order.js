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
                    await strapi.entityService.update('api::coupon.coupon', coupon_used.id, {
                        data: { users: user.id },
                    });
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
            const productItems = summary.products.map(product => ({
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: product.product_name,
                    },
                    unit_amount: product.discount > 0 ? product.discountPrice : product.realPrice,
                },
                quantity: product.stockSelected,
            }));

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
                success_url: `${process.env.PUBLIC_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.PUBLIC_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}`,
                line_items: productItems,
                client_reference_id: clientReferenceId,
                customer_email: user.email,
                metadata: { order_id, user_id: user.id },
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

            if (session.payment_status === 'paid') {
                const orders = await strapi.entityService.findMany('api::order.order', {
                    filters: { stripe_id: session.id },
                });
                if (orders.length > 0) {
                    //obtener metodo de pago
                    const orderId = orders[0].id;
                    await strapi.entityService.update('api::order.order', orderId, {
                        data: { order_status: 'completed', },
                    });
                }
                ctx.body = { status: 'completed' };
            } else {
                ctx.body = { status: 'failed' };
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
    'processing': ['completed', 'failed', 'canceled'],
    'completed': ['refunded', 'canceled'], // Solo en casos especiales
    'failed': ['pending', 'processing'], // Reintentos
    'canceled': [], // Estado final
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
                await handleOxxoPaymentOptimized(paymentData);
            }
            break;

        case 'checkout.session.completed':
            await handleCheckoutSessionEvent(paymentData, 'completed', false);
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
 * Manejo optimizado de pagos OXXO con validación mejorada
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

        // Enviar email con voucher
        if (receipt_email) {
            try {
                console.log(`🔄 Intentando enviar email OXXO a: ${receipt_email}`);
                
                // Versión simplificada para testing - Usar configuración similar a emails que funcionan
                const simpleEmailConfig = {
                    to: receipt_email,
                    from: "noreply@everblack.store", // Intentar primero con el dominio principal
                    subject: "Tu pago OXXO está listo - EverBlack Store",
                    html: `
                        <h2>🏪 Tu pago OXXO está listo</h2>
                        <p>Hola,</p>
                        <p>Tu pedido está confirmado. Para completar tu compra, ve a cualquier tienda OXXO y presenta el siguiente comprobante:</p>
                        <p><a href="${voucher_url}" style="background-color: #000; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">📄 Descargar Comprobante OXXO</a></p>
                        <p><strong>Fecha límite:</strong> ${expire_date}</p>
                        <p>Gracias por elegir EverBlack Store 🖤</p>
                    `
                };

                console.log(`📧 Configuración email simplificada:`, simpleEmailConfig);

                try {
                    await strapi.plugins['email'].services.email.send(simpleEmailConfig);
                    console.log(`✅ Email OXXO enviado exitosamente a: ${receipt_email}`);
                } catch (domainError) {
                    console.warn(`⚠️ Fallo con dominio everblack.store, intentando con configuración alternativa`);
                    console.error(`Error dominio principal:`, domainError.message);
                    
                    // Intentar con configuración más básica sin CC/BCC
                    const basicEmailConfig = {
                        to: receipt_email,
                        from: "noreply@everblack.store",
                        subject: "Tu pago OXXO está listo",
                        html: `<p>Tu voucher OXXO: <a href="${voucher_url}">Descargar</a></p><p>Expira: ${expire_date}</p>`
                    };
                    
                    await strapi.plugins['email'].services.email.send(basicEmailConfig);
                    console.log(`✅ Email OXXO básico enviado exitosamente a: ${receipt_email}`);
                }
            } catch (emailError) {
                console.error(`❌ Error enviando email OXXO a ${receipt_email}:`, emailError.message || emailError);
                
                // Si falla el email simplificado, intentar con el template completo
                try {
                    console.log(`🔄 Intentando con template completo...`);
                    await sendOXXOVoucherEmail(
                        receipt_email, 
                        strapi, 
                        "Tu pago requiere acción - OXXO", 
                        voucher_url, 
                        expire_date
                    );
                    console.log(`✅ Email OXXO (template completo) enviado exitosamente a: ${receipt_email}`);
                } catch (templateError) {
                    console.error(`❌ Error también con template completo:`, templateError.message || templateError);
                    // No lanzar error - el voucher sigue siendo válido sin el email
                }
            }
        } else {
            console.warn(`⚠️ No hay receipt_email disponible para enviar el voucher OXXO`);
        }

        // Actualizar orden con estado pending y información de OXXO
        console.log(`🔄 Actualizando orden a estado pending para payment intent: ${paymentData.id}`);
        await updateOrderStatusOptimized(paymentData.id, 'pending', 'oxxo');

        // Enviar email de pedido pendiente para OXXO
        if (receipt_email) {
            try {
                console.log(`🔄 Buscando orden para enviar email de pedido pendiente`);
                // Buscar la orden para obtener productos y datos del cliente
                const orders = await strapi.entityService.findMany('api::order.order', {
                    filters: { stripe_id: paymentData.id },
                    limit: 1,
                });

                console.log(`Órdenes encontradas: ${orders.length}`);

                if (orders.length > 0 && orders[0].products) {
                    console.log(`🔄 Enviando email de pedido pendiente OXXO`);
                    await sendPendingPaymentEmail(
                        orders[0]['customer_name'] || 'Cliente',
                        receipt_email,
                        strapi,
                        orders[0].products,
                        'oxxo'
                    );
                    console.log(`✅ Email de pedido pendiente OXXO enviado a: ${receipt_email}`);
                } else {
                    console.warn(`⚠️ No se encontró orden o productos para enviar email de pedido pendiente`);
                }
            } catch (emailError) {
                console.error(`❌ Error enviando email de pedido pendiente:`, emailError.message || emailError);
                // No lanzar error - no es crítico para el procesamiento del pago
            }
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

        // Verificar estado de pago - Para OXXO permitir procesamiento aún si no está pagado
        if (checkoutSession.payment_status !== 'paid' && !isOxxoPayment) {
            console.log(`Sesión ${sessionId} no está pagada. Estado: ${checkoutSession.payment_status}`);
            return;
        }

        // Para OXXO, solo loguear el estado pero continuar procesando
        if (isOxxoPayment && checkoutSession.payment_status !== 'paid') {
            console.log(`Sesión OXXO ${sessionId} no está pagada. Estado: ${checkoutSession.payment_status} - Continuando procesamiento para OXXO`);
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
            payment_method: order['payment_method'] || 'card'
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

        // Enviar email de confirmación con tipo de pago detectado
        const { name: emailCustomerName, email: emailCustomerEmail } = checkoutSession.customer_details || {};
        if (emailCustomerEmail && order.products) {
            try {
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
            .content h2 {
                color: #000000;
                font-size: 24px;
                margin-bottom: 20px;
                font-weight: 400;
            }
            .content p {
                font-size: 16px;
                margin-bottom: 15px;
                color: #555555;
            }
            .button {
                display: inline-block;
                background: linear-gradient(135deg, #000000 0%, #333333 100%);
                color: white !important;
                padding: 15px 30px;
                text-decoration: none;
                border-radius: 5px;
                font-weight: 500;
                margin: 20px 0;
                transition: transform 0.2s;
            }
            .button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2);
            }
            .alert {
                background-color: #fff3cd;
                border: 1px solid #ffeaa7;
                border-radius: 5px;
                padding: 15px;
                margin: 20px 0;
                color: #856404;
            }
            .alert.success {
                background-color: #d4edda;
                border-color: #c3e6cb;
                color: #155724;
            }
            .alert.warning {
                background-color: #fff3cd;
                border-color: #ffeaa7;
                color: #856404;
            }
            .alert.info {
                background-color: #cce7ff;
                border-color: #b8daff;
                color: #004085;
            }
            .products-list {
                background-color: #f8f9fa;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
            }
            .product-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 0;
                border-bottom: 1px solid #e9ecef;
            }
            .product-item:last-child {
                border-bottom: none;
            }
            .product-name {
                font-weight: 500;
                color: #000000;
            }
            .product-quantity {
                background-color: #000000;
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
            }
            .footer {
                background-color: #f8f9fa;
                padding: 30px 40px;
                text-align: center;
                border-top: 1px solid #e9ecef;
            }
            .footer p {
                margin: 5px 0;
                font-size: 14px;
                color: #6c757d;
            }
            .divider {
                height: 1px;
                background: linear-gradient(to right, transparent, #e9ecef, transparent);
                margin: 30px 0;
            }
            @media (max-width: 600px) {
                .email-container {
                    width: 100% !important;
                }
                .header, .content, .footer {
                    padding: 20px !important;
                }
                .header h1 {
                    font-size: 24px;
                }
                .content h2 {
                    font-size: 20px;
                }
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
                <div class="product-name">${product.product_name}</div>
                ${product.size ? `<div style="font-size: 14px; color: #666;">Talla: ${product.size}</div>` : ''}
            </div>
            <div class="product-quantity">${product.stockSelected || 1}</div>
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
 * Envía email de confirmación de compra con diseño profesional
 */
async function sendOrderConfirmationEmail(customerName, email, strapi, products, subject = "¡Compra confirmada!", paymentMethod = 'card', isAsyncPayment = false) {
    const productsList = products.map(product => `
        <div class="product-item">
            <div>
                <div class="product-name">${product.product_name || product.slug}</div>
                ${product.slug_variant ? `<div style="color: #666; font-size: 14px;">Variante: ${product.slug_variant}</div>` : ''}
            </div>
            <div>
                <span class="product-quantity">${product.stockSelected || product.quantity || 1}</span>
            </div>
        </div>
    `).join('');

    const paymentMethodText = {
        'card': '💳 Tarjeta de Crédito/Débito',
        'oxxo': '🏪 OXXO',
        'free': '🎁 Orden Gratuita',
        'spei': '🏦 Transferencia SPEI'
    }[paymentMethod] || '💳 Pago en línea';

    const asyncText = isAsyncPayment ? `
        <div class="alert success">
            <strong>✅ Tu pago se acreditó exitosamente</strong><br>
            Recibimos la confirmación de tu pago ${paymentMethodText.toLowerCase()}.
        </div>
    ` : '';

    const content = `
        <div class="alert success">
            <strong>🎉 ¡Tu compra ha sido confirmada!</strong>
        </div>

        <p>Hola <strong>${customerName}</strong>,</p>
        
        <p>Nos complace confirmar que hemos recibido tu pedido exitosamente.</p>

        ${asyncText}

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #000; margin-top: 0;">📦 Detalles del Pedido</h3>
            <p><strong>Método de Pago:</strong> ${paymentMethodText}</p>
            <p><strong>Estado:</strong> ${isAsyncPayment ? 'Pago Confirmado ✅' : 'Procesando'}</p>
        </div>

        <div class="products-list">
            <h3 style="margin-top: 0; color: #000;">🛍️ Productos Pedidos</h3>
            ${productsList}
        </div>

        <div class="alert info">
            <strong>📧 Próximos pasos:</strong><br>
            • Recibirás un email con el número de seguimiento una vez que tu pedido sea enviado<br>
            • Si tienes preguntas, puedes contactarnos respondiendo a este email
        </div>

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 16px; color: #000;"><strong>Gracias por elegir EverBlack Store 🖤</strong></p>
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
        console.log(`Email de confirmación enviado exitosamente a: ${email} (${paymentMethod})`);
    } catch (error) {
        console.error(`Error enviando email de confirmación a ${email}:`, error);
        throw error;
    }
}

/**
 * Envía email con voucher de pago OXXO
 */
async function sendOXXOVoucherEmail(email, strapi, subject, voucher_url, expire_date) {
    console.log(`=== ENVIANDO EMAIL OXXO ===`);
    console.log(`Email destinatario: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log(`Voucher URL: ${voucher_url}`);
    console.log(`Fecha expiración: ${expire_date}`);
    
    const content = `
        <div class="alert warning">
            <strong>🏪 Tu pago OXXO está listo</strong>
        </div>

        <p>Hola,</p>
        
        <p>Tu pedido está confirmado, pero <strong>requiere que completes el pago en OXXO</strong> para ser procesado.</p>

        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0;">
            <h3 style="color: #856404; margin-top: 0;">📋 Instrucciones de Pago</h3>
            <p style="color: #856404;"><strong>1.</strong> Haz clic en el botón de abajo para descargar tu comprobante</p>
            <p style="color: #856404;"><strong>2.</strong> Ve a cualquier tienda OXXO</p>
            <p style="color: #856404;"><strong>3.</strong> Presenta el comprobante en caja</p>
            <p style="color: #856404;"><strong>4.</strong> Realiza el pago</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
            <a href="${voucher_url}" class="button" style="font-size: 18px; padding: 20px 40px;">
                📄 Descargar Comprobante OXXO
            </a>
        </div>

        <div class="alert warning">
            <strong>⚠️ Fecha límite de pago:</strong> ${expire_date}<br>
            Si no realizas el pago antes de esta fecha, tu pedido será cancelado automáticamente.
        </div>

        <div class="alert info">
            <strong>💡 Consejos importantes:</strong><br>
            • Guarda este email hasta completar tu pago<br>
            • El comprobante es único para tu pedido<br>
            • Una vez pagado, recibirás confirmación por email<br>
            • Si tienes dudas, contáctanos
        </div>

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 16px; color: #000;"><strong>Gracias por elegir EverBlack Store 🖤</strong></p>
        </div>
    `;

    try {
        // Verificar que el plugin de email esté disponible
        if (!strapi.plugins['email'] || !strapi.plugins['email'].services || !strapi.plugins['email'].services.email) {
            throw new Error('Plugin de email no está disponible o configurado correctamente');
        }

        console.log('=== CONFIGURACIÓN EMAIL ===');
        console.log('Plugin email disponible:', !!strapi.plugins['email']);
        console.log('Servicio email disponible:', !!strapi.plugins['email']?.services?.email);
        console.log('RESEND_API_KEY configurado:', !!process.env.RESEND_API_KEY);

        const emailConfig = {
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: subject,
            html: createEmailTemplate(content, "Pago OXXO Requerido - EverBlack Store"),
        };

        console.log('=== ENVIANDO EMAIL ===');
        console.log('Configuración email:', JSON.stringify(emailConfig, null, 2));

        await strapi.plugins['email'].services.email.send(emailConfig);
        console.log(`✅ Email OXXO enviado exitosamente a: ${email}`);
    } catch (error) {
        console.error(`❌ Error enviando email OXXO a ${email}:`, error);
        
        // Log más detallado del error
        if (error.response) {
            console.error('Error response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        
        if (error.request) {
            console.error('Error request:', error.request);
        }
        
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        // Re-lanzar solo si es un error crítico, pero no para errores de configuración de email
        if (error.message.includes('Plugin de email no está disponible')) {
            console.warn('Plugin de email no configurado - continuando sin enviar email');
        } else {
            throw error;
        }
    }
}

/**
 * Envía email de pedido pendiente de pago
 */
async function sendPendingPaymentEmail(customerName, email, strapi, products, paymentMethod = 'card') {
    const productsList = products.map(product => `
        <div class="product-item">
            <div>
                <div class="product-name">${product.product_name || product.slug}</div>
                ${product.slug_variant ? `<div style="color: #666; font-size: 14px;">Variante: ${product.slug_variant}</div>` : ''}
            </div>
            <div>
                <span class="product-quantity">${product.stockSelected || product.quantity || 1}</span>
            </div>
        </div>
    `).join('');

    const paymentMethodText = {
        'card': '💳 Tarjeta de Crédito/Débito',
        'oxxo': '🏪 OXXO',
        'spei': '🏦 Transferencia SPEI'
    }[paymentMethod] || '💳 Pago en línea';

    const paymentInstructions = paymentMethod === 'oxxo' 
        ? `<div class="alert warning">
            <strong>🏪 Instrucciones para OXXO:</strong><br>
            • Ve a cualquier tienda OXXO con tu comprobante<br>
            • Presenta el código en caja<br>
            • Realiza el pago<br>
            • Recibirás confirmación automática por email
        </div>`
        : `<div class="alert info">
            <strong>💳 Completar pago:</strong><br>
            • Tu pago está siendo procesado<br>
            • Recibirás confirmación una vez acreditado<br>
            • Si hay algún problema, te contactaremos
        </div>`;

    const content = `
        <div class="alert warning">
            <strong>⏳ Tu pedido está pendiente de pago</strong>
        </div>

        <p>Hola <strong>${customerName}</strong>,</p>
        
        <p>Hemos recibido tu pedido, pero está <strong>pendiente de confirmación de pago</strong>.</p>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #000; margin-top: 0;">📦 Detalles del Pedido</h3>
            <p><strong>Método de Pago:</strong> ${paymentMethodText}</p>
            <p><strong>Estado:</strong> Pendiente de Pago</p>
        </div>

        <div class="products-list">
            <h3 style="margin-top: 0; color: #000;">🛍️ Productos Reservados</h3>
            ${productsList}
        </div>

        ${paymentInstructions}

        <div class="alert info">
            <strong>📧 ¿Qué sigue?</strong><br>
            • Una vez confirmado el pago, procesaremos tu pedido inmediatamente<br>
            • Te enviaremos la confirmación y número de seguimiento<br>
            • Si tienes preguntas, no dudes en contactarnos
        </div>

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 16px; color: #000;"><strong>Gracias por elegir EverBlack Store 🖤</strong></p>
        </div>
    `;

    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: "Pedido Pendiente de Pago - EverBlack Store",
            html: createEmailTemplate(content, "Pedido Pendiente - EverBlack Store"),
        });
        console.log(`Email de pedido pendiente enviado exitosamente a: ${email} (${paymentMethod})`);
    } catch (error) {
        console.error(`Error enviando email de pedido pendiente a ${email}:`, error);
        throw error;
    }
}

/**
 * Email para notificar que el pedido está pendiente de acreditación de pago
 */
async function sendEmailPendingPayment(name, email, strapi, products, paymentMethod = 'oxxo') {
    if (!email || !products || products.length === 0) {
        console.error("Datos incompletos para email de pedido pendiente:", {
            email: !!email,
            products: products?.length || 0,
            name: !!name
        });
        return;
    }

    const customerName = name || 'Cliente';
    const totalProducts = products.reduce((sum, product) => sum + (product.stockSelected || 1), 0);
    
    // Generar lista de productos
    const productsList = products.map(product => `
        <div class="product-item">
            <div>
                <div class="product-name">${product.product_name}</div>
                ${product.size ? `<div style="font-size: 14px; color: #666;">Talla: ${product.size}</div>` : ''}
            </div>
            <div class="product-quantity">${product.stockSelected || 1}</div>
        </div>
    `).join('');

    let subject = '';
    let statusIcon = '';
    let statusMessage = '';
    let timeMessage = '';
    
    if (paymentMethod === 'oxxo') {
        subject = "⏳ Pedido registrado - Esperando confirmación de pago OXXO";
        statusIcon = '⏳';
        statusMessage = 'Hemos registrado tu pedido y estamos esperando la confirmación de tu pago OXXO';
        timeMessage = 'Los pagos OXXO pueden tardar hasta 24 horas en acreditarse';
    } else {
        subject = "⏳ Pedido registrado - Esperando confirmación de pago";
        statusIcon = '⏳';
        statusMessage = 'Tu pedido ha sido registrado y estamos esperando la confirmación del pago';
        timeMessage = 'Te notificaremos tan pronto como se confirme el pago';
    }

    const content = `
        <h2>${statusIcon} Tu pedido está siendo procesado</h2>
        <p>Hola <strong>${customerName}</strong>,</p>
        <p>${statusMessage}</p>
        
        <div class="alert warning">
            <strong>Estado actual:</strong> Esperando confirmación de pago 💳<br>
            <strong>Método de pago:</strong> ${paymentMethod.toUpperCase()}<br>
            <strong>Tiempo estimado:</strong> ${timeMessage}
        </div>

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
            <strong>📱 ¿Qué sigue?</strong><br>
            1. Confirmaremos tu pago automáticamente<br>
            2. Te enviaremos un email de confirmación<br>
            3. Procederemos a preparar tu pedido para envío
        </div>

        <div class="divider"></div>
        
        <h3 style="color: #000;">📞 ¿Tienes dudas?</h3>
        <p>Si tienes alguna pregunta sobre tu pedido o el proceso de pago:</p>
        <ul style="color: #555;">
            <li>📧 Email: <a href="mailto:info@everblack.store" style="color: #000;">info@everblack.store</a></li>
            <li>📧 Ventas: <a href="mailto:ventas@everblack.store" style="color: #000;">ventas@everblack.store</a></li>
        </ul>

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 16px; color: #666;">Gracias por tu paciencia mientras procesamos tu pago 🖤</p>
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
            html: createEmailTemplate(content, "Pedido Pendiente - EverBlack Store"),
        });
        console.log(`Email de pedido pendiente enviado exitosamente a: ${email} (${paymentMethod})`);
    } catch (error) {
        console.error(`Error enviando email de pedido pendiente a ${email}:`, error);
        throw error;
    }
}

/**
 * Email para actualizaciones de seguimiento del pedido (envío, entrega, etc.)
 */
async function sendEmailOrderUpdate(name, email, strapi, orderId, status, trackingInfo = null) {
    if (!email || !orderId || !status) {
        console.error("Datos incompletos para email de actualización:", {
            email: !!email,
            orderId: !!orderId,
            status: !!status
        });
        return;
    }

    const customerName = name || 'Cliente';
    let subject = '';
    let statusIcon = '';
    let mainMessage = '';
    let alertType = 'info';
    let additionalContent = '';

    switch (status) {
        case 'shipped':
            subject = "📦 ¡Tu pedido está en camino!";
            statusIcon = '🚚';
            mainMessage = 'Tu pedido ha sido enviado y está en camino hacia ti';
            alertType = 'success';
            additionalContent = trackingInfo ? `
                <div class="alert info">
                    <strong>📍 Información de seguimiento:</strong><br>
                    <strong>Número de guía:</strong> ${trackingInfo.trackingNumber || 'Por asignar'}<br>
                    <strong>Paquetería:</strong> ${trackingInfo.carrier || 'Por confirmar'}<br>
                    <strong>Tiempo estimado:</strong> ${trackingInfo.estimatedDays || '2-5'} días hábiles
                </div>
                ${trackingInfo.trackingUrl ? `
                <div style="text-align: center; margin: 20px 0;">
                    <a href="${trackingInfo.trackingUrl}" class="button">
                        📍 Rastrear mi pedido
                    </a>
                </div>
                ` : ''}
            ` : '';
            break;

        case 'delivered':
            subject = "✅ ¡Tu pedido ha sido entregado!";
            statusIcon = '🎉';
            mainMessage = '¡Excelente! Tu pedido ha sido entregado exitosamente';
            alertType = 'success';
            additionalContent = `
                <div class="alert success">
                    <strong>🎯 ¡Entrega confirmada!</strong><br>
                    Tu pedido fue entregado en la dirección especificada.<br>
                    Esperamos que disfrutes tus productos EverBlack.
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <p style="font-size: 16px; color: #000;">
                        <strong>¿Te gustó tu experiencia? 🖤</strong><br>
                        <span style="color: #666;">Nos encantaría conocer tu opinión</span>
                    </p>
                </div>
            `;
            break;

        case 'processing':
            subject = "🔄 Tu pedido está siendo preparado";
            statusIcon = '⚙️';
            mainMessage = 'Estamos preparando tu pedido con mucho cuidado';
            alertType = 'info';
            additionalContent = `
                <div class="alert info">
                    <strong>📦 Estado actual:</strong> Preparando pedido<br>
                    <strong>⏱️ Tiempo estimado:</strong> 24-48 horas<br>
                    <strong>📧 Siguiente actualización:</strong> Notificación de envío
                </div>
            `;
            break;

        case 'cancelled':
            subject = "❌ Tu pedido ha sido cancelado";
            statusIcon = '❌';
            mainMessage = 'Tu pedido ha sido cancelado';
            alertType = 'warning';
            additionalContent = `
                <div class="alert warning">
                    <strong>🔄 Reembolso:</strong> Si ya realizaste el pago, será reembolsado automáticamente<br>
                    <strong>⏱️ Tiempo de reembolso:</strong> 5-10 días hábiles<br>
                    <strong>📧 Dudas:</strong> Contáctanos si necesitas más información
                </div>
            `;
            break;

        default:
            subject = "📋 Actualización de tu pedido";
            statusIcon = '📋';
            mainMessage = `Tu pedido ha sido actualizado - Estado: ${status}`;
            alertType = 'info';
    }

    const content = `
        <h2>${statusIcon} ${subject.replace(/^[^\s]+ /, '')}</h2>
        <p>Hola <strong>${customerName}</strong>,</p>
        <p>${mainMessage}</p>
        
        <div class="alert ${alertType}">
            <strong>Número de pedido:</strong> #${orderId}<br>
            <strong>Estado actual:</strong> ${status.charAt(0).toUpperCase() + status.slice(1)}<br>
            <strong>Fecha de actualización:</strong> ${new Date().toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}
        </div>

        ${additionalContent}

        <div class="divider"></div>
        
        <h3 style="color: #000;">📞 ¿Necesitas ayuda?</h3>
        <p>Si tienes alguna pregunta sobre tu pedido:</p>
        <ul style="color: #555;">
            <li>📧 Email: <a href="mailto:info@everblack.store" style="color: #000;">info@everblack.store</a></li>
            <li>📧 Ventas: <a href="mailto:ventas@everblack.store" style="color: #000;">ventas@everblack.store</a></li>
        </ul>

        <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 16px; color: #000;"><strong>Gracias por elegir EverBlack Store 🖤</strong></p>
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
            html: createEmailTemplate(content, "Actualización de Pedido - EverBlack Store"),
        });
        console.log(`Email de actualización enviado exitosamente a: ${email} (${status})`);
    } catch (error) {
        console.error(`Error enviando email de actualización a ${email}:`, error);
        throw error;
    }
}

// Función obsoleta - removida en favor de updateOrderStatusOptimized
// async function updateOrderPaymentMethod(paymentData, async_payment = false) {
//     // Lógica movida a updateOrderStatusOptimized para mejor control de estados
// }

/**
 * Actualización optimizada de stock con validación mejorada
 */
async function updateStockProducts(products, action) {
    if (!products || !Array.isArray(products) || products.length === 0) {
        console.log("No hay productos para actualizar stock");
        return;
    }

    console.log(`Actualizando stock de ${products.length} productos - Acción: ${action}`);
    
    const errors = [];
    const updated = [];

    for (const product of products) {
        try {
            const { slug_variant, stockSelected, slug, product_name } = product;
            
            if (!stockSelected || stockSelected <= 0) {
                console.warn(`Stock inválido para producto ${product_name}: ${stockSelected}`);
                continue;
            }

            if (slug_variant) {
                // Producto con variante
                const variants = await strapi.entityService.findMany('api::variation.variation', {
                    filters: { slug: slug_variant },
                    limit: 1,
                });

                if (variants.length === 0) {
                    errors.push(`Variante no encontrada: ${slug_variant}`);
                    continue;
                }

                const variant = variants[0];
                const newStock = action === "minus" 
                    ? Math.max(0, variant.stock - stockSelected)
                    : variant.stock + stockSelected;
                
                const newUnitsSold = action === "minus"
                    ? variant.units_sold + stockSelected
                    : Math.max(0, variant.units_sold - stockSelected);

                await strapi.entityService.update('api::variation.variation', variant.id, {
                    data: {
                        stock: newStock,
                        units_sold: newUnitsSold,
                        last_updated: new Date()
                    },
                });

                updated.push(`Variante ${slug_variant}: stock ${variant.stock} -> ${newStock}`);

            } else {
                // Producto sin variante
                const mainProducts = await strapi.entityService.findMany('api::product.product', {
                    filters: { slug: slug },
                    limit: 1,
                });

                if (mainProducts.length === 0) {
                    errors.push(`Producto no encontrado: ${slug}`);
                    continue;
                }

                const mainProduct = mainProducts[0];
                const newStock = action === "minus"
                    ? Math.max(0, mainProduct.stock - stockSelected)
                    : mainProduct.stock + stockSelected;
                
                const newUnitsSold = action === "minus"
                    ? mainProduct.units_sold + stockSelected
                    : Math.max(0, mainProduct.units_sold - stockSelected);

                await strapi.entityService.update('api::product.product', mainProduct.id, {
                    data: {
                        stock: newStock,
                        units_sold: newUnitsSold,
                        last_updated: new Date()
                    },
                });

                updated.push(`Producto ${slug}: stock ${mainProduct.stock} -> ${newStock}`);
            }

        } catch (error) {
            const errorMsg = `Error actualizando stock de ${product.product_name || product.slug}: ${error.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
        }
    }

    if (updated.length > 0) {
        console.log(`Stock actualizado exitosamente:\n${updated.join('\n')}`);
    }

    if (errors.length > 0) {
        console.error(`Errores actualizando stock:\n${errors.join('\n')}`);
    }
}

