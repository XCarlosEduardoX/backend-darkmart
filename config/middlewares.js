module.exports = [
  'strapi::errors',
  'strapi::security',
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
  'strapi::cors'
  // {
  //   name: 'strapi::cors',
  //   config: {
  //     origin: ['http://localhost:3000', 'https://grass-characteristics-antigua-specs.trycloudflare.com/'], // Agrega tu dominio aquí
  //   },
  // },
];
