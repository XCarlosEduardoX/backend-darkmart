module.exports = (plugin) => {
  
  // Verificar que el plugin y los controladores existen
  if (!plugin || !plugin.controllers || !plugin.controllers['content-types']) {
    console.log('Content-manager plugin o controladores no encontrados');
    return plugin;
  }

  // Sobrescribir el controlador de configuración de content-types
  const originalGetConfiguration = plugin.controllers['content-types'].getConfiguration;
  
  if (originalGetConfiguration) {
    plugin.controllers['content-types'].getConfiguration = async (ctx) => {
      const { uid } = ctx.params;
      
      // Si es un content-type de users-permissions que está causando problemas de privacidad
      if (uid === 'plugin::users-permissions.role' || uid === 'plugin::users-permissions.permission') {
        try {
          // Llamar al método original
          await originalGetConfiguration(ctx);
        } catch (error) {
          if (error.message && error.message.includes('privacy')) {
            console.log(`Error de privacidad para ${uid}, proporcionando configuración por defecto`);
            
            // Configuración por defecto para evitar el error
            ctx.body = {
              data: {
                contentType: {
                  uid: uid,
                  settings: {
                    bulkable: true,
                    filterable: true,
                    searchable: true,
                    pageSize: 10,
                    mainField: uid.includes('role') ? 'name' : 'action',
                    defaultSortBy: uid.includes('role') ? 'name' : 'action',
                    defaultSortOrder: 'ASC'
                  },
                  metadatas: {},
                  layouts: {
                    list: [],
                    edit: [],
                    editRelations: []
                  }
                }
              }
            };
            return;
          }
          throw error;
        }
      } else {
        // Para otros content-types, usar el método original
        await originalGetConfiguration(ctx);
      }
    };
  } else {
    console.log('getConfiguration method not found in content-types controller');
  }

  return plugin;
};
