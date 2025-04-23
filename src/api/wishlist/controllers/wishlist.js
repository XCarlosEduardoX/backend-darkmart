'use strict';

/**
 * wishlist controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const generateShortSku = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = 8;
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
};

module.exports = createCoreController('api::wishlist.wishlist', ({ strapi }) => ({
    async create(ctx) {
        console.log('wishlist.create');
        const { data } = ctx.request.body;
        console.log('data', data);

        try {
            const wishlistData = {
                product: data.productID,  // Relación con el producto
                user: data.user.id,  // Relación con el usuario
                identifier: generateShortSku(),  // Genera un identificador corto
            };

            // Si variationID es válido, lo agregamos; si no, lo omitimos
            if (data.variationID) {
                wishlistData.variation = data.variationID;
            }

            const wishlist = await strapi.entityService.create('api::wishlist.wishlist', {
                data: wishlistData,
            });

            return wishlist;
        } catch (error) {
            console.error('Error al crear wishlist:', error);
            ctx.response.status = 500;
            return { error: 'Error al crear wishlist' };
        }
    },
}));
