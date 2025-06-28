
#!/usr/bin/env node

/**
 * Script de Monitoreo de Redis
 * Obtiene métricas del sistema de cache
 */

const enterpriseRedis = require('../src/utils/advancedRedisCache');
const cacheAnalytics = require('../src/services/cacheAnalytics');

async function showMetrics() {
  console.log('📊 Métricas de Redis Empresarial\n');
  
  try {
    // Métricas básicas
    const health = await enterpriseRedis.healthCheck();
    console.log('🔍 Estado de Salud:', health);
    
    // Generar reporte completo
    const report = await cacheAnalytics.generateReport();
    console.log('\n📋 Reporte Completo:', JSON.stringify(report, null, 2));
    
  } catch (error) {
    console.error('❌ Error obteniendo métricas:', error);
  }
}

showMetrics();
