'use strict';

/**
 * cart controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::cart.cart', ({ strapi }) => ({
  /**
   * Obtener todos los items del carrito para un usuario
   */
  async findByUser(ctx) {
    try {
      const { userId, sessionId } = ctx.query;
      
      if (!userId && !sessionId) {
        return ctx.badRequest('Se requiere userId o sessionId');
      }

      const filters = {};
      if (userId) {
        filters.user = userId;
      } else if (sessionId) {
        filters.sessionId = sessionId;
      }

      const cartItems = await strapi.entityService.findMany('api::cart.cart', {
        filters,
        populate: {
          product: {
            populate: ['images', 'variations', 'category']
          }
        }
      });

      return { data: cartItems };
    } catch (error) {
      console.error('Error al obtener carrito:', error);
      return ctx.internalServerError('Error al obtener el carrito');
    }
  },

  /**
   * Agregar producto al carrito
   */
  async addToCart(ctx) {
    try {
      const { 
        userId, 
        sessionId, 
        productId, 
        quantity = 1, 
        selectedVariationSize, 
        selectedVariationId,
        realPrice,
        discountApplied = 0,
        sku
      } = ctx.request.body;

      if (!userId && !sessionId) {
        return ctx.badRequest('Se requiere userId o sessionId');
      }

      if (!productId || !sku) {
        return ctx.badRequest('Se requiere productId y sku');
      }

      // Verificar que el producto existe
      const product = await strapi.entityService.findOne('api::product.product', productId, {
        populate: ['variations']
      });

      if (!product) {
        return ctx.notFound('Producto no encontrado');
      }

      // Verificar stock disponible
      let availableStock = product.stock;
      if (selectedVariationSize && product.variations) {
        const variation = product.variations.find(v => v.size === selectedVariationSize);
        if (variation) {
          availableStock = variation.stock;
        }
      }

      if (quantity > availableStock) {
        return ctx.badRequest(`Stock insuficiente. Disponible: ${availableStock}`);
      }

      // Buscar si ya existe el item en el carrito
      const filters = { sku };
      if (userId) {
        filters.userId = userId;
      } else {
        filters.sessionId = sessionId;
      }

      const existingItem = await strapi.entityService.findMany('api::cart.cart', {
        filters,
        limit: 1
      });

      let cartItem;

      if (existingItem.length > 0) {
        // Actualizar cantidad
        const newQuantity = existingItem[0].quantity + quantity;
        
        if (newQuantity > availableStock) {
          return ctx.badRequest(`Stock insuficiente. Disponible: ${availableStock}, en carrito: ${existingItem[0].quantity}`);
        }

        cartItem = await strapi.entityService.update('api::cart.cart', existingItem[0].id, {
          data: { quantity: newQuantity }
        });
      } else {
        // Crear nuevo item
        cartItem = await strapi.entityService.create('api::cart.cart', {
          data: {
            user: userId,
            sessionId,
            product: productId,
            quantity,
            selectedVariationSize,
            selectedVariationId,
            realPrice,
            discountApplied,
            sku
          }
        });
      }

      return { data: cartItem, message: 'Producto agregado al carrito' };
    } catch (error) {
      console.error('Error al agregar al carrito:', error);
      return ctx.internalServerError('Error al agregar producto al carrito');
    }
  },

  /**
   * Actualizar cantidad de un item del carrito
   */
  async updateQuantity(ctx) {
    try {
      const { id } = ctx.params;
      const { quantity } = ctx.request.body;

      if (!quantity || quantity < 1) {
        return ctx.badRequest('La cantidad debe ser mayor a 0');
      }

      const cartItem = await strapi.entityService.findOne('api::cart.cart', id, {
        populate: { product: { populate: ['variations'] } }
      });

      if (!cartItem) {
        return ctx.notFound('Item del carrito no encontrado');
      }

      // Verificar stock disponible
      let availableStock = cartItem.product.stock;
      if (cartItem.selectedVariationSize && cartItem.product.variations) {
        const variation = cartItem.product.variations.find(v => v.size === cartItem.selectedVariationSize);
        if (variation) {
          availableStock = variation.stock;
        }
      }

      if (quantity > availableStock) {
        return ctx.badRequest(`Stock insuficiente. Disponible: ${availableStock}`);
      }

      const updatedItem = await strapi.entityService.update('api::cart.cart', id, {
        data: { quantity }
      });

      return { data: updatedItem, message: 'Cantidad actualizada' };
    } catch (error) {
      console.error('Error al actualizar cantidad:', error);
      return ctx.internalServerError('Error al actualizar cantidad');
    }
  },

  /**
   * Eliminar item del carrito
   */
  async removeFromCart(ctx) {
    try {
      const { id } = ctx.params;

      const cartItem = await strapi.entityService.findOne('api::cart.cart', id);
      
      if (!cartItem) {
        return ctx.notFound('Item del carrito no encontrado');
      }

      await strapi.entityService.delete('api::cart.cart', id);

      return { message: 'Producto eliminado del carrito' };
    } catch (error) {
      console.error('Error al eliminar del carrito:', error);
      return ctx.internalServerError('Error al eliminar producto del carrito');
    }
  },

  /**
   * Limpiar todo el carrito de un usuario
   */
  async clearCart(ctx) {
    try {
      const { userId, sessionId } = ctx.request.body;

      if (!userId && !sessionId) {
        return ctx.badRequest('Se requiere userId o sessionId');
      }

      const filters = {};
      if (userId) {
        filters.user = userId;
      } else {
        filters.sessionId = sessionId;
      }

      const cartItems = await strapi.entityService.findMany('api::cart.cart', {
        filters
      });

      // Eliminar todos los items
      for (const item of cartItems) {
        await strapi.entityService.delete('api::cart.cart', item.id);
      }

      return { message: 'Carrito limpiado correctamente' };
    } catch (error) {
      console.error('Error al limpiar carrito:', error);
      return ctx.internalServerError('Error al limpiar el carrito');
    }
  },

  /**
   * Migrar carrito de sessionId a userId (cuando el usuario se loguea)
   */
  async migrateCart(ctx) {
    try {
      const { sessionId, userId } = ctx.request.body;

      if (!sessionId || !userId) {
        return ctx.badRequest('Se requiere sessionId y userId');
      }

      // Buscar items del carrito por sessionId
      const sessionCartItems = await strapi.entityService.findMany('api::cart.cart', {
        filters: { sessionId }
      });

      // Buscar items existentes del usuario
      const userCartItems = await strapi.entityService.findMany('api::cart.cart', {
        filters: { user: userId }
      });

      let migratedCount = 0;

      for (const sessionItem of sessionCartItems) {
        // Verificar si el usuario ya tiene este producto en su carrito
        const existingUserItem = userCartItems.find(item => item.sku === sessionItem.sku);

        if (existingUserItem) {
          // Combinar cantidades
          const newQuantity = existingUserItem.quantity + sessionItem.quantity;
          
          await strapi.entityService.update('api::cart.cart', existingUserItem.id, {
            data: { quantity: newQuantity }
          });
        } else {
          // Migrar el item completo
          await strapi.entityService.update('api::cart.cart', sessionItem.id, {
            data: { 
              user: userId,
              sessionId: null
            }
          });
          migratedCount++;
        }

        // Eliminar el item de sessión si no se migró (porque se combinó)
        if (existingUserItem) {
          await strapi.entityService.delete('api::cart.cart', sessionItem.id);
        }
      }

      return { 
        message: `Carrito migrado correctamente. ${migratedCount} items migrados.`,
        migratedCount 
      };
    } catch (error) {
      console.error('Error al migrar carrito:', error);
      return ctx.internalServerError('Error al migrar el carrito');
    }
  }
}));
