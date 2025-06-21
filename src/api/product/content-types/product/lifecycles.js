'use strict';


const redis = require('../../../../utils/redisCache'); // Ruta a tu utilitario de Redis
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


module.exports = {

  async beforeCreate(event) {
    const { data } = event.params;
    console.log('agregando el sku', data);

    console.log('data', data);
    // Generar el SKU si no está definido
    if (!data.sku) {
      let newSku;
      let exists = true;

      // Verificar si el SKU ya existe
      while (exists) {
        newSku = generateShortSku();
        exists = await strapi.query('api::variation.variation').findOne({
          where: { sku: newSku }
        });
      }

      data.sku = newSku;
    };
    // if (data.images && data.images.length > 0) {
    //   if (!data.blurDataURL) {
    //     console.log('generando el blurDataURL');

    //     const blurDataURL = await generateBlurDataURL(data.images[0].url, data.images[0].id);
    //     // data.blurDataURL = blurDataURL;
    //     data.images[0].blurDataURL = blurDataURL;
    //     data.blurDataURL = blurDataURL;
    //   }

    // }
  },

  // async beforeUpdate(event) {

  //   const { data } = event.params;
  //   if (data.images && data.images.length > 0) {
  //     if (!data.blurDataURL) {
  //       console.log('generando el blurDataURL');

  //       const blurDataURL = await generateBlurDataURL(data.images[0].url, data.images[0].id);
  //       // data.blurDataURL = blurDataURL;
  //       data.images[0].blurDataURL = blurDataURL;
  //       data.blurDataURL = blurDataURL;

  //     }

  //   }
  // },










  async beforeFindMany(event) {
    // Crear una clave única basada en los parámetros de la consulta
    const { start, limit, where, sort, populate } = event.params;
    
    // Crear un hash único para la consulta específica
    const queryHash = JSON.stringify({
      start: start || 0,
      limit: limit || 25,
      where: where || {},
      sort: sort || {},
      populate: populate || {}
    });
    
    const cacheKey = `products:query:${Buffer.from(queryHash).toString('base64')}`;

    // Verifica si los datos ya están en cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`Retrieving products from cache with key: ${cacheKey}`);

      // Si hay datos cacheados, se los asignamos a `event.result`
      event.result = JSON.parse(cachedData);
      return event.result; // Retorna la cache en lugar de ir a la DB
    }
  },

  async beforeFindOne(event) {
    const { params } = event;
    const cacheKey = `products:${params.where.id}`;

    // Verifica si los datos ya están en cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log("Retrieving products from cache...");

      event.result = JSON.parse(cachedData);
      return event.result; // Retorna la cache en lugar de ir a la DB
    }
  },
  async afterFindMany(event) {
    // Crear la misma clave única que se usó en beforeFindMany
    const { start, limit, where, sort, populate } = event.params;
    
    const queryHash = JSON.stringify({
      start: start || 0,
      limit: limit || 25,
      where: where || {},
      sort: sort || {},
      populate: populate || {}
    });
    
    const cacheKey = `products:query:${Buffer.from(queryHash).toString('base64')}`;

    // Guarda los datos en Redis después de consultarlos
    await redis.set(cacheKey, JSON.stringify(event.result), CACHE_TTL);
    console.log(`Cached products with key: ${cacheKey}`);
  },

  async afterFindOne(event) {
    const { params, result } = event;
    const cacheKey = `products:${params.where.id}`;

    // Guarda el producto en cache después de consultarlo
    await redis.set(cacheKey, JSON.stringify(result));
  },
  async afterCreate(event) {
    // Eliminar todas las consultas cacheadas de productos
    await redis.delPattern("products:query:*");
    console.log("Cleared all product query caches after create");
  },

  async afterUpdate(event) {
    const { result } = event;
    await redis.del(`products:${result.id}`); // Elimina cache del producto actualizado
    // Eliminar todas las consultas cacheadas de productos
    await redis.delPattern("products:query:*");
    console.log("Cleared all product query caches after update");
  },

  async afterDelete(event) {
    const { params } = event;
    await redis.del(`products:${params.where.id}`); // Elimina cache del producto eliminado
    // Eliminar todas las consultas cacheadas de productos
    await redis.delPattern("products:query:*");
    console.log("Cleared all product query caches after delete");
  },
};
