const userController = require('./controllers/user');
const userRoutes = require('./routes/user');

module.exports = (plugin) => {
  // Extender el controlador de usuarios
  plugin = userController(plugin);
  
  // Extender las rutas de usuarios
  plugin = userRoutes(plugin);

  return plugin;
};
