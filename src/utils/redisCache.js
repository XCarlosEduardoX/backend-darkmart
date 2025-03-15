const { Redis } = require('ioredis');

// const redis = new Redis(process.env.REDIS_URL + "?family=0");

const redis = new Redis({
    host: "172.17.103.125",
    port: 6379,
    password: "lalo123lalo123",
});

// Verificación de la conexión con Redis
(async () => {
    try {
        const ping = await redis.ping();
        console.log('Redis connected: ', ping);  // Log de éxito de la conexión
    } catch (error) {
        console.error('Error connecting to Redis:', error);
    }
})();

// Funciones de caché
// const cache = {
//     async get(key) {
//         try {
//             const data = await redis.get(key);
//             return data ? JSON.parse(data) : null;
//         } catch (error) {
//             console.error(`Error getting key ${key} from Redis:`, error);
//             return null;  // Devolvemos null si ocurre un error
//         }
//     },

//     async set(key, value, maxAge = 3600) {
//         try {
//             await redis.set(key, JSON.stringify(value), 'EX', maxAge);
//         } catch (error) {
//             console.error(`Error setting key ${key} in Redis:`, error);
//         }
//     },

//     async del(key) {
//         try {
//             await redis.del(key);
//         } catch (error) {
//             console.error(`Error deleting key ${key} from Redis:`, error);
//         }
//     },

//     async flush() {
//         try {
//             await redis.flushall();
//         } catch (error) {
//             console.error('Error flushing Redis:', error);
//         }
//     },

//     // Eliminar claves que coincidan con un patrón
//     async delPattern(pattern) {
//         try {
//             const keys = await redis.keys(pattern);
//             if (keys.length > 0) {
//                 await redis.del(keys);
//             }
//         } catch (error) {
//             console.error(`Error deleting keys with pattern ${pattern}:`, error);
//         }
//     },
// };

module.exports = redis;
