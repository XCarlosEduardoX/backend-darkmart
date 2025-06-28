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
            // Obtener el usuario
            const user = await strapi.entityService.findOne('plugin::users-permissions.user', data.user.id);
            
            let wishlistIdentifierUser = user.wishlist_identifier;
            console.log('User existing wishlist_identifier:', wishlistIdentifierUser);

            // Si el usuario no tiene wishlist_identifier, generar uno nuevo
            if (!wishlistIdentifierUser) {
                wishlistIdentifierUser = generateShortSku();
                console.log('Generated new wishlist_identifier:', wishlistIdentifierUser);
                
                // Actualizar el usuario con el nuevo identificador
                await strapi.entityService.update('plugin::users-permissions.user', data.user.id, {
                    data: {
                        wishlist_identifier: wishlistIdentifierUser
                    }
                });
                console.log('Updated user with new wishlist_identifier');
            }

            const wishlistData = {
                product: data.productID,  // Relación con el producto
                user: data.user.id,  // Relación con el usuario
                identifier: generateShortSku(),  // Genera un identificador corto para este item
                wishlist_identifier_user: wishlistIdentifierUser,  // Usar el wishlist_identifier del usuario
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

    async findPublic(ctx) {
        console.log('wishlist.findPublic');
        const { identifier } = ctx.params;
        console.log('Public identifier:', identifier);

        try {
            // Buscar wishlists por wishlist_identifier_user
            const wishlists = await strapi.entityService.findMany('api::wishlist.wishlist', {
                filters: {
                    wishlist_identifier_user: {
                        $eq: identifier
                    }
                },
                populate: {
                    product: {
                        populate: {
                            images: true,
                            category: true
                        }
                    },
                    variation: true,
                    user: {
                        fields: ['id', 'username'] // Solo campos públicos del usuario
                    }
                }
            });

            console.log('Found public wishlists:', wishlists?.length || 0);

            if (!wishlists || wishlists.length === 0) {
                return ctx.notFound('Wishlist not found');
            }

            // Retornar los datos con información del propietario
            return {
                wishlist: wishlists,
                owner: wishlists[0]?.user ? {
                    id: wishlists[0].user.id,
                    username: wishlists[0].user.username
                } : null,
                wishlist_identifier: identifier
            };
        } catch (error) {
            console.error('Error finding public wishlist:', error);
            ctx.response.status = 500;
            return { error: 'Error finding public wishlist' };
        }
    },
}));
