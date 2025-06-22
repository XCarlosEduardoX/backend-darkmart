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
        console.log(`Validando producto ${index + 1}:`, product);
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
      console.log(`\n=== VALIDANDO PRODUCTO ${index + 1} ===`);
      console.log(`SKU: ${sku}`);
      console.log(`slug_variant: ${slug_variant}`);
      console.log(`stockSelected: ${stockSelected}`);

      // 1. Validación de datos de entrada
      const inputValidation = this.validateInput(product, index);
      if (!inputValidation.isValid) {
        console.log(`❌ Validación de entrada falló para SKU ${sku}`);
        return { isValid: false, errors: inputValidation.errors };
      }

      // 2. Buscar primero si es una variación por SKU
      console.log(`🔍 Buscando variación con SKU: ${sku}`);
      const variationResults = await strapi.entityService.findMany('api::variation.variation', {
        filters: { sku: sku },
        limit: 1,
      });
      
      console.log(`📊 Resultados búsqueda variación:`, variationResults);
      const [variationData] = variationResults;

      if (variationData) {
        console.log(`✅ Variación encontrada: ${variationData.id} - ${variationData.size}`);
        return await this.validateDirectVariation(variationData, product, errors);
      }

      // 3. Si hay slug_variant pero no se encontró por SKU, buscar por slug_variant
      if (slug_variant) {
        console.log(`🔍 No se encontró por SKU, buscando variación por slug_variant: ${slug_variant}`);
        const variantBySlugResults = await strapi.entityService.findMany('api::variation.variation', {
          filters: { slug: slug_variant },
          limit: 1,
        });
        
        console.log(`📊 Resultados búsqueda por slug_variant:`, variantBySlugResults);
        const [variantBySlugData] = variantBySlugResults;

        if (variantBySlugData) {
          console.log(`✅ Variación encontrada por slug: ${variantBySlugData.id} - ${variantBySlugData.size}`);
          console.log(`⚠️ Advertencia: SKU no coincide. SKU enviado: ${sku}, SKU en DB: ${variantBySlugData.sku}`);
          return await this.validateDirectVariation(variantBySlugData, product, errors);
        }
      }

      // 4. Si no es variación, buscar producto principal
      console.log(`🔍 Buscando producto principal con SKU: ${sku}`);
      const productResults = await strapi.entityService.findMany('api::product.product', {
        filters: { sku: sku },
        limit: 1,
      });
      
      console.log(`📊 Resultados búsqueda producto:`, productResults);
      const [productData] = productResults;

      if (!productData) {
        console.log(`❌ Producto no encontrado con SKU: ${sku}`);
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

      // 4. Validar producto principal
      return await this.validateMainProduct(productData, product, errors);

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
   * Validar variación directa (cuando el SKU corresponde a una variación)
   */
  async validateDirectVariation(variationData, product, errors) {
    const { stockSelected, discount, realPrice, sku } = product;
    const variantName = variationData.size;

    console.log(`\n🔍 Validando variación directa:`);
    console.log(`- ID: ${variationData.id}`);
    console.log(`- SKU: ${variationData.sku}`);
    console.log(`- Size: ${variantName}`);
    console.log(`- Stock disponible: ${variationData.stock}`);
    console.log(`- Stock solicitado: ${stockSelected}`);
    console.log(`- Precio en DB: ${variationData.price}`);
    console.log(`- Precio enviado: ${realPrice}`);
    console.log(`- Activo: ${variationData.active}`);

    // Validaciones críticas de la variante
    this.validateProductAvailability(variationData, variantName, true, sku, errors);
    this.validateStock(variationData, stockSelected, variantName, true, sku, errors);
    this.validatePrice(variationData, realPrice, variantName, true, sku, errors);
    this.validateDiscount(variationData, discount, variantName, true, sku, errors);

    // Si hay errores, el producto es inválido
    if (errors.length > 0) {
      console.log(`❌ Variación falló validación:`, errors);
      return { isValid: false, errors };
    }

    console.log(`✅ Variación válida`);
    // Producto válido
    return {
      isValid: true,
      product: {
        id: variationData.id,
        sku: variationData.sku,
        stock: stockSelected,
        isVariant: true,
        name: variantName,
        price: variationData.price,
        discount: variationData.discount
      }
    };
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
    console.log(`Validando disponibilidad de ${isVariant ? 'la variante' : 'el producto'}: ${name} (SKU: ${sku})`);
    console.log(`Estado activo: ${data.active}, Stock: ${data.stock}`);
    console.log(`ID del producto/variante: ${data.id}`);
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
  },

  /**
   * Función de diagnóstico para verificar el contenido de la base de datos
   */
  async diagnoseDatabase(ctx) {
    try {
      console.log(`\n=== DIAGNÓSTICO DE BASE DE DATOS ===`);
      
      // Buscar todas las variaciones
      const allVariations = await strapi.entityService.findMany('api::variation.variation', {
        limit: 10,
        sort: { id: 'desc' }
      });
      
      console.log(`📊 Total variaciones encontradas: ${allVariations.length}`);
      allVariations.forEach((variation, index) => {
        console.log(`${index + 1}. ID: ${variation.id}, SKU: "${variation.sku}", Size: "${variation.size}", Stock: ${variation.stock}, Active: ${variation.active}`);
      });

      // Buscar algunas variaciones específicas
      const testSKUs = ['HENBF', 'SNKQV'];
      for (const testSKU of testSKUs) {
        console.log(`\n🔍 Buscando variación con SKU: "${testSKU}"`);
        const found = await strapi.entityService.findMany('api::variation.variation', {
          filters: { sku: testSKU },
          limit: 1,
        });
        console.log(`Resultado:`, found.length > 0 ? found[0] : 'No encontrado');
      }

      // Buscar productos principales
      const allProducts = await strapi.entityService.findMany('api::product.product', {
        limit: 5,
        sort: { id: 'desc' }
      });
      
      console.log(`\n📦 Total productos encontrados: ${allProducts.length}`);
      allProducts.forEach((product, index) => {
        console.log(`${index + 1}. ID: ${product.id}, SKU: "${product.sku}", Name: "${product.product_name}", Active: ${product.active}`);
      });

      return ctx.send({
        variations: allVariations,
        products: allProducts,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      strapi.log.error('Error en diagnóstico:', error);
      return ctx.internalServerError({
        error: 'DIAGNOSTIC_ERROR',
        message: 'Error en diagnóstico de base de datos'
      });
    }
  },
};
