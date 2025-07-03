'use strict';

/**
 * review router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

const defaultRouter = createCoreRouter('api::review.review');

const customRouter = (innerRouter, extraRoutes = []) => {
  let routes;
  return {
    get prefix() {
      return innerRouter.prefix;
    },
    get routes() {
      if (!routes) routes = innerRouter.routes.concat(extraRoutes);
      return routes;
    },
  };
};

const myExtraRoutes = [
  {
    method: 'POST',
    path: '/reviews/validate-purchase',
    handler: 'review.validatePurchase',
  },
  {
    method: 'POST',
    path: '/reviews/by-product',
    handler: 'review.byProduct',
  },
  {
    method: 'POST',
    path: '/reviews/update',
    handler: 'review.updateReview',
  },
  {
    method: 'POST',
    path: '/reviews/delete',
    handler: 'review.deleteReview',
  },
];

module.exports = customRouter(defaultRouter, myExtraRoutes);
