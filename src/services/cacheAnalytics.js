/**
 * Servicio de Análisis y Optimización de Cache Redis
 * Proporciona herramientas para monitoreo y mejora del rendimiento
 */

const enterpriseRedis = require('../utils/advancedRedisCache');
const cron = require('node-cron');

class CacheAnalyticsService {
  constructor() {
    this.analytics = {
      queries: new Map(),
      patterns: new Map(),
      performance: [],
      recommendations: []
    };
    
    this.initializeAnalytics();
  }

  initializeAnalytics() {
    // Análisis cada 15 minutos
    cron.schedule('*/15 * * * *', async () => {
      await this.performAnalysis();
    });

    // Reporte completo cada 4 horas
    cron.schedule('0 */4 * * *', async () => {
      await this.generateReport();
    });

    // Optimización automática cada 2 horas
    cron.schedule('0 */2 * * *', async () => {
      await this.autoOptimize();
    });
  }

  async performAnalysis() {
    console.log('📊 Iniciando análisis de cache...');
    
    try {
      await Promise.all([
        this.analyzeQueryPatterns(),
        this.analyzePerformance(),
        this.analyzeMemoryUsage(),
        this.detectBottlenecks()
      ]);
      
      console.log('✅ Análisis de cache completado');
    } catch (error) {
      console.error('❌ Error en análisis de cache:', error);
    }
  }

  async analyzeQueryPatterns() {
    // Analizar patrones de consulta más frecuentes
    const patterns = await this.getTopQueryPatterns();
    
    for (const pattern of patterns) {
      if (pattern.frequency > 50) { // Umbral de optimización
        await this.optimizePattern(pattern);
      }
    }
  }

  async analyzePerformance() {
    // Analizar tiempos de respuesta
    const slowQueries = await this.getSlowQueries();
    
    for (const query of slowQueries) {
      this.analytics.recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: `Consulta lenta detectada: ${query.key}`,
        suggestion: 'Considerar pre-caching o ajustar TTL',
        timestamp: new Date()
      });
    }
  }

  async analyzeMemoryUsage() {
    // Analizar uso de memoria por capa
    const memoryStats = await this.getMemoryStats();
    
    if (memoryStats.shortTerm > 80) { // 80% de uso
      this.analytics.recommendations.push({
        type: 'memory',
        severity: 'high',
        message: 'Memoria a corto plazo casi llena',
        suggestion: 'Implementar limpieza más agresiva o reducir TTL',
        timestamp: new Date()
      });
    }
  }

  async detectBottlenecks() {
    // Detectar cuellos de botella en patrones de acceso
    const hotspots = await this.identifyHotspots();
    
    for (const hotspot of hotspots) {
      await this.createOptimizationStrategy(hotspot);
    }
  }

  async getTopQueryPatterns() {
    // Simular análisis de patrones (en producción se conectaría a métricas reales)
    return [
      { pattern: 'products:query:*', frequency: 150, avgTime: 45 },
      { pattern: 'products:category:*', frequency: 89, avgTime: 32 },
      { pattern: 'products:single:*', frequency: 234, avgTime: 12 }
    ];
  }

  async getSlowQueries() {
    // Simular detección de consultas lentas
    return [
      { key: 'products:query:large_category', time: 1200, threshold: 500 },
      { key: 'products:semantic:complex_search', time: 850, threshold: 500 }
    ];
  }

  async getMemoryStats() {
    // Simular estadísticas de memoria
    return {
      shortTerm: 75,  // Porcentaje de uso
      longTerm: 45,
      semantic: 60,
      session: 30
    };
  }

  async identifyHotspots() {
    // Identificar puntos calientes en el acceso a datos
    return [
      {
        pattern: 'products:featured',
        accessCount: 500,
        missRate: 0.15,
        recommendation: 'increase_ttl'
      },
      {
        pattern: 'products:category:electronics',
        accessCount: 300,
        missRate: 0.25,
        recommendation: 'preload_cache'
      }
    ];
  }

  async optimizePattern(pattern) {
    console.log(`🎯 Optimizando patrón: ${pattern.pattern}`);
    
    switch (pattern.pattern) {
      case 'products:query:*':
        // Incrementar TTL para consultas frecuentes
        await this.adjustQueryTTL(pattern.pattern, 1.5);
        break;
        
      case 'products:category:*':
        // Pre-cargar categorías populares
        await this.preloadPopularCategories();
        break;
        
      case 'products:single:*':
        // Promover productos frecuentes a memoria superior
        await this.promoteFrequentProducts();
        break;
    }
  }

  async createOptimizationStrategy(hotspot) {
    const strategy = {
      pattern: hotspot.pattern,
      currentPerformance: {
        accessCount: hotspot.accessCount,
        missRate: hotspot.missRate
      },
      optimizations: [],
      expectedImprovement: 0
    };

    switch (hotspot.recommendation) {
      case 'increase_ttl':
        strategy.optimizations.push({
          action: 'increase_ttl',
          factor: 2,
          target: 'longTerm'
        });
        strategy.expectedImprovement = 0.30; // 30% mejora esperada
        break;

      case 'preload_cache':
        strategy.optimizations.push({
          action: 'preload',
          schedule: '*/30 * * * *', // Cada 30 minutos
          priority: 'high'
        });
        strategy.expectedImprovement = 0.50; // 50% mejora esperada
        break;
    }

    await this.implementOptimization(strategy);
  }

  async implementOptimization(strategy) {
    console.log(`🚀 Implementando optimización para: ${strategy.pattern}`);
    
    for (const optimization of strategy.optimizations) {
      switch (optimization.action) {
        case 'increase_ttl':
          await this.adjustTTLForPattern(strategy.pattern, optimization.factor);
          break;
          
        case 'preload':
          await this.setupPreloading(strategy.pattern, optimization.schedule);
          break;
      }
    }
  }

  async adjustQueryTTL(pattern, factor) {
    // Implementar ajuste de TTL
    console.log(`⏱️ Ajustando TTL para ${pattern} por factor ${factor}`);
  }

  async adjustTTLForPattern(pattern, factor) {
    // Implementar ajuste de TTL específico
    console.log(`⏱️ Ajustando TTL para patrón ${pattern} por factor ${factor}`);
  }

  async preloadPopularCategories() {
    console.log('🔄 Pre-cargando categorías populares...');
    
    try {
      // Verificar si Strapi está disponible
      if (typeof strapi === 'undefined') {
        console.log('📦 Modo demo: simulando pre-carga de categorías');
        
        // Simular datos de categorías para el demo
        const mockCategories = [
          { id: 1, name: 'Electronics', slug: 'electronics' },
          { id: 2, name: 'Clothing', slug: 'clothing' },
          { id: 3, name: 'Books', slug: 'books' }
        ];
        
        for (const category of mockCategories) {
          const cacheKey = `products:category:${category.slug}`;
          const mockProducts = [
            { id: 1, name: `Sample ${category.name} Product 1`, price: 100 },
            { id: 2, name: `Sample ${category.name} Product 2`, price: 200 }
          ];
          
          await enterpriseRedis.setWithStrategy(cacheKey, mockProducts, 'product', 'high');
          console.log(`📦 Pre-cargado mock: ${category.name}`);
        }
        return;
      }
      
      // Obtener categorías más populares
      const popularCategories = await this.getPopularCategories();
      
      for (const category of popularCategories) {
        const cacheKey = `products:category:${category.id}`;
        
        // Verificar si ya está en cache
        const cached = await enterpriseRedis.get(cacheKey);
        if (!cached) {        // Cargar desde base de datos
        const categoryProducts = await strapi.entityService.findMany('api::product.product', {
          filters: { 
            category: {
              id: category.id
            }
          },
          populate: ['images', 'category', 'variations']
        });
          
          // Guardar con alta prioridad
          await enterpriseRedis.setWithStrategy(
            cacheKey,
            categoryProducts,
            'product',
            'high'
          );
        }
      }
      
      console.log('✅ Categorías populares pre-cargadas');
    } catch (error) {
      console.error('❌ Error pre-cargando categorías:', error);
    }
  }

  async promoteFrequentProducts() {
    console.log('⬆️ Promoviendo productos frecuentes...');
    
    try {
      const frequentProducts = await this.getFrequentlyAccessedProducts();
      
      for (const product of frequentProducts) {
        const cacheKey = `products:single:${product.id}`;
        
        // Promover a memoria de alta prioridad
        const productData = await enterpriseRedis.get(cacheKey);
        if (productData) {
          await enterpriseRedis.setWithStrategy(
            cacheKey,
            productData,
            'product',
            'critical'
          );
        }
      }
      
      console.log('✅ Productos frecuentes promovidos');
    } catch (error) {
      console.error('❌ Error promoviendo productos:', error);
    }
  }

  async setupPreloading(pattern, schedule) {
    console.log(`🔄 Configurando pre-carga para ${pattern} con schedule ${schedule}`);
    
    // Configurar tarea cron para pre-carga
    cron.schedule(schedule, async () => {
      await this.executePreload(pattern);
    });
  }

  async executePreload(pattern) {
    console.log(`🔄 Ejecutando pre-carga para patrón: ${pattern}`);
    
    try {
      if (pattern.includes('category')) {
        await this.preloadPopularCategories();
      } else if (pattern.includes('featured')) {
        await this.preloadFeaturedProducts();
      }
    } catch (error) {
      console.error('❌ Error en pre-carga:', error);
    }
  }

  async preloadFeaturedProducts() {
    console.log('⭐ Pre-cargando productos destacados...');
    
    try {
      // Verificar si Strapi está disponible
      if (typeof strapi === 'undefined') {
        console.log('📦 Modo demo: simulando pre-carga de productos destacados');
        
        // Simular productos destacados para el demo
        const mockFeaturedProducts = [
          { id: 1, name: 'iPhone 15 Pro', price: 999, is_featured: true },
          { id: 2, name: 'MacBook Pro M3', price: 1999, is_featured: true },
          { id: 3, name: 'AirPods Pro', price: 249, is_featured: true }
        ];
        
        for (const product of mockFeaturedProducts) {
          const cacheKey = `products:single:${product.id}`;
          await enterpriseRedis.setWithStrategy(cacheKey, product, 'product', 'critical');
          console.log(`⭐ Pre-cargado producto: ${product.name}`);
        }
        
        // También guardar la lista completa
        await enterpriseRedis.setWithStrategy('products:featured', mockFeaturedProducts, 'product', 'high');
        return;
      }
      
      const featuredProducts = await strapi.entityService.findMany('api::product.product', {
        filters: { is_featured: true },
        populate: ['images', 'category', 'variations'],
        sort: { createdAt: 'desc' },
        pagination: { limit: 20 }
      });

      // featuredProducts es directamente un array, no tiene propiedad data
      for (const product of featuredProducts) {
        const cacheKey = `products:single:${product.id}`;
        
        await enterpriseRedis.setWithStrategy(
          cacheKey,
          product,
          'product',
          'critical'
        );
      }
      
      console.log('✅ Productos destacados pre-cargados');
    } catch (error) {
      console.error('❌ Error pre-cargando productos destacados:', error);
    }
  }

  async getPopularCategories() {
    // Simular obtención de categorías populares
    return [
      { id: 1, name: 'Electronics', accessCount: 500 },
      { id: 2, name: 'Clothing', accessCount: 350 },
      { id: 3, name: 'Home', accessCount: 280 }
    ];
  }

  async getFrequentlyAccessedProducts() {
    // Simular obtención de productos frecuentes
    return [
      { id: 101, accessCount: 150 },
      { id: 102, accessCount: 120 },
      { id: 103, accessCount: 95 }
    ];
  }

  async autoOptimize() {
    console.log('🤖 Iniciando optimización automática...');
    
    try {
      const optimizations = await this.generateOptimizationPlan();
      
      for (const optimization of optimizations) {
        if (optimization.autoApply) {
          await this.applyOptimization(optimization);
        }
      }
      
      console.log('✅ Optimización automática completada');
    } catch (error) {
      console.error('❌ Error en optimización automática:', error);
    }
  }

  async generateOptimizationPlan() {
    const plan = [];
    
    // Analizar métricas actuales
    const metrics = await this.getCurrentMetrics();
    
    if (metrics.hitRate < 0.85) { // Menos del 85% de aciertos
      plan.push({
        type: 'increase_preloading',
        priority: 'high',
        autoApply: true,
        description: 'Incrementar pre-carga debido a baja tasa de aciertos'
      });
    }
    
    if (metrics.avgResponseTime > 100) { // Más de 100ms promedio
      plan.push({
        type: 'optimize_queries',
        priority: 'medium',
        autoApply: true,
        description: 'Optimizar consultas lentas'
      });
    }
    
    return plan;
  }

  async getCurrentMetrics() {
    // Simular métricas actuales
    return {
      hitRate: 0.82,
      avgResponseTime: 120,
      memoryUsage: 0.75,
      errorRate: 0.02
    };
  }

  async applyOptimization(optimization) {
    console.log(`🔧 Aplicando optimización: ${optimization.description}`);
    
    switch (optimization.type) {
      case 'increase_preloading':
        await this.increasePreloadingFrequency();
        break;
        
      case 'optimize_queries':
        await this.optimizeSlowQueries();
        break;
    }
  }

  async increasePreloadingFrequency() {
    // Incrementar frecuencia de pre-carga
    await this.preloadFeaturedProducts();
    await this.preloadPopularCategories();
  }

  async optimizeSlowQueries() {
    // Optimizar consultas lentas identificadas
    const slowQueries = await this.getSlowQueries();
    
    for (const query of slowQueries) {
      // Aumentar TTL para consultas lentas frecuentes
      await this.adjustTTLForPattern(query.key, 2);
    }
  }

  async generateReport() {
    console.log('📋 Generando reporte de cache...');
    
    const report = {
      timestamp: new Date().toISOString(),
      performance: await this.getPerformanceReport(),
      recommendations: this.analytics.recommendations.slice(-10), // Últimas 10
      memoryUsage: await this.getMemoryStats(),
      topPatterns: await this.getTopQueryPatterns(),
      optimizations: await this.getRecentOptimizations()
    };

    console.log('📊 Reporte de Cache Redis:', JSON.stringify(report, null, 2));
    
    // Limpiar recomendaciones antiguas
    this.analytics.recommendations = this.analytics.recommendations.slice(-20);
    
    return report;
  }

  async getPerformanceReport() {
    const metrics = await this.getCurrentMetrics();
    
    return {
      hitRate: `${(metrics.hitRate * 100).toFixed(2)}%`,
      avgResponseTime: `${metrics.avgResponseTime}ms`,
      status: metrics.hitRate > 0.85 ? 'good' : 'needs_improvement'
    };
  }

  async getRecentOptimizations() {
    // Simular optimizaciones recientes
    return [
      {
        timestamp: new Date().toISOString(),
        type: 'preload',
        description: 'Pre-carga de productos destacados',
        impact: '+15% hit rate'
      }
    ];
  }
}

// Exportar instancia singleton
const cacheAnalytics = new CacheAnalyticsService();

module.exports = cacheAnalytics;
