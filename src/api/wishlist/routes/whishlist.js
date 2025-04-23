'use strict';

/**
 * wishlist router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = {
    routes: [{
        method: 'POST',
        path: '/wishlist', // Ruta para crear wishlist
        handler: 'wishlist.create',
        config: {
            policies: [],
        },
    }]
}
