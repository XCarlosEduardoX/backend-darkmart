'use strict';

/**
 * User controller extension para agregar funcionalidad de cambio de email
 */

module.exports = (plugin) => {
  
  // Agregar el método de cambio de email al controlador de usuarios
  plugin.controllers.user.changeEmail = async (ctx) => {
    const { user } = ctx.state;
    const { newEmail, password } = ctx.request.body;

    console.log('Change email request from user:', user?.id, 'to email:', newEmail);

    if (!user) {
      return ctx.unauthorized('Usuario no autenticado');
    }

    if (!newEmail || !password) {
      return ctx.badRequest('Email y contraseña son requeridos');
    }

    try {
      // Verificar que el email no esté en uso
      const existingUser = await strapi.query('plugin::users-permissions.user').findOne({
        where: { email: newEmail }
      });

      if (existingUser && existingUser.id !== user.id) {
        return ctx.badRequest('Este email ya está en uso');
      }

      // Obtener el usuario completo con la contraseña
      const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
        where: { id: user.id }
      });

      // Verificar la contraseña actual
      const validPassword = await strapi.plugins['users-permissions'].services.user.validatePassword(
        password,
        fullUser.password
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
      });      // Enviar email de confirmación
      let emailSent = false;
      let emailError = null;
      
      try {
        console.log('Intentando enviar email de confirmación a:', newEmail);
        
        // Verificar si el plugin de email está configurado
        const emailService = strapi.plugins['email'];
        if (!emailService) {
          console.warn('Plugin de email no está disponible');
          emailError = 'Servicio de email no configurado';
        } else {
          // Usar el servicio de confirmación de users-permissions
          await strapi.plugins['users-permissions'].services.user.sendConfirmationEmail(updatedUser);
          emailSent = true;
          console.log('Email de confirmación enviado exitosamente');
        }
      } catch (error) {
        emailError = error.message;
        console.error('Error al enviar email de confirmación:', error);
        
        // Si hay error de configuración de email, intentar método alternativo
        if (error.message.includes('No email server configured') || 
            error.message.includes('provider') ||
            error.message.includes('RESEND_API_KEY')) {
          console.warn('Error de configuración de email detectado. Continuando sin envío...');
        }
      }      // Sanitizar la respuesta
      const { password: _, resetPasswordToken, confirmationToken, ...sanitizedUser } = updatedUser;

      // Mensaje personalizado según si se envió el email o no
      let message = 'Email actualizado exitosamente.';
      if (emailSent) {
        message += ' Se ha enviado un correo de confirmación a tu nueva dirección.';
      } else {
        message += ' Para activar tu nuevo email, contacta al administrador.';
        if (emailError) {
          console.log('Detalle del error de email:', emailError);
        }
      }

      ctx.send({
        user: sanitizedUser,
        message: message,
        emailSent: emailSent,
        emailError: emailError ? 'Error en configuración de email' : null
      });

    } catch (error) {
      console.error('Error al cambiar email:', error);
      return ctx.internalServerError('Error interno del servidor');
    }
  };

  // Nuevo método para reenviar email de confirmación
  plugin.controllers.user.resendConfirmationEmail = async (ctx) => {
    const { user } = ctx.state;

    if (!user) {
      return ctx.unauthorized('Usuario no autenticado');
    }

    try {
      // Obtener el usuario completo
      const fullUser = await strapi.query('plugin::users-permissions.user').findOne({
        where: { id: user.id }
      });

      if (fullUser.confirmed) {
        return ctx.badRequest('El email ya está confirmado');
      }

      console.log('Reenviando email de confirmación para usuario:', user.id, 'email:', fullUser.email);

      try {
        await strapi.plugins['users-permissions'].services.user.sendConfirmationEmail(fullUser);
        
        ctx.send({
          message: 'Email de confirmación reenviado exitosamente',
          emailSent: true
        });
      } catch (emailError) {
        console.error('Error al reenviar email:', emailError);
        
        ctx.send({
          message: 'No se pudo enviar el email de confirmación. Contacta al administrador.',
          emailSent: false,
          error: 'Error en configuración de email'
        });
      }

    } catch (error) {
      console.error('Error al reenviar confirmación:', error);
      return ctx.internalServerError('Error interno del servidor');
    }
  };
  plugin.controllers.user.getProfile = async (ctx) => {
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
      return ctx.internalServerError('Error interno del servidor');
    }
  };

  return plugin;
};
