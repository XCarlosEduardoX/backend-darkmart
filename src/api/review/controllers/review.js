'use strict';

/**
 * review controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::review.review', ({ strapi }) => ({
    // Crear una nueva review
    async create(ctx) {
        try {
            const { productSlug, userId, rating, comment } = ctx.request.body;

            // Validar campos requeridos
            if (!productSlug || !userId || !rating) {
                return ctx.badRequest('Faltan campos requeridos: productSlug, userId, rating');
            }

            if (rating < 1 || rating > 5) {
                return ctx.badRequest('La calificación debe estar entre 1 y 5 estrellas');
            }

            // Buscar el producto por slug para obtener su ID
            const products = await strapi.entityService.findMany('api::product.product', {
                filters: { slug: productSlug }
            });

            if (!products || products.length === 0) {
                return ctx.badRequest('Producto no encontrado');
            }

            const product = products[0];
            const productId = product.id;

            // Verificar si el usuario ya calificó este producto
            const existingReview = await strapi.entityService.findMany('api::review.review', {
                filters: {
                    users_permissions_user: userId,
                    product: productId
                }
            });

            if (existingReview && existingReview.length > 0) {
                return ctx.badRequest('Ya has calificado este producto');
            }

            // Crear la review
            const review = await strapi.entityService.create('api::review.review', {
                data: {
                    users_permissions_user: userId,
                    product: productId,
                    rating: parseInt(rating),
                    comment: comment || ''
                }
            });

            // Actualizar average_rating y total_reviews del producto
            await this.updateProductRating(productId);

            ctx.send({
                success: true,
                message: '¡Gracias por tu calificación!',
                reviewId: review.id
            });

        } catch (error) {
            console.error('Error al crear review:', error);
            ctx.internalServerError('Error al guardar la calificación');
        }
    },

    // Validar si el usuario compró el producto
    async validatePurchase(ctx) {
        try {
            const { productSlug, userId } = ctx.request.body;
            console.log('Validando compra para:', { productSlug, userId });
            if (!productSlug || !userId) {
                return ctx.badRequest('productSlug y userId son requeridos');
            }

            // Buscar el producto por slug para obtener su ID
            // const products = await strapi.entityService.findMany('api::product.product', {
            //     filters: { slug: productSlug }
            // });

            // if (!products || products.length === 0) {
            //     return ctx.badRequest('Producto no encontrado');
            // }

            // const product = products[0];
            // const productId = product.id;

            // Buscar en las órdenes si el usuario compró este producto
            // No usamos populate porque products es un campo JSON, no una relación
            const orders = await strapi.entityService.findMany('api::order.order', {
                filters: {
                    user: userId,
                    order_status: 'completed' // Solo órdenes completadas
                }
            });

            let hasPurchased = false;

            for (const order of orders) {
                // Los productos están almacenados como un array JSON
                if (Array.isArray(order.products)) {
                    hasPurchased = order.products.some(orderProduct => {
                        console.log('Verificando producto en orden:', orderProduct);
                        return orderProduct.slug === productSlug;
                    }
                    );

                    if (hasPurchased) {
                        break;
                    }
                }
            }

            ctx.send({
                hasPurchased,
                message: hasPurchased ? 'Usuario ha comprado el producto' : 'Usuario no ha comprado el producto'
            });

        } catch (error) {
            console.error('Error al validar compra:', error);
            ctx.internalServerError('Error al validar la compra');
        }
    },

    // Obtener reviews por producto
    async byProduct(ctx) {
        try {
            const { productSlug, userId } = ctx.request.body;

            if (!productSlug) {
                return ctx.badRequest('productSlug es requerido');
            }

            // Buscar el producto por slug para obtener su ID
            const products = await strapi.entityService.findMany('api::product.product', {
                filters: { slug: productSlug }
            });

            if (!products || products.length === 0) {
                return ctx.badRequest('Producto no encontrado');
            }

            const product = products[0];
            const productId = product.id;

            const reviews = await strapi.entityService.findMany('api::review.review', {
                filters: {
                    product: productId
                },
                sort: { createdAt: 'desc' },
                populate: {
                    users_permissions_user: {
                        fields: ['username', 'email'] // Solo campos públicos del usuario
                    }
                }
            });

            // Verificar si el usuario actual ya calificó
            let userHasReviewed = false;
            if (userId) {
                userHasReviewed = reviews.some(review => review.users_permissions_user?.id?.toString() === userId.toString());
            }

            ctx.send({
                reviews,
                userHasReviewed,
                totalReviews: reviews.length,
                averageRating: reviews.length > 0
                    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
                    : 0
            });

        } catch (error) {
            console.error('Error al obtener reviews:', error);
            ctx.internalServerError('Error al obtener las calificaciones');
        }
    },

    // Actualizar una review existente
    async updateReview(ctx) {
        try {
            const { reviewId, rating, comment } = ctx.request.body;
            const { userId } = ctx.request.body;

            if (!reviewId || !userId || !rating) {
                return ctx.badRequest('Faltan campos requeridos: reviewId, userId, rating');
            }

            if (rating < 1 || rating > 5) {
                return ctx.badRequest('La calificación debe estar entre 1 y 5 estrellas');
            }

            // Verificar que la review existe y pertenece al usuario
            const existingReview = await strapi.entityService.findOne('api::review.review', reviewId, {
                populate: {
                    users_permissions_user: true,
                    product: true
                }
            });

            if (!existingReview) {
                return ctx.notFound('Review no encontrada');
            }

            if (existingReview.users_permissions_user.id.toString() !== userId.toString()) {
                return ctx.forbidden('No tienes permiso para editar esta review');
            }

            // Actualizar la review
            const updatedReview = await strapi.entityService.update('api::review.review', reviewId, {
                data: {
                    rating: parseInt(rating),
                    comment: comment || ''
                }
            });

            // Actualizar el rating promedio del producto
            await this.updateProductRating(existingReview.product.id);

            ctx.send({
                success: true,
                message: 'Calificación actualizada correctamente',
                reviewId: updatedReview.id
            });

        } catch (error) {
            console.error('Error al actualizar review:', error);
            ctx.internalServerError('Error al actualizar la calificación');
        }
    },

    // Eliminar una review
    async deleteReview(ctx) {
        try {
            const { reviewId, userId } = ctx.request.body;

            if (!reviewId || !userId) {
                return ctx.badRequest('Faltan campos requeridos: reviewId, userId');
            }

            // Verificar que la review existe y pertenece al usuario
            const existingReview = await strapi.entityService.findOne('api::review.review', reviewId, {
                populate: {
                    users_permissions_user: true,
                    product: true
                }
            });

            if (!existingReview) {
                return ctx.notFound('Review no encontrada');
            }

            if (existingReview.users_permissions_user.id.toString() !== userId.toString()) {
                return ctx.forbidden('No tienes permiso para eliminar esta review');
            }

            const productId = existingReview.product.id;

            // Eliminar la review
            await strapi.entityService.delete('api::review.review', reviewId);

            // Actualizar el rating promedio del producto
            await this.updateProductRating(productId);

            ctx.send({
                success: true,
                message: 'Calificación eliminada correctamente'
            });

        } catch (error) {
            console.error('Error al eliminar review:', error);
            ctx.internalServerError('Error al eliminar la calificación');
        }
    },

    // Función auxiliar para actualizar el rating promedio del producto
    async updateProductRating(productId) {
        try {
            const reviews = await strapi.entityService.findMany('api::review.review', {
                filters: {
                    product: productId
                }
            });

            const totalReviews = reviews.length;
            const averageRating = totalReviews > 0
                ? reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews
                : 0;

            await strapi.entityService.update('api::product.product', productId, {
                data: {
                    total_reviews: totalReviews,
                    average_rating: Math.round(averageRating * 10) / 10 // Redondear a 1 decimal
                }
            });

        } catch (error) {
            console.error('Error al actualizar rating del producto:', error);
        }
    }
}));
