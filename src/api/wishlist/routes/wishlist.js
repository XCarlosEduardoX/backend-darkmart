'use strict';

/**
 * wishlist router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/wishlist', // Ruta para crear wishlist
            handler: 'wishlist.create',
            config: {
                policies: [],
            },
        },
        {
            method: 'GET',
            path: '/wishlists', // Ruta para consultar wishlists
            handler: 'wishlist.find',
            config: {
                policies: [],
            },
        },
        {
            method: 'GET',
            path: '/wishlists/:id', // Ruta para consultar wishlist específico
            handler: 'wishlist.findOne',
            config: {
                policies: [],
            },
        },
        {
            method: 'DELETE',
            path: '/wishlists/:id', // Ruta para eliminar wishlist
            handler: 'wishlist.delete',
            config: {
                policies: [],
            },
        },
        {
            method: 'GET',
            path: '/wishlists/public/:identifier', // Ruta pública para consultar por identificador
            handler: 'wishlist.findPublic',
            config: {
                auth: false, // Sin autenticación requerida
                policies: [],
            },
        }
    ]
}
