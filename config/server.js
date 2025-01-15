module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // url: env('CLIENT_URL', 'http://localhost:1337'),
  url: 'https://backend-darkmart-production.up.railway.app',
  forgotPassword: {
    redirectTo: env('FRONTEND_RESET_PASSWORD_URL', 'http://localhost:3000/reset-password'), // URL de tu frontend
  },
});
