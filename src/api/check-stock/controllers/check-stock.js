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
 * Controlador optimizado para verificar stock y validar productos
 * Incluye validaciones exhaustivas para evitar problemas legales y malos cobros
 */

module.exports = {
  async checkStock(ctx, next) {
    try {
      const { arrayproducts } = ctx.request.body;

      // Validación inicial más estricta
      if (!Array.isArray(arrayproducts) || arrayproducts.length === 0) {
        return ctx.badRequest({
          error: 'REQUEST_INVALID',
          message: 'La solicitud debe incluir un array de productos válido.',
          invalidProducts: []
        });
      }

      const invalidProducts = [];
      const validProducts = [];

      // Procesar cada producto con validaciones exhaustivas
      for (const [index, product] of arrayproducts.entries()) {
        const validationResult = await this.validateProduct(product, index);
        
        if (validationResult.isValid) {
          validProducts.push(validationResult.product);
        } else {
          invalidProducts.push(...validationResult.errors);
        }
      }

      // Respuesta estructurada
      return ctx.send({
        success: invalidProducts.length === 0,
        totalProducts: arrayproducts.length,
        validProducts: validProducts.length,
        invalidProducts,
        validatedProducts: validProducts,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      strapi.log.error('Error crítico en checkStock:', error);
      return ctx.internalServerError({
        error: 'INTERNAL_ERROR',
        message: 'Error interno del servidor al verificar productos.',
        invalidProducts: []
      });
    }
  },

  /**
   * Validar un producto individual con todas las verificaciones necesarias
   */
  async validateProduct(product, index) {
    const { stockSelected, sku, slug_variant, discount, realPrice } = product;
    const errors = [];

    try {
      // 1. Validación de datos de entrada
      const inputValidation = this.validateInput(product, index);
      if (!inputValidation.isValid) {
        return { isValid: false, errors: inputValidation.errors };
      }

      // 2. Buscar producto principal
      const [productData] = await strapi.entityService.findMany('api::product.product', {
        filters: { sku: sku },
        limit: 1,
      });

      if (!productData) {
        errors.push({
          sku,
          id: null,
          isVariant: false,
          stock: 0,
          product_name: 'Producto no encontrado',
          reason: `El producto con SKU ${sku} no existe en nuestro catálogo`,
          errorType: 'PRODUCT_NOT_FOUND',
          severity: 'CRITICAL'
        });
        return { isValid: false, errors };
      }

      // 3. Validar si es variante o producto normal
      if (slug_variant) {
        return await this.validateVariant(productData, product, errors);
      } else {
        return await this.validateMainProduct(productData, product, errors);
      }

    } catch (error) {
      strapi.log.error(`Error validando producto ${sku}:`, error);
      errors.push({
        sku,
        id: null,
        isVariant: false,
        stock: 0,
        product_name: 'Error de validación',
        reason: 'Error interno al validar el producto',
        errorType: 'VALIDATION_ERROR',
        severity: 'CRITICAL'
      });
      return { isValid: false, errors };
    }
  },

  /**
   * Validar datos de entrada del producto
   */
  validateInput(product, index) {
    const { stockSelected, sku, discount, realPrice } = product;
    const errors = [];

    // Validar stockSelected
    if (!stockSelected || typeof stockSelected !== 'number' || stockSelected <= 0 || !Number.isInteger(stockSelected)) {
      errors.push({
        sku: sku || 'Sin SKU',
        id: null,
        isVariant: false,
        stock: 0,
        product_name: 'Datos inválidos',
        reason: `Cantidad solicitada inválida en el producto ${index + 1}. Debe ser un número entero positivo.`,
        errorType: 'INVALID_QUANTITY',
        severity: 'CRITICAL'
      });
    }

    // Validar SKU
    if (!sku || typeof sku !== 'string' || sku.trim().length === 0) {
      errors.push({
        sku: 'Sin SKU',
        id: null,
        isVariant: false,
        stock: 0,
        product_name: 'Datos inválidos',
        reason: `SKU faltante o inválido en el producto ${index + 1}`,
        errorType: 'INVALID_SKU',
        severity: 'CRITICAL'
      });
    }

    // Validar precio
    if (realPrice == null || typeof realPrice !== 'number' || realPrice < 0) {
      errors.push({
        sku: sku || 'Sin SKU',
        id: null,
        isVariant: false,
        stock: 0,
        product_name: 'Datos inválidos',
        reason: `Precio inválido en el producto ${index + 1}`,
        errorType: 'INVALID_PRICE',
        severity: 'CRITICAL'
      });
    }

    // Validar descuento
    if (discount == null || typeof discount !== 'number' || discount < 0 || discount > 100) {
      errors.push({
        sku: sku || 'Sin SKU',
        id: null,
        isVariant: false,
        stock: 0,
        product_name: 'Datos inválidos',
        reason: `Descuento inválido en el producto ${index + 1}. Debe estar entre 0 y 100.`,
        errorType: 'INVALID_DISCOUNT',
        severity: 'CRITICAL'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  },

  /**
   * Validar variante de producto
   */
  async validateVariant(productData, product, errors) {
    const { stockSelected, slug_variant, discount, realPrice, sku } = product;

    // Buscar la variante
    const [variantData] = await strapi.entityService.findMany('api::variation.variation', {
      filters: { slug: slug_variant },
      limit: 1,
    });

    const variantName = slug_variant.split('-')[0].toUpperCase();

    if (!variantData) {
      errors.push({
        sku,
        id: null,
        isVariant: true,
        stock: 0,
        product_name: variantName,
        reason: `La variante ${variantName} no existe`,
        errorType: 'VARIANT_NOT_FOUND',
        severity: 'CRITICAL'
      });
      return { isValid: false, errors };
    }

    // Validaciones críticas de la variante
    this.validateProductAvailability(variantData, variantName, true, sku, errors);
    this.validateStock(variantData, stockSelected, variantName, true, sku, errors);
    this.validatePrice(variantData, realPrice, variantName, true, sku, errors);
    this.validateDiscount(variantData, discount, variantName, true, sku, errors);

    // Si hay errores, el producto es inválido
    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    // Producto válido
    return {
      isValid: true,
      product: {
        id: variantData.id,
        sku: variantData.sku,
        stock: stockSelected,
        isVariant: true,
        name: variantName,
        price: variantData.price,
        discount: variantData.discount
      }
    };
  },

  /**
   * Validar producto principal (sin variante)
   */
  async validateMainProduct(productData, product, errors) {
    const { stockSelected, discount, realPrice, sku } = product;
    const productName = productData.product_name;

    // Validaciones críticas del producto
    this.validateProductAvailability(productData, productName, false, sku, errors);
    this.validateStock(productData, stockSelected, productName, false, sku, errors);
    this.validatePrice(productData, realPrice, productName, false, sku, errors);
    this.validateDiscount(productData, discount, productName, false, sku, errors);

    // Si hay errores, el producto es inválido
    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    // Producto válido
    return {
      isValid: true,
      product: {
        id: productData.id,
        sku: productData.sku,
        stock: stockSelected,
        isVariant: false,
        name: productName,
        price: productData.price,
        discount: productData.discount
      }
    };
  },

  /**
   * Validar disponibilidad del producto/variante
   */
  validateProductAvailability(data, name, isVariant, sku, errors) {
    if (!data.active) {
      errors.push({
        sku,
        id: data.id,
        isVariant,
        stock: 0,
        product_name: name,
        reason: `${isVariant ? 'La variante' : 'El producto'} ${name} ya no está disponible`,
        errorType: 'PRODUCT_UNAVAILABLE',
        severity: 'CRITICAL'
      });
    }
  },

  /**
   * Validar stock disponible
   */
  validateStock(data, requestedStock, name, isVariant, sku, errors) {
    if (data.stock < requestedStock) {
      errors.push({
        sku,
        id: data.id,
        isVariant,
        stock: data.stock,
        requestedStock,
        product_name: name,
        reason: `Stock insuficiente para ${isVariant ? 'la variante' : 'el producto'} ${name}. Disponible: ${data.stock}, Solicitado: ${requestedStock}`,
        errorType: 'INSUFFICIENT_STOCK',
        severity: 'HIGH'
      });
    }
  },

  /**
   * Validar precio del producto
   */
  validatePrice(data, expectedPrice, name, isVariant, sku, errors) {
    // Usar parseFloat para manejar diferencias de precisión decimal
    const actualPrice = parseFloat(data.price);
    const clientPrice = parseFloat(expectedPrice);
    
    if (Math.abs(actualPrice - clientPrice) > 0.01) { // Tolerancia de 1 centavo
      errors.push({
        sku,
        id: data.id,
        isVariant,
        stock: 0,
        product_name: name,
        reason: `El precio de ${isVariant ? 'la variante' : 'el producto'} ${name} ha cambiado. Precio actual: $${actualPrice}, Precio enviado: $${clientPrice}`,
        errorType: 'PRICE_CHANGED',
        severity: 'HIGH',
        actualPrice,
        clientPrice
      });
    }
  },

  /**
   * Validar descuento del producto
   */
  validateDiscount(data, expectedDiscount, name, isVariant, sku, errors) {
    const actualDiscount = parseFloat(data.discount || 0);
    const clientDiscount = parseFloat(expectedDiscount || 0);
    
    if (Math.abs(actualDiscount - clientDiscount) > 0.01) { // Tolerancia de 0.01%
      errors.push({
        sku,
        id: data.id,
        isVariant,
        stock: 0,
        product_name: name,
        reason: `La promoción de ${isVariant ? 'la variante' : 'el producto'} ${name} ha cambiado. Descuento actual: ${actualDiscount}%, Descuento enviado: ${clientDiscount}%`,
        errorType: 'DISCOUNT_CHANGED',
        severity: 'MEDIUM',
        actualDiscount,
        clientDiscount
      });
    }
  }
};
