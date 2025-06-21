'use strict';

/**
 * coupon router
 */


module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/coupons/applyCoupon',
            handler: 'coupon.applyCoupon',
            config: {
                policies: [],
            },
        },

    ]
}
