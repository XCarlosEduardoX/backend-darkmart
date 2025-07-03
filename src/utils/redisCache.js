/**
 * Redis Cache - Versión mejorada con migración gradual a sistema empresarial
 * Mantiene compatibilidad con el código existente mientras introduce mejoras
 */

const { Redis } = require('ioredis');

const redis = new Redis(process.env.REDIS_URL + "?family=0");

// Verificación de la conexión con Redis
(async () => {
    try {
        const ping = await redis.ping();
        console.log('Redis connected: ', ping);
    } catch (error) {
        console.error('Error connecting to Redis:', error);
    }
})();

// Sistema de métricas integrado
let metrics = {
    hits: 0,
    misses: 0,
    writes: 0,
    errors: 0,
    lastReset: new Date()
};

// Función para validar claves de cache
const isValidCacheKey = (key) => {
    if (!key || typeof key !== 'string') {
        return false;
    }
    // Verificar que no contenga 'undefined', 'null' o sea vacío
    if (key.includes('undefined') || key.includes('null') || key.trim() === '') {
        return false;
    }
    return true;
};

// Funciones de caché optimizadas
const cache = {
    async get(key) {
        // Validar clave antes de usar
        if (!isValidCacheKey(key)) {
            console.warn(`🚫 Clave de cache inválida detectada: "${key}"`);
            metrics.errors++;
            return null;
        }

        try {
            const startTime = Date.now();
            const data = await redis.get(key);

            if (data) {
                metrics.hits++;
                const parsedData = JSON.parse(data);

                // Log de rendimiento solo si es muy lento
                const duration = Date.now() - startTime;
                if (duration > 100) { // Aumentado a 100ms para reducir spam
                    console.warn(`⚠️ Cache get lento: ${key} (${duration}ms)`);
                }

                return parsedData;
            } else {
                metrics.misses++;
                return null;
            }
        } catch (error) {
            metrics.errors++;
            console.error(`❌ Error getting key ${key} from Redis:`, error);
            return null;
        }
    },

    async set(key, value, maxAge = 3600) {
        // Validar clave antes de usar
        if (!isValidCacheKey(key)) {
            console.warn(`🚫 Intento de set con clave inválida: "${key}"`);
            metrics.errors++;
            return;
        }

        // Validar valor
        if (value === undefined || value === null) {
            console.warn(`🚫 Intento de cachear valor nulo para clave: ${key}`);
            return;
        }

        try {
            const startTime = Date.now();
            const serializedValue = JSON.stringify(value);

            await redis.set(key, serializedValue, 'EX', maxAge);
            metrics.writes++;

            // Log de rendimiento solo si es muy lento
            const duration = Date.now() - startTime;
            if (duration > 150) { // Aumentado a 150ms para reducir spam
                console.warn(`⚠️ Cache set lento: ${key} (${duration}ms)`);
            }

        } catch (error) {
            metrics.errors++;
            console.error(`❌ Error setting key ${key} in Redis:`, error);
        }
    },

    // Nuevo método con estrategia inteligente
    async setWithStrategy(key, value, options = {}) {
        // Validar clave antes de usar
        if (!isValidCacheKey(key)) {
            console.warn(`🚫 Intento de setWithStrategy con clave inválida: "${key}"`);
            metrics.errors++;
            return;
        }

        // Validar valor
        if (value === undefined || value === null) {
            console.warn(`🚫 Intento de cachear valor nulo con estrategia para clave: ${key}`);
            return;
        }

        const {
            ttl = 3600,
            priority = 'normal',
            compress = false,
            tags = []
        } = options;

        try {
            let serializedValue = JSON.stringify(value);

            // Compresión para valores grandes (opcional)
            if (compress && serializedValue.length > 10000) {
                console.log(`📦 Valor grande detectado: ${key} (${serializedValue.length} chars)`);
            }

            // Ajustar TTL según prioridad
            let adjustedTTL = ttl;
            switch (priority) {
                case 'critical':
                    adjustedTTL = ttl * 2;
                    break;
                case 'high':
                    adjustedTTL = ttl * 1.5;
                    break;
                case 'low':
                    adjustedTTL = ttl * 0.5;
                    break;
            }

            // Usar pipeline para operaciones múltiples
            const pipeline = redis.pipeline();
            pipeline.set(key, serializedValue, 'EX', adjustedTTL);

            // Indexar por tags si se proporcionan
            if (tags.length > 0) {
                for (const tag of tags) {
                    pipeline.sadd(`tag:${tag}`, key);
                    pipeline.expire(`tag:${tag}`, adjustedTTL);
                }
            }

            await pipeline.exec();
            metrics.writes++;

            // Log menos verboso, solo para operaciones críticas
            if (priority === 'critical' || priority === 'high') {
                console.log(`💾 Cache ${priority}: ${key} (TTL: ${adjustedTTL}s)`);
            }

        } catch (error) {
            metrics.errors++;
            console.error(`❌ Error setting key ${key} with strategy:`, error);
        }
    },

    async del(key) {
        // Validar clave antes de usar
        if (!isValidCacheKey(key)) {
            console.warn(`🚫 Intento de delete con clave inválida: "${key}"`);
            return;
        }

        try {
            await redis.del(key);
        } catch (error) {
            metrics.errors++;
            console.error(`❌ Error deleting key ${key} from Redis:`, error);
        }
    },

    async flush() {
        try {
            await redis.flushall();
            console.log('✅ Cache flushed successfully');
        } catch (error) {
            metrics.errors++;
            console.error('Error flushing Redis:', error);
        }
    },

    // Eliminar claves que coincidan con un patrón (mejorado)
    async delPattern(pattern) {
        try {
            const startTime = Date.now();
            const keys = await redis.keys(pattern);

            if (keys.length > 0) {
                // Borrar en lotes para mejor rendimiento
                const batchSize = 100;
                for (let i = 0; i < keys.length; i += batchSize) {
                    const batch = keys.slice(i, i + batchSize);
                    await redis.del(batch);
                }

                const duration = Date.now() - startTime;
                console.log(`🧹 Eliminadas ${keys.length} claves con patrón ${pattern} (${duration}ms)`);
            }
        } catch (error) {
            metrics.errors++;
            console.error(`Error deleting keys with pattern ${pattern}:`, error);
        }
    },

    // Nuevo método para eliminación por tags
    async delByTag(tag) {
        try {
            const keys = await redis.smembers(`tag:${tag}`);
            if (keys.length > 0) {
                await redis.del(keys);
                await redis.del(`tag:${tag}`);
                console.log(`🏷️ Eliminadas ${keys.length} claves con tag ${tag}`);
            }
        } catch (error) {
            metrics.errors++;
            console.error(`Error deleting keys with tag ${tag}:`, error);
        }
    },

    // Método para obtener múltiples claves eficientemente
    async mget(keys) {
        try {
            if (!keys || keys.length === 0) return [];

            const values = await redis.mget(keys);
            return values.map(value => value ? JSON.parse(value) : null);
        } catch (error) {
            metrics.errors++;
            console.error(`Error getting multiple keys:`, error);
            return [];
        }
    },

    // Método para establecer múltiples claves
    async mset(keyValuePairs, ttl = 3600) {
        try {
            const pipeline = redis.pipeline();

            for (const [key, value] of Object.entries(keyValuePairs)) {
                pipeline.set(key, JSON.stringify(value), 'EX', ttl);
            }

            await pipeline.exec();
            metrics.writes += Object.keys(keyValuePairs).length;

            console.log(`📦 Set múltiple: ${Object.keys(keyValuePairs).length} claves`);
        } catch (error) {
            metrics.errors++;
            console.error(`Error setting multiple keys:`, error);
        }
    },

    // Método para incrementar contadores
    async incr(key, amount = 1, ttl = 3600) {
        try {
            const value = await redis.incrby(key, amount);
            await redis.expire(key, ttl);
            return value;
        } catch (error) {
            metrics.errors++;
            console.error(`Error incrementing key ${key}:`, error);
            return null;
        }
    },

    // Método para obtener TTL restante
    async ttl(key) {
        try {
            return await redis.ttl(key);
        } catch (error) {
            metrics.errors++;
            console.error(`Error getting TTL for key ${key}:`, error);
            return -1;
        }
    },

    // Método para verificar si existe una clave
    async exists(key) {
        // Validar clave antes de usar
        if (!isValidCacheKey(key)) {
            console.warn(`🚫 Intento de exists con clave inválida: "${key}"`);
            return false;
        }

        try {
            return await redis.exists(key) === 1;
        } catch (error) {
            metrics.errors++;
            console.error(`❌ Error checking existence of key ${key}:`, error);
            return false;
        }
    },

    // Método para obtener métricas de rendimiento
    getMetrics() {
        const totalRequests = metrics.hits + metrics.misses;
        const hitRate = totalRequests > 0 ? (metrics.hits / totalRequests * 100).toFixed(2) : 0;

        return {
            ...metrics,
            hitRate: `${hitRate}%`,
            totalRequests,
            uptime: Date.now() - metrics.lastReset.getTime()
        };
    },

    // Método para resetear métricas
    resetMetrics() {
        metrics = {
            hits: 0,
            misses: 0,
            writes: 0,
            errors: 0,
            lastReset: new Date()
        };
        console.log('📊 Métricas de cache reseteadas');
    },

    // Método para reporte de salud
    async healthCheck() {
        try {
            const startTime = Date.now();
            await redis.ping();
            const pingTime = Date.now() - startTime;

            const info = await redis.info('memory');
            const memoryUsed = info.match(/used_memory_human:(.+)/)?.[1]?.trim();

            return {
                status: 'healthy',
                pingTime: `${pingTime}ms`,
                memoryUsed,
                metrics: this.getMetrics()
            };
        } catch (error) {
            console.error('❌ Redis health check failed:', error);
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    },

    // Nuevo método para limpiar claves inválidas
    async cleanInvalidKeys() {
        try {
            console.log('🧹 Iniciando limpieza de claves inválidas...');
            const pattern = '*undefined*';
            const keys = await redis.keys(pattern);
            
            if (keys.length > 0) {
                await redis.del(keys);
                console.log(`🗑️ Eliminadas ${keys.length} claves con 'undefined'`);
            }

            // También limpiar claves con 'null'
            const nullPattern = '*null*';
            const nullKeys = await redis.keys(nullPattern);
            
            if (nullKeys.length > 0) {
                await redis.del(nullKeys);
                console.log(`🗑️ Eliminadas ${nullKeys.length} claves con 'null'`);
            }

            return keys.length + nullKeys.length;
        } catch (error) {
            console.error('❌ Error limpiando claves inválidas:', error);
            return 0;
        }
    },

    // Método para obtener estadísticas detalladas
    async getDetailedStats() {
        try {
            const info = await redis.info();
            const keyspace = await redis.info('keyspace');
            const memory = await redis.info('memory');
            
            return {
                metrics: this.getMetrics(),
                keyspace,
                memory: memory.match(/used_memory_human:(.+)/)?.[1]?.trim(),
                connected_clients: info.match(/connected_clients:(\d+)/)?.[1],
                total_commands_processed: info.match(/total_commands_processed:(\d+)/)?.[1]
            };
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas detalladas:', error);
            return null;
        }
    }
};

// Función utilitaria exportada para validar IDs
const validateId = (id) => {
    if (!id || id === 'undefined' || id === 'null' || id === undefined || id === null) {
        return null;
    }
    
    // Convertir a string y limpiar
    const cleanId = String(id).trim();
    
    if (cleanId === '' || cleanId === 'undefined' || cleanId === 'null') {
        return null;
    }
    
    return cleanId;
};

// Limpieza automática de claves inválidas cada 6 horas
setInterval(async () => {
    try {
        const cleaned = await cache.cleanInvalidKeys();
        if (cleaned > 0) {
            console.log(`🧹 Limpieza automática: ${cleaned} claves inválidas eliminadas`);
        }
    } catch (error) {
        console.error('❌ Error en limpieza automática:', error);
    }
}, 6 * 60 * 60 * 1000); // 6 horas

// Reporte automático de métricas cada hora (reducido verbosidad)
setInterval(() => {
    const metricsReport = cache.getMetrics();
    // Solo reportar si hay actividad significativa
    if (metricsReport.totalRequests > 10) {
        console.log('📈 Redis Cache Metrics:', {
            hitRate: metricsReport.hitRate,
            totalRequests: metricsReport.totalRequests,
            errors: metricsReport.errors
        });
    }
}, 3600000); // 1 hora


// Exportar el objeto de caché mejorado y funciones utilitarias
module.exports = cache;
module.exports.validateId = validateId;
module.exports.isValidCacheKey = isValidCacheKey;