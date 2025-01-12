// ./src/policies/isAuthenticated.js

module.exports = async (policyContext, config, { strapi }) => {
    const ctx = policyContext;
  
    // Verifica si el usuario está autenticado
    if (!ctx.state.user) {
      // Si no está autenticado, rechaza la solicitud
      return ctx.unauthorized('You need to be logged in to perform this action.');
    }
  
    // Si está autenticado, permite continuar con la solicitud
    return true;
  };
  