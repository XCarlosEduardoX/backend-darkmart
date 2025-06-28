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
      // Usar entityService para mejor manejo de privacidad
      const userProfile = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
        populate: {
          role: {
            fields: ['id', 'name', 'type', 'description']
          }
        }
      });

      const { password, resetPasswordToken, confirmationToken, ...sanitizedUser } = userProfile;

      ctx.send({ user: sanitizedUser });
    } catch (error) {
      console.error('Error al obtener perfil:', error);
      ctx.internalServerError('Error interno del servidor');
    }
  },

  /**
   * Cambiar rol del usuario (solo para administradores)
   */
  async changeUserRole(ctx) {
    const { user } = ctx.state;
    const { userId, newRoleId } = ctx.request.body;

    if (!user) {
      return ctx.unauthorized('Usuario no autenticado');
    }

    // Verificar que el usuario actual sea administrador
    if (user.role.type !== 'admin' && user.role.type !== 'super_admin') {
      return ctx.forbidden('No tienes permisos para cambiar roles de usuario');
    }

    if (!userId || !newRoleId) {
      return ctx.badRequest('ID de usuario y ID de rol son requeridos');
    }

    try {
      // Verificar que el rol existe
      const role = await strapi.entityService.findOne('plugin::users-permissions.role', newRoleId, {
        fields: ['id', 'name', 'type', 'description']
      });

      if (!role) {
        return ctx.badRequest('El rol especificado no existe');
      }

      // Verificar que el usuario existe
      const targetUser = await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        populate: {
          role: {
            fields: ['id', 'name', 'type', 'description']
          }
        }
      });

      if (!targetUser) {
        return ctx.badRequest('El usuario especificado no existe');
      }

      // Actualizar el rol del usuario
      await strapi.entityService.update('plugin::users-permissions.user', userId, {
        data: { role: newRoleId }
      });

      // Obtener el usuario actualizado con la información del rol
      const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        populate: {
          role: {
            fields: ['id', 'name', 'type', 'description']
          }
        }
      });

      // Sanitizar la respuesta
      const { password: _, resetPasswordToken, confirmationToken, ...sanitizedUser } = userWithRole;

      ctx.send({
        user: sanitizedUser,
        message: `Rol actualizado exitosamente a '${role.name}'`
      });

    } catch (error) {
      console.error('Error al cambiar rol:', error);
      ctx.internalServerError('Error interno del servidor');
    }
  },

  /**
   * Obtener todos los roles disponibles
   */
  async getRoles(ctx) {
    const { user } = ctx.state;

    if (!user) {
      return ctx.unauthorized('Usuario no autenticado');
    }

    // Solo administradores pueden ver los roles
    if (user.role.type !== 'admin' && user.role.type !== 'super_admin') {
      return ctx.forbidden('No tienes permisos para ver los roles');
    }

    try {
      // Usar entityService en lugar de query para mejor manejo de privacidad
      const roles = await strapi.entityService.findMany('plugin::users-permissions.role', {
        fields: ['id', 'name', 'description', 'type']
      });

      ctx.send({ roles });
    } catch (error) {
      console.error('Error al obtener roles:', error);
      ctx.internalServerError('Error interno del servidor');
    }
  }
};
