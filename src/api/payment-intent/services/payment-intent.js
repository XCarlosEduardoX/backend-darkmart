'use strict';

/**
 * payment-intent service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::payment-intent.payment-intent');
