module.exports = [
 
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', 'res.cloudinary.com'],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            'res.cloudinary.com',
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::poweredBy',
  'strapi::logger',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      includeUnparsed: true, // Permite capturar el cuerpo crudo
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  // Agregar el middleware personalizado para manejar problemas de privacidad
  'strapi::cors',

  // {
  //   name: 'strapi::cors',
  //   config: {
  //     origin: ['http://localhost:3000', 'https://grass-characteristics-antigua-specs.trycloudflare.com/'], // Agrega tu dominio aquí
  //   },
  // },
];
