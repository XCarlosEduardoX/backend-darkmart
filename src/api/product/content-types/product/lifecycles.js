'use strict';

const cache = require('../../../../utils/redisCache'); // Ruta a tu utilitario de Redis

// Configuración para la caché
const CACHE_TTL = 3600; // 1 hora

// Función para generar un identificador único corto
const generateShortSku = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length = 5;
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
};

// Función para manejar la caché
const handleCache = async (cacheKey, fetchFunction, ttl = CACHE_TTL) => {
  try {
    // Intentar recuperar datos de la caché
    const cachedData = await cache.get(cacheKey);
    if (cachedData) {
      console.log(`[CACHE] Data retrieved for key: ${cacheKey}`);
      return JSON.parse(cachedData);
    }
  } catch (error) {
    console.error(`[CACHE ERROR] Failed to retrieve key ${cacheKey}`, error);
  }

  // Si no hay datos en caché, ejecuta la función fetchFunction
  const result = await fetchFunction();
  try {
    // Guardar los datos en la caché
    await cache.set(cacheKey, JSON.stringify(result), ttl);
    console.log(`[CACHE] Data saved for key: ${cacheKey}`);
  } catch (error) {
    console.error(`[CACHE ERROR] Failed to save key ${cacheKey}`, error);
  }

  return result;
};

// Función para invalidar una lista de claves de caché
const invalidateCache = async (keys = []) => {
  console.log(`Invalidating cache for keys: ${keys}`);
  for (const key of keys) {
    await cache.del(key).catch(err => console.error(`Error deleting key ${key}:`, err));
  }
};

// Función para invalidar patrones de caché
const invalidateCachePatterns = async (patterns = []) => {
  for (const pattern of patterns) {
    await cache.delPattern(pattern).catch(err => console.error(`Error deleting pattern ${pattern}:`, err));
  }
};

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    // Generar el SKU si no está definido
    if (!data.sku) {
      let newSku;
      let exists = true;

      // Verificar si el SKU ya existe
      while (exists) {
        newSku = generateShortSku();
        exists = await strapi.query('api::product.product').findOne({
          where: { sku: newSku }
        });
      }

      data.sku = newSku;
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;

    // Generar un nuevo SKU solo si falta
    if (!data.sku) {
      let newSku;
      let exists = true;

      while (exists) {
        newSku = generateShortSku();
        exists = await strapi.query('api::product.product').findOne({
          where: { sku: newSku }
        });
      }

      data.sku = newSku;
    }
  },

  async afterCreate(event) {
    console.log('afterCreate: invalidando cache');
    // Invalidar todos los productos
    await invalidateCachePatterns(['products:*']);

    // Manejar la caché del producto creado (opcional)
    const { result } = event;
    const cacheKey = `product:${result.id}`;
    await handleCache(cacheKey, async () => result);
  },

  async afterUpdate(event) {
    const { result } = event; // Contiene los datos del registro actualizado
    console.log(`afterUpdate: invalidando cache para producto ${result.id}`);

    // Invalidar el caché del producto actualizado y la lista de productos
    await invalidateCache([`product:${result.id}`]);
    await invalidateCachePatterns(['products:*']);

    // Manejar la caché del producto actualizado (opcional)
    const cacheKey = `product:${result.id}`;
    await handleCache(cacheKey, async () => result);
  },

  async afterDelete(event) {
    const { result } = event; // Contiene los datos del registro eliminado
    console.log(`afterDelete: invalidando cache para producto ${result.id}`);

    // Invalidar el caché del producto eliminado y la lista de productos
    await invalidateCache([`product:${result.id}`]);
    await invalidateCachePatterns(['products:*']);
  }
};
