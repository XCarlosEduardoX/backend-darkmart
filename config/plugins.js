module.exports = ({ env }) => ({
  // ...
  email: {
    config: {
      provider: 'sendgrid',
      providerOptions: {
        apiKey: env('SENDGRID_API_KEY'),
      },
      settings: {
        defaultFrom: 'mrlcoked4@gmail.com',
        defaultReplyTo: 'mrlcoked4@gmail.com',
      },
    },
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