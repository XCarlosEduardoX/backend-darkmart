'use strict';

module.exports = {
  async bootstrap() {
    const addSkuToProducts = require('./scripts/add-sku-to-products');
    await addSkuToProducts();
  },
  // /**
  //  * An asynchronous register function that runs before
  //  * your application is initialized.
  //  *
  //  * This gives you an opportunity to extend code.
  //  */
  // register(/*{ strapi }*/) {},

  // /**
  //  * An asynchronous bootstrap function that runs before
  //  * your application gets started.
  //  *
  //  * This gives you an opportunity to set up your data model,
  //  * run jobs, or perform some special logic.
  //  */
  // bootstrap(/*{ strapi }*/) {},
};
