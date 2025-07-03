'use strict';

const sharp = require('sharp');
const redis = require('../../../../utils/redisCache');


// Importar funciones de validación
const { validateId, isValidCacheKey } = redis;

// Configuración optimizada
const CACHE_TTL = 3600; // 1 hora
const QUERY_CACHE_TTL = 1800; // 30 minutos para queries
const REDIS_TIMEOUT = 20; // Timeout más agresivo para Redis

// Cache de claves generadas para evitar recálculos
const keyCache = new Map();
const MAX_CACHE_SIZE = 1000;

// Cache en memoria para consultas ultra-frecuentes (OPTIMIZADO)
const memoryCache = new Map();
const MAX_MEMORY_CACHE = 100; // Aumentado para mejor hit rate
const MEMORY_CACHE_TTL = 60000; // 1 minuto (aumentado)

// Set para evitar operaciones de cache duplicadas
const pendingCacheOps = new Set();

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
  try {
    // Sanitizar parámetros para evitar claves inválidas
    const sanitizedParams = JSON.stringify(params, (key, value) => {
      if (value === undefined || value === null) {
        return 'null';
      }
      return value;
    });
    
    const cacheMapKey = `${type}_${sanitizedParams}`;
    
    if (keyCache.has(cacheMapKey)) {
      return keyCache.get(cacheMapKey);
    }
    
    // Hash más eficiente
    let fastHash = 0;
    for (let i = 0; i < sanitizedParams.length; i += 3) {
      fastHash = ((fastHash << 5) - fastHash + sanitizedParams.charCodeAt(i)) & 0xfffffff;
    }
    
    const cacheKey = `products:${type}:${fastHash.toString(16).slice(-8)}`;
    
    // Validar que la clave generada sea válida
    if (!isValidCacheKey(cacheKey)) {
      console.warn('⚠️ Clave de cache inválida generada:', cacheKey);
      return null;
    }
    
    // Gestión del tamaño del cache local
    if (keyCache.size >= MAX_CACHE_SIZE) {
      const firstKey = keyCache.keys().next().value;
      keyCache.delete(firstKey);
    }
    keyCache.set(cacheMapKey, cacheKey);
    
    return cacheKey;
  } catch (error) {
    console.error('❌ Error generando clave de cache:', error);
    return null;
  }
};

// Función segura para obtener ID de parámetros (MEJORADA)
const extractId = (params) => {
  // Múltiples formas de obtener el ID
  const rawId = params?.where?.id || 
                params?.id || 
                params?.data?.id ||
                (typeof params === 'string' ? params : null);
            
  // Usar la función de validación mejorada
  const validId = validateId(rawId);
  
  if (!validId) {
    console.warn('⚠️ ID inválido detectado:', { 
      params: typeof params === 'object' ? Object.keys(params) : params,
      rawId 
    });
    return null;
  }
  
  return validId;
};

// Funciones del cache en memoria híbrido (OPTIMIZADAS)
const getFromMemoryCache = (key) => {
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.timestamp < MEMORY_CACHE_TTL) {
    cached.hits = (cached.hits || 0) + 1; // Track hits
    return cached.data;
  }
  if (cached) {
    memoryCache.delete(key);
  }
  return null;
};

const setInMemoryCache = (key, data) => {
  // Evitar cache de datos inválidos
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return;
  }
  
  // Limpiar cache si está lleno (LRU básico)
  if (memoryCache.size >= MAX_MEMORY_CACHE) {
    // Encontrar el entry con menos hits para eliminar
    let leastUsed = null;
    let minHits = Infinity;
    
    for (const [k, cached] of memoryCache.entries()) {
      const hits = cached.hits || 0;
      if (hits < minHits) {
        minHits = hits;
        leastUsed = k;
      }
    }
    
    if (leastUsed) {
      memoryCache.delete(leastUsed);
    }
  }
  
  memoryCache.set(key, {
    data: data,
    timestamp: Date.now(),
    hits: 0
  });
};

const clearMemoryCache = () => {
  memoryCache.clear();
  console.log("🧹 Memory cache cleared");
};

// Limpiar cache en memoria periódicamente (OPTIMIZADO)
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

// Función para normalizar parámetros de query (MEJORADA)
const normalizeQueryParams = ({ start, limit, where, sort, populate }) => {
  return {
    start: start || 0,
    limit: limit || 25,
    where: where || {},
    sort: sort || {},
    populate: populate || {}
  };
};

// Función con timeout para Redis con circuit breaker
let redisFailureCount = 0;
const MAX_REDIS_FAILURES = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 segundos
let circuitBreakerOpenUntil = 0;

const redisWithTimeout = async (operation, timeout = REDIS_TIMEOUT) => {
  // Circuit breaker - si Redis ha fallado mucho, no intentar por un tiempo
  if (Date.now() < circuitBreakerOpenUntil) {
    throw new Error('Circuit breaker open');
  }
  
  try {
    const result = await Promise.race([
      operation(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis timeout')), timeout)
      )
    ]);
    
    // Reset failure count on success
    redisFailureCount = 0;
    return result;
  } catch (error) {
    redisFailureCount++;
    
    if (redisFailureCount >= MAX_REDIS_FAILURES) {
      circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
      console.warn(`🔥 Circuit breaker opened for Redis (${redisFailureCount} failures)`);
    }
    
    throw error;
  }
};

// Función mejorada para generar blur base64 usando sharp
const generateBlurDataURL = async (imageUrl) => {
  try {
    let imageBuffer;
    
    // Validar URL
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('URL de imagen inválida');
    }
    
    console.log(`🖼️  Generando blur para: ${imageUrl}`);
    
    if (imageUrl.startsWith('/uploads/')) {
      const fs = require('fs').promises;
      const path = require('path');
      const filePath = path.join(process.cwd(), 'public', imageUrl);
      
      try {
        imageBuffer = await fs.readFile(filePath);
        console.log('📁 Imagen cargada desde archivo local');
      } catch (fileError) {
        console.warn('No se pudo leer archivo local:', filePath);
        const fullUrl = process.env.STRAPI_URL || 'http://localhost:1337';
        
        // Usar AbortController para timeout manual
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        try {
          const response = await fetch(fullUrl + imageUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Strapi-BlurGenerator'
            }
          });
          clearTimeout(timeoutId);
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          imageBuffer = Buffer.from(await response.arrayBuffer());
          console.log('🌐 Imagen descargada desde URL');
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      }
    } else {
      // Para URLs externas (ej. Cloudinary)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      try {
        const response = await fetch(imageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Strapi-BlurGenerator'
          }
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        imageBuffer = Buffer.from(await response.arrayBuffer());
        console.log('🌐 Imagen descargada desde URL externa');
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    }

    // Generar blur con Sharp
    const blurBuffer = await sharp(imageBuffer)
      .resize(20, 20, { fit: 'cover' })
      .blur(8) // Blur más suave
      .jpeg({ quality: 30, progressive: true })
      .toBuffer();
    
    const base64 = blurBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;
    
    console.log(`✅ Blur generado exitosamente (${(base64.length / 1024).toFixed(1)}KB)`);
    return dataUrl;
    
  } catch (error) {
    console.error('❌ Error generando blur para', imageUrl, ':', error.message);
    // Fallback blur placeholder
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSIjZjNmNGY2IiBvcGFjaXR5PSIwLjUiLz4KPC9zdmc+Cg==';
  }
};

// Función para obtener la mejor URL para blur
const getBestImageUrlForBlur = (imageData) => {
  if (imageData.formats) {
    if (imageData.formats.thumbnail?.url) return imageData.formats.thumbnail.url;
    if (imageData.formats.small?.url) return imageData.formats.small.url;
    if (imageData.formats.medium?.url) return imageData.formats.medium.url;
    if (imageData.formats.large?.url) return imageData.formats.large.url;
  }
  
  if (imageData.url) return imageData.url;
  if (typeof imageData === 'string') return imageData;
  
  console.warn('No se pudo obtener URL de imagen:', imageData);
  return null;
};

// Función para procesar imágenes y generar blur (MEJORADA)
const processImagesForBlur = async (images) => {
  if (!images || !Array.isArray(images) || images.length === 0) {
    console.log('⚠️ No hay imágenes para procesar');
    return;
  }
  
  console.log(`🖼️  Procesando ${images.length} imágenes para blur...`);
  
  const blurPromises = images.map(async (imageData, index) => {
    try {
      // Si ya tiene blur, saltear
      if (imageData.blur) {
        console.log(`✅ Imagen ${index + 1} ya tiene blur`);
        return;
      }
      
      const imageUrl = getBestImageUrlForBlur(imageData);
      if (!imageUrl) {
        console.warn(`⚠️  No se pudo obtener URL para imagen ${index + 1}`);
        return;
      }
      
      console.log(`🔄 Generando blur para imagen ${index + 1}: ${imageUrl.substring(0, 50)}...`);
      const blurDataUrl = await generateBlurDataURL(imageUrl);
      
      if (blurDataUrl && blurDataUrl.startsWith('data:image/')) {
        imageData.blur = blurDataUrl;
        console.log(`✅ Blur generado exitosamente para imagen ${index + 1}`);
      } else {
        console.warn(`⚠️ Blur inválido generado para imagen ${index + 1}`);
      }
    } catch (error) {
      console.error(`❌ Error procesando imagen ${index + 1}:`, error.message);
      // Asignar blur placeholder en caso de error
      imageData.blur = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1zbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSIjZjNmNGY2IiBvcGFjaXR5PSIwLjMiLz4KPC9zdmc+Cg==';
    }
  });
  
  await Promise.allSettled(blurPromises); // Usar allSettled para no fallar si una imagen falla
  console.log(`🎉 Procesamiento de blur completado para ${images.length} imágenes`);
};

// Función de utilidad para regenerar blurs de productos existentes
const regenerateProductBlurs = async (productId = null) => {
  try {
    console.log('🔄 Iniciando regeneración de blurs...');
    
    let products;
    if (productId) {
      // Regenerar blur de un producto específico
      const product = await strapi.entityService.findOne('api::product.product', productId, {
        populate: { images: true }
      });
      products = product ? [product] : [];
    } else {
      // Regenerar blurs de todos los productos
      products = await strapi.entityService.findMany('api::product.product', {
        populate: { images: true },
        pagination: { start: 0, limit: -1 } // Obtener todos
      });
    }
    
    console.log(`📊 Encontrados ${products.length} productos para procesar`);
    
    let processedCount = 0;
    let errorCount = 0;
    
    for (const product of products) {
      try {
        if (product['images'] && Array.isArray(product['images']) && product['images'].length > 0) {
          console.log(`🖼️  Procesando producto ${product.id}...`);
          
          // Limpiar blurs existentes para regenerar
          product['images'].forEach(img => {
            if (img.blur) {
              delete img.blur;
            }
          });
          
          await processImagesForBlur(product['images']);
          
          await strapi.entityService.update('api::product.product', product.id, {
            data: {
              images: product['images']
            }
          });
          
          processedCount++;
          console.log(`✅ Producto ${product.id} procesado exitosamente`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error procesando producto ${product.id}:`, error.message);
      }
    }
    
    console.log(`🎉 Regeneración completada: ${processedCount} exitosos, ${errorCount} errores`);
    return { processed: processedCount, errors: errorCount };
    
  } catch (error) {
    console.error('❌ Error en regeneración de blurs:', error);
    throw error;
  }
};

// Función para limpiar blurs inválidos o corruptos
const cleanInvalidBlurs = async () => {
  try {
    console.log('🧹 Iniciando limpieza de blurs inválidos...');
    
    const products = await strapi.entityService.findMany('api::product.product', {
      populate: { images: true },
      pagination: { start: 0, limit: -1 }
    });
    
    let cleanedCount = 0;
    
    for (const product of products) {
      let needsUpdate = false;
      
      if (product['images'] && Array.isArray(product['images'])) {
        product['images'].forEach(img => {
          if (img.blur) {
            // Verificar si el blur es válido
            if (!img.blur.startsWith('data:image/') || img.blur.length < 50) {
              console.log(`🗑️ Eliminando blur inválido del producto ${product.id}`);
              delete img.blur;
              needsUpdate = true;
            }
          }
        });
        
        if (needsUpdate) {
          await strapi.entityService.update('api::product.product', product.id, {
            data: {
              images: product['images']
            }
          });
          cleanedCount++;
        }
      }
    }
    
    console.log(`✅ Limpieza completada: ${cleanedCount} productos actualizados`);
    return cleanedCount;
    
  } catch (error) {
    console.error('❌ Error en limpieza de blurs:', error);
    throw error;
  }
};

module.exports = {

  async beforeCreate(event) {
    const { data } = event.params;
    console.log('🆕 Creando producto con datos:', Object.keys(data));

    if (!data.sku) {
      let newSku;
      let exists = true;

      while (exists) {
        newSku = generateShortSku();
        exists = await strapi.query('api::variation.variation').findOne({
          where: { sku: newSku }
        });
      }
      data.sku = newSku;
      console.log(`🏷️  SKU generado: ${newSku}`);
    }

    if (data.images) {
      await processImagesForBlur(data.images);
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    console.log('🔄 Actualizando producto con datos:', Object.keys(data));
    
    if (data.images) {
      await processImagesForBlur(data.images);
    }
  },

  async afterCreate(event) {
    const { result } = event;
    
    if (result.id && result.images && result.images.length > 0) {
      const needsBlurUpdate = result.images.some(img => !img.blur);
      
      if (needsBlurUpdate) {
        console.log('🔄 Post-procesando blur para producto creado:', result.id);
        
        setImmediate(async () => {
          try {
            const fullProduct = await strapi.entityService.findOne('api::product.product', result.id, {
              populate: { images: true }
            });
            
            // Verificar que se obtuvo el producto y tiene imágenes usando acceso por índice
            if (fullProduct && fullProduct['images'] && Array.isArray(fullProduct['images'])) {
              await processImagesForBlur(fullProduct['images']);
              
              await strapi.entityService.update('api::product.product', result.id, {
                data: {
                  images: fullProduct['images']
                }
              });
              
              console.log('✅ Blur post-procesado completado para producto:', result.id);
            } else {
              console.warn('⚠️ No se pudieron obtener las imágenes del producto:', result.id);
            }
          } catch (error) {
            console.error('❌ Error en post-procesamiento de blur:', error);
          }
        });
      }
    }

    clearMemoryCache();
    
    // Limpieza de cache asíncrona sin duplicación
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

  async beforeFindMany(event) {
    const { start, limit, where, sort, populate } = event.params;
    
    const normalizedParams = normalizeQueryParams({ start, limit, where, sort, populate });
    const cacheKey = generateCacheKey('query', normalizedParams);

    // Verificar que se generó una clave válida
    if (!cacheKey) {
      console.warn('⚠️ No se pudo generar clave de cache válida para query');
      return;
    }

    // 1. Cache en memoria (instantáneo)
    const memoryData = getFromMemoryCache(cacheKey);
    if (memoryData) {
      console.log(`🚀 Lightning memory hit: ${cacheKey}`);
      event.result = { ...memoryData, _fromCache: true };
      return event.result;
    }

    // 2. Redis con timeout y circuit breaker
    try {
      const cachedData = await redisWithTimeout(() => redis.get(cacheKey));
      
      if (cachedData) {
        console.log(`⚡ Fast Redis hit: ${cacheKey}`);
        setInMemoryCache(cacheKey, cachedData);
        event.result = { ...cachedData, _fromCache: true };
        return event.result;
      }
    } catch (error) {
      if (error.message === 'Redis timeout') {
        console.warn(`⏰ Redis timeout (${REDIS_TIMEOUT}ms): query cache`);
      } else if (error.message === 'Circuit breaker open') {
        console.warn(`🔥 Circuit breaker prevented Redis call`);
      }
    }
  },

  async beforeFindOne(event) {
    const { params } = event;
    const id = extractId(params);
    
    // Salir early si no hay ID válido
    if (!id) {
      console.warn('⚠️ beforeFindOne: ID inválido, saltando cache');
      return;
    }
    
    const cacheKey = `products:single:${id}`;

    // Validar que la clave de cache sea válida
    if (!isValidCacheKey(cacheKey)) {
      console.warn('⚠️ beforeFindOne: Clave de cache inválida generada, saltando cache');
      return;
    }

    // 1. Cache en memoria primero
    const memoryData = getFromMemoryCache(cacheKey);
    if (memoryData) {
      console.log(`🚀 Memory hit for single: ${id}`);
      event.result = { ...memoryData, _fromCache: true };
      return event.result;
    }

    // 2. Redis con timeout
    try {
      const cachedData = await redisWithTimeout(() => redis.get(cacheKey));
      
      if (cachedData) {
        console.log(`⚡ Fast single hit: ${id}`);
        setInMemoryCache(cacheKey, cachedData);
        event.result = { ...cachedData, _fromCache: true };
        return event.result;
      }
    } catch (error) {
      if (error.message === 'Redis timeout') {
        console.warn(`⏰ Single cache timeout for ID: ${id}`);
      } else if (error.message === 'Circuit breaker open') {
        console.warn(`🔥 Circuit breaker prevented single cache call`);
      }
    }
  },

  async afterFindMany(event) {
    // Solo cachear si no había cache previo Y el resultado es válido
    if (!event.result || 
        event.result._fromCache || 
        (Array.isArray(event.result) && event.result.length === 0)) {
      return;
    }

    const { start, limit, where, sort, populate } = event.params;
    const normalizedParams = normalizeQueryParams({ start, limit, where, sort, populate });
    const cacheKey = generateCacheKey('query', normalizedParams);

    // Verificar que se generó una clave válida
    if (!cacheKey) {
      console.warn('⚠️ No se pudo generar clave de cache válida para afterFindMany');
      return;
    }

    // Evitar operaciones duplicadas
    if (pendingCacheOps.has(cacheKey)) {
      return;
    }
    pendingCacheOps.add(cacheKey);

    // Cache en memoria inmediato
    setInMemoryCache(cacheKey, event.result);

    // Cache Redis asíncrono
    setImmediate(async () => {
      try {
        const exists = await redisWithTimeout(() => redis.exists(cacheKey), 50);
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
      } finally {
        pendingCacheOps.delete(cacheKey);
      }
    });
  },

  async afterFindOne(event) {
    // Solo cachear si no había cache previo y hay resultado válido
    if (!event.result || event.result._fromCache) {
      return;
    }

    const { params, result } = event;
    const id = extractId(params);
    
    if (!id) {
      console.warn('⚠️ afterFindOne: ID inválido, saltando cache');
      return;
    }
    
    const cacheKey = `products:single:${id}`;

    // Validar que la clave de cache sea válida
    if (!isValidCacheKey(cacheKey)) {
      console.warn('⚠️ afterFindOne: Clave de cache inválida, saltando cache');
      return;
    }

    // Evitar operaciones duplicadas
    if (pendingCacheOps.has(cacheKey)) {
      return;
    }
    pendingCacheOps.add(cacheKey);

    // Cache en memoria inmediato
    setInMemoryCache(cacheKey, result);

    // Cache Redis asíncrono
    setImmediate(async () => {
      try {
        await redis.setWithStrategy(cacheKey, result, {
          ttl: CACHE_TTL,
          priority: 'critical',
          tags: ['products', 'single']
        });
        console.log(`💾 Single cached: ${id}`);
      } catch (error) {
        console.error(`❌ Error caching single:`, error.message);
      } finally {
        pendingCacheOps.delete(cacheKey);
      }
    });
  },

  async afterUpdate(event) {
    const { result } = event;
    const id = extractId({ id: result?.id });
    
    clearMemoryCache();
    
    setImmediate(async () => {
      try {
        const deletePromises = [
          redis.delByTag('queries'),
          redis.delByTag('products')
        ];
        
        // Solo agregar delete específico si tenemos ID válido
        if (id) {
          deletePromises.push(redis.del(`products:single:${id}`));
        }
        
        await Promise.all(deletePromises);
        console.log(`🔄 Cleared product caches after update (${id || 'unknown id'})`);
      } catch (error) {
        console.error("❌ Error clearing cache after update:", error.message);
      }
    });
  },

  async afterDelete(event) {
    const { params } = event;
    const id = extractId(params);
    
    clearMemoryCache();
    
    setImmediate(async () => {
      try {
        const deletePromises = [
          redis.delByTag('queries'),
          redis.delByTag('products')
        ];
        
        // Solo agregar delete específico si tenemos ID válido
        if (id) {
          deletePromises.push(redis.del(`products:single:${id}`));
        }
        
        await Promise.all(deletePromises);
        console.log(`🗑️ Cleared product caches after delete (${id || 'unknown id'})`);
      } catch (error) {
        console.error("❌ Error clearing cache after delete:", error.message);
      }
    });
  },
};