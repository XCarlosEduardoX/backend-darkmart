
#!/usr/bin/env node

/**
 * Script de Limpieza de Cache
 * Limpia selectivamente el cache Redis
 */

const enterpriseRedis = require('../src/utils/advancedRedisCache');

async function cleanup(pattern = '*') {
  console.log(`🧹 Limpiando cache con patrón: ${pattern}`);
  
  try {
    if (pattern === 'all') {
      await enterpriseRedis.flush();
      console.log('✅ Cache completamente limpiado');
    } else {
      await enterpriseRedis.clearByPattern(pattern);
      console.log(`✅ Cache limpiado para patrón: ${pattern}`);
    }
    
  } catch (error) {
    console.error('❌ Error limpiando cache:', error);
  }
}

const pattern = process.argv[2] || 'products:*';
cleanup(pattern);
