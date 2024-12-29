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
  ],
};
