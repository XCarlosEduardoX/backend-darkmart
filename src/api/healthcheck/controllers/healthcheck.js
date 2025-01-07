module.exports = {
    async index(ctx) {
      try {
        // Puedes agregar checks adicionales aquí (base de datos, servicios, etc.)
        ctx.send({
          status: 'ok',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        ctx.status = 500;
        ctx.send({
          status: 'error',
          message: 'Healthcheck failed',
        });
      }
    },
  };
  