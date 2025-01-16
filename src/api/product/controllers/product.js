'use strict';

const cache = require('../../../utils/redisCache');
const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::product.product', ({ strapi }) => {
  // Helper genérico para manejar el caché
  const handleCache = async (cacheKey, fetchFunction, ttl = 3600) => {
    const cachedData = await cache.get(cacheKey);

    if (cachedData) {
      console.log('Data retrieved from cache');
      return JSON.parse(cachedData);
    }

    console.log('Fetching data from database');
    const result = await fetchFunction();
    await cache.set(cacheKey, JSON.stringify(result), ttl);

    return result;
  };

  return {
    async find(ctx) {
      const cacheKey = `products:${JSON.stringify(ctx.query)}`;
      const { data, meta } = await handleCache(
        cacheKey,
        async () => await super.find(ctx)
      );
      return { data, meta };
    },

    async findOne(ctx) {
      const { id } = ctx.params;
      const cacheKey = `product:${id}`;
      const { data, meta } = await handleCache(
        cacheKey,
        async () => await super.findOne(ctx)
      );
      return { data, meta };
    },

    async create(ctx) {
      const response = await super.create(ctx);
      await cache.flush(); // Limpiar la caché cuando un nuevo producto es creado
      return response;
    },

    async update(ctx) {
      const response = await super.update(ctx);
      await cache.flush(); // Limpiar la caché cuando un producto es actualizado
      return response;
    },

    async delete(ctx) {
      const response = await super.delete(ctx);
      await cache.flush(); // Limpiar la caché cuando un producto es eliminado
      return response;
    },
  };
});
