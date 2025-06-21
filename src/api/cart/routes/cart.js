'use strict';

/**
 * cart router
 */

module.exports = {
  routes: [
    // Rutas personalizadas para el carrito
    {
      method: 'GET',
      path: '/carts/user',
      handler: 'cart.findByUser',
      config: {
        auth: false, // Cambiar a true si requiere autenticación
      },
    },
    {
      method: 'POST',
      path: '/carts/add',
      handler: 'cart.addToCart',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/carts/:id/quantity',
      handler: 'cart.updateQuantity',
      config: {
        auth: false,
      },
    },
    {
      method: 'DELETE',
      path: '/carts/:id',
      handler: 'cart.removeFromCart',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/carts/clear',
      handler: 'cart.clearCart',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/carts/migrate',
      handler: 'cart.migrateCart',
      config: {
        auth: false,
      },
    },
    // Rutas CRUD estándar
    {
      method: 'GET',
      path: '/carts',
      handler: 'cart.find',
    },
    {
      method: 'GET',
      path: '/carts/:id',
      handler: 'cart.findOne',
    },
    {
      method: 'POST',
      path: '/carts',
      handler: 'cart.create',
    },
    {
      method: 'PUT',
      path: '/carts/:id',
      handler: 'cart.update',
    },
    {
      method: 'DELETE',
      path: '/carts/:id/delete',
      handler: 'cart.delete',
    },
  ],
};
