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

// Funciones de caché optimizadas
const cache = {
    async get(key) {
        try {
            const startTime = Date.now();
            const data = await redis.get(key);

            if (data) {
                metrics.hits++;
                const parsedData = JSON.parse(data);

                // Log de rendimiento
                const duration = Date.now() - startTime;
                if (duration > 50) { // Más de 50ms
                    console.warn(`⚠️ Cache get lento: ${key} (${duration}ms)`);
                }

                return parsedData;
            } else {
                metrics.misses++;
                return null;
            }
        } catch (error) {
            metrics.errors++;
            console.error(`Error getting key ${key} from Redis:`, error);
            return null;
        }
    },

    async set(key, value, maxAge = 3600) {
        try {
            const startTime = Date.now();
            const serializedValue = JSON.stringify(value);

            await redis.set(key, serializedValue, 'EX', maxAge);
            metrics.writes++;

            // Log de rendimiento
            const duration = Date.now() - startTime;
            if (duration > 100) { // Más de 100ms
                console.warn(`⚠️ Cache set lento: ${key} (${duration}ms)`);
            }

        } catch (error) {
            metrics.errors++;
            console.error(`Error setting key ${key} in Redis:`, error);
        }
    },

    // Nuevo método con estrategia inteligente
    async setWithStrategy(key, value, options = {}) {
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
                // En el futuro se puede añadir compresión aquí
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

            await redis.set(key, serializedValue, 'EX', adjustedTTL);

            // Indexar por tags si se proporcionan
            if (tags.length > 0) {
                for (const tag of tags) {
                    await redis.sadd(`tag:${tag}`, key);
                    await redis.expire(`tag:${tag}`, adjustedTTL);
                }
            }

            metrics.writes++;
            console.log(`💾 Cache set con estrategia ${priority}: ${key} (TTL: ${adjustedTTL}s)`);

        } catch (error) {
            metrics.errors++;
            console.error(`Error setting key ${key} with strategy:`, error);
        }
    },

    async del(key) {
        try {
            await redis.del(key);
        } catch (error) {
            metrics.errors++;
            console.error(`Error deleting key ${key} from Redis:`, error);
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
        try {
            return await redis.exists(key) === 1;
        } catch (error) {
            metrics.errors++;
            console.error(`Error checking existence of key ${key}:`, error);
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
    }
};

// Reporte automático de métricas cada hora
setInterval(() => {
    const metricsReport = cache.getMetrics();
    console.log('📈 Redis Cache Metrics:', metricsReport);
}, 3600000); // 1 hora


// Exportar el objeto de caché mejorado
module.exports = cache;