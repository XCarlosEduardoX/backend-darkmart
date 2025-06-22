module.exports = (plugin) => {
  // Agregar rutas personalizadas al plugin users-permissions
  plugin.routes['content-api'].routes.push(
    {
      method: 'POST',
      path: '/auth/change-email',
      handler: 'user.changeEmail',
      config: {
        middlewares: ['plugin::users-permissions.rateLimit'],
        prefix: '',
      }
    },
    {
      method: 'GET',
      path: '/users/profile',
      handler: 'user.getProfile',
      config: {
        middlewares: ['plugin::users-permissions.rateLimit'],
        prefix: '',
      }
    },
    {
      method: 'POST',
      path: '/auth/resend-confirmation',
      handler: 'user.resendConfirmationEmail',
      config: {
        middlewares: ['plugin::users-permissions.rateLimit'],
        prefix: '',
      }
    }
  );

  return plugin;
};
