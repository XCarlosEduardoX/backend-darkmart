'use strict';

/**
 * processed-event router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::processed-event.processed-event');
