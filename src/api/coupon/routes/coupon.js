'use strict';

/**
 * coupon router
 */


module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/coupons/apply-coupon',
            handler: 'coupon.applyCoupon',
            config: {
                policies: [],
            },
        },
        {
            method: 'POST',
            path: '/coupons/validate-coupon',
            handler: 'coupon.validateCoupon',
            config: {
                policies: [],
                auth: false, // Temporal para testing
            },
        },
    ]
}
