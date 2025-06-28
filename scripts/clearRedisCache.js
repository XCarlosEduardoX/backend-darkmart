/**
 * Script para limpiar completamente el cache de Redis
 * Útil para desarrollo y mantenimiento
 */

// Cargar variables de entorno
require('dotenv').config();

const { Redis } = require('ioredis');

async function clearAllRedisCache() {
  console.log('🧹 === LIMPIEZA COMPLETA DE REDIS ===\n');
  
  try {
    // Obtener URL de Redis
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl || redisUrl === 'undefined') {
      console.log('❌ No hay URL de Redis configurada');
      console.log('💡 El sistema está en modo fallback (memoria local)');
      console.log('📦 No hay cache de Redis para limpiar');
      return;
    }
    
    console.log('🔗 Conectando a Redis...');
    console.log(`📍 URL: ${redisUrl.replace(/:[^:]*@/, ':***@')}`);
    
    // Crear conexión a Redis
    const redis = new Redis(redisUrl, {
      connectTimeout: 10000,
      lazyConnect: true,
      showFriendlyErrorStack: process.env.NODE_ENV === 'development',
      family: 4
    });
    
    // Verificar conexión
    await redis.ping();
    console.log('✅ Conectado a Redis\n');
    
    // Opción 1: Limpiar todo con FLUSHALL
    console.log('🗑️ Opción 1: Limpiar TODA la base de datos Redis...');
    const choice = process.argv[2];
    
    if (choice === '--all' || choice === '--flush-all') {
      console.log('⚠️ ATENCIÓN: Esto eliminará TODOS los datos de Redis');
      console.log('🚀 Ejecutando FLUSHALL...');
      await redis.flushall();
      console.log('✅ Toda la base de datos Redis ha sido limpiada');
    } else {
      // Opción 2: Limpiar solo claves específicas del proyecto
      console.log('🎯 Limpiando solo claves del proyecto DarkMart...');
      
      const patterns = [
        'products:*',
        'categories:*',
        'orders:*',
        'users:*',
        'cart:*',
        'session:*',
        'query:*',
        'semantic:*',
        'analytics:*',
        'checkpoints:*',
        'cache:*'
      ];
      
      let totalDeleted = 0;
      
      for (const pattern of patterns) {
        console.log(`🔍 Buscando claves: ${pattern}`);
        const keys = await redis.keys(pattern);
        
        if (keys.length > 0) {
          await redis.del(...keys);
          console.log(`   ✅ Eliminadas ${keys.length} claves`);
          totalDeleted += keys.length;
        } else {
          console.log(`   📭 No se encontraron claves`);
        }
      }
      
      console.log(`\n🎉 Total de claves eliminadas: ${totalDeleted}`);
    }
    
    // Verificar limpieza
    console.log('\n📊 Verificando estado después de la limpieza...');
    const info = await redis.info('keyspace');
    const lines = info.split('\n');
    const dbInfo = lines.find(line => line.startsWith('db0:'));
    
    if (dbInfo) {
      const keyCount = dbInfo.match(/keys=(\d+)/);
      if (keyCount) {
        console.log(`📈 Claves restantes en Redis: ${keyCount[1]}`);
      }
    } else {
      console.log('✨ Redis está completamente vacío');
    }
    
    // Cerrar conexión
    await redis.quit();
    console.log('\n✅ Limpieza completada exitosamente');
    console.log('🔄 Puedes reiniciar tu aplicación ahora');
    
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error.message);
    process.exit(1);
  }
}

// Mostrar ayuda si no hay argumentos
if (process.argv.length === 2) {
  console.log('🧹 Script de Limpieza de Redis\n');
  console.log('Uso:');
  console.log('  node scripts/clearRedisCache.js              - Limpiar solo claves del proyecto');
  console.log('  node scripts/clearRedisCache.js --all        - Limpiar TODA la base de datos');
  console.log('  node scripts/clearRedisCache.js --flush-all  - Igual que --all\n');
  console.log('⚠️ PRECAUCIÓN: --all eliminará TODOS los datos de Redis, no solo del proyecto');
}

// Ejecutar limpieza
clearAllRedisCache();
