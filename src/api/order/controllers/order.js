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
                    // Para órdenes gratuitas, usar email básico en lugar de la función compleja
                    console.log(`Orden gratuita creada para ${user.email} - Email pendiente de configuración`);
                } catch (emailError) {
                    console.error("Error al procesar orden gratuita: ", emailError);
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
            const session = await stripe.checkout.sessions.retrieve(session_id, {
                expand: ['payment_intent']
            });

            // Buscar la orden asociada para contexto adicional
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: { stripe_id: session.id },
                limit: 1
            });

            const order = orders.length > 0 ? orders[0] : null;

            // Usar la función auxiliar para detectar el método de pago
            const { paymentMethod, isOxxo } = detectPaymentMethod(session, session.payment_intent, order);

            console.log(`🔍 Detectando método de pago para sesión ${session_id}:`, {
                session_payment_types: session.payment_method_types,
                pi_payment_types: session.payment_intent?.payment_method_types,
                detected_method: paymentMethod,
                is_oxxo: isOxxo,
                payment_status: session.payment_status,
                order_id: order?.id
            });

            if (session.payment_status === 'paid') {
                if (order) {
                    const orderId = order.id;
                    await strapi.entityService.update('api::order.order', orderId, {
                        data: {
                            order_status: 'completed'
                            // No actualizar payment_method aquí si causa errores de schema
                        },
                    });
                    console.log(`✅ Orden ${orderId} completada con método de pago: ${paymentMethod}`);
                }
                ctx.body = {
                    status: 'completed',
                    payment_method: paymentMethod,
                    is_oxxo: isOxxo
                };
            } else if (isOxxo && session.payment_status === 'unpaid') {
                // Para OXXO, mostrar estado pendiente en lugar de fallido
                console.log(`🏪 Estado OXXO pendiente para sesión ${session_id}`);
                ctx.body = {
                    status: 'pending',
                    payment_method: 'oxxo', // Forzar oxxo explícitamente
                    is_oxxo: true,
                    message: 'Pago OXXO pendiente. Recibirás confirmación por email una vez completado.'
                };
            } else {
                ctx.body = {
                    status: 'failed',
                    payment_method: paymentMethod,
                    is_oxxo: isOxxo
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

// Mapa para controlar emails de confirmación duplicados
const processingEmails = new Map();

/**
 * Controla que solo se envíe un email de confirmación por orden/payment
 */
function startEmailProcessing(orderId, paymentIntentId) {
    const key = `${orderId}-${paymentIntentId}`;
    if (processingEmails.has(key)) {
        console.log(`📧 Email ya en proceso para orden ${orderId} - payment ${paymentIntentId}`);
        return false;
    }
    processingEmails.set(key, Date.now());
    console.log(`📧 Iniciando control de email para orden ${orderId} - payment ${paymentIntentId}`);
    return true;
}

/**
 * Finaliza el control de email
 */
function finishEmailProcessing(orderId, paymentIntentId) {
    const key = `${orderId}-${paymentIntentId}`;
    processingEmails.delete(key);
    console.log(`📧 Finalizando control de email para orden ${orderId} - payment ${paymentIntentId}`);
}

// Control de emails ya inicializado arriba

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
                // Actualizar estado a pending y método de pago a oxxo
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
        // Para OXXO, pasar explícitamente 'oxxo' como método de pago
        const paymentMethodToPass = paymentData.payment_method_types?.[0] === 'oxxo' ? 'oxxo' : paymentData.payment_method_types?.[0];
        await updateOrderStatusOptimized(paymentData.id, newOrderStatus, paymentMethodToPass);
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

        // Extraer los últimos 4 dígitos de la tarjeta si están disponibles
        let last4 = null;
        if (paymentData.charges?.data?.length > 0) {
            const charge = paymentData.charges.data[0];
            if (charge.payment_method_details?.card?.last4) {
                last4 = charge.payment_method_details.card.last4;
                console.log(`💳 Últimos 4 dígitos de tarjeta extraídos del charge: ${last4}`);
            }
        }

        // Si no hay charges en el paymentData, intentar obtenerlos directamente de Stripe
        // Esto es especialmente útil para el evento payment_intent.succeeded
        if (!last4 && paymentData.status === 'succeeded') {
            try {
                console.log(`🔍 Intentando obtener últimos 4 dígitos desde Stripe para PI: ${paymentIntentId}`);
                const fullPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
                    expand: ['charges']
                });

                if (fullPaymentIntent.charges?.data?.length > 0) {
                    const charge = fullPaymentIntent.charges.data[0];
                    if (charge.payment_method_details?.card?.last4) {
                        last4 = charge.payment_method_details.card.last4;
                        console.log(`💳 Últimos 4 dígitos de tarjeta obtenidos desde Stripe API: ${last4}`);
                    }
                }
            } catch (stripeError) {
                console.error(`❌ Error obteniendo charges desde Stripe para PI ${paymentIntentId}:`, stripeError.message);
            }
        }

        const paymentIntentData = {
            amount: paymentData.amount,
            pi_status: paymentData.status,
            payment_method: paymentData.payment_method_types?.[0],
            created_at: created_at,
            payment_status: paymentData.status,
            payment_details: paymentData,
            waiting_payment_accreditation: paymentData.status === 'requires_action',
            last_updated: new Date(),
            last4: last4 // Agregar los últimos 4 dígitos de la tarjeta
        };

        if (existingPaymentIntents.length > 0) {
            const existingPI = existingPaymentIntents[0];

            // Solo actualizar si ha cambiado el estado o hay nueva información relevante
            if (existingPI.pi_status !== paymentData.status ||
                existingPI.payment_method !== paymentData.payment_method_types?.[0] ||
                existingPI.amount !== paymentData.amount ||
                (last4 && existingPI['last4'] !== last4)) { // Actualizar si hay nuevos datos de last4

                console.log(`Actualizando Payment Intent ${paymentIntentId}: ${existingPI.pi_status} -> ${paymentData.status}`);
                if (last4 && existingPI['last4'] !== last4) {
                    console.log(`💳 Actualizando últimos 4 dígitos: ${existingPI['last4'] || 'null'} -> ${last4}`);
                }

                await strapi.service('api::payment-intent.payment-intent').update(existingPI.id, {
                    data: paymentIntentData
                });

                return existingPI.id;
            }

            return existingPI.id;
        } else {
            console.log(`Creando nuevo Payment Intent: ${paymentIntentId}`);
            if (last4) {
                console.log(`💳 Guardando últimos 4 dígitos de tarjeta: ${last4}`);
            }

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
        };

        // Actualizar método de pago si se proporciona
        if (paymentMethod) {
            updateData.order_status = newStatus; // Mantener el nuevo estado
            // Para OXXO, necesitamos forzar la actualización del método de pago
            console.log(`Actualizando método de pago a: ${paymentMethod}`);
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

        console.log(`Orden ${order.id} actualizada exitosamente a estado: ${newStatus}${paymentMethod ? ` con método de pago: ${paymentMethod}` : ''}`);

    } catch (error) {
        console.error(`Error actualizando estado de orden para stripe_id ${stripeId}:`, error);
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
 * Template base para todos los emails con diseño profesional
 */
function createEmailTemplate(content, title = "EverBlack Store") {
    // const logoUrl = `${process.env.PUBLIC_URL}/icons/EverBlackLogo.svg`;
    const logoUrl = `https://www.everblack.store/icons/EverBlackLogo.svg`; // Asegúrate de que esta URL sea accesible públicamente

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
            .logo {
                max-width: 150px;
                height: auto;
                margin-bottom: 15px;
                filter: invert(1) brightness(2);
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
            .footer-logo {
                max-width: 100px;
                height: auto;
                margin-bottom: 10px;
                opacity: 0.7;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <img src="${logoUrl}" alt="EverBlack Logo" class="logo" />
                <h1>EVERBLACK</h1>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <img src="${logoUrl}" alt="EverBlack Logo" class="footer-logo" />
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
 * Crea template de email para OXXO con logo de la empresa
 */
function createOxxoEmailTemplate(voucher_url, expire_date) {
    // const logoUrl = `${process.env.PUBLIC_URL}/icons/EverBlackLogo.svg`;
    const logoUrl = `https://www.everblack.store/icons/EverBlackLogo.svg`; // Asegúrate de que esta URL sea accesible públicamente

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pago OXXO - EverBlack Store</title>
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
                background: linear-gradient(135deg, #ff6600 0%, #ff4400 100%);
                color: white;
                padding: 30px 40px;
                text-align: center;
            }
            .logo {
                max-width: 120px;
                height: auto;
                margin-bottom: 15px;
                filter: invert(1) brightness(2);
            }
            .header h1 {
                margin: 0;
                font-size: 24px;
                font-weight: 500;
            }
            .content {
                padding: 30px;
                color: #333333;
            }
            .oxxo-button {
                display: inline-block;
                background: #ff6600;
                color: white;
                padding: 15px 30px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
                margin: 20px 0;
            }
            .warning-box {
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                border-left: 4px solid #ffb000;
            }
            .steps {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
            }
            .footer {
                background-color: #2c2c2c;
                color: white;
                padding: 30px 40px;
                text-align: center;
            }
            .footer-logo {
                max-width: 80px;
                height: auto;
                margin-bottom: 10px;
                filter: invert(1) brightness(2);
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <img src="${logoUrl}" alt="EverBlack Logo" class="logo" />
                <h1>🏪 Tu pago OXXO está listo</h1>
            </div>
            <div class="content">
                <p>¡Hola!</p>
                <p>Tu pedido de <strong>EverBlack Store</strong> ha sido registrado exitosamente. Para completar tu compra, necesitas realizar el pago en cualquier tienda OXXO.</p>
                
                <div class="steps">
                    <h3>📋 Instrucciones de pago:</h3>
                    <ol>
                        <li><strong>Descarga tu comprobante</strong> haciendo clic en el botón de abajo</li>
                        <li><strong>Ve a cualquier tienda OXXO</strong></li>
                        <li><strong>Presenta el comprobante</strong> en caja (impreso o en tu celular)</li>
                        <li><strong>Realiza el pago</strong> en efectivo</li>
                        <li><strong>¡Listo!</strong> Recibirás confirmación automática por email</li>
                    </ol>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${voucher_url}" class="oxxo-button">
                        📄 Descargar Comprobante OXXO
                    </a>
                </div>
                
                <div class="warning-box">
                    <strong>⚠️ Fecha límite de pago:</strong> ${new Date(expire_date).toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })}<br><br>
                    <strong>Importante:</strong> Si no pagas antes de esta fecha, tu pedido será cancelado automáticamente.
                </div>
                
                <div style="background: #e8f5e8; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #28a745;">
                    <strong>💡 Consejos importantes:</strong>
                    <ul>
                        <li>El pago puede tardar hasta 24 horas en acreditarse</li>
                        <li>Conserva tu ticket de pago hasta recibir la confirmación</li>
                        <li>Te notificaremos por email cuando tu pago sea confirmado</li>
                        <li>Después del pago, tu pedido será preparado para envío</li>
                    </ul>
                </div>
                
                <p style="font-size: 14px; color: #666; margin-top: 30px;">
                    <strong>¿Problemas para acceder al enlace?</strong><br>
                    Copia y pega esta URL en tu navegador:<br>
                    <span style="word-break: break-all; background-color: #f8f9fa; padding: 8px; border-radius: 4px; display: inline-block; margin-top: 5px; font-family: monospace;">${voucher_url}</span>
                </p>
            </div>
            <div class="footer">
                <img src="${logoUrl}" alt="EverBlack Logo" class="footer-logo" />
                <p><strong>EverBlack Store</strong></p>
                <p style="margin: 10px 0;">¡Gracias por elegir EverBlack! 🖤</p>
                <p style="font-size: 12px; opacity: 0.8;">
                    ¿Dudas? Contáctanos en <a href="mailto:info@everblack.store" style="color: #fff;">info@everblack.store</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Sistema de reenvío automático de emails con logs detallados
 */
async function sendEmailWithRetry(emailConfig, maxRetries = 3, baseDelay = 2000) {
    console.log(`📧 === INICIANDO ENVÍO DE EMAIL ===`);
    console.log(`📧 Destinatario: ${emailConfig.to}`);
    console.log(`📧 Asunto: ${emailConfig.subject}`);
    console.log(`📧 From: ${emailConfig.from}`);

    // Verificaciones detalladas
    const emailPluginAvailable = !!(strapi.plugins['email'] && strapi.plugins['email'].services && strapi.plugins['email'].services.email);
    const resendKeyConfigured = !!process.env.RESEND_API_KEY;
    const publicUrlConfigured = !!process.env.PUBLIC_URL;

    console.log(`📧 Plugin de email disponible: ${emailPluginAvailable}`);
    console.log(`📧 RESEND_API_KEY configurado: ${resendKeyConfigured}`);
    console.log(`📧 PUBLIC_URL configurado: ${publicUrlConfigured} (${process.env.PUBLIC_URL})`);

    if (!emailPluginAvailable) {
        console.error(`❌ CRÍTICO: Plugin de email no está disponible`);
        console.error(`   - strapi.plugins existe: ${!!strapi.plugins}`);
        console.error(`   - strapi.plugins['email'] existe: ${!!strapi.plugins['email']}`);
        console.error(`   - services disponibles: ${!!strapi.plugins?.['email']?.services}`);
        console.error(`   - email service disponible: ${!!strapi.plugins?.['email']?.services?.email}`);
        return false;
    }

    if (!resendKeyConfigured) {
        console.error(`❌ CRÍTICO: RESEND_API_KEY no está configurado en el archivo .env`);
        return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📧 Intento ${attempt}/${maxRetries} - Enviando email...`);

            // Agregar headers adicionales para debugging
            const finalConfig = {
                ...emailConfig,
                headers: {
                    'X-Attempt': attempt.toString(),
                    'X-Timestamp': new Date().toISOString(),
                    'X-Service': 'everblack-store'
                }
            };

            console.log(`📧 Configuración final del email:`, {
                to: finalConfig.to,
                from: finalConfig.from,
                subject: finalConfig.subject,
                hasHtml: !!finalConfig.html,
                htmlLength: finalConfig.html?.length || 0
            });

            // Llamada real al servicio de email
            console.log(`📧 Llamando a strapi.plugins['email'].services.email.send...`);
            await strapi.plugins['email'].services.email.send(finalConfig);

            console.log(`✅ Email enviado exitosamente en intento ${attempt}`);
            console.log(`✅ Destinatario: ${emailConfig.to}`);
            console.log(`✅ Asunto: ${emailConfig.subject}`);
            return true;

        } catch (error) {
            const errorMessage = error.message || 'Error desconocido';
            const statusCode = error.statusCode || error.status || error.code || 'N/A';

            console.error(`❌ Error en intento ${attempt}/${maxRetries}:`);
            console.error(`❌ Código de estado: ${statusCode}`);
            console.error(`❌ Mensaje: ${errorMessage}`);
            console.error(`❌ Destinatario: ${emailConfig.to}`);
            console.error(`❌ Tipo de error:`, error.name || 'Unknown');
            console.error(`❌ Error completo:`, JSON.stringify(error, null, 2));

            // Analizar el tipo de error
            if (statusCode === 404) {
                console.error(`🔍 ERROR 404 DETECTADO - Posibles causas:`);
                console.error(`   - API Key de Resend inválida: ${process.env.RESEND_API_KEY?.substring(0, 10)}...`);
                console.error(`   - Endpoint de email no encontrado`);
                console.error(`   - Configuración del plugin incorrecta`);
                console.error(`   - Proveedor de email no disponible`);
            } else if (statusCode === 429) {
                console.error(`⏱️ RATE LIMIT DETECTADO - Esperando más tiempo`);
            } else if (statusCode === 401 || statusCode === 403) {
                console.error(`🔐 ERROR DE AUTENTICACIÓN - Verificar API key`);
                console.error(`   - RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'Configurado' : 'NO CONFIGURADO'}`);
            } else if (statusCode === 400) {
                console.error(`📝 ERROR DE FORMATO - Verificar contenido del email`);
                console.error(`   - Destinatario válido: ${!!emailConfig.to}`);
                console.error(`   - From válido: ${!!emailConfig.from}`);
                console.error(`   - Subject length: ${emailConfig.subject?.length || 'N/A'}`);
                console.error(`   - HTML content: ${!!emailConfig.html}`);
            } else if (errorMessage.includes('connect') || errorMessage.includes('network') || errorMessage.includes('timeout')) {
                console.error(`🌐 ERROR DE CONEXIÓN - Problema de red o conectividad`);
            }

            // Si es el último intento, no continuar
            if (attempt === maxRetries) {
                console.error(`� FALLÓ DESPUÉS DE ${maxRetries} INTENTOS`);
                console.error(`💀 Email que falló: ${emailConfig.to}`);
                console.error(`💀 Último error: ${errorMessage}`);

                // Log para debugging manual
                console.error(`🔧 INFORMACIÓN PARA DEBUG:`);
                console.error(`   - Plugin configurado: ${emailPluginAvailable}`);
                console.error(`   - API Key configurado: ${resendKeyConfigured}`);
                console.error(`   - Proveedor: strapi-provider-email-resend`);
                console.error(`   - From email: ${emailConfig.from}`);
                console.error(`   - To email: ${emailConfig.to}`);

                return false;
            }

            // Calcular delay con backoff exponencial
            const delay = baseDelay * Math.pow(2, attempt - 1);

            // Para rate limiting, esperar más tiempo
            const finalDelay = statusCode === 429 ? delay * 2 : delay;

            console.log(`⏱️ Esperando ${finalDelay}ms antes del siguiente intento...`);
            await new Promise(resolve => setTimeout(resolve, finalDelay));
        }
    }

    return false;
}

/**
 * Función específica para emails OXXO con reenvío automático
 */
async function sendOxxoEmailWithRetry(receipt_email, voucher_url, expire_date) {
    if (!receipt_email || !voucher_url || !expire_date) {
        console.error("❌ Datos incompletos para email OXXO:", {
            email: !!receipt_email,
            voucher_url: !!voucher_url,
            expire_date: !!expire_date
        });
        return false;
    }

    console.log(`🏪 === PREPARANDO EMAIL OXXO ===`);
    console.log(`🏪 Destinatario: ${receipt_email}`);
    console.log(`🏪 Voucher URL: ${voucher_url}`);
    console.log(`🏪 Fecha de expiración: ${expire_date}`);

    const emailConfig = {
        to: receipt_email,
        from: "noreply@everblack.store",
        subject: "🏪 Tu ficha de pago OXXO - EverBlack Store",
        html: createOxxoEmailTemplate(voucher_url, expire_date)
    };

    try {
        const success = await sendEmailWithRetry(emailConfig, 3, 2000);
        if (success) {
            console.log(`🏪 ✅ Email OXXO enviado exitosamente a: ${receipt_email}`);
        } else {
            console.log(`🏪 ❌ No se pudo enviar email OXXO a: ${receipt_email}`);
        }
        return success;
    } catch (error) {
        console.error(`🏪 ❌ Error crítico enviando email OXXO:`, error);
        return false;
    }
}

/**
 * Fulfillment optimizado de checkout con validación mejorada
 */
async function fulfillCheckoutOptimized(sessionId, isAsyncPayment) {
    try {
        console.log(`📦 === INICIANDO FULFILLMENT ===`);
        console.log(`📦 Sesión ID: ${sessionId}`);
        console.log(`📦 Es pago asíncrono: ${isAsyncPayment}`);

        // Retrieve the Checkout Session with payment_intent expandido
        const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items', 'payment_intent', 'payment_intent.charges'],
        });

        const payment_intent_id = checkoutSession.payment_intent?.id || checkoutSession.payment_intent;

        if (!payment_intent_id) {
            console.error(`❌ No se encontró payment_intent para sesión: ${sessionId}`);
            return;
        }

        console.log(`📦 Payment Intent obtenido:`, {
            id: payment_intent_id,
            status: checkoutSession.payment_intent?.status,
            charges_count: checkoutSession.payment_intent?.charges?.data?.length || 0
        });

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
            console.error(`❌ Orden no encontrada para sesión: ${sessionId}`);
            return;
        }

        const order = orders[0];
        // Usar la función auxiliar para detectar método de pago
        const { paymentMethod: detectedPaymentMethod, isOxxo } = detectPaymentMethod(checkoutSession, null, order);

        console.log(`🔍 === INFORMACIÓN COMPLETA DE LA SESIÓN ===`);
        console.log(`🔍 Sesión ID: ${sessionId}`);
        console.log(`🔍 Payment Intent ID: ${payment_intent_id}`);
        console.log(`🔍 Payment Status: ${checkoutSession.payment_status}`);
        console.log(`🔍 Payment Method Types: ${JSON.stringify(checkoutSession.payment_method_types)}`);
        console.log(`🔍 Payment Method Options: ${JSON.stringify(checkoutSession.payment_method_options)}`);
        console.log(`🔍 Payment Intent Status: ${checkoutSession.payment_intent?.status}`);
        console.log(`🔍 Payment Intent Charges: ${checkoutSession.payment_intent?.charges?.data?.length || 0}`);
        if (checkoutSession.payment_intent?.charges?.data?.length > 0) {
            const charge = checkoutSession.payment_intent.charges.data[0];
            console.log(`🔍 First Charge ID: ${charge.id}`);
            console.log(`🔍 First Charge Payment Method Details: ${JSON.stringify(Object.keys(charge.payment_method_details || {}))}`);
        }
        console.log(`🔍 === RESULTADO DETECCIÓN ===`);
        console.log(`🔍 Método detectado: ${detectedPaymentMethod}`);
        console.log(`🔍 Es OXXO: ${isOxxo}`);
        console.log(`🔍 Estado actual de orden: ${order.order_status}`);
        console.log(`🔍 Es pago asíncrono: ${isAsyncPayment}`);

        // VALIDACIÓN CRÍTICA: Solo para OXXO, verificar si realmente está pagado
        if (isOxxo) {
            console.log(`🏪 Procesando sesión OXXO ${sessionId}`);

            if (checkoutSession.payment_status !== 'paid') {
                console.log(`❌ Sesión OXXO no pagada - NO completando orden`);
                console.log(`⏳ Manteniendo orden ${order.id} en estado pending para OXXO`);
                return;
            } else {
                console.log(`✅ Sesión OXXO completada y pagada - Procesando fulfillment`);
            }
        }

        // Verificar estado de pago - Para otros métodos de pago
        if (checkoutSession.payment_status !== 'paid' && !isOxxo) {
            console.log(`❌ Sesión ${sessionId} no está pagada. Estado: ${checkoutSession.payment_status}`);
            return;
        }

        // Evitar procesar la misma orden múltiples veces
        if (order.order_status === 'completed' && order['payment_credited']) {
            console.log(`⚠️ Orden ${order.id} ya fue completada previamente`);
            return;
        }

        console.log(`✅ Completando orden ${order.id} para sesión ${sessionId}`);

        // Actualizar orden como completada
        const updateData = {
            shipping_status: 'pending',
            order_status: 'completed',
            payment_credited: true,
            order_canceled: false,
            refund_requested: false,
            order_date: new Date(),
        };

        console.log(`🏪 Método de pago final para fulfillment: ${detectedPaymentMethod} (isOxxo: ${isOxxo})`);

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

        console.log(`✅ Orden ${order.id} completada exitosamente con método: ${detectedPaymentMethod}`);

        // Enviar email de confirmación con control de duplicados básico
        const { name: emailCustomerName, email: emailCustomerEmail } = checkoutSession.customer_details || {};
        if (emailCustomerEmail && order.products) {
            try {
                console.log(`📧 Preparando email de confirmación para: ${emailCustomerEmail}`);
                console.log(`📧 Orden ID: ${order.id}, Session ID: ${sessionId}`);

                // Delay para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));

                const emailSubject = isAsyncPayment ?
                    "¡Compra confirmada! Tu pago se acreditó con éxito" :
                    "¡Compra confirmada!";

                const emailSuccess = await sendOrderConfirmationEmail(
                    emailCustomerName || order['customer_name'] || 'Cliente',
                    emailCustomerEmail,
                    strapi,
                    order.products,
                    emailSubject,
                    detectedPaymentMethod, // ← Este es el parámetro crítico
                    isAsyncPayment,
                    order.id, // Añadir orderId
                    payment_intent_id // Añadir paymentIntentId
                );

                console.log(`📧 PARÁMETROS ENVIADOS AL EMAIL:`);
                console.log(`   - Método de pago enviado: ${detectedPaymentMethod}`);
                console.log(`   - Es asíncrono: ${isAsyncPayment}`);
                console.log(`   - Asunto: ${emailSubject}`);
                console.log(`   - Destinatario: ${emailCustomerEmail}`);
                console.log(`   - Orden ID: ${order.id}`);

                if (emailSuccess) {
                    console.log(`✅ Email de confirmación enviado a: ${emailCustomerEmail} (${detectedPaymentMethod}, async: ${isAsyncPayment})`);
                } else {
                    console.error(`❌ No se pudo enviar email de confirmación a: ${emailCustomerEmail}`);
                }

            } catch (emailError) {
                console.error(`❌ Error en email de confirmación:`, emailError);
                // No lanzar error - la orden ya fue procesada
            }
        } else {
            console.warn(`⚠️ No se puede enviar email de confirmación:`);
            console.warn(`   - Email disponible: ${!!emailCustomerEmail}`);
            console.warn(`   - Productos disponibles: ${!!order.products}`);
        }

    } catch (error) {
        console.error(`❌ Error en fulfillment para sesión ${sessionId}:`, error);

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
                console.log(`❌ Orden ${orders[0].id} marcada como fallida debido a error en fulfillment`);
            }
        } catch (updateError) {
            console.error(`❌ Error actualizando orden a fallida:`, updateError);
        }

        throw error;
    }
}

/**
 * Función auxiliar para detectar el método de pago de manera robusta
 * Prioriza la detección del método REALMENTE usado, no solo disponible
 */
function detectPaymentMethod(sessionData, paymentIntentData, order = null) {
    console.log(`🔍 === DETECTANDO MÉTODO DE PAGO ===`);
    console.log(`🔍 Session payment_method_types:`, sessionData?.payment_method_types);
    console.log(`🔍 Session payment_status:`, sessionData?.payment_status);
    console.log(`🔍 Session payment_intent:`, sessionData?.payment_intent);
    console.log(`🔍 Payment Intent payment_method_types:`, paymentIntentData?.payment_method_types);
    console.log(`🔍 Session payment_method_options:`, sessionData?.payment_method_options);
    console.log(`🔍 Order existing payment_method:`, order?.payment_method);

    let paymentMethod = 'unknown';
    let isOxxo = false;

    // PRIORIDAD 1: Verificar el payment_intent expandido para obtener el método REAL usado
    if (sessionData?.payment_intent) {
        const pi = sessionData.payment_intent;
        console.log(`🔍 Payment Intent expandido:`, {
            id: pi.id,
            status: pi.status,
            payment_method_types: pi.payment_method_types,
            charges: pi.charges?.data?.length || 0
        });

        // Verificar charges para método real usado
        if (pi.charges?.data?.length > 0) {
            const charge = pi.charges.data[0]; // El primer charge tiene el método usado
            console.log(`🔍 Primer charge:`, {
                id: charge.id,
                payment_method_details: Object.keys(charge.payment_method_details || {})
            });

            if (charge.payment_method_details?.card) {
                console.log(`💳 TARJETA detectada en charge payment_method_details (MÉTODO REAL)`);
                return { paymentMethod: 'card', isOxxo: false };
            }

            if (charge.payment_method_details?.oxxo) {
                console.log(`🏪 OXXO detectado en charge payment_method_details (MÉTODO REAL)`);
                return { paymentMethod: 'oxxo', isOxxo: true };
            }
        }

        // Verificar next_action para OXXO (pago pendiente)
        if (pi.next_action?.oxxo_display_details?.hosted_voucher_url) {
            console.log(`🏪 OXXO detectado en next_action con voucher URL (MÉTODO REAL)`);
            return { paymentMethod: 'oxxo', isOxxo: true };
        }
    }

    // PRIORIDAD 2: Para payment intent directo (sin session)
    if (paymentIntentData && !sessionData) {
        // Verificar next_action para OXXO
        if (paymentIntentData.next_action?.oxxo_display_details?.hosted_voucher_url) {
            console.log(`🏪 OXXO detectado en PaymentIntent next_action`);
            return { paymentMethod: 'oxxo', isOxxo: true };
        }

        // Verificar charges
        if (paymentIntentData.charges?.data?.length > 0) {
            const charge = paymentIntentData.charges.data[0];
            if (charge.payment_method_details?.oxxo) {
                console.log(`🏪 OXXO detectado en PaymentIntent charges`);
                return { paymentMethod: 'oxxo', isOxxo: true };
            }
            if (charge.payment_method_details?.card) {
                console.log(`💳 TARJETA detectada en PaymentIntent charges`);
                return { paymentMethod: 'card', isOxxo: false };
            }
        }
    }

    // PRIORIDAD 3: Verificar si la orden ya tiene OXXO como método
    if (order?.payment_method === 'oxxo') {
        console.log(`🏪 OXXO detectado en orden existente`);
        return { paymentMethod: 'oxxo', isOxxo: true };
    }

    // PRIORIDAD 4: Si no hay información específica del método usado, 
    // usar el estado de la sesión para inferir
    if (sessionData?.payment_status === 'paid') {
        // Si está pagado pero no detectamos método específico, asumir tarjeta
        console.log(`💳 Sesión pagada sin método específico - Asumiendo tarjeta`);
        return { paymentMethod: 'card', isOxxo: false };
    }

    if (sessionData?.payment_status === 'unpaid' &&
        sessionData?.payment_method_types?.includes('oxxo')) {
        // Si no está pagado y OXXO está disponible, podría ser OXXO pendiente
        console.log(`🏪 Sesión no pagada con OXXO disponible - Verificando más detalles`);

        // Solo considerar OXXO si hay evidencia de que fue seleccionado
        if (sessionData?.payment_method_options?.oxxo) {
            console.log(`🏪 OXXO confirmado por opciones específicas`);
            return { paymentMethod: 'oxxo', isOxxo: true };
        }
    }

    // FALLBACK: Usar el primer método disponible (generalmente 'card')
    const firstMethodType = sessionData?.payment_method_types?.[0] ||
        paymentIntentData?.payment_method_types?.[0] ||
        'card';

    console.log(`💳 Método de pago por defecto: ${firstMethodType} (fallback)`);
    console.log(`🔍 === RESULTADO DETECCIÓN ===`);
    console.log(`🔍 Payment Method: ${firstMethodType}, Is OXXO: false`);

    return {
        paymentMethod: firstMethodType,
        isOxxo: false
    };
}

/**
 * Manejo optimizado de pagos OXXO con validación mejorada y rate limiting
 */
async function handleOxxoPaymentOptimized(paymentData) {
    try {
        console.log(`🏪 === PROCESANDO PAGO OXXO ===`);
        console.log(`🏪 Payment Intent ID: ${paymentData.id}`);
        console.log(`🏪 Payment Intent Status: ${paymentData.status}`);
        console.log(`🏪 Receipt Email: ${paymentData.receipt_email}`);
        console.log(`🏪 Payment Method Types:`, paymentData.payment_method_types);
        console.log(`🏪 MÉTODO DE PAGO DETECTADO: OXXO`);
        console.log(`🏪 Next Action:`, paymentData.next_action);

        const voucher_url = paymentData.next_action?.oxxo_display_details?.hosted_voucher_url;
        const expire_days = paymentData.payment_method_options?.oxxo?.expires_after_days;
        const receipt_email = paymentData.receipt_email;

        console.log(`🏪 Voucher URL: ${voucher_url}`);
        console.log(`🏪 Expire days: ${expire_days}`);
        console.log(`🏪 Receipt email: ${receipt_email}`);

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

        console.log(`🏪 Procesando pago OXXO para Payment Intent: ${paymentData.id}`);
        console.log(`🏪 📄 Voucher URL generado, expira: ${expire_date}`);

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

        console.log(`🏪 Orden encontrada: ${order ? order.id : 'NO ENCONTRADA'}`);

        // Enviar email con voucher SOLO si hay email y orden
        if (receipt_email && order) {
            console.log(`📧 Iniciando envío de email OXXO a: ${receipt_email}`);
            console.log(`📧 Plugin de email disponible:`, !!(strapi.plugins['email'] && strapi.plugins['email'].services && strapi.plugins['email'].services.email));
            console.log(`📧 RESEND_API_KEY configurado:`, !!process.env.RESEND_API_KEY);

            try {
                const emailSuccess = await sendOxxoEmailWithRetry(receipt_email, voucher_url, expire_date);

                if (emailSuccess) {
                    console.log(`✅ Email OXXO enviado exitosamente a: ${receipt_email}`);
                    console.log(`🏪 Email confirmado como PAGO OXXO en el asunto y contenido`);
                } else {
                    console.error(`❌ No se pudo enviar email OXXO a: ${receipt_email}`);
                }

            } catch (emailError) {
                console.error(`❌ Error crítico enviando email OXXO a ${receipt_email}:`, emailError);
            }
        } else {
            console.warn(`⚠️ No se puede enviar email OXXO:`);
            console.warn(`   - Email disponible: ${!!receipt_email}`);
            console.warn(`   - Orden encontrada: ${!!order}`);
        }

        // Actualizar orden para mantener estado pending
        console.log(`🔄 Actualizando orden para OXXO payment intent: ${paymentData.id}`);
        if (order) {
            try {
                await strapi.entityService.update('api::order.order', order.id, {
                    data: {
                        order_status: 'pending' // Asegurar que mantenga estado pending
                    }
                });
                console.log(`✅ Orden ${order.id} actualizada: método de pago OXXO, estado pending`);
            } catch (updateError) {
                console.error(`❌ Error actualizando orden ${order.id}:`, updateError);
            }
        }

        console.log(`✅ Procesamiento OXXO completado para Payment Intent: ${paymentData.id}`);

    } catch (error) {
        console.error(`❌ Error procesando pago OXXO para ${paymentData.id}:`, error);
        throw error;
    }
}

/**
 * Envía email de confirmación de compra con diseño profesional y control de duplicados
 */
async function sendOrderConfirmationEmail(customerName, email, strapi, products, subject = "¡Compra confirmada!", paymentMethod = 'card', isAsyncPayment = false, orderId = null, paymentIntentId = null) {
    if (!email || !products || products.length === 0) {
        console.error("❌ Datos incompletos para email de confirmación:", {
            email: !!email,
            products: products?.length || 0,
            name: !!customerName
        });
        return false;
    }

    // Control de emails duplicados usando orderId y paymentIntentId
    const orderIdToUse = orderId || 'unknown';
    const paymentIntentIdToUse = paymentIntentId || 'unknown';

    if (!startEmailProcessing(orderIdToUse, paymentIntentIdToUse)) {
        console.log(`📧 Email de confirmación ya en proceso para orden ${orderIdToUse}, saltando...`);
        return false;
    }

    console.log(`📧 === PREPARANDO EMAIL DE CONFIRMACIÓN ===`);
    console.log(`📧 Orden ID: ${orderIdToUse}`);
    console.log(`📧 Payment Intent ID: ${paymentIntentIdToUse}`);
    console.log(`📧 Destinatario: ${email}`);
    console.log(`📧 Cliente: ${customerName}`);
    console.log(`📧 Método de pago recibido: ${paymentMethod}`);
    console.log(`📧 Es asíncrono: ${isAsyncPayment}`);
    console.log(`📧 Productos: ${products.length}`);
    console.log(`📧 Subject recibido: ${subject}`);

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

    console.log(`📧 EVALUANDO LÓGICA DE EMAIL:`);
    console.log(`📧 paymentMethod === 'oxxo': ${paymentMethod === 'oxxo'}`);
    console.log(`📧 isAsyncPayment: ${isAsyncPayment}`);

    if (paymentMethod === 'oxxo' && isAsyncPayment) {
        statusIcon = '🏪';
        statusMessage = 'Tu pago OXXO fue acreditado exitosamente';
        alertType = 'success';
        console.log(`📧 RAMA: OXXO ASYNC - Pago acreditado`);
    } else if (paymentMethod === 'oxxo') {
        statusIcon = '⏳';
        statusMessage = 'Tu pedido está confirmado, pendiente de pago OXXO';
        alertType = 'warning';
        console.log(`📧 RAMA: OXXO PENDIENTE - Esperando pago`);
    } else {
        statusMessage = isAsyncPayment ? 'Tu pago fue procesado exitosamente' : 'Tu compra fue procesada exitosamente';
        console.log(`📧 RAMA: NO OXXO - Pago procesado con ${paymentMethod}`);
    }

    console.log(`📧 RESULTADO: statusIcon=${statusIcon}, statusMessage=${statusMessage}, alertType=${alertType}`);

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

    const emailConfig = {
        to: email,
        from: "noreply@everblack.store",
        cc: "info@everblack.store",
        bcc: "ventas@everblack.store",
        replyTo: "info@everblack.store",
        subject: subject,
        html: createEmailTemplate(content, "Confirmación de Compra - EverBlack Store"),
    };

    try {
        console.log(`📧 Enviando email de confirmación...`);
        const success = await sendEmailWithRetry(emailConfig, 3, 2000);

        if (success) {
            console.log(`✅ Email de confirmación enviado exitosamente a: ${email} (método: ${paymentMethod})`);
        } else {
            console.error(`❌ No se pudo enviar email de confirmación a: ${email}`);
        }

        // Limpiar el control de duplicados al completar
        finishEmailProcessing(orderIdToUse, paymentIntentIdToUse);

        return success;
    } catch (error) {
        console.error(`❌ Error enviando email de confirmación a ${email}:`, error);

        // Limpiar el control de duplicados en caso de error
        finishEmailProcessing(orderIdToUse, paymentIntentIdToUse);

        return false;
    }
}

/**
 * Función de prueba de emails (solo para desarrollo)
 */
async function testEmail(ctx) {
    console.log(`🧪 === INICIANDO PRUEBA DE EMAIL ===`);

    const testEmailConfig = {
        to: "pspkuroro@gmail.com", // Email de prueba
        from: "noreply@everblack.store",
        subject: "🧪 Prueba de Email - EverBlack Store",
        html: createEmailTemplate(`
            <h2>Prueba de Sistema de Emails</h2>
            <p>Este es un email de prueba para verificar que el sistema funciona correctamente.</p>
            <div style="background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px; padding: 15px; margin: 20px 0;">
                <strong>✅ Sistema funcionando correctamente</strong>
            </div>
            <p>Información del sistema:</p>
            <ul>
                <li>Fecha: ${new Date().toISOString()}</li>
                <li>Servidor: ${process.env.NODE_ENV || 'development'}</li>
                <li>Plugin de email: Disponible</li>
            </ul>
        `, "Prueba de Email - EverBlack Store")
    };

    try {
        console.log(`🧪 Configuración del entorno:`);
        console.log(`   - RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'Configurado' : 'NO CONFIGURADO'}`);
        console.log(`   - PUBLIC_URL: ${process.env.PUBLIC_URL || 'NO CONFIGURADO'}`);
        console.log(`   - Plugin email: ${!!(strapi.plugins['email'] && strapi.plugins['email'].services && strapi.plugins['email'].services.email)}`);

        const success = await sendEmailWithRetry(testEmailConfig, 3, 1000);

        if (success) {
            ctx.body = {
                success: true,
                message: "Email de prueba enviado correctamente",
                timestamp: new Date().toISOString()
            };
        } else {
            ctx.response.status = 500;
            ctx.body = {
                success: false,
                message: "No se pudo enviar el email de prueba",
                timestamp: new Date().toISOString()
            };
        }
    } catch (error) {
        console.error(`🧪 Error en prueba de email:`, error);
        ctx.response.status = 500;
        ctx.body = {
            success: false,
            message: "Error crítico en prueba de email",
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Función de prueba para el sistema de control de emails duplicados
 */
async function testEmailConcurrencyControl(ctx) {
    console.log(`🧪 === INICIANDO PRUEBA DE CONTROL DE CONCURRENCIA ===`);

    const testOrderId = 'test-order-123';
    const testPaymentId = 'pi_test_payment_123';

    try {
        // Primer intento - debería permitir
        const first = startEmailProcessing(testOrderId, testPaymentId);
        console.log(`🧪 Primer intento: ${first ? 'PERMITIDO' : 'BLOQUEADO'}`);

        // Segundo intento - debería bloquear
        const second = startEmailProcessing(testOrderId, testPaymentId);
        console.log(`🧪 Segundo intento: ${second ? 'PERMITIDO' : 'BLOQUEADO'}`);

        // Limpiar el primer procesamiento
        finishEmailProcessing(testOrderId, testPaymentId);
        console.log(`🧪 Procesamiento finalizado`);

        // Tercer intento - debería permitir de nuevo
        const third = startEmailProcessing(testOrderId, testPaymentId);
        console.log(`🧪 Tercer intento después de limpiar: ${third ? 'PERMITIDO' : 'BLOQUEADO'}`);

        // Limpiar
        finishEmailProcessing(testOrderId, testPaymentId);

        ctx.body = {
            success: true,
            message: "Prueba de control de concurrencia completada",
            results: {
                first_attempt: first,
                second_attempt: second,
                third_attempt: third
            },
            expected: {
                first_attempt: true,
                second_attempt: false,
                third_attempt: true
            },
            status: first && !second && third ? "PASSED ✅" : "FAILED ❌"
        };

    } catch (error) {
        console.error(`🧪 Error en prueba de concurrencia:`, error);
        ctx.response.status = 500;
        ctx.body = {
            success: false,
            message: "Error en prueba de concurrencia",
            error: error.message
        };
    }
}