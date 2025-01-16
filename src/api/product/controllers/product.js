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

      // Limpiar lista de productos en caché
      await cache.delPattern('products:*');

      return response;
    },

    async update(ctx) {
  const { id } = ctx.params;

  // Realiza la actualización en la base de datos
  const response = await super.update(ctx);

  // Clave del caché para el producto actualizado
  const cacheKey = `product:${id}`;

  // Actualiza el caché con los nuevos datos del producto
  await cache.set(cacheKey, JSON.stringify(response), 3600); // TTL de 1 hora

  // Opcional: limpiar lista de productos si afecta resultados
  await cache.delPattern('products:*');

  return response;
},

    async delete(ctx) {
      const { id } = ctx.params;
      const response = await super.delete(ctx);

      // Invalidar el caché del producto específico
      const cacheKey = `product:${id}`;
      await cache.del(cacheKey);

      // Opcional: limpiar lista de productos si afecta resultados
      await cache.delPattern('products:*');

      return response;
    },
  };
});