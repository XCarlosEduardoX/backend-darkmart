'use strict';

/**
 * User profile service
 */

module.exports = () => ({
  /**
   * Validar que el email sea único
   */
  async validateUniqueEmail(email, excludeUserId) {
    const user = await strapi.query('plugin::users-permissions.user').findOne({
      where: { email }
    });

    return !user || user.id === excludeUserId;
  },

  /**
   * Actualizar email del usuario
   */
  async updateUserEmail(userId, newEmail) {
    return await strapi.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: { 
        email: newEmail,
        confirmed: false
      }
    });
  }
});
