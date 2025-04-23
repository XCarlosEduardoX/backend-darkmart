'use strict';



// // Configuración para la caché
// const CACHE_TTL = 3600; // 1 hora

// Función para generar un identificador único corto
const generateShortSku = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length = 8;
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
  
    // Generar el SKU si no está definido
    if (!data.identifier) {
      let newUid;
      let exists = true;

      // Verificar si el SKU ya existe
      while (exists) {
        newUid = generateShortSku();
        exists = await strapi.query('api::wishlist.wishlist').findOne({
          where: { identifier: newUid }
        });
      }

      data.identifier = newUid;
    };
    // if (data.images && data.images.length > 0) {
    //   if (!data.blurDataURL) {
    //     console.log('generando el blurDataURL');

    //     const blurDataURL = await generateBlurDataURL(data.images[0].url, data.images[0].id);
    //     // data.blurDataURL = blurDataURL;
    //     data.images[0].blurDataURL = blurDataURL;
    //     data.blurDataURL = blurDataURL;
    //   }

    // }
  },

};
