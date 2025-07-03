'use strict';


const stripe = require('stripe')(process.env.STRIPE_KEY);
const { v4: uuidv4 } = require('uuid');
const { createCoreController } = require('@strapi/strapi').factories;
const generateUniqueID = require('../../../scripts/generateUniqueID');
const { RateLimiterMemory } = require('rate-limiter-flexible');


const retryQueue = [];
const MAX_RETRIES = 3; // Número máximo de reintentos
const RETRY_DELAY = 5000; // Tiempo en milisegundos entre reintentos

// Configuración del rate limiter para proteger createSecure
const rateLimiter = new RateLimiterMemory({
    points: 5, // 5 intentos
    duration: 600, // por cada 10 minutos
});




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
                    // Registrar que el usuario ha usado este cupón
                    await registerCouponUsage(user.id, coupon_used.id);
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

        // Debug: Ver qué datos estamos recibiendo
        console.log('🔍 [ORDER] Datos recibidos en create:');
        console.log('- Usuario:', user?.id, user?.email);
        console.log('- Summary:', summary);
        console.log('- Productos en summary:', summary?.products);
        console.log('- Dirección:', address?.id);

        try {
            const productItems = summary.products.map(product => {
                console.log('🔍 [ORDER] Procesando producto:', product);

                // Crear nombre del producto incluyendo variación si existe
                let productName = product.product_name;
                if (product.size && product.size.trim() !== '') {
                    // Extraer solo el nombre de la talla (antes del primer guión si existe)
                    const sizeName = product.size.split('-')[0];
                    productName = `${product.product_name} - Talla: ${sizeName}`;
                }                // Normalizar precios - manejar ambos formatos (carrito vs compra directa)
                let unitAmount;

                if (product.discountPrice && product.discountPrice > 0) {
                    // Formato del carrito: discountPrice ya viene en centavos después de normalización
                    unitAmount = Math.round(product.discountPrice);
                } else if (product.discount && product.discount > 0) {
                    // Formato de compra directa: calcular precio con descuento
                    // realPrice ya viene en centavos desde calculatePriceProduct o fue normalizado
                    const discountedPrice = product.realPrice * (1 - product.discount / 100);
                    unitAmount = Math.round(discountedPrice);
                } else {
                    // Sin descuento: usar precio real
                    // realPrice ya viene en centavos o fue normalizado
                    unitAmount = Math.round(product.realPrice);
                }

                console.log(`💰 [ORDER] Precio calculado para ${productName}:`, {
                    realPrice: product.realPrice,
                    realPriceInPesos: product.realPrice / 100,
                    discount: product.discount,
                    discountPrice: product.discountPrice,
                    discountPriceInPesos: product.discountPrice ? product.discountPrice : 'N/A',
                    unitAmount: unitAmount,
                    unitAmountInPesos: unitAmount / 100
                });

                return {
                    price_data: {
                        currency: 'mxn',
                        product_data: {
                            name: productName,
                        },
                        unit_amount: unitAmount,
                    },
                    quantity: product.stockSelected,
                };
            });

            const shipping_cost = summary.shipping_cost;
            console.log('🚚 [ORDER] Shipping cost recibido:', {
                shipping_cost,
                shipping_cost_in_pesos: shipping_cost / 100,
                is_free: shipping_cost === 0
            });
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
                billing_address_collection: 'auto',
                shipping_options: [
                    {
                        shipping_rate_data: {
                            display_name: 'Costo de envío',
                            type: 'fixed_amount',
                            fixed_amount: {
                                amount: shipping_cost, // shipping_cost ya viene en centavos del frontend
                                currency: 'mxn',
                            },
                        },
                    },
                ],
            };

            let subtotal = products.reduce((sum, product) => sum + product.realPrice * product.stockSelected, 0);

            // Configurar cupón de descuento si se aplica
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
            } else {
                // Solo establecer allow_promotion_codes si NO hay cupón aplicado
                sessionData.allow_promotion_codes = false;
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

    // Crear nueva orden y sesión de Stripe - VERSIÓN SEGURA
    async createSecure(ctx) {
        // Rate limiting por IP
        let ip = ctx.request.ip || ctx.request.header['x-forwarded-for'] || ctx.request.headers['x-real-ip'] || ctx.req.connection.remoteAddress;
        if (Array.isArray(ip)) {
            ip = ip[0]; // Tomar el primer valor si es un array
        }
        try {
            await rateLimiter.consume(ip);
        } catch (rejRes) {
            ctx.status = 429;
            ctx.body = { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' };
            return;
        }

        const { products, userId, couponId, addressId } = ctx.request.body;

        console.log('🔒 [ORDER-SECURE] Datos recibidos:', {
            products: products?.length || 0,
            userId,
            couponId,
            addressId,
            addressIdType: typeof addressId,
            addressIdValue: addressId,
            produc: products[0]
        });

        try {
            // Paso 1: Validar y calcular la orden
            console.log('🔍 [ORDER-SECURE] Validando productos...');

            // Validar datos de entrada
            if (!products || !Array.isArray(products) || products.length === 0) {
                return ctx.badRequest('Products array is required');
            }

            // Validar estructura de productos
            for (const product of products) {
                if (!product.id || !product.quantity || product.quantity <= 0) {
                    return ctx.badRequest('Each product must have id and quantity > 0');
                }
            }

            // Obtener datos del usuario para validar direcciones
            const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
                populate: { addresses: true }
            });

            if (!user) {
                return ctx.badRequest('Usuario no encontrado');
            }



            // Buscar dirección seleccionada por addressId, si existe y pertenece al usuario
            let selectedAddress = null;
            if (addressId) {
                console.log(`🔍 [ORDER-SECURE] Buscando dirección con ID: ${addressId}`);
                selectedAddress = user.addresses?.find(addr => addr.id == addressId);
                console.log('📍 [ORDER-SECURE] Dirección encontrada por ID:', selectedAddress ? {
                    id: selectedAddress.id,
                    is_main: selectedAddress.is_main,
                    street: selectedAddress.street
                } : null);

                if (!selectedAddress) {
                    return ctx.badRequest('La dirección seleccionada no pertenece al usuario');
                }
            }
            // Si no se envió addressId, usar la principal
            else {
                console.log(user)
                console.log('🔍 [ORDER-SECURE] Buscando dirección principal (is_main: true)');
                selectedAddress = user.addresses?.find(addr => addr.is_main);

            }
            if (!selectedAddress) {
                return ctx.badRequest('El usuario debe tener una dirección principal configurada o seleccionar una dirección válida');
            }

            // Calcular productos del carrito
            const calculatedProducts = [];
            let subtotal = 0;

            for (const productRequest of products) {
                const { id: productId, quantity, variationId } = productRequest;

                // Obtener producto desde la base de datos
                    const product = await strapi.entityService.findOne('api::product.product', productId, {
                        populate: { variations: true, images: true }
                    });

                if (!product) {
                    return ctx.badRequest(`Producto con ID ${productId} no encontrado`);
                }

                console.log(product);
                let stockAvailable = product.stock;
                let productName = product.product_name;
                let sku = product.sku;
                let productPrice = product.price;

                // Manejar variaciones si existen
                if (variationId) {
                    const variation = product.variations?.find(v => v.id === variationId);
                    if (!variation) {
                        return ctx.badRequest(`Variación con ID ${variationId} no encontrada en producto ${productId}`);
                    }
                    console.log(`🔍 [ORDER-SECURE] Variación encontrada: ${variation.size} (ID: ${variation.id})`);
                    stockAvailable = variation.stock;
                    productName = `${product.product_name} - Talla: ${variation.size.split('-')[0]}`; // Extraer solo el nombre de la talla
                    sku = variation.sku;
                    productPrice = variation.price;
                }

                // Validar stock disponible
                if (quantity > stockAvailable) {
                    return ctx.badRequest(`Stock insuficiente para ${productName}. Disponible: ${stockAvailable}, Solicitado: ${quantity}`);
                }

                // Calcular precio con descuentos si los hay
                let finalPrice = productPrice;
                let discountApplied = 0;

                if (product.discount && product.discount > 0) {
                    discountApplied = product.discount;
                    finalPrice = productPrice * (1 - discountApplied / 100);
                }

                const productTotal = finalPrice * quantity;
                subtotal += productTotal;

                console.log(`📊 [ORDER] Producto: ${productName}, Precio original: ${productPrice} (unidad DB), Precio final: ${finalPrice} (unidad DB), Cantidad: ${quantity}, Total: ${productTotal} (unidad DB)`);

                calculatedProducts.push({
                    id: productId,
                    variationId: variationId || null,
                    product_name: productName,
                    sku,
                    price: productPrice,
                    finalPrice,
                    discountApplied,
                    quantity,
                    total: productTotal,
                    stockAvailable,
                    urlImage: product.images[0]?.formats.small?.url || product.images[0]?.url || null,
                    slug: product.slug,
                });
            }

            // Calcular costo de envío
            // IMPORTANTE: Verificar si los precios en DB están en centavos o pesos
            const SHIPPING_COST = parseFloat(process.env.SHIPPING_COST || '17000');
            const MIN_FREE_SHIPPING_PESOS = parseFloat(process.env.QUANTITY_MIN_FREE_SHIPPING || '1500');

            // Verificar qué unidad está usando la DB basándose en el primer producto
            const firstProductPrice = calculatedProducts[0]?.price || 0;
            const isPriceInCentavos = firstProductPrice > 1000; // Si es > 1000, probablemente está en centavos

            let shippingCost;
            if (isPriceInCentavos) {
                // Precios en centavos: convertir MIN_FREE_SHIPPING a centavos
                const MIN_FREE_SHIPPING = MIN_FREE_SHIPPING_PESOS * 100;
                shippingCost = subtotal >= MIN_FREE_SHIPPING ? 0 : SHIPPING_COST;
                console.log(`📊 [ORDER] Precios detectados en CENTAVOS`);
            } else {
                // Precios en pesos: comparar directamente
                shippingCost = subtotal >= MIN_FREE_SHIPPING_PESOS ? 0 : SHIPPING_COST;
                console.log(`📊 [ORDER] Precios detectados en PESOS`);
            }

            console.log(`💰 [ORDER] ANÁLISIS DE UNIDADES:`);
            console.log(`- Primer producto precio: ${firstProductPrice} (${isPriceInCentavos ? 'centavos' : 'pesos'})`);
            console.log(`- Subtotal desde DB: ${subtotal} (${isPriceInCentavos ? 'centavos' : 'pesos'})`);
            console.log(`- Subtotal en pesos: ${isPriceInCentavos ? subtotal / 100 : subtotal} pesos`);
            console.log(`- MIN_FREE_SHIPPING_PESOS: ${MIN_FREE_SHIPPING_PESOS} pesos`);
            console.log(`- Comparación resultado: envío gratis = ${shippingCost === 0}`);
            console.log(`- Envío aplicado: ${shippingCost} pesos`);

            // Aplicar cupón si existe
            let couponDiscount = 0;

            if (couponId) {
                const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId);

                if (!coupon) {
                    return ctx.badRequest('Cupón no encontrado');
                }

                // Validar cupón básico
                const currentDate = new Date();
                const validUntil = new Date(coupon.valid_until);

                if (currentDate > validUntil) {
                    return ctx.badRequest('El cupón ha expirado');
                }

                if (!coupon.is_active) {
                    return ctx.badRequest('El cupón no está activo');
                }

                // Calcular descuento
                couponDiscount = (subtotal * coupon.discount) / 100;
            }

            // Calcular total final
            const total = subtotal - couponDiscount + shippingCost;

            const calculatedOrder = {
                products: calculatedProducts,
                subtotal,
                shippingCost,
                couponDiscount,
                total,
                address: {
                    ...selectedAddress,
                }
            };
            const order_id = 'MX-' + generateUniqueID();

            console.log('✅ [ORDER-SECURE] Orden calculada:', {
                subtotal: calculatedOrder.subtotal,
                total: calculatedOrder.total,
                products: calculatedOrder.products.length
            });

            // Paso 2: Crear los line items para Stripe usando precios ya descontados
            // Si hay descuento, distribuirlo proporcionalmente entre todos los productos
            let productItems = [];

            if (calculatedOrder.couponDiscount > 0) {
                console.log(`🎫 [ORDER-SECURE] Aplicando descuento de ${calculatedOrder.couponDiscount} distribuido entre productos`);
                // Calcular el descuento proporcional para cada producto usando finalPrice (precio ya con descuento individual)
                productItems = calculatedOrder.products.map(product => {
                    const productSubtotal = product.finalPrice * product.quantity;
                    const proportionalDiscount = (productSubtotal / calculatedOrder.subtotal) * calculatedOrder.couponDiscount;
                    const discountedSubtotal = productSubtotal - proportionalDiscount;
                    let discountedUnitPrice = Math.round(discountedSubtotal / product.quantity);
                    // Validación estricta para Stripe
                    if (!Number.isInteger(discountedUnitPrice) || isNaN(discountedUnitPrice) || discountedUnitPrice < 0) {
                        throw new Error(`Precio inválido para Stripe (unit_amount): ${discountedUnitPrice} en producto ${product.product_name}`);
                    }
                    console.log(`🛍️ [ORDER-SECURE] ${product.product_name}: Precio con descuento individual ${product.finalPrice}, después del cupón ${discountedUnitPrice}`);
                    return {
                        price_data: {
                            currency: 'mxn',
                            product_data: {
                                name: `${product.product_name} (con descuento de cupón aplicado)`,
                            },
                            unit_amount: discountedUnitPrice,
                        },
                        quantity: product.quantity,
                    };
                });
            } else {
                // Sin descuento, usar precios finales (que pueden incluir descuentos del producto)
                productItems = calculatedOrder.products.map(product => {
                    let unitPrice = Math.round(product.finalPrice);
                    if (!Number.isInteger(unitPrice) || isNaN(unitPrice) || unitPrice < 0) {
                        throw new Error(`Precio inválido para Stripe (unit_amount): ${unitPrice} en producto ${product.product_name}`);
                    }
                    console.log(`🛍️ [ORDER-SECURE] ${product.product_name}: Precio original ${product.price}, Precio final ${unitPrice} (${product.discountApplied > 0 ? 'con descuento' : 'sin descuento'})`);
                    return {
                        price_data: {
                            currency: 'mxn',
                            product_data: {
                                name: product.discountApplied > 0 ? `${product.product_name} (${product.discountApplied}% descuento)` : product.product_name,
                            },
                            unit_amount: unitPrice,
                        },
                        quantity: product.quantity,
                    };
                });
            }

            // Paso 3: Configurar shipping
            const shipping_cost = calculatedOrder.shippingCost;

            console.log(`🚚 [ORDER-SECURE] Costo de envío: ${calculatedOrder.shippingCost} para Stripe`);

            // Paso 4: Crear sesión de Stripe
            const sessionData = {
                payment_method_types: ['card', 'oxxo'],
                payment_method_options: {
                    oxxo: {
                        expires_after_days: 2,
                    },
                },
                mode: 'payment',
                success_url: `${process.env.PUBLIC_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.PUBLIC_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}&cancelled=true`,
                line_items: productItems,
                client_reference_id: userId,
                customer_email: user.email, // ¡AGREGADO! - Email del usuario para prefill en Stripe
                metadata: {
                    order_id,
                    user_id: userId,
                    user_email: user.email, // También en metadata para referencia
                    coupon_id: couponId || '',
                    secure_order: 'true',
                    address_id: selectedAddress.id,
                    address_street: selectedAddress.street,
                    address_city: selectedAddress.city
                },
                payment_intent_data: {
                    metadata: {
                        order_id: order_id,
                        user_id: userId,
                        user_email: user.email, // También en payment intent metadata
                        coupon_id: couponId || '',
                        secure_order: 'true',
                        address_id: selectedAddress.id
                    }
                },
                billing_address_collection: 'auto'
            };

            console.log('🏷️ [ORDER-SECURE] Metadatos para Stripe:', {
                order_id,
                user_id: userId,
                address_id: selectedAddress.id,
                address_street: selectedAddress.street
            });

            // Paso 5: Agregar shipping si hay costo
            if (shipping_cost > 0) {
                sessionData.shipping_options = [
                    {
                        shipping_rate_data: {
                            type: 'fixed_amount',
                            fixed_amount: {
                                amount: shipping_cost,
                                currency: 'mxn',
                            },
                            display_name: 'Envío estándar',
                        },
                    },
                ];
            }

            const session = await stripe.checkout.sessions.create(sessionData);

            console.log('💳 [ORDER-SECURE] Sesión de Stripe creada:', session.id);
            if (calculatedOrder.couponDiscount > 0) {
                console.log(`🎫 [ORDER-SECURE] Descuento de cupón aplicado: ${calculatedOrder.couponDiscount}`);
            }
            
            // Log resumen de precios para debugging
            calculatedOrder.products.forEach(product => {
                if (product.discountApplied > 0) {
                    console.log(`🏷️ [ORDER-SECURE] ${product.product_name}: Precio original ${product.price}, con descuento ${product.discountApplied}%, precio final ${product.finalPrice}`);
                }
            });

            // Paso 6: Crear la orden en base de datos
            const orderData = {
                products: calculatedOrder.products,
                total: calculatedOrder.total,
                order_status: 'pending',
                stripe_id: session.id,
                order_id: order_id, // Cambiar 'unique_id' por 'order_id' según el schema
                user: userId,
                coupon_used: couponId || null,
                shipping_cost: calculatedOrder.shippingCost,
                subtotal: calculatedOrder.subtotal,
                coupon_discount: calculatedOrder.couponDiscount || 0,
                address: calculatedOrder.address, // ¡AGREGADO! - Guardar la dirección
                order_date: new Date() // Agregar fecha de orden
            };

            console.log('💾 [ORDER-SECURE] Guardando orden con dirección:', {
                orderId: order_id,
                addressId: calculatedOrder.address.id,
                addressStreet: calculatedOrder.address.street,
                userId,
                userName: user.username,
                userEmail: user.email
            });

            const order = await strapi.service('api::order.order').create({
                data: {
                    ...orderData,
                    customer_name: user.username,
                    customer_email: user.email
                },
            });

            console.log('✅ [ORDER-SECURE] Orden creada en DB:', order.id);

            return ctx.send({
                sessionId: session.id,
                url: session.url,
                orderId: order.id,
                uniqueId: order_id,
                calculatedData: calculatedOrder
            });

        } catch (error) {
            console.error('❌ [ORDER-SECURE] Error:', error);
            return ctx.internalServerError('Error al crear la orden: ' + error.message);
        }
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
 * Función para registrar el uso de un cupón por un usuario
 */
async function registerCouponUsage(userId, couponId) {
    try {
        // Primero, intentar usar el nuevo campo used_by_users
        try {
            const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId, {
                populate: { used_by_users: true },
            });

            if (coupon && coupon.used_by_users) {
                // Verificar si el usuario ya está en la lista
                const currentUserIds = coupon.used_by_users.map(user => user.id);

                if (!currentUserIds.includes(userId)) {
                    // Usar la API de Strapi para conectar la relación
                    await strapi.db.query('api::coupon.coupon').update({
                        where: { id: couponId },
                        data: {
                            used_by_users: {
                                connect: [userId]
                            }
                        }
                    });

                    console.log(`✅ Usuario ${userId} agregado a used_by_users del cupón ${couponId}`);
                } else {
                    console.log(`ℹ️ Usuario ${userId} ya estaba en used_by_users del cupón ${couponId}`);
                }
                return;
            }
        } catch (error) {
            console.log(`⚠️ Campo used_by_users no disponible, usando método alternativo:`, error.message);
        }

        // Método alternativo: el registro ya está en la orden con coupon_used
        console.log(`📝 Registro de uso de cupón guardado en la orden para usuario ${userId} y cupón ${couponId}`);

    } catch (error) {
        console.error('Error al registrar uso del cupón:', error);
        throw error;
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

        console.log(`✅ Orden ${order.id} completada exitosamente`);

        // Registrar uso de cupón si existe
        if (order.coupon_used) {
            try {
                await registerCouponUsage(order.user, order.coupon_used);
                console.log(`✅ Cupón ${order.coupon_used} registrado como usado por usuario ${order.user}`);
            } catch (couponError) {
                console.error('Error registrando uso de cupón en fulfillment:', couponError);
            }
        }

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
                    detectedPaymentMethod,
                    isAsyncPayment,
                    order.id,
                    payment_intent_id
                );

                console.log(`📧 PARÁMETROS ENVIADOS AL EMAIL:`);
                console.log(`   - Método de pago enviado: ${detectedPaymentMethod}`);
                console.log(`   - Es pago asíncrono: ${isAsyncPayment}`);
                console.log(`   - Es OXXO: ${isOxxo}`);
                console.log(`   - Email enviado exitosamente: ${emailSuccess}`);

                if (!emailSuccess) {
                    console.error(`❌ No se pudo enviar email de confirmación para orden ${order.id}`);
                }

            } catch (emailError) {
                console.error(`❌ Error enviando email de confirmación para orden ${order.id}:`, emailError);
            }
        }

        console.log(`📦 === FULFILLMENT COMPLETADO ===`);
        console.log(`📦 Orden ${order.id} procesada con éxito`);
        console.log(`📦 Método de pago: ${detectedPaymentMethod}`);
        console.log(`📦 Email enviado: ${emailCustomerEmail ? 'Sí' : 'No disponible'}`);

    } catch (error) {
        console.error(`❌ Error en fulfillCheckoutOptimized para sesión ${sessionId}:`, error);
        throw error;
    }
}

/**
 * Función auxiliar para detectar el método de pago de manera robusta
 * Prioriza la detección del método REALMENTE usado, no solo disponible
 */
function detectPaymentMethod(sessionData, paymentIntentData, order = null) {
    console.log(`🔍 === DETECTANDO MÉTODO DE PAGO ===`);

    // Logs detallados de entrada
    console.log(`🔍 Session payment_method_types:`, sessionData?.payment_method_types);
    console.log(`🔍 Session payment_status:`, sessionData?.payment_status);
    console.log(`🔍 Payment Intent payment_method_types:`, paymentIntentData?.payment_method_types);
    console.log(`🔍 Payment Intent status:`, paymentIntentData?.status);
    console.log(`🔍 Orden ID:`, order?.id);

    let detectedMethod = 'card'; // Default
    let isOxxo = false;

    // 1. Verificar primero en charges del payment intent (más confiable)
    if (sessionData?.payment_intent?.charges?.data?.length > 0) {
        const charge = sessionData.payment_intent.charges.data[0];
        const paymentMethodDetails = charge.payment_method_details;

        console.log(`🔍 Charge payment method details keys:`, Object.keys(paymentMethodDetails || {}));

        if (paymentMethodDetails?.oxxo) {
            detectedMethod = 'oxxo';
            isOxxo = true;
            console.log(`✅ OXXO detectado desde charges`);
        } else if (paymentMethodDetails?.card) {
            detectedMethod = 'card';
            console.log(`✅ Card detectado desde charges`);
        }
    }

    // 2. Si no hay charges, verificar por payment_method_types en sesión
    if (!isOxxo && sessionData?.payment_method_types?.includes('oxxo')) {
        // Para OXXO, verificar que esté en estado correcto
        if (sessionData.payment_status === 'unpaid' ||
            sessionData.payment_status === 'paid' ||
            sessionData?.payment_intent?.status === 'requires_action') {
            detectedMethod = 'oxxo';
            isOxxo = true;
            console.log(`✅ OXXO detectado desde session payment_method_types`);
        }
    }

    // 3. Si no hay payment_method_types en sesión, verificar en payment intent
    if (!isOxxo && paymentIntentData?.payment_method_types?.includes('oxxo')) {
        detectedMethod = 'oxxo';
        isOxxo = true;
        console.log(`✅ OXXO detectado desde payment intent payment_method_types`);
    }

    // 4. Validación adicional para OXXO basada en status
    if (isOxxo) {
        const piStatus = sessionData?.payment_intent?.status || paymentIntentData?.status;
        const sessionStatus = sessionData?.payment_status;

        console.log(`🏪 Validación OXXO - PI Status: ${piStatus}, Session Status: ${sessionStatus}`);

        // OXXO válido debe tener requires_action o succeeded con unpaid/paid
        if (piStatus === 'requires_action' ||
            (piStatus === 'succeeded' && sessionStatus === 'paid') ||
            sessionStatus === 'unpaid') {
            console.log(`✅ Estado OXXO válido confirmado`);
        } else {
            console.log(`⚠️ Estado OXXO inválido, defaulting a card`);
            detectedMethod = 'card';
            isOxxo = false;
        }
    }

    console.log(`🔍 === RESULTADO FINAL ===`);
    console.log(`🔍 Método detectado: ${detectedMethod}`);
    console.log(`🔍 Es OXXO: ${isOxxo}`);

    return { paymentMethod: detectedMethod, isOxxo };
}

/**
 * Manejo optimizado de pagos OXXO con validación mejorada y rate limiting
 */
async function handleOxxoPaymentOptimized(paymentData) {
    console.log(`🏪 === PROCESANDO PAGO OXXO ===`);
    console.log(`🏪 Payment Intent ID: ${paymentData.id}`);
    console.log(`🏪 Status: ${paymentData.status}`);
    console.log(`🏪 Next action type: ${paymentData.next_action?.type}`);

    if (!paymentData.next_action?.oxxo_display_details?.hosted_voucher_url) {
        console.error(`❌ No se encontró voucher URL para OXXO payment: ${paymentData.id}`);
        return;
    }

    const voucher_url = paymentData.next_action.oxxo_display_details.hosted_voucher_url;
    const expire_date = paymentData.next_action.oxxo_display_details.expires_after ||
        new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 días por defecto

    console.log(`🏪 Voucher URL obtenido: ${voucher_url}`);
    console.log(`🏪 Fecha de expiración: ${expire_date}`);

    const receipt_email = paymentData.receipt_email;
    if (!receipt_email) {
        console.error(`❌ No hay email de recibo para OXXO payment: ${paymentData.id}`);
        return;
    }

    // Rate limiting para OXXO - máximo 1 email por minuto por payment intent
    const rateLimitKey = `oxxo_${paymentData.id}`;
    const lastSent = global.oxxoEmailCache = global.oxxoEmailCache || {};

    if (lastSent[rateLimitKey]) {
        const timeSince = Date.now() - lastSent[rateLimitKey];
        if (timeSince < 60000) { // 1 minuto
            console.log(`🏪 ⏱️ Rate limit para OXXO ${paymentData.id} - última vez enviado hace ${timeSince}ms`);
            return;
        }
    }

    // Marcar como enviado antes del intento para evitar duplicados
    lastSent[rateLimitKey] = Date.now();

    try {
        console.log(`🏪 Enviando email OXXO a: ${receipt_email}`);

        const emailSuccess = await sendOxxoEmailWithRetry(receipt_email, voucher_url, expire_date);

        if (emailSuccess) {
            console.log(`🏪 ✅ Email OXXO enviado exitosamente a: ${receipt_email}`);
            console.log(`🏪 ✅ Payment Intent: ${paymentData.id}`);
            console.log(`🏪 ✅ Voucher URL: ${voucher_url}`);
        } else {
            console.error(`🏪 ❌ No se pudo enviar email OXXO a: ${receipt_email}`);
            // Remover del cache para permitir reintento
            delete lastSent[rateLimitKey];
        }

        return emailSuccess;
    } catch (error) {
        console.error(`🏪 ❌ Error procesando pago OXXO:`, error);
        // Remover del cache para permitir reintento
        delete lastSent[rateLimitKey];
        return false;
    }
}

/**
 * Envía email de confirmación de compra con diseño profesional y control de duplicados
 */
async function sendOrderConfirmationEmail(customerName, email, strapi, products, subject = "¡Compra confirmada!", paymentMethod = 'card', isAsyncPayment = false, orderId = null, paymentIntentId = null) {
    // Control de duplicados usando orderId y paymentIntentId
    if (orderId && paymentIntentId) {
        const canProceed = startEmailProcessing(orderId, paymentIntentId);
        if (!canProceed) {
            console.log(`📧 Email de confirmación ya procesándose para orden ${orderId}`);
            return false;
        }
    }

    try {
        console.log(`📧 === ENVIANDO EMAIL DE CONFIRMACIÓN ===`);
        console.log(`📧 Cliente: ${customerName}`);
        console.log(`📧 Email: ${email}`);
        console.log(`📧 Productos: ${products?.length || 0}`);
        console.log(`📧 Método de pago: ${paymentMethod}`);
        console.log(`📧 Es asíncrono: ${isAsyncPayment}`);
        console.log(`📧 Orden ID: ${orderId}`);

        if (!email || !products || products.length === 0) {
            console.error(`❌ Datos insuficientes para enviar email de confirmación`);
            return false;
        }

        // Generar contenido del email
        let productsList = '';
        let total = 0;

        products.forEach(product => {
            const price = product.discountPrice || product.realPrice || 0;
            const quantity = product.stockSelected || 1;
            const itemTotal = (price * quantity) / 100; // Convertir de centavos a pesos

            total += itemTotal;

            let productName = product.product_name || product.name || 'Producto';
            if (product.size && product.size.trim() !== '') {
                const sizeName = product.size.split('-')[0];
                productName = `${productName} - Talla: ${sizeName}`;
            }

            productsList += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 15px 0; font-weight: 500;">${productName}</td>
                    <td style="padding: 15px 0; text-align: center;">${quantity}</td>
                    <td style="padding: 15px 0; text-align: right; font-weight: 600;">$${itemTotal.toFixed(2)} MXN</td>
                </tr>
            `;
        });

        // Determinar mensaje según método de pago
        let paymentMessage = '';
        let statusMessage = '';

        if (paymentMethod === 'oxxo') {
            paymentMessage = `
                <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #ffb000;">
                    <h3 style="margin: 0 0 10px 0; color: #856404;">🏪 Pago OXXO Registrado</h3>
                    <p style="margin: 0; color: #856404;">
                        Tu pago OXXO ha sido registrado exitosamente. Tu pedido será preparado para envío una vez que se confirme el pago.
                    </p>
                </div>
            `;
            statusMessage = 'Tu pedido está siendo preparado y será enviado pronto.';
        } else if (isAsyncPayment) {
            paymentMessage = `
                <div style="background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #17a2b8;">
                    <h3 style="margin: 0 0 10px 0; color: #0c5460;">💳 Pago Confirmado</h3>
                    <p style="margin: 0; color: #0c5460;">
                        Tu pago ha sido acreditado exitosamente. Tu pedido está siendo preparado para envío.
                    </p>
                </div>
            `;
            statusMessage = 'Tu pago ha sido confirmado y tu pedido está siendo preparado.';
        } else {
            paymentMessage = `
                <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #28a745;">
                    <h3 style="margin: 0 0 10px 0; color: #155724;">✅ Pago Completado</h3>
                    <p style="margin: 0; color: #155724;">
                        Tu pago ha sido procesado exitosamente. Tu pedido está siendo preparado para envío.
                    </p>
                </div>
            `;
            statusMessage = 'Tu pedido está confirmado y será enviado pronto.';
        }

        const emailContent = `
            <h2 style="color: #333; margin: 0 0 20px 0;">¡Hola ${customerName}!</h2>
            <p style="font-size: 16px; color: #666; margin: 0 0 20px 0;">
                Gracias por tu compra en <strong>EverBlack Store</strong>. ${statusMessage}
            </p>
            
            ${paymentMessage}
            
            <h3 style="color: #333; margin: 30px 0 15px 0; padding: 10px 0; border-bottom: 2px solid #f0f0f0;">
                📦 Resumen de tu pedido
            </h3>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                    <tr style="background-color: #f8f9fa;">
                        <th style="padding: 15px 0; text-align: left; font-weight: 600; color: #333;">Producto</th>
                        <th style="padding: 15px 0; text-align: center; font-weight: 600; color: #333;">Cantidad</th>
                        <th style="padding: 15px 0; text-align: right; font-weight: 600; color: #333;">Precio</th>
                    </tr>
                </thead>
                <tbody>
                    ${productsList}
                    <tr style="border-top: 2px solid #333; background-color: #f8f9fa;">
                        <td colspan="2" style="padding: 20px 0; font-weight: 700; font-size: 18px; color: #333;">TOTAL</td>
                        <td style="padding: 20px 0; text-align: right; font-weight: 700; font-size: 18px; color: #333;">$${total.toFixed(2)} MXN</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 30px 0; text-align: center;">
                <h3 style="margin: 0 0 15px 0; color: #333;">📞 ¿Necesitas ayuda?</h3>
                <p style="margin: 0; color: #666; line-height: 1.6;">
                    Si tienes preguntas sobre tu pedido, no dudes en contactarnos:<br>
                    📧 <a href="mailto:info@everblack.store" style="color: #000; text-decoration: none; font-weight: 600;">info@everblack.store</a>
                </p>
            </div>
            
            <p style="margin: 30px 0 0 0; font-size: 16px; color: #333; text-align: center;">
                ¡Gracias por elegir <strong>EverBlack</strong>! 🖤
            </p>
        `;

        const finalEmailContent = createEmailTemplate(emailContent, subject);

        const emailConfig = {
            to: email,
            from: "noreply@everblack.store",
            subject: subject,
            html: finalEmailContent
        };

        const success = await sendEmailWithRetry(emailConfig, 3, 2000);

        if (success) {
            console.log(`✅ Email de confirmación enviado exitosamente a: ${email}`);
        } else {
            console.error(`❌ No se pudo enviar email de confirmación a: ${email}`);
        }

        return success;

    } catch (error) {
        console.error(`❌ Error enviando email de confirmación:`, error);
        return false;
    } finally {
        // Finalizar control de duplicados
        if (orderId && paymentIntentId) {
            finishEmailProcessing(orderId, paymentIntentId);
        }
    }
}

/**
 * Función de prueba de emails (solo para desarrollo)
 */
async function testEmail(ctx) {
    console.log("🧪 === INICIANDO TEST DE EMAIL ===");

    try {
        const testEmailConfig = {
            to: "test@example.com",
            from: "noreply@everblack.store",
            subject: "🧪 Test Email - EverBlack Store",
            html: createEmailTemplate(
                `
                <h2>¡Email de prueba!</h2>
                <p>Este es un email de prueba para verificar la configuración.</p>
                <p>Timestamp: ${new Date().toISOString()}</p>
                `,
                "Test Email"
            )
        };

        const success = await sendEmailWithRetry(testEmailConfig, 1, 1000);

        console.log(`🧪 Resultado del test: ${success ? 'ÉXITO' : 'FALLO'}`);

        return {
            success,
            message: success ? "Email de prueba enviado exitosamente" : "Falló el envío del email de prueba",
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error("🧪 Error en test de email:", error);
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Función de prueba para el sistema de control de emails duplicados
 */
async function testEmailConcurrencyControl(ctx) {
    console.log("🧪 === TEST DE CONTROL DE CONCURRENCIA ===");

    const testOrderId = "test-order-123";
    const testPaymentIntentId = "test-pi-456";

    // Simular múltiples intentos simultáneos
    const promises = [];
    for (let i = 0; i < 5; i++) {
        promises.push(new Promise(async (resolve) => {
            const canProceed = startEmailProcessing(testOrderId, testPaymentIntentId);
            console.log(`🧪 Intento ${i + 1}: ${canProceed ? 'PERMITIDO' : 'BLOQUEADO'}`);

            if (canProceed) {
                // Simular procesamiento
                await new Promise(resolve => setTimeout(resolve, 1000));
                finishEmailProcessing(testOrderId, testPaymentIntentId);
            }

            resolve({ attempt: i + 1, allowed: canProceed });
        }));
    }

    const results = await Promise.all(promises);
    const allowedCount = results.filter(r => r.allowed).length;

    console.log(`🧪 Resultado: ${allowedCount} de 5 intentos fueron permitidos`);

    return {
        success: allowedCount === 1,
        results,
        message: allowedCount === 1 ? "Control de concurrencia funciona correctamente" : "Problema con el control de concurrencia"
    };
}