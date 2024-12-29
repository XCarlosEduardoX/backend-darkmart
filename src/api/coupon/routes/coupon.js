'use strict';

/**
 * coupon router
 */


module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/coupons/applyCoupon', // Ruta para crear pedidos
            handler: 'coupon.applyCoupon',
            config: {
                policies: [],
            },
        },
    ]
}
