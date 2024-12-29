'use strict';

/**
 * product router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

// module.exports = createCoreRouter('api::product.product', ({ strapi }) => ({
//   'POST /products/check-stock': 'product.checkStock',
// }));
module.exports = createCoreRouter('api::product.product', {

});
// module.exports = {
//     routes: [
//       {
//         method: 'POST', // Método de la solicitud
//         path: '/products/check-stock', // Ruta del endpoint
//         handler: 'product.checkStock', // Método que maneja la solicitud en el controlador
//         config: {
//           policies: [], // Políticas opcionales
//           middlewares: [], // Middlewares opcionales
//         },
//       },
//     ],
//   };
