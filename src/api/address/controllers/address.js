'use strict';

/**
 * address controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::address.address', ({ strapi }) => ({

    //delete: async ctx => {
    async delete(ctx) {
        const { id } = ctx.params;

        try {
            const deletedAddress = await strapi.query('api::address.address').delete({
                where: { id },
            });

            if (!deletedAddress) {
                return ctx.throw(404, 'Address not found');
            }

            ctx.send({ message: 'Address deleted successfully' }); // Respuesta de éxito
            // o ctx.status = 204; // No Content
        } catch (error) {
            console.error("Error deleting address:", error); //Log del error para debug
            ctx.throw(400, 'Error deleting address. Please try again.');
        }
    },
    update: async ctx => {
        const { id } = ctx.params;
        const { data } = ctx.request.body;

        try {
            const existingAddress = await strapi.query('api::address.address').findOne({
                where: { id, }
            });

            if (!existingAddress) {
                return ctx.throw(404, 'Address not found');
            }

            const updatedAddress = await strapi.query('api::address.address').update({
                where: { id },
                data: data,
            });

            ctx.send(updatedAddress);
        } catch (error) {
            console.error("Error updating address:", error); //Log del error para debug
            ctx.throw(400, "Error updating address. Please check your data.");
        }
    }
}));
