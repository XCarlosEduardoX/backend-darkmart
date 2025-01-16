const { Redis } = require('ioredis');

// Conexión a Redis con búsqueda dual (IPv4 e IPv6)
const redis = new Redis(process.env.REDIS_URL + '?family=0');

// Funciones de caché
const cache = {
    async get(key) {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
    },

    async set(key, value, maxAge = 3600) {
        await redis.set(key, JSON.stringify(value), 'EX', maxAge);
    },

    async del(key) {
        await redis.del(key);
    },

    async flush() {
        await redis.flushall();
    },
};

module.exports = cache;