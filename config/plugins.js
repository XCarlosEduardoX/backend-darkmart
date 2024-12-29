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
  'magictm-deep-populate': {
    enabled: true,
  }
  // ...
});