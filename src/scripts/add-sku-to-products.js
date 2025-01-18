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

module.exports = async () => {
  const products = await strapi.query('api::product.product').findMany({
    where: { sku: null } // Buscar productos que no tienen `sku`
  });

  for (const product of products) {
    let newSku;
    let exists = true;

    // Verificar que el SKU sea único
    while (exists) {
      newSku = generateShortSku();
      exists = await strapi.query('api::product.product').findOne({
        where: { sku: newSku }
      });
    }

    // Actualizar el producto con el nuevo SKU
    await strapi.query('api::product.product').update({
      where: { id: product.id },
      data: { sku: newSku }
    });

    console.log(`SKU asignado: ${newSku} para el producto ID: ${product.id}`);
  }

  console.log('¡Actualización de SKUs completada!');
};
