# Optimización del Webhook de Stripe - Documentación

## Problemas Identificados en el Código Original

### 1. **Orden de Eventos Inconsistente**
- Los eventos de Stripe pueden llegar fuera de orden
- No había validación de transiciones de estado válidas
- Eventos más antiguos podían sobrescribir estados más recientes

### 2. **Concurrencia y Race Conditions**
- Múltiples eventos del mismo payment_intent podían procesarse simultáneamente
- Duplicación de actualizaciones en la base de datos
- Estados inconsistentes por procesamiento paralelo

### 3. **Manejo de Errores Deficiente**
- Falta de reintentos automáticos
- Errores no capturados adecuadamente
- No había logging detallado para debugging

### 4. **Código Duplicado y Mantenimiento**
- Lógica repetitiva entre funciones
- Difícil mantenimiento y debugging
- Falta de validaciones consistentes

## Soluciones Implementadas

### 1. **Control de Concurrencia**
```javascript
const processingEvents = new Map();
```
- Previene procesamiento simultáneo de eventos del mismo payment_intent
- Evita race conditions y estados inconsistentes

### 2. **Máquina de Estados**
```javascript
const VALID_STATE_TRANSITIONS = {
    'pending': ['processing', 'completed', 'failed', 'canceled', 'expired'],
    'processing': ['completed', 'failed', 'canceled'],
    'completed': ['refunded', 'canceled'],
    // ...
};
```
- Valida transiciones de estado antes de aplicarlas
- Previene cambios de estado inválidos
- Mantiene integridad de datos

### 3. **Sistema de Reintentos con Backoff Exponencial**
```javascript
async function processEventWithRetry(event, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await processEventOptimized(event);
            break;
        } catch (error) {
            // Backoff exponencial: 2^attempt * 1000ms
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}
```

### 4. **Logging Mejorado y Timestamps**
- Logs detallados con timestamps de eventos
- Tracking de transiciones de estado
- Información completa para debugging

### 5. **Optimización de Base de Datos**
- Reducción de consultas innecesarias
- Validación antes de actualizar
- Control de duplicados mejorado

## Funciones Optimizadas

### `handleWebhook()` - Función Principal
**Mejoras:**
- Mejor logging con timestamps
- Manejo robusto de errores
- Registro mejorado de eventos procesados

### `processEventWithRetry()` - Nueva Función
**Características:**
- Control de concurrencia por payment_intent
- Sistema de reintentos automáticos
- Backoff exponencial para evitar sobrecarga

### `processEventOptimized()` - Lógica Centralizada
**Mejoras:**
- Manejo centralizado de todos los tipos de eventos
- Logging detallado de cada evento
- Mejor separación de responsabilidades

### `handlePaymentIntentEvent()` - Eventos de Payment Intent
**Características:**
- Mapeo consistente de estados
- Validación de transiciones
- Procesamiento optimizado

### `handleCheckoutSessionEvent()` - Eventos de Checkout
**Mejoras:**
- Manejo diferenciado de pagos síncronos/asíncronos
- Validación mejorada de estados
- Mejor tracking de fulfillment

### `createOrUpdatePaymentIntentOptimized()` - Gestión de Payment Intents
**Optimizaciones:**
- Evita actualizaciones innecesarias
- Validación de cambios antes de escribir
- Mejor control de duplicados
- Timestamps de última actualización

### `updateOrderStatusOptimized()` - Actualización de Estados
**Características:**
- Validación de transiciones de estado
- Actualización condicional (solo si hay cambios)
- Manejo automático de stock según estado
- Logging detallado de cambios

### `fulfillCheckoutOptimized()` - Fulfillment de Órdenes
**Mejoras:**
- Validación completa antes de procesar
- Prevención de procesamiento duplicado
- Manejo robusto de errores con rollback
- Email de confirmación mejorado

### `handleOxxoPaymentOptimized()` - Pagos OXXO
**Optimizaciones:**
- Validación completa de datos requeridos
- Email HTML mejorado con mejor formato
- Manejo de errores sin afectar el flujo principal
- Logging detallado

### Funciones de Email Optimizadas
**Mejoras:**
- Templates HTML responsivos y profesionales
- Validación de datos antes del envío
- Manejo de errores sin afectar el flujo
- Mejor formato y presentación

### `updateStockProducts()` - Actualización de Inventario
**Optimizaciones:**
- Validación de datos de entrada
- Prevención de stock negativo
- Logging detallado de cambios
- Manejo de errores por producto individual
- Timestamps de última actualización

## Beneficios de la Optimización

### 1. **Consistencia de Datos**
- Estados de órdenes siempre coherentes
- Eliminación de race conditions
- Validación de transiciones de estado

### 2. **Confiabilidad**
- Sistema de reintentos automáticos
- Mejor manejo de errores temporales
- Recuperación automática de fallos

### 3. **Observabilidad**
- Logging detallado para debugging
- Tracking completo de eventos
- Métricas de rendimiento

### 4. **Mantenibilidad**
- Código más limpio y modular
- Separación clara de responsabilidades
- Documentación integrada

### 5. **Rendimiento**
- Reducción de consultas innecesarias a BD
- Evitar actualizaciones redundantes
- Procesamiento más eficiente

## Configuración Recomendada

### Variables de Entorno
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_KEY=sk_xxx
```

### Configuración de Webhook en Stripe
**Eventos Recomendados:**
- `payment_intent.created`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `payment_intent.requires_action`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

### Monitoreo
- Verificar logs regularmente
- Configurar alertas para errores críticos
- Monitorear tiempos de respuesta del webhook

## Pruebas Recomendadas

1. **Orden de Eventos**
   - Simular eventos fuera de orden
   - Verificar que los estados finales sean correctos

2. **Concurrencia**
   - Enviar múltiples eventos simultáneos
   - Verificar que no hay duplicados

3. **Fallos de Red**
   - Simular timeouts y errores de red
   - Verificar reintentos automáticos

4. **Pagos OXXO**
   - Probar flujo completo de voucher
   - Verificar emails y expiración

5. **Estados de Orden**
   - Probar todas las transiciones válidas
   - Verificar que las inválidas se rechacen

## Archivos Modificados

- `backend-darkmart/src/api/order/controllers/order.js` - **OPTIMIZADO COMPLETAMENTE**

## Próximos Pasos

1. Probar en entorno de desarrollo con eventos reales
2. Configurar monitoreo de logs
3. Validar flujos de pago completos
4. Documentar métricas de rendimiento
