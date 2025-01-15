module.exports = ({ env }) => ({
  // ...
  email: {
    config: {
      provider: 'strapi-provider-email-resend',
      providerOptions: {
        apiKey: env('RESEND_API_KEY'), // Required
      },
      settings: {
        defaultFrom: 'mrlocked4@gmail.com',
        defaultReplyTo: 'mrlocked4@gmail.com',
      },
    }
    // config: {
    //   provider: 'sendgrid',
    //   providerOptions: {
    //     apiKey: env('SENDGRID_API_KEY'),
    //   },
    //   settings: {
    //     defaultFrom: 'mrlcoked4@gmail.com',
    //     defaultReplyTo: 'mrlcoked4@gmail.com',
    //   },
    // },
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
  redis: {
    config: {
      settings: {
        debug: false,
        enableRedlock: true,
      },
      connections: {
        default: {
          connection: {
            host: env('REDISHOST', '127.0.0.1'),
            port: env.int('REDISPORT', 6379),
            db: env.int('REDISDB', 0),
            password: env('REDISPASSWORD', null),
          },
          settings: {
            debug: false,
          },
        },
      },
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