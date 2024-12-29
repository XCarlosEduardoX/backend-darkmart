'use strict';

/**
 * order router
 */
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/orders', // Ruta para crear pedidos
      handler: 'order.create',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/orders/free-order', // Ruta para crear pedidos
      handler: 'order.createFreeOrder',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/check-payment-status',
      handler: 'order.checkPaymentStatus',
      config: {
        policies: [],
        middlewares: [],
      },

    },
    {
      method: 'GET',
      path: '/orders', // Endpoint para obtener órdenes
      handler: 'order.getOrders',
      config: {
        policies: [], // Agrega restricciones si es necesario
        middlewares: [], // Agrega middlewares si son requeridos
      },
    },
    {
      method: 'GET',
      path: '/orders/all-orders', // Endpoint para obtener órdenes
      handler: 'order.getAllOrders',
      config: {
        policies: [], // Agrega restricciones si es necesario
        middlewares: [], // Agrega middlewares si son requeridos
      },
    },
    // {
    //   method: 'POST',
    //   path: '/orders/:id/update-stripe', // Ruta personalizada para actualizar stripeId
    //   handler: 'order.updateStripeId', // Necesitas definir este controlador
    //   config: {
    //     policies: [], // Agrega restricciones si es necesario
    //   },
    // },
    // {
    //   method: 'POST',
    //   path: '/orders/:id/update-stripe', // Ruta personalizada para actualizar stripeId
    //   handler: 'order.updateStripeId', // Necesitas definir este controlador
    //   config: {
    //     policies: [], // Agrega restricciones si es necesario
    //   },
    // },
    {
      method: 'POST',
      path: '/orders/stripe-webhook',
      handler: 'order.handleWebhook',
      config: {
        auth: false,

        // middlewares: ["api::order.rawbody"],
        // Asegúrate de que esto esté en `false` si no necesitas autenticación
      },
    },
  ],
};
