module.exports = {
  "redis": {
    "url": "redis://localhost:6379",
    "keyPrefix": "darkmart:",
    "defaultTTL": 3600
  },
  "strategies": {
    "products": {
      "ttl": 1800,
      "priority": "high"
    },
    "categories": {
      "ttl": 3600,
      "priority": "high"
    },
    "search": {
      "ttl": 600,
      "priority": "normal"
    }
  },
  "analytics": {
    "enabled": true,
    "reportInterval": "0 */4 * * *",
    "cleanupInterval": "0 */6 * * *"
  }
};