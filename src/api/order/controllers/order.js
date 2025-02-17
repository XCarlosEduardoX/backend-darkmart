'use strict';


const stripe = require('stripe')(process.env.STRIPE_KEY);
const { v4: uuidv4 } = require('uuid');
const { createCoreController } = require('@strapi/strapi').factories;


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

          

            // Enviar email de confirmación
            if (user?.email) {
                try {
                    await strapi.plugins['email'].services.email.send({
                        to: user.email,
                        from: "noreply@everblack.store",
                        subject: 'Compra Everblack recibida',
                        text: `Hola ${user.username}, tu compra se ha recibido con éxito.`,
                    });
                    console.log('Email enviado con éxito');
                } catch (emailError) {
                    console.error("Error al enviar el email: ", emailError);
                    return { error: 'error al enviar el email ', emailError };
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
                populate: ['coupon_used'],
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
        console.log('Creando orden...');
        const { products, user, coupon_used, summary, address } = ctx.request.body;
        const order_id = uuidv4();

        try {
            const productItems = summary.products.map(product => ({
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: product.product_name,
                    },
                    unit_amount: product.realPrice,
                },
                quantity: product.stockSelected,
            }));

            const shipping_cost = summary.shipping_cost;
            const clientReferenceId = user.id;

            const sessionData = {
                payment_method_types: ['card', 'oxxo', ],
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
                metadata: { order_id },
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
            let discount = 0;

            if (coupon_used && coupon_used.is_active) {
               
              }

            const session = await stripe.checkout.sessions.create(sessionData);

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
            };

            if (coupon_used) {
                orderDatas.coupon_used = coupon_used.id;
            }

            const order = await strapi.service('api::order.order').create({ data: orderDatas });
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
                    const orderId = orders[0].id;
                    await strapi.entityService.update('api::order.order', orderId, {
                        data: { order_status: 'completed' },
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

    // Manejo de webhook de Stripe

    async handleWebhook(ctx) {
        const rawBody = ctx.request.body[Symbol.for('unparsedBody')];
        const signature = ctx.request.headers['stripe-signature'];
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

        // Verifica si el evento ya ha sido procesado en la colección de Strapi
        const existingEvent = await strapi.entityService.findMany('api::processed-event.processed-event', {
            filters: { event_id: event.id }
        });

        if (existingEvent.length > 0) {
            console.log(`Evento ya procesado: ${event.id}`);
            ctx.status = 200;
            ctx.body = { received: true };
            return;
        }

        // Procesa el evento
        try {
            //console.log(`Procesando evento: ${event.id} (${event.type})`);
            processEvent(event);


            // Marca el evento como procesado en Strapi
            await strapi.entityService.create('api::processed-event.processed-event', {
                data: {
                    event_id: event.id,
                    event_created_at: new Date(),
                },
            });
        } catch (err) {
            console.error(`Error procesando el evento ${event.id}:`, err.message);
        }

        ctx.status = 200;
        ctx.body = { received: true };
    },




}));








/**
 * @param {{ data: { object: any; }; type: string; }} event
 */
async function processEvent(event) {
    const paymentData = event.data?.object; // Optional chaining for safety
    if (!paymentData) {
        console.error("Missing payment data in event:", event);
        return; // Exit early if data is missing
    }

    const created_at = paymentData.created ? new Date(paymentData.created * 1000) : null; // Handle missing created timestamp

    switch (event.type) {
        case 'payment_intent.created':
        case 'payment_intent.succeeded':
        case 'payment_intent.payment_failed':
        case 'payment_intent.canceled':
        case 'payment_intent.requires_action':
            await createOrUpdatePaymentIntent(paymentData, created_at);
            if (event.type === 'payment_intent.requires_action' && paymentData.payment_method_types[0] === 'oxxo') {
                await handleOxxoPayment(paymentData);
            }
            break;

        case 'checkout.session.async_payment_succeeded':
            console.log('Pago Oxxo completado:', paymentData);
            fulfillCheckout(paymentData.id, true);
            break;

        case 'checkout.session.completed':
            console.log(`Pago con tarjeta ${paymentData.status === 'paid' ? 'completado' : 'no completado'}:`, paymentData);
            fulfillCheckout(paymentData.id, false);
            break;

        case 'checkout.session.async_payment_failed':
        case 'checkout.session.expired':
            console.log(`Pago asíncrono/expirado:`, paymentData);
            await updateOrderStatus(paymentData);
            break;

        default:
            console.log(`Evento no manejado: ${event.type}`);
    }
}


/**
 * @param {{ id: any; amount: any; status: any; payment_method_types: any[]; }} paymentData
 * @param {Date} created_at
 */
async function createOrUpdatePaymentIntent(paymentData, created_at) {
    try {
        await strapi.service('api::payment-intent.payment-intent').create({
            data: {
                paymentintent_id: paymentData.id,
                amount: paymentData.amount,
                pi_status: paymentData.status,
                payment_method: paymentData.payment_method_types?.[0], // Optional chaining
                created_at: created_at,
            },
        });
    } catch (error) {
        console.error("Error creating/updating payment intent:", error);
        // Consider adding error handling/retry logic here
    }
}

/**
 * @param {{ next_action: { oxxo_display_details: { hosted_voucher_url: any; }; }; payment_method_options: { oxxo: { expires_after_days: any; }; }; receipt_email: any; }} paymentData
 */
async function handleOxxoPayment(paymentData) {
    const voucher_url = paymentData.next_action?.oxxo_display_details?.hosted_voucher_url; // Optional chaining
    const expire_days = paymentData.payment_method_options?.oxxo?.expires_after_days; // Optional chaining

    if (!voucher_url || !expire_days) {
        console.error("Missing Oxxo payment details:", paymentData);
        return;
    }

    const expire_date = new Date(Date.now() + expire_days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    sendEmailVoucherUrl(paymentData.receipt_email, strapi, "Tu pago requiere acción", voucher_url, expire_date);

    await updateOrderStatus(paymentData, 'pending'); // Pass 'pending' status directly
}


/**
 * @param {{ status: any; id: any; }} paymentData
 */
async function updateOrderStatus(paymentData, orderStatus = paymentData.status) { // Default to paymentData.status
    try {
        const orders = await strapi.entityService.findMany('api::order.order', {
            filters: { stripe_id: paymentData.id },
        });

        if (orders.length > 0) {
            await strapi.entityService.update('api::order.order', orders[0].id, {
                data: { order_status: orderStatus },
            });
        }
    } catch (error) {
        console.error("Error updating order status:", error);
    }
}



// ... (fulfillCheckout and sendEmailVoucherUrl remain unchanged)


/**
 * @param {any} sessionId
 * @param {boolean} async_payment
 */
async function fulfillCheckout(sessionId, async_payment) {
    // Set your secret key. Remember to switch to your live secret key in production.
    // See your keys here: https://dashboard.stripe.com/apikeys
    const stripe = require('stripe')(process.env.STRIPE_KEY);

    // Retrieve the Checkout Session from the API with line_items expanded
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items'],
    });
    const stripe_id = checkoutSession.id;
    const payment_intent_id = checkoutSession.payment_intent;
    const orders = await strapi.entityService.findMany('api::order.order', {
        filters: { stripe_id },
    });

    // Check the Checkout Session's payment_status property
    // to determine if fulfillment should be performed
    if (checkoutSession.payment_status === 'paid') {
        if (orders.length > 0) {
            const orderId = orders[0].id;

            try {
                await strapi.entityService.update('api::order.order', orderId, {
                    data: {
                        shipping_status: 'pending',
                        order_status: 'completed',
                        payment_intent: payment_intent_id,
                        order_date: new Date(),
                    },
                });
            } catch (error) {
                console.error('Error al actualizar el pedido:', error);
                await strapi.entityService.update('api::order.order', orderId, {
                    data: { order_status: 'failed' },
                });
            }

            const products = orders[0].products;
            updateStockProducts(products);

            const { name, email } = checkoutSession.customer_details;
            if (async_payment) {
                let mainMessage = "¡Compra recibida! Tu pago se acreditó con éxito";
                sendEmail(name, email, strapi, products, mainMessage);
            } else {
                let mainMessage = "¡Compra recibida!";
                sendEmail(name, email, strapi, products, mainMessage);
            }
        }
    }
}


/**
 * @param {any} email
 * @param {import("@strapi/types/dist/core").Strapi} strapi
 * @param {string} mainMessage
 * @param {any} voucher_url
 * @param {string} expire_date
 */
async function sendEmailVoucherUrl(email, strapi, mainMessage, voucher_url, expire_date) {
    console.log("sending email");
    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: mainMessage,
            html: `<div>
                <h2>Hola</h2>
                <p>${mainMessage}</p>
                <p>El link de pago es el siguiente:</p>
                <a href="${voucher_url}">Pagar</a>
                <p>El link expira el ${expire_date}</p>



            </div>`,
        });
        console.log('Email enviado con éxito');
    } catch (error) {
        console.log("Error al enviar el email: ", error);
    }
}
/**
 * @param {any} name
 * @param {any} email
 * @param {import("@strapi/types/dist/core").Strapi} strapi
 * @param {string | number | boolean | import("@strapi/types/dist/utils").JSONObject | import("@strapi/types/dist/utils").JSONArray | { product_name: any; stockSelected: any; }[]} products
 * @param {string} mainMessage
 */
async function sendEmail(name, email, strapi, products, mainMessage) {
    console.log("sending email");
    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "noreply@everblack.store",
            cc: "info@everblack.store",
            bcc: "ventas@everblack.store",
            replyTo: "info@everblack.store",
            subject: mainMessage,
            html: `<div>
                <h2>Hola ${name},</h2>
                <p>Tu compra se ha recibido con éxito.</p>
                <p>¡Gracias por comprar con nosotros!</p>

                <h3>Detalles de la compra:</h3>
                <ul>
                    ${products.map((/** @type {{ product_name: any; stockSelected: any; }} */ product) => `<li>${product.product_name} - ${product.stockSelected} unidades</li>`).join('')}
                </ul>

            </div>`,
        });
        console.log('Email enviado con éxito');
    } catch (error) {
        console.log("Error al enviar el email: ", error);
    }
}


/**
 * @param {string | number | boolean | import("@strapi/types/dist/utils").JSONObject | import("@strapi/types/dist/utils").JSONArray} products
 */
async function updateStockProducts(products) {
    for (const product of products) {
        try {
            const { slug_variant, stockSelected, slug } = product;
            if (slug_variant) {
                // Buscar la variante del producto
                const [variantData] = await strapi.entityService.findMany('api::variation.variation', {
                    filters: { slug: slug_variant },
                    limit: 1,
                });

                if (!variantData) {
                    return 'No se encontró la variante del producto'
                }

                //bajar stock de la variante
                await strapi.entityService.update('api::variation.variation', variantData.id, {
                    data: {
                        stock: variantData.stock - stockSelected,
                        units_sold: variantData.units_sold + stockSelected,


                    },
                });
            } else {
                const [productData] = await strapi.entityService.findMany('api::product.product', {
                    filters: { slug: slug },
                    limit: 1,
                });

                //bajar stock del producto
                if (productData) {
                    await strapi.entityService.update('api::product.product', productData.id, {
                        data: {
                            stock: productData.stock - stockSelected,
                            units_sold: productData.units_sold + stockSelected,


                        },
                    });
                }
            }

        } catch (error) {
            console.error('Error al actualizar el stock del producto:', error);
        }
    }

}