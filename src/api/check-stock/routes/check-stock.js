module.exports = {
  routes: [
    {
      method: 'POST', // Método de la solicitud
      path: '/check-stock', // Ruta del endpoint
      handler: 'check-stock.checkStock', // Método que maneja la solicitud en el controlador
      config: {
        policies: [], // Políticas opcionales
        middlewares: [], // Middlewares opcionales
      },
    },
    {
      method: 'GET', // Método de la solicitud
      path: '/check-stock/diagnose', // Ruta del endpoint de diagnóstico
      handler: 'check-stock.diagnoseDatabase', // Método de diagnóstico
      config: {
        policies: [], // Políticas opcionales
        middlewares: [], // Middlewares opcionales
      },
    },
  ],
};
