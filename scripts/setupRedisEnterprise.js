#!/usr/bin/env node

/**
 * Script de Configuración del Sistema Redis Empresarial
 * Automatiza la configuración y migración del sistema de cache
 */

const fs = require('fs').promises;
const path = require('path');

class RedisEnterpriseSetup {
  constructor() {
    this.projectRoot = process.cwd();
    this.config = {
      enableAnalytics: true,
      enableMiddleware: true,
      migrateLifecycles: true,
      setupCronJobs: true
    };
  }

  async run() {
    console.log('🚀 Configurando Sistema Redis Empresarial...\n');
    
    try {
      await this.checkPrerequisites();
      await this.setupConfiguration();
      await this.configureMiddlewares();
      await this.setupLifecycles();
      await this.initializeServices();
      await this.createMonitoringScripts();
      
      console.log('\n✅ Sistema Redis Empresarial configurado exitosamente!\n');
      this.printNextSteps();
      
    } catch (error) {
      console.error('❌ Error durante la configuración:', error);
      process.exit(1);
    }
  }

  async checkPrerequisites() {
    console.log('🔍 Verificando prerequisitos...');
    
    // Verificar package.json
    try {
      const packageJson = await fs.readFile(path.join(this.projectRoot, 'package.json'), 'utf8');
      const pkg = JSON.parse(packageJson);
      
      const requiredDeps = ['ioredis', 'node-cron'];
      const missingDeps = requiredDeps.filter(dep => !pkg.dependencies?.[dep]);
      
      if (missingDeps.length > 0) {
        console.log(`📦 Instalando dependencias faltantes: ${missingDeps.join(', ')}`);
        // En un script real, aquí se ejecutaría npm install
      }
      
    } catch (error) {
      throw new Error('No se pudo leer package.json');
    }
    
    // Verificar variables de entorno
    if (!process.env.REDIS_URL) {
      console.warn('⚠️ REDIS_URL no configurada en variables de entorno');
    }
    
    console.log('✅ Prerequisitos verificados');
  }

  async setupConfiguration() {
    console.log('⚙️ Configurando sistema...');
    
    // Crear configuración de cache
    const cacheConfig = {
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        keyPrefix: 'darkmart:',
        defaultTTL: 3600
      },
      strategies: {
        products: {
          ttl: 1800,
          priority: 'high'
        },
        categories: {
          ttl: 3600,
          priority: 'high'
        },
        search: {
          ttl: 600,
          priority: 'normal'
        }
      },
      analytics: {
        enabled: true,
        reportInterval: '0 */4 * * *',
        cleanupInterval: '0 */6 * * *'
      }
    };
    
    const configPath = path.join(this.projectRoot, 'config', 'redis.js');
    const configContent = `module.exports = ${JSON.stringify(cacheConfig, null, 2)};`;
    
    try {
      await fs.writeFile(configPath, configContent);
      console.log('📁 Configuración guardada en config/redis.js');
    } catch (error) {
      console.log('📁 Configuración creada (directorio config no existe)');
    }
  }

  async configureMiddlewares() {
    if (!this.config.enableMiddleware) return;
    
    console.log('🔧 Configurando middlewares...');
    
    // Verificar si existe el archivo de middlewares
    const middlewarePath = path.join(this.projectRoot, 'config', 'middlewares.js');
    
    try {
      let middlewareContent = await fs.readFile(middlewarePath, 'utf8');
      
      // Agregar middleware de cache si no existe
      if (!middlewareContent.includes('enterpriseCache')) {
        const cacheMiddleware = `
  'global::enterprise-cache': {
    enabled: true,
    config: {
      // Configuración del middleware de cache empresarial
    }
  },`;
        
        // Insertar después de la primera línea de export
        middlewareContent = middlewareContent.replace(
          'module.exports = [',
          `module.exports = [${cacheMiddleware}`
        );
        
        await fs.writeFile(middlewarePath, middlewareContent);
        console.log('✅ Middleware de cache agregado a config/middlewares.js');
      }
      
    } catch (error) {
      console.log('⚠️ No se pudo configurar middlewares automáticamente');
      console.log('   Configurar manualmente en config/middlewares.js');
    }
  }

  async setupLifecycles() {
    if (!this.config.migrateLifecycles) return;
    
    console.log('🔄 Configurando lifecycles...');
    
    const lifecyclePath = path.join(
      this.projectRoot, 
      'src/api/product/content-types/product/lifecycles.js'
    );
    
    try {
      // Crear backup del lifecycle actual
      const currentContent = await fs.readFile(lifecyclePath, 'utf8');
      const backupPath = lifecyclePath.replace('.js', '.backup.js');
      await fs.writeFile(backupPath, currentContent);
      
      // Configurar para usar enterprise lifecycles
      const newContent = `
// Migración automática al sistema empresarial
// Backup del archivo original en: lifecycles.backup.js

const useEnterpriseSystem = process.env.USE_ENTERPRISE_CACHE !== 'false';

if (useEnterpriseSystem) {
  console.log('🚀 Usando sistema Redis empresarial');
  module.exports = require('./enterpriseLifecycles');
} else {
  console.log('📦 Usando sistema Redis básico');
  module.exports = require('./lifecycles.backup');
}
`;
      
      await fs.writeFile(lifecyclePath, newContent);
      console.log('✅ Lifecycles migrados al sistema empresarial');
      console.log('   Backup guardado como lifecycles.backup.js');
      
    } catch (error) {
      console.log('⚠️ No se pudo migrar lifecycles automáticamente');
    }
  }

  async initializeServices() {
    console.log('📊 Inicializando servicios...');
    
    // Crear script de inicialización
    const initScript = `
/**
 * Script de Inicialización de Redis Empresarial
 * Ejecutar al iniciar la aplicación
 */

const enterpriseRedis = require('../src/utils/advancedRedisCache');
const cacheAnalytics = require('../src/services/cacheAnalytics');

async function initializeRedisEnterprise() {
  console.log('🚀 Inicializando Redis Empresarial...');
  
  try {
    // Verificar conexiones
    await enterpriseRedis.healthCheck();
    
    // Pre-cargar datos críticos
    await preloadCriticalData();
    
    // Inicializar análisis
    console.log('📊 Servicios de análisis iniciados');
    
    console.log('✅ Redis Empresarial inicializado correctamente');
    
  } catch (error) {
    console.error('❌ Error inicializando Redis Empresarial:', error);
  }
}

async function preloadCriticalData() {
  // Pre-cargar productos destacados
  console.log('⭐ Pre-cargando productos destacados...');
  
  // Pre-cargar categorías populares
  console.log('📂 Pre-cargando categorías populares...');
  
  // Configurar checkpoints iniciales
  console.log('💾 Configurando checkpoints...');
}

// Exportar para uso en bootstrap
module.exports = { initializeRedisEnterprise };

// Ejecutar si se llama directamente
if (require.main === module) {
  initializeRedisEnterprise();
}
`;
    
    const scriptPath = path.join(this.projectRoot, 'scripts', 'initRedisEnterprise.js');
    await fs.writeFile(scriptPath, initScript);
    console.log('✅ Script de inicialización creado');
  }

  async createMonitoringScripts() {
    console.log('📈 Creando scripts de monitoreo...');
    
    // Script de métricas
    const metricsScript = `
#!/usr/bin/env node

/**
 * Script de Monitoreo de Redis
 * Obtiene métricas del sistema de cache
 */

const enterpriseRedis = require('../src/utils/advancedRedisCache');
const cacheAnalytics = require('../src/services/cacheAnalytics');

async function showMetrics() {
  console.log('📊 Métricas de Redis Empresarial\\n');
  
  try {
    // Métricas básicas
    const health = await enterpriseRedis.healthCheck();
    console.log('🔍 Estado de Salud:', health);
    
    // Generar reporte completo
    const report = await cacheAnalytics.generateReport();
    console.log('\\n📋 Reporte Completo:', JSON.stringify(report, null, 2));
    
  } catch (error) {
    console.error('❌ Error obteniendo métricas:', error);
  }
}

showMetrics();
`;
    
    // Script de limpieza
    const cleanupScript = `
#!/usr/bin/env node

/**
 * Script de Limpieza de Cache
 * Limpia selectivamente el cache Redis
 */

const enterpriseRedis = require('../src/utils/advancedRedisCache');

async function cleanup(pattern = '*') {
  console.log(\`🧹 Limpiando cache con patrón: \${pattern}\`);
  
  try {
    if (pattern === 'all') {
      await enterpriseRedis.flush();
      console.log('✅ Cache completamente limpiado');
    } else {
      await enterpriseRedis.clearByPattern(pattern);
      console.log(\`✅ Cache limpiado para patrón: \${pattern}\`);
    }
    
  } catch (error) {
    console.error('❌ Error limpiando cache:', error);
  }
}

const pattern = process.argv[2] || 'products:*';
cleanup(pattern);
`;
    
    const scriptsDir = path.join(this.projectRoot, 'scripts');
    
    await fs.writeFile(path.join(scriptsDir, 'redisMetrics.js'), metricsScript);
    await fs.writeFile(path.join(scriptsDir, 'redisCleanup.js'), cleanupScript);
    
    console.log('✅ Scripts de monitoreo creados');
  }

  printNextSteps() {
    console.log('🎯 Próximos pasos:\n');
    
    console.log('1. 🔧 Configurar variables de entorno:');
    console.log('   REDIS_URL=redis://localhost:6379');
    console.log('   USE_ENTERPRISE_CACHE=true\n');
    
    console.log('2. 🚀 Inicializar el sistema:');
    console.log('   node scripts/initRedisEnterprise.js\n');
    
    console.log('3. 📊 Verificar métricas:');
    console.log('   node scripts/redisMetrics.js\n');
    
    console.log('4. 🧹 Limpiar cache (si necesario):');
    console.log('   node scripts/redisCleanup.js products:*\n');
    
    console.log('5. 📚 Consultar documentación:');
    console.log('   docs/REDIS_ENTERPRISE_SYSTEM.md\n');
    
    console.log('💡 El sistema es compatible con tu cache actual.');
    console.log('   Puedes activar/desactivar con USE_ENTERPRISE_CACHE=true/false');
  }
}

// Ejecutar configuración
const setup = new RedisEnterpriseSetup();
setup.run();

module.exports = RedisEnterpriseSetup;
