'use strict';





module.exports = {

  async beforeCreate(event) {
    const { data } = event.params;

    console.log('data', data);
    console.log('user', data.user);

    // Buscar en los demás registros si ya existe un predeterminado
    if (data.is_main) {
      const userId = data.user.set[0].id; // Extraer el id del usuario

      const address = await strapi.query('api::address.address').findOne({
        where: { is_main: true, user: { id: userId } }, // Usar el id extraído
      });

      if (address) {
        await strapi.query('api::address.address').update({
          where: { id: address.id, user: { id: userId } }, // Usar el id extraído
          data: { is_main: false },
        });
      }
    }
  },

  async beforeUpdate(event) {

    const { data } = event.params;
    console.log('data', data);
    console.log('user', data.user);
    if (data.is_main) {
      const userId = data.user; // Extraer el id del usuario

      const address = await strapi.query('api::address.address').findOne({
        where: { is_main: true, user: { id: userId } }
      });
      if (address) {
        await strapi.query('api::address.address').update({
          where: { id: address.id, user: { id: userId } },
          data: { is_main: false }
        });
      }
    }

  },

  async beforeDelete(event) {
    const { data } = event.params;
    console.log('data', data);
    // if (data.is_main) {
    //   const userId = data.user.set[0].id; // Extraer el id del usuario

    //   // Buscar otro registro para marcarlo como predeterminado
    //   const address = await strapi.query('api::address.address').findOne({
    //     where: { user: { id: userId } }
    //   });

    //   if (address) {
    //     await strapi.query('api::address.address').update({
    //       where: { id: address.id, user: { id: userId } },
    //       data: { is_main: true }
    //     });
    //   }
      
    // }
  }

};
