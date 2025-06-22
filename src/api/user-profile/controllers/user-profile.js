'use strict';

/**
 * User profile controller para manejar cambios de email
 */

module.exports = {
  /**
   * Cambiar email del usuario
   */
  async changeEmail(ctx) {
    const { user } = ctx.state;
    const { newEmail, password } = ctx.request.body;

    if (!user) {
      return ctx.unauthorized('Usuario no autenticado');
    }

    if (!newEmail || !password) {
      return ctx.badRequest('Email y contraseña son requeridos');
    }    try {
      // 1. Validar si el nuevo email es igual al actual
      if (user.email && newEmail.toLowerCase() === user.email.toLowerCase()) {
        return ctx.badRequest('El nuevo correo electrónico es igual al actual. No es necesario cambiar.');
      }

      // 2. Verificar que el email no esté en uso por otro usuario
      const existingUser = await strapi.query('plugin::users-permissions.user').findOne({
        where: { email: newEmail }
      });

      if (existingUser && existingUser.id !== user.id) {
        return ctx.badRequest('Ya existe una cuenta registrada con este correo electrónico. Por favor, utiliza otra dirección.');
      }

      // Verificar la contraseña actual
      const validPassword = await strapi.plugins['users-permissions'].services.user.validatePassword(
        password,
        user.password
      );

      if (!validPassword) {
        return ctx.badRequest('Contraseña incorrecta');
      }

      // Actualizar el email
      const updatedUser = await strapi.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { 
          email: newEmail,
          confirmed: false // Requerir nueva confirmación de email
        }
      });

      // Enviar email de confirmación
      try {
        await strapi.plugins['users-permissions'].services.user.sendConfirmationEmail(updatedUser);
      } catch (emailError) {
        console.warn('No se pudo enviar el email de confirmación:', emailError);
      }

      // Sanitizar la respuesta
      const { password: _, resetPasswordToken, confirmationToken, ...sanitizedUser } = updatedUser;

      ctx.send({
        user: sanitizedUser,
        message: 'Email actualizado exitosamente. Se ha enviado un correo de confirmación a tu nueva dirección.'
      });

    } catch (error) {
      console.error('Error al cambiar email:', error);
      ctx.internalServerError('Error interno del servidor');
    }
  },

  /**
   * Obtener información del perfil del usuario
   */
  async getProfile(ctx) {
    const { user } = ctx.state;

    if (!user) {
      return ctx.unauthorized('Usuario no autenticado');
    }

    try {
      const userProfile = await strapi.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
        populate: ['role']
      });

      const { password, resetPasswordToken, confirmationToken, ...sanitizedUser } = userProfile;

      ctx.send({ user: sanitizedUser });
    } catch (error) {
      console.error('Error al obtener perfil:', error);
      ctx.internalServerError('Error interno del servidor');
    }
  }
};
