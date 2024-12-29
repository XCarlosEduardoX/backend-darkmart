// 'use strict';

// /**
//  * A set of functions called "actions" for `check-stock`
//  */

// module.exports = {
//   async checkStock(ctx, next) {
//     try {
//       const { arrayproducts } = ctx.request.body;

//       const currentStock = [];


//       // const { stockSelected, productId, slug_variant } = ctx.request.body;
//       for (let i = 0; i < arrayproducts.length; i++) {
//         const { stockSelected, productId, slug_variant } = arrayproducts[i];
//         // Validar los datos recibidos
//         if (!stockSelected || !productId) {
//           return ctx.badRequest('Hubo un error al validar los datos');
//         }

//         // Buscar el producto por ID
//         const products = await strapi.entityService.findMany('api::product.product', {
//           filters: { slug: productId },
//         });

//         if (!products || products.length === 0) {
//           return ctx.notFound('El producto no existe o no se encontró');
//         }



//         if (slug_variant) {
//           const variants = await strapi.entityService.findMany('api::variation.variation', {
//             filters: { slug: slug_variant },
//           });






//           // Verificar si hay suficiente stock en la variante
//           if (variants[0].stock >= stockSelected) {
//             // Agregar la variante al array de currentStock
//             currentStock.push({
//               id: variants[0].id,
//               stock: stockSelected,
//             });
//           } else {
//             let variantName = slug_variant.split('-');
//             return ctx.badRequest('Solo hay ' + variants[0].stock + ' unidades en stock de la variante ' + variantName[0].toUpperCase() + ' del producto ' + products[0].product_name.toUpperCase());
//           }
//         } else {
//           // Verificar si hay suficiente stock en el producto normal
//           if (products[0].stock >= stockSelected) {
//             // Agregar el producto normal al array de currentStock
//             currentStock.push({
//               id: products[0].id,
//               stock: stockSelected,
//             });
//           } else {
//             return ctx.badRequest('Solo hay ' + products[0].stock + ' unidades en stock del producto ' + products[0].product_name.toUpperCase());
//           }
//         }
//       }

//       return currentStock;

//       // Devolver los productos validados
//     } catch (error) {
//       console.error(error);
//       return ctx.internalServerError('An error occurred while checking stock');
//     }
//   }

// }

'use strict';

/**
 * A set of functions called "actions" for `check-stock`
 */


module.exports = {
  async checkStock(ctx, next) {
    try {
      const { arrayproducts } = ctx.request.body;

      if (!Array.isArray(arrayproducts) || arrayproducts.length === 0) {
        return ctx.badRequest('La solicitud debe incluir un array de productos válido.');
      }

      const currentStock = [];

      for (const product of arrayproducts) {
        const { stockSelected, productId, slug_variant, discount } = product;

        // Validar los datos recibidos
        if (!stockSelected || !productId || typeof stockSelected !== 'number' || stockSelected <= 0) {
          return ctx.badRequest('Datos inválidos: asegúrese de proporcionar stockSelected válido y un productId.');
        }

        // Buscar el producto por ID
        const [productData] = await strapi.entityService.findMany('api::product.product', {
          filters: { slug: productId },
          limit: 1,
        });

        if (!productData) {
          return ctx.notFound(`El producto con ID "${productId}" no existe.`);
        }

        if (slug_variant) {
          // Buscar la variante del producto
          const [variantData] = await strapi.entityService.findMany('api::variation.variation', {
            filters: { slug: slug_variant },
            limit: 1,
          });

          if (!variantData) {
            return ctx.notFound(`La variante "${slug_variant}" no existe para el producto.`);
          }

          // Verificar el stock de la variante
          if (variantData.stock >= stockSelected) {
            currentStock.push({
              id: variantData.id,
              stock: stockSelected,
            });
          } else {
            const variantName = slug_variant.split('-')[0].toUpperCase();
            return ctx.badRequest(
              `Solo hay ${variantData.stock} unidades en stock de la variante ${variantName} del producto ${productData.product_name.toUpperCase()}.`
            );
          }

          //revisar si el descuento esta disponible
          // if (variantData.discount == discount) {
          //   // currentStock.push({
          //   //   id: variantData.id,
          //   //   stock: stockSelected,
          //   // });
          // } else {
          //   const variantName = slug_variant.split('-')[0].toUpperCase();
          //   return ctx.badRequest(
          //     `La promoción de la variante ${variantName} del producto ${productData.product_name.toUpperCase()} ya no está disponible.`
          //   );
          // }

          //revisar si esta disponible
          if (!variantData.active) {
            const variantName = slug_variant.split('-')[0].toUpperCase();
            return ctx.badRequest(
              `La variante ${variantName} del producto ${productData.product_name.toUpperCase()} ya no está disponible.`
            );
          }
        } else {
          // Verificar el stock del producto normal
          if (productData.stock >= stockSelected) {
            currentStock.push({
              id: productData.id,
              stock: stockSelected,
            });
          } else {
            return ctx.badRequest(
              `Solo hay ${productData.stock} unidades en stock del producto ${productData.product_name.toUpperCase()}.`
            );
          }

          //revisar si esta disponible
          if (!productData.active) {
            return ctx.badRequest(
              `El producto ${productData.product_name.toUpperCase()} ya no está disponible.`
            );
          }

          //revisar si el descuento esta disponible
          // if (productData.discount == discount ) {
          //   // currentStock.push({
          //   //   id: productData.id,
          //   //   stock: stockSelected,
          //   // });
          // } else {
          //   return ctx.badRequest(
          //     `La promoción del producto ${productData.product_name.toUpperCase()} ya no está disponible.`
          //   );
          // }
        }
      }

      // Devolver los productos validados
      return ctx.send({ validatedProducts: currentStock });
    } catch (error) {
      console.error('Error en checkStock:', error);
      return ctx.internalServerError('Ocurrió un error al verificar el stock.');
    }
  },
};
