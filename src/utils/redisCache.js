const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDISHOST || '127.0.0.1',
  port: process.env.REDISPORT || 6379,
  password: process.env.REDISPASSWORD || null,
  db: process.env.REDISDB || 0,
});

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
