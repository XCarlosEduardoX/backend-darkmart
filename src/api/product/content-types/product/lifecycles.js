'use strict';

const crypto = require('crypto');
const redis = require('../../../../utils/redisCache'); // Ruta a tu utilitario de Redis

// Configuración para la caché optimizada
const CACHE_TTL = 3600; // 1 hora
const QUERY_CACHE_TTL = 1800; // 30 minutos para queries (más volátiles)

// Cache de claves generadas para evitar recálculos
const keyCache = new Map();
const MAX_CACHE_SIZE = 1000; // Limitar el tamaño del cache local

// Cache en memoria para consultas ultra-frecuentes (NUEVA IMPLEMENTACIÓN)
const memoryCache = new Map();
const MAX_MEMORY_CACHE = 50; // Solo las 50 consultas más frecuentes
const MEMORY_CACHE_TTL = 30000; // 30 segundos en memoria

// Función optimizada para generar un identificador único corto
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

// Función ultra-optimizada para generar claves de cache (MEJORADA)
const generateCacheKey = (type, params) => {
  // Crear una clave simple y estable
  const paramString = JSON.stringify(params);
  
  // Verificar cache local primero
  const cacheMapKey = `${type}_${paramString}`;
  if (keyCache.has(cacheMapKey)) {
    return keyCache.get(cacheMapKey);
  }
  
  // Hash ultra-rápido usando solo algunos caracteres clave
  let fastHash = 0;
  for (let i = 0; i < paramString.length; i += 4) { // Saltar caracteres para velocidad
    fastHash = ((fastHash << 5) - fastHash + paramString.charCodeAt(i)) & 0xfffffff;
  }
  
  const cacheKey = `products:${type}:${fastHash.toString(16).slice(-8)}`;
  
  // Guardar en cache local con límite de tamaño
  if (keyCache.size >= MAX_CACHE_SIZE) {
    const firstKey = keyCache.keys().next().value;
    keyCache.delete(firstKey);
  }
  keyCache.set(cacheMapKey, cacheKey);
  
  return cacheKey;
};

// Funciones del cache en memoria híbrido
const getFromMemoryCache = (key) => {
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.timestamp < MEMORY_CACHE_TTL) {
    return cached.data;
  }
  if (cached) {
    memoryCache.delete(key); // Limpiar cache expirado
  }
  return null;
};

const setInMemoryCache = (key, data) => {
  // Limpiar cache si está lleno
  if (memoryCache.size >= MAX_MEMORY_CACHE) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
  }
  
  memoryCache.set(key, {
    data: data,
    timestamp: Date.now()
  });
};

const clearMemoryCache = () => {
  memoryCache.clear();
  console.log("🧹 Memory cache cleared");
};

// Limpiar cache en memoria periódicamente (cada 5 minutos)
setInterval(() => {
  const expiredKeys = [];
  const now = Date.now();
  
  for (const [key, cached] of memoryCache.entries()) {
    if (now - cached.timestamp >= MEMORY_CACHE_TTL) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => memoryCache.delete(key));
  
  if (expiredKeys.length > 0) {
    console.log(`🕒 Cleaned ${expiredKeys.length} expired memory cache entries`);
  }
}, 300000); // 5 minutos

// Función para normalizar parámetros de query
const normalizeQueryParams = ({ start, limit, where, sort, populate }) => {
  return {
    start: start || 0,
    limit: limit || 25,
    where: where || {},
    sort: sort || {},
    populate: populate || {}
  };
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
    const { start, limit, where, sort, populate } = event.params;
    
    // Normalizar parámetros para consistencia
    const normalizedParams = normalizeQueryParams({ start, limit, where, sort, populate });
    
    // Generar clave de cache optimizada (con cache local)
    const cacheKey = generateCacheKey('query', normalizedParams);

    // 1. PRIMER NIVEL: Cache en memoria (instantáneo)
    const memoryData = getFromMemoryCache(cacheKey);
    if (memoryData) {
      console.log(`🚀 Lightning memory hit: ${cacheKey}`);
      event.result = { ...memoryData, _fromCache: true };
      return event.result;
    }

    // 2. SEGUNDO NIVEL: Redis con timeout muy corto
    try {
      const cachedData = await Promise.race([
        redis.get(cacheKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Cache timeout')), 30)) // 30ms timeout
      ]);
      
      if (cachedData) {
        console.log(`⚡ Fast Redis hit: ${cacheKey}`);
        // Guardar en memoria para próximas consultas
        setInMemoryCache(cacheKey, cachedData);
        event.result = { ...cachedData, _fromCache: true };
        return event.result;
      }
    } catch (error) {
      if (error.message === 'Cache timeout') {
        console.warn(`⏰ Redis timeout (30ms): ${cacheKey}`);
      }
      // Continuar sin cache si Redis es lento
    }
  },

  async beforeFindOne(event) {
    const { params } = event;
    const cacheKey = `products:single:${params.where.id}`;

    // Verificar cache con timeout
    try {
      const cachedData = await Promise.race([
        redis.get(cacheKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Cache timeout')), 50))
      ]);
      
      if (cachedData) {
        console.log(`⚡ Fast single hit: ${params.where.id}`);
        // Marcar que viene del cache
        event.result = { ...cachedData, _fromCache: true };
        return event.result;
      }
    } catch (error) {
      if (error.message === 'Cache timeout') {
        console.warn(`⏰ Single cache timeout: ${params.where.id}`);
      }
    }
  },
  async afterFindMany(event) {
    // Solo cachear si no había cache previo Y el resultado es válido
    if (!event.result || event.result._fromCache || Array.isArray(event.result) && event.result.length === 0) {
      return;
    }

    const { start, limit, where, sort, populate } = event.params;
    
    // Usar los mismos parámetros normalizados que en beforeFindMany
    const normalizedParams = normalizeQueryParams({ start, limit, where, sort, populate });
    const cacheKey = generateCacheKey('query', normalizedParams);

    // Inmediatamente guardar en memoria cache (instantáneo)
    setInMemoryCache(cacheKey, event.result);

    // Cache asíncrono en Redis para persistencia
    setImmediate(async () => {
      try {
        // Verificar que no existe ya para evitar escrituras innecesarias
        const exists = await redis.exists(cacheKey);
        if (!exists) {
          await redis.setWithStrategy(cacheKey, event.result, {
            ttl: QUERY_CACHE_TTL,
            priority: 'high',
            tags: ['products', 'queries']
          });
          console.log(`💾 Async Redis cached: ${cacheKey}`);
        }
      } catch (error) {
        console.error(`❌ Error caching query:`, error.message);
      }
    });
  },

  async afterFindOne(event) {
    // Solo cachear si no había cache previo
    if (!event.result || event.result._fromCache) {
      return;
    }

    const { params, result } = event;
    const cacheKey = `products:single:${params.where.id}`;

    // Cache asíncrono para no bloquear
    setImmediate(async () => {
      try {
        await redis.setWithStrategy(cacheKey, result, {
          ttl: CACHE_TTL,
          priority: 'critical',
          tags: ['products', 'single']
        });
      } catch (error) {
        console.error(`❌ Error caching single:`, error.message);
      }
    });
  },
  async afterCreate(event) {
    // Limpiar ambos niveles de cache
    clearMemoryCache();
    
    // Usar el nuevo método de eliminación por tags para mayor eficiencia
    setImmediate(async () => {
      try {
        await Promise.all([
          redis.delByTag('queries'),
          redis.delByTag('products')
        ]);
        console.log("🧹 Cleared all product caches after create (optimized)");
      } catch (error) {
        console.error("❌ Error clearing cache after create:", error.message);
      }
    });
  },

  async afterUpdate(event) {
    const { result } = event;
    
    // Limpiar cache en memoria
    clearMemoryCache();
    
    // Paralelizar las operaciones de limpieza (asíncrono)
    setImmediate(async () => {
      try {
        await Promise.all([
          redis.del(`products:single:${result.id}`),
          redis.delByTag('queries'),
          redis.delByTag('products')
        ]);
        console.log("🔄 Cleared product caches after update (optimized)");
      } catch (error) {
        console.error("❌ Error clearing cache after update:", error.message);
      }
    });
  },

  async afterDelete(event) {
    const { params } = event;
    
    // Limpiar cache en memoria
    clearMemoryCache();
    
    // Paralelizar las operaciones de limpieza (asíncrono)
    setImmediate(async () => {
      try {
        await Promise.all([
          redis.del(`products:single:${params.where.id}`),
          redis.delByTag('queries'),
          redis.delByTag('products')
        ]);
        console.log("🗑️ Cleared product caches after delete (optimized)");
      } catch (error) {
        console.error("❌ Error clearing cache after delete:", error.message);
      }
    });
  },
};