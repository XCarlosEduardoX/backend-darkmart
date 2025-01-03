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
            user: user?.id || undefined,
            coupon_used: coupon_used?.id || undefined,
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

            //actualizar user
            // try {
            //     await strapi.entityService.update('api::user.user', user.id, {
            //         data: { promo_first_purchase_used: true },
            //     });
            // }
            // catch (error) {
            //     console.error('Error al actualizar el usuario:', error);
            //     return { error: 'Error al actualizar el usuario' };
            // }


            // Enviar email de confirmación
            if (user?.email) {
                try {
                    await strapi.plugins['email'].services.email.send({
                        to: user.email,
                        from: "mrlocked4@gmail.com",
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
        const { products, user, coupon_used, summary, address } = ctx.request.body;
        const order_id = uuidv4();
        try {
            const productItems = await Promise.all(
                summary.products.map(async (product) => {
                    return {
                        price_data: {
                            currency: 'mxn',
                            product_data: {
                                name: product.product_name,
                            },
                            unit_amount: product.realPrice
                        },
                        quantity: product.stockSelected,
                    };
                })
            );

            const shipping_cost = summary.shipping_cost
            const clientReferenceId = user.id

            const sessionData = {
                // shipping_address_collection: { allowed_countries: ['MX'] },
                payment_method_types: ['card', 'oxxo'],
                // The parameter is optional. The default value of expires_after_days is 3.
                payment_method_options: {
                    oxxo: {
                        expires_after_days: 2
                    }
                },
                mode: 'payment',
                success_url: `${process.env.CLIENT_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.CLIENT_URL}/status-pay?session_id={CHECKOUT_SESSION_ID}`,
                line_items: productItems,
                client_reference_id: clientReferenceId,
                customer_email: user.email,
                metadata: { order_id },


                // phone_number_collection: { enabled: true }, // Habilitar la colección de número de teléfono
            };

            sessionData.shipping_options = [
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
            ];

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


            // Calcular el total antes de crear la sesión
            let subtotal = products.reduce((sum, product) => sum + product.realPrice * product.stockSelected, 0);
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
                address
                //guardar el metodo de pago y si uso tarjeta guardar el numero de tarjeta
            };


            if (coupon_used) {
                orderDatas.coupon_used = coupon_used.id;
            }

            const order = await strapi.service('api::order.order').create({
                data: orderDatas,

            });

            //actualizar user
            // await strapi.service('api::user.user').update(user.id, {
            //     data: {
            //         promo_first_purchase_used: true
            //     },

            // })

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
            event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
        } catch (err) {
            console.error('Error verificando la firma del webhook:', err.message);
            ctx.status = 400;
            ctx.body = { error: 'Verificación de firma fallida del webhook' };
            return;
        }

        // Verifica si el evento ya ha sido procesado en la colección de Strapi
        const existingEvent = await strapi.entityService.findMany('api::processed-event.processed-event', {
            filters: { id_event: event.id }
        });

        if (existingEvent.length > 0) {
            console.log(`Evento ya procesado: ${event.id}`);
            ctx.status = 200;
            ctx.body = { received: true };
            return;
        }

        // Procesa el evento
        try {
            console.log(`Procesando evento: ${event.id} (${event.type})`);

            switch (event.type) {
                case 'payment_intent.succeeded':
                    // Lógica para pagos exitosos
                    console.log('Pago exitoso:', event.data.object);
                    break;
                case 'payment_intent.failed':
                    // Lógica para pagos fallidos
                    console.log('Pago fallido:', event.data.object);
                    break;
                default:
                    console.log(`Evento no manejado: ${event.type}`);
            }

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



    // async handleWebhook(ctx) {
    //     const rawBody = ctx.request.body[Symbol.for('unparsedBody')]; // Cuerpo crudo del webhook
    //     const signature = ctx.request.headers['stripe-signature'];
    //     const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    //     if (!rawBody || !signature) {
    //         console.error('[Webhook] Cuerpo o firma faltantes.');
    //         ctx.status = 400;
    //         ctx.body = 'Cuerpo o firma faltantes';
    //         return;
    //     }

    //     let event;
    //     try {
    //         event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
    //     } catch (err) {
    //         console.error('Error verificando la firma del webhook:', err.message);
    //         ctx.response.status = 400;
    //         return ctx.send({ error: 'Verificación de firma fallida del webhook' });
    //     }

    //     console.log("Se recibio el evento ", event.type);
    //     switch (event.type) {

    // case 'payment_intent.created': {
    //     const paymentData = event.data.object;



    //     await strapi.service('api::payment-intent.payment-intent').create({
    //         data: {
    //             paymentintent_id: paymentData.id,
    //             amount: paymentData.amount,
    //             pi_status: paymentData.status,
    //             payment_method: paymentData.payment_method_types[0]
    //         },
    //     });
    //     break;
    // }
    // case 'invoice.created': {
    //     const paymentIntent = event.data.object;
    //     break;
    // }
    // case 'charge.dispute.created': {
    //     const paymentIntent = event.data.object;
    //     break;
    // }

    // case 'charge.dispute.funds_withdrawn': {
    //     const paymentIntent = event.data.object;
    //     break;
    // }

    // case 'charge.updated': {
    //     const paymentIntent = event.data.object;
    //     break;
    // }
    // case 'charge.refunded': {
    //     const paymentIntent = event.data.object;

    //     break;

    // }
    // case 'charge.succeeded': {
    //     const paymentIntent = event.data.object;

    //     break;
    // }
    // case 'charge.failed': {
    //     const charge = event.data.object;
    //     break;
    // }




    // case 'payment_intent.requires_action': {
    //     const paymentData = event.data.object;
    //     const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
    //         filters: { paymentintent_id: paymentData.id },
    //     });
    //     if (paymentIntents.length > 0) { }
    //     else {
    //         // await strapi.entityService.create('api::payment-intent.payment-intent', {
    //         //     data: {
    //         //         paymentintent_id: paymentData.id,
    //         //         pi_status: paymentData.status,
    //         //         amount: paymentData.amount,
    //         //         payment_method: paymentData.payment_method_types[0],
    //         //         payment_link: paymentData.payment_method_types[0] == 'oxxo' ? paymentData.next_action.oxxo_display_details.hosted_voucher_url : 'nolink'
    //         //     }
    //         // })
    //     }
    //     // const pi_id = paymentIntents[0].id
    //     // console.log("payment_intent.requires_action ", paymentData);
    //     // if( paymentData.payment_method_types[0] == 'oxxo'){
    //     // await strapi.entityService.update('api::payment-intent.payment-intent', pi_id, {
    //     //     data: { payment_link: paymentData.next_action.oxxo_display_detailshosted_voucher_url },
    //     // });
    //     // }

    //     break;
    // }

    // //The customer has successfully submitted the Checkout form pero aun no ha pagado
    // case 'checkout.session.completed': {
    //     const paymentData = event.data.object;
    //     const payment_intent_id = paymentData.payment_intent
    //     const payment_link = paymentData.url
    //     const payment_status = paymentData.payment_status
    //     const pi_status = paymentData.status
    //     const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
    //         filters: { paymentintent_id: payment_intent_id },
    //     });
    //     if (paymentIntents.length > 0) {
    //         const pi_id = paymentIntents[0].id
    //         await strapi.entityService.update('api::payment-intent.payment-intent', pi_id, {
    //             data: { payment_link: payment_link, payment_status: payment_status, pi_status: pi_status },
    //         });
    //     } else {
    //         console.log('no se encontro el payment intent');

    //     }
    //     break;
    // }

    // //pago oxxo hecho con exito
    // case 'checkout.session.async_payment_succeeded': {
    //     const paymentData = event.data.object;
    //     console.log('el pago del oxxo completado con exito, mandar correo');
    //     fulfillCheckout(paymentData.id);
    //     break;
    // }

    // case 'checkout.session.completed': {
    //     const paymentData = event.data.object;
    //     console.log('el pago del oxxo completado con exito, mandar correo');
    //     fulfillCheckout(paymentData.id);
    //     break;
    // }


    // case 'checkout.session.async_payment_failed': {
    //     const paymentData = event.data.object;
    //     console.log('el pago del oxxo fallo, no mandar nada');
    //     break;
    // }


    // case 'payment_intent.succeeded': {
    //     const paymentData = event.data.object;
    //     const payment_intent_id = paymentData.id
    //     const payment_status = paymentData.payment_status
    //     const pi_status = paymentData.status
    //     const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
    //         filters: { paymentintent_id: payment_intent_id },
    //     });
    //     if (paymentIntents.length > 0) {
    //         const pi_id = paymentIntents[0].id
    //         await strapi.entityService.update('api::payment-intent.payment-intent', pi_id, {
    //             data: { payment_status, pi_status },
    //         });
    //     } else {
    //         console.log('no se encontro el payment intent')
    //     }
    //     break;
    // }

    // case 'payment_intent.payment_failed': {
    //     const session = event.data.object;

    //     const stripe_id = session.id;
    //     const orders = await strapi.entityService.findMany('api::order.order', {
    //         filters: { stripe_id },
    //     });

    //     if (orders.length > 0) {
    //         const orderId = orders[0].id;
    //         await strapi.entityService.update('api::order.order', orderId, {
    //             data: { order_status: 'failed' },
    //         });
    //         console.log('El pedido falló - payment_intent.payment_failed');
    //     } else {
    //         console.error('No se encontró la orden con el stripeId proporcionado.');
    //     }
    //     break;
    // }
    // case 'payment_intent.canceled': {
    //     //Si el cliente cancela un pago o se interrumpe por alguna razón (como un pago fallido)
    //     const paymentData = event.data.object;

    //     const order_id = paymentData.metadata.id_order
    //     const orders = await strapi.entityService.findMany('api::order.order', {
    //         filters: { order_id },
    //     });

    //     if (orders.length > 0) {
    //         const orderId = orders[0].id;
    //         await strapi.entityService.update('api::order.order', orderId, {
    //             data: { order_status: paymentData.status },
    //         });

    //     }
    //     break;
    // }
    // case 'checkout.session.expired': {
    //     //Si usas Stripe Checkout y el cliente no termina de pagar antes de la expiración de la sesión
    //     const paymentData = event.data.object;
    //     const stripe_id = paymentData.id;
    //     const orders = await strapi.entityService.findMany('api::order.order', {
    //         filters: { stripe_id },
    //     });

    //     if (orders.length > 0) {
    //         const orderId = orders[0].id;
    //         await strapi.entityService.update('api::order.order', orderId, {
    //             data: { order_status: paymentData.status },
    //         });

    //     }
    //         }


    //         // case 'checkout.session.completed': {
    //         //     const paymentIntent = event.data.object;
    //         //     console.log('checkout.session.completed', paymentIntent);
    //         // const stripe_id = paymentIntent.id;
    //         // const orders = await strapi.entityService.findMany('api::order.order', {
    //         //     filters: { stripe_id },
    //         // });

    //         //     if (orders.length > 0) {
    //         //         const orderId = orders[0].id;
    //         //         const { name, email } = paymentIntent.customer_details;


    //         //         //bajar stock de productos
    //         //         const products = orders[0].products
    //         //         console.log("products products products " + products)
    //         //         for (const product of products) {
    //         //             try {
    //         //                 const { slug_variant, stockSelected, slug } = product;
    //         //                 if (slug_variant) {
    //         //                     // Buscar la variante del producto
    //         //                     const [variantData] = await strapi.entityService.findMany('api::variation.variation', {
    //         //                         filters: { slug: slug_variant },
    //         //                         limit: 1,
    //         //                     });

    //         //                     if (!variantData) {
    //         //                         return ctx.notFound(`La variante "${slug_variant}" no existe para el producto.`);
    //         //                     }

    //         //                     //bajar stock de la variante
    //         //                     await strapi.entityService.update('api::variation.variation', variantData.id, {
    //         //                         data: { stock: variantData.stock - stockSelected },
    //         //                     });
    //         //                 } else {
    //         //                     const [productData] = await strapi.entityService.findMany('api::product.product', {
    //         //                         filters: { slug: slug },
    //         //                         limit: 1,
    //         //                     });

    //         //                     //bajar stock del producto
    //         //                     if (productData) {
    //         //                         await strapi.entityService.update('api::product.product', productData.id, {
    //         //                             data: { stock: productData.stock - stockSelected },
    //         //                         });
    //         //                     }
    //         //                 }

    //         //             } catch (error) {
    //         //                 console.error('Error al actualizar el stock del producto:', error);
    //         //             }
    //         //         }

    //         // try {
    //         //     await strapi.entityService.update('api::order.order', orderId, {
    //         //         data: {
    //         //             shipping_status: 'pending',
    //         //             status_order: 'completed',
    //         //             total: paymentIntent.amount_total,
    //         //         },
    //         //     });
    //         // } catch (error) {
    //         //     console.error('Error al actualizar el pedido:', error);
    //         //     await strapi.entityService.update('api::order.order', orderId, {
    //         //         data: { status_order: 'failed' },
    //         //     });
    //         // }
    //         //         // Enviar email de confirmación
    //         // try {
    //         //     await strapi.plugins['email'].services.email.send({
    //         //         to: email,
    //         //         from: "mrlocked4@gmail.com",

    //         //         subject: 'Compra Darkmart recibida',
    //         //         html: `<div>
    //         //             <h2>Hola ${name},</h2>
    //         //             <p>Tu compra se ha recibido con éxito.</p>
    //         //             <p>¡Gracias por comprar con nosotros!</p>

    //         //             <h3>Detalles de la compra:</h3>
    //         //             <h4>Productos comprados:</h4>
    //         //             <ul>
    //         //                 ${products.map(product => `<li>${product.product_name} - ${product.stockSelected} unidades</li>`).join('')}
    //         //             </ul>

    //         //         </div>`,
    //         //     });
    //         //     console.log('Email enviado con éxito');
    //         // } catch (error) {
    //         //     console.log("Error al enviar el email: ", error);
    //         // }
    //         //     } else {
    //         //         console.error('No se encontró la orden con el stripeId proporcionado.');
    //         //     }
    //         //     break;
    //         // }


    //         default:
    //             console.log(`Evento no procesado: ${event.type}`);
    //     }

    //     ctx.response.status = 200;
    //     ctx.body = { received: true };
    // },
}));

async function retryFailedEvents() {
    while (retryQueue.length > 0) {
        const { event, retries } = retryQueue.shift();

        if (retries > MAX_RETRIES) {
            console.error(`Evento ${event.id} falló después de ${retries} intentos.`);
            continue; // O puedes guardar este evento en un log para revisión manual.
        }

        console.log(`Reintentando evento ${event.id}, intento ${retries + 1}`);
        try {
            await processEvent(event);
        } catch (err) {
            console.error(`Error en el reintento del evento ${event.id}:`, err.message);
            retryQueue.push({ event, retries: retries + 1 });
            setTimeout(() => retryFailedEvents(), RETRY_DELAY); // Reprogramar reintento
        }
    }
}
async function fulfillCheckout(sessionId) {
    // Set your secret key. Remember to switch to your live secret key in production.
    // See your keys here: https://dashboard.stripe.com/apikeys
    const stripe = require('stripe')(process.env.STRIPE_KEY);

    // TODO: Make this function safe to run multiple times,
    // even concurrently, with the same session ID

    // TODO: Make sure fulfillment hasn't already been
    // peformed for this Checkout Session

    // Retrieve the Checkout Session from the API with line_items expanded
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items'],
    });

    console.log('checkoutSession', checkoutSession);
    const stripe_id = checkoutSession.id;
    const payment_intent_id = checkoutSession.payment_intent;
    const orders = await strapi.entityService.findMany('api::order.order', {
        filters: { stripe_id },
    });
    // Check the Checkout Session's payment_status property
    // to determine if fulfillment should be peformed
    if (checkoutSession.payment_status === 'paid') {
        if (orders.length > 0) {
            const orderId = orders[0].id;

            try {
                await strapi.entityService.update('api::order.order', orderId, {
                    data: {
                        shipping_status: 'pending',
                        order_status: 'completed',
                        payment_intent: payment_intent_id,

                    },
                });
            } catch (error) {
                console.error('Error al actualizar el pedido:', error);
                await strapi.entityService.update('api::order.order', orderId, {
                    data: { order_status: 'failed' },
                });
            }


            const products = orders[0].products
            updateStockProducts(products)

            const { name, email } = checkoutSession.customer_details;

            //obtener los datos del payment intent
            const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
                filters: { paymentintent_id: payment_intent_id },
            });

            if (paymentIntents.length > 0) {
                const payment_method = paymentIntents[0].payment_method;
                console.log('paymentIntents ', paymentIntents[0])
                if (payment_method == 'oxxo') {
                    let mainMessage = "¡Compra Everblack recibida! Tu pago se acreditó con éxito"
                    //enviar correo de confirmacion
                    sendEmail(name, email, strapi, products, mainMessage)

                } else if (payment_method == 'card') {
                    let mainMessage = "¡Compra Everblack recibida!"
                    sendEmail(name, email, strapi, products, mainMessage)
                }
            }
        }
    }
    // if (checkoutSession.payment_status !== 'unpaid') {
    //     // TODO: Perform fulfillment of the line items

    //     // TODO: Record/save fulfillment status for this
    //     // Checkout Session
    // }
}
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

/**
 * @param {any} name
 * @param {any} email
 * @param {import("@strapi/types/dist/core").Strapi} strapi
 * @param {any} products
 * @param {string} mainMessage
 */
async function sendEmail(name, email, strapi, products, mainMessage) {
    try {
        await strapi.plugins['email'].services.email.send({
            to: email,
            from: "mrlocked4@gmail.com",

            subject: mainMessage,
            html: `<div>
                <h2>Hola ${name},</h2>
                <p>Tu compra se ha recibido con éxito.</p>
                <p>¡Gracias por comprar con nosotros!</p>

                <h3>Detalles de la compra:</h3>
                <h4>Productos comprados:</h4>
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



function hasUnresolvedDependencies(event) {
    // Aquí puedes implementar lógica específica según el tipo de evento
    // que necesites para verificar si hay dependencias sin resolver.
    // Por ejemplo, si el evento es de tipo 'payment_intent.created', puedes
    // verificar si hay dependencias sin resolver relacionadas con pagos.


    return false;
}


async function processEvent(event) {
    console.log("Procesando evento:", event.type, "ID:", event.id);

    switch (event.type) {
        case 'payment_intent.created': {
            const paymentData = event.data.object;



            await strapi.service('api::payment-intent.payment-intent').create({
                data: {
                    paymentintent_id: paymentData.id,
                    amount: paymentData.amount,
                    pi_status: paymentData.status,
                    payment_method: paymentData.payment_method_types[0]
                },
            });
            break;
        }
        case 'invoice.created': {
            const paymentIntent = event.data.object;
            break;
        }
        case 'charge.dispute.created': {
            const paymentIntent = event.data.object;
            break;
        }

        case 'charge.dispute.funds_withdrawn': {
            const paymentIntent = event.data.object;
            break;
        }

        case 'charge.updated': {
            const paymentIntent = event.data.object;
            break;
        }
        case 'charge.refunded': {
            const paymentIntent = event.data.object;

            break;

        }
        case 'charge.succeeded': {
            const paymentIntent = event.data.object;

            break;
        }
        case 'charge.failed': {
            const charge = event.data.object;
            break;
        }




        case 'payment_intent.requires_action': {
            const paymentData = event.data.object;
            const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
                filters: { paymentintent_id: paymentData.id },
            });
            if (paymentIntents.length > 0) {

            }
            else {
                // await strapi.entityService.create('api::payment-intent.payment-intent', {
                //     data: {
                //         paymentintent_id: paymentData.id,
                //         pi_status: paymentData.status,
                //         amount: paymentData.amount,
                //         payment_method: paymentData.payment_method_types[0],
                //         payment_link: paymentData.payment_method_types[0] == 'oxxo' ? paymentData.next_action.oxxo_display_details.hosted_voucher_url : 'nolink'
                //     }
                // })
            }
            // const pi_id = paymentIntents[0].id
            // console.log("payment_intent.requires_action ", paymentData);
            // if( paymentData.payment_method_types[0] == 'oxxo'){
            // await strapi.entityService.update('api::payment-intent.payment-intent', pi_id, {
            //     data: { payment_link: paymentData.next_action.oxxo_display_detailshosted_voucher_url },
            // });
            // }

            break;
        }

        //The customer has successfully submitted the Checkout form pero aun no ha pagado
        case 'checkout.session.completed': {
            const paymentData = event.data.object;
            const payment_intent_id = paymentData.payment_intent
            const payment_link = paymentData.url
            const payment_status = paymentData.payment_status
            const pi_status = paymentData.status
            const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
                filters: { paymentintent_id: payment_intent_id },
            });
            if (paymentIntents.length > 0) {
                const pi_id = paymentIntents[0].id
                await strapi.entityService.update('api::payment-intent.payment-intent', pi_id, {
                    data: { payment_link: payment_link, payment_status: payment_status, pi_status: pi_status },
                });
            } else {
                console.log('no se encontro el payment intent');

            }
            break;
        }

        //pago oxxo hecho con exito
        case 'checkout.session.async_payment_succeeded': {
            const paymentData = event.data.object;
            console.log('el pago del oxxo completado con exito, mandar correo');
            fulfillCheckout(paymentData.id);
            break;
        }

        case 'checkout.session.completed': {
            const paymentData = event.data.object;
            console.log('el pago del oxxo completado con exito, mandar correo');
            fulfillCheckout(paymentData.id);
            break;
        }


        case 'checkout.session.async_payment_failed': {
            const paymentData = event.data.object;
            console.log('el pago del oxxo fallo, no mandar nada');
            break;
        }


        case 'payment_intent.succeeded': {
            const paymentData = event.data.object;
            const payment_intent_id = paymentData.id
            const payment_status = paymentData.payment_status
            const pi_status = paymentData.status
            const paymentIntents = await strapi.entityService.findMany('api::payment-intent.payment-intent', {
                filters: { paymentintent_id: payment_intent_id },
            });
            if (paymentIntents.length > 0) {
                const pi_id = paymentIntents[0].id
                await strapi.entityService.update('api::payment-intent.payment-intent', pi_id, {
                    data: { payment_status, pi_status },
                });
            } else {
                console.log('no se encontro el payment intent')
            }
            break;
        }

        case 'payment_intent.payment_failed': {
            const session = event.data.object;

            const stripe_id = session.id;
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: { stripe_id },
            });

            if (orders.length > 0) {
                const orderId = orders[0].id;
                await strapi.entityService.update('api::order.order', orderId, {
                    data: { order_status: 'failed' },
                });
                console.log('El pedido falló - payment_intent.payment_failed');
            } else {
                console.error('No se encontró la orden con el stripeId proporcionado.');
            }
            break;
        }
        case 'payment_intent.canceled': {
            //Si el cliente cancela un pago o se interrumpe por alguna razón (como un pago fallido)
            const paymentData = event.data.object;

            const order_id = paymentData.metadata.id_order
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: { order_id },
            });

            if (orders.length > 0) {
                const orderId = orders[0].id;
                await strapi.entityService.update('api::order.order', orderId, {
                    data: { order_status: paymentData.status },
                });

            }
            break;
        }
        case 'checkout.session.expired': {
            //Si usas Stripe Checkout y el cliente no termina de pagar antes de la expiración de la sesión
            const paymentData = event.data.object;
            const stripe_id = paymentData.id;
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: { stripe_id },
            });

            if (orders.length > 0) {
                const orderId = orders[0].id;
                await strapi.entityService.update('api::order.order', orderId, {
                    data: { order_status: paymentData.status },
                });

            }
            break;
        }

        default:
            console.log(`Evento no manejado: ${event.type}`);
    }
}