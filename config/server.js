module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // URL pública para generar los enlaces de confirmación de correo
  url: env('ADMIN_URL', 'http://localhost:1337'),  // URL de tu frontend

  admin: {
    // Configuración del panel de administración de Strapi
    url: '/admin',  // Esto asegura que /admin siga estando disponible
  },
});
