'use strict';

const redis = require('../../../utils/redisCache');

// Importar funciones de validación
const { validateId, isValidCacheKey } = redis;

// Configuración optimizada
const CACHE_TTL = 3600; // 1 hora
const QUERY_CACHE_TTL = 1800; // 30 minutos para queries

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

// Exportar funciones de utilidad básicas
module.exports = {
  generateShortSku,
  generateCacheKey,
  extractId,
  
  // Constantes útiles
  CACHE_TTL,
  QUERY_CACHE_TTL,
  MAX_MEMORY_CACHE,
  MEMORY_CACHE_TTL
};
