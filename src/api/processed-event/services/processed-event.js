'use strict';

/**
 * processed-event service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::processed-event.processed-event');
