const compress = require('compression');

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await compress()(ctx.req, ctx.res, next);
  };
};