'use strict';

/**
 * cart service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::cart.cart', ({ strapi }) => ({
  /**
   * Validar stock disponible para un producto
   */
  async validateStock(productId, quantity, selectedVariationSize = null) {
    const product = await strapi.entityService.findOne('api::product.product', productId, {
      populate: ['variations']
    });

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    let availableStock = product.stock;
    
    if (selectedVariationSize && product.variations) {
      const variation = product.variations.find(v => v.size === selectedVariationSize);
      if (variation) {
        availableStock = variation.stock;
      } else {
        throw new Error('Variación no encontrada');
      }
    }

    if (quantity > availableStock) {
      throw new Error(`Stock insuficiente. Disponible: ${availableStock}`);
    }

    return { valid: true, availableStock };
  },

  /**
   * Calcular totales del carrito
   */
  async calculateCartTotals(userId, sessionId = null) {
    const filters = {};
    if (userId) {
      filters.user = userId;
    } else if (sessionId) {
      filters.sessionId = sessionId;
    }

    const cartItems = await strapi.entityService.findMany('api::cart.cart', {
      filters,
      populate: {
        product: true
      }
    });

    let subtotal = 0;
    let totalDiscount = 0;
    let totalItems = 0;

    cartItems.forEach(item => {
      const itemPrice = item.realPrice || 0;
      const itemDiscount = item.discountApplied || 0;
      const quantity = item.quantity;

      subtotal += itemPrice * quantity;
      totalDiscount += itemDiscount * quantity;
      totalItems += quantity;
    });

    const total = subtotal - totalDiscount;

    return {
      items: cartItems,
      subtotal,
      totalDiscount,
      total,
      totalItems,
      itemCount: cartItems.length
    };
  },

  /**
   * Limpiar carritos abandonados (más de X días)
   */
  async cleanupAbandonedCarts(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const abandonedCarts = await strapi.entityService.findMany('api::cart.cart', {
      filters: {
        updatedAt: {
          $lt: cutoffDate.toISOString()
        }
      }
    });

    for (const cart of abandonedCarts) {
      await strapi.entityService.delete('api::cart.cart', cart.id);
    }

    return { deletedCount: abandonedCarts.length };
  }
}));
