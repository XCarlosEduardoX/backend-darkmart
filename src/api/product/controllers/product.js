'use strict';
const cache = require('../../../utils/redisCache');


/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::product.product', ({ strapi }) => ({
  async find(ctx) {
    const cacheKey = `products:${JSON.stringify(ctx.query)}`;
    const cachedData = await cache.get(cacheKey);

    if (cachedData) {
      return ctx.send(cachedData);
    }

    const { data, meta } = await super.find(ctx);

    await cache.set(cacheKey, { data, meta }, 3600);

    return { data, meta };
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    const cacheKey = `product:${id}`;
    const cachedData = await cache.get(cacheKey);

    if (cachedData) {
      return ctx.send(cachedData);
    }

    const { data, meta } = await super.findOne(ctx);

    await cache.set(cacheKey, { data, meta }, 3600);

    return { data, meta };
  },

  async create(ctx) {
    const response = await super.create(ctx);
    await cache.flush();
    return response;
  },

  async update(ctx) {
    const response = await super.update(ctx);
    await cache.flush();
    return response;
  },

  async delete(ctx) {
    const response = await super.delete(ctx);
    await cache.flush();
    return response;
  },
}));
