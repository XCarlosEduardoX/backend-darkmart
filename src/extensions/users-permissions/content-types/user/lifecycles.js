const { v4: uuidv4 } = require('uuid');

module.exports = {
  async afterCreate(event) {
    const { id } = event.result;

    // Generar un UUID
    const uuid = uuidv4();

    // Formatear el identificador
    const wishlistIdentifier = `wishlist-${uuid.substring(0, 5).toUpperCase()}`;

    // Actualizar el usuario con el nuevo identificador
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id },
      data: { wishlist_identifier: wishlistIdentifier },
    });

    console.log(`Identificador de wishlist generado para el usuario ${id}: ${wishlistIdentifier}`);
  },
};