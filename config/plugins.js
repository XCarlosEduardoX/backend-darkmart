module.exports = ({ env }) => ({

  email: {
    config: {
      provider: 'strapi-provider-email-resend',
      providerOptions: {
        apiKey: env('RESEND_API_KEY'), // Required
      },
      settings: {
        defaultFrom: 'noreply@everblack.store', // Correo personalizado
        defaultReplyTo: 'support@everblack.store', // Correo personalizado
      },
    }
  },
  upload: {
    config: {
      provider: 'cloudinary',
      providerOptions: {
        cloud_name: env('CLOUDINARY_NAME'),
        api_key: env('CLOUDINARY_KEY'),
        api_secret: env('CLOUDINARY_SECRET'),
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
  seo: {
    enabled: true,
  },
  'strapi-algolia': {
    enabled: true,
    config: {
      apiKey: env('ALGOLIA_ADMIN_KEY'),
      applicationId: env('ALGOLIA_APP_ID'),
      contentTypes: [
        {
          name: 'api::product.product', // Nombre del modelo en Strapi
          index: 'dev_products', // Nombre del índice en Algolia
          fields: ['product_name', 'description', 'price'], // Campos que quieres sincronizar
        },

      ],
    },
  },
  'users-permissions': {
    config: {
      email_confirmation_redirection: `${process.env.CLIENT_URL}/email-confirmed`, // URL a donde redirigir después de la confirmación
    },
  },
  // Step 2: Configure the redis cache plugin
  // "rest-cache": {
  //   config: {
  //     provider: {
  //       name: "redis",
  //       options: {
  //         max: 32767,
  //         connection: "default",
  //       },
  //     },
  //     strategy: {

  //       enableEtagSupport: true,
  //       logs: true,
  //       clearRelatedCache: true,
  //       maxAge: 3600000,
  //       contentTypes: [
  //         // list of Content-Types UID to cache
  //         "api::category.category",
  //         "api::product.product",

  //         {
  //           contentType: "api::product.product",
  //           maxAge: 3600000,
  //           hitpass: false,
  //           keys: {
  //             useQueryParams: false,
  //             useHeaders: ["accept-encoding"],
  //           },
  //           maxAge: 18000,
  //           method: "GET",
  //         }
  //       ],
  //     },
  //   },
  // },
  // "image-optimizer": {
  //   enabled: true,
  //   config: {
  //     include: ["jpeg", "jpg", "png"],
  //     exclude: ["gif"],
  //     formats: ["original", "webp", "avif"],
  //     sizes: [
  //       {
  //         name: "xs",
  //         width: 300,
  //       },
  //       {
  //         name: "sm",
  //         width: 768,
  //       },
  //       {
  //         name: "md",
  //         width: 1280,
  //       },
  //       {
  //         name: "lg",
  //         width: 1920,
  //       },
  //       {
  //         name: "xl",
  //         width: 2840,
  //         // Won't create an image larger than the original size
  //         withoutEnlargement: true,
  //       },
  //       {
  //         // Uses original size but still transforms for formats
  //         name: "original",
  //       },
  //     ],
  //     additionalResolutions: [1.5, 3],
  //     quality: 70,
  //   },
  // },
  // ...
});