'use strict';



// Función para generar un identificador único corto
const generateShortSku = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length = 5;
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
};




module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    console.log('agregando el sku', data);

    console.log('data', data);
    // Generar el SKU si no está definido
    if (!data.sku) {
      let newSku;
      let exists = true;

      // Verificar si el SKU ya existe
      while (exists) {
        newSku = generateShortSku();
        exists = await strapi.query('api::variation.variation').findOne({
          where: { sku: newSku }
        });
      }

      data.sku = newSku;
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    console.log('actualizando el sku', data);
    // Generar un nuevo SKU solo si falta

    // Generar un nuevo SKU solo si falta
    if (!data.sku) {
      let newSku;
      let exists = true;

      while (exists) {
        newSku = generateShortSku();
        exists = await strapi.query('api::variation.variation').findOne({
          where: { sku: newSku }
        });
      }

      data.sku = newSku;
    }
  },


};
