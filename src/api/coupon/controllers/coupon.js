module.exports = {
    async applyCoupon(ctx) {
        const { couponCode, user, summary } = ctx.request.body;
        //covertir a string couponcode
        let couponCodeString = couponCode.toString().toUpperCase();


        let totalPurchase = summary.totalPriceProducts * 0.01; // Convertir a pesos mexicanos
        const userData = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
            populate: { orders: true },
        });
        if (!couponCodeString) {
            return ctx.badRequest('El código del cupón es requerido');
        }
        // Buscar cupón
        const coupon = await findCouponByCode(couponCodeString)

        if (!coupon) {
            return ctx.badRequest('Cupón no encontrado');
        }
        if (isCouponExpired(coupon)) {
            return ctx.badRequest('El cupón ha expirado');
        }
        if (!isCouponActive(coupon)) {
            return ctx.badRequest('El cupón inactivo');
        }

        if (coupon.allowed_users.length > 0) {
            //buscar si el usuario esta en la lista de usuarios permitidos
            const allowedUsers = coupon.allowed_users.find((allowedUser) => allowedUser.id === user.id);
            if (!allowedUsers) {
                return ctx.badRequest('El cupón no está permitido para este usuario');
            }
        }

        const rules = typeof coupon.rules === 'string' ? JSON.parse(coupon.rules) : coupon.rules;
        // 2. Validar reglas 
        if (rules) {


            if (rules.new_user && userData.orders.length > 0) {
                return ctx.badRequest('El cupón es solo para nuevos usuarios');
            }

            // Verificar si el usuario ya ha usado el cupón
            // const hasUsedCoupon = await userHasUsedCoupon(user.id, coupon.id);
            // if (hasUsedCoupon) {
            //     return ctx.badRequest('Ya has utilizado este cupón');
            // }



            if (rules.min_purchase > 0) {
                if (totalPurchase < rules.min_purchase) {
                    return ctx.badRequest('El mínimo de compra es de $' + (rules.min_purchase * 100) / 100 + ' MXN');
                }
            }
            //si max_purchase es  0, entonces no hay limite de compra
            if (rules.max_purchase > 0) {
                if (totalPurchase > rules.max_purchase) {
                    return ctx.badRequest('El máximo de compra para este cupón es de $' + (rules.max_purchase * 100) / 100 + ' MXN');
                }
            }

            //si total_items es  0, entonces no hay limite de items
            if (rules.total_items > 0) {
                console.log('total items', summary.totalItems);
                if (summary.totalItems > rules.total_items) {

                    return ctx.badRequest('El máximo de items para este cupón es de ' + rules.total_items);
                }
            }
        }
        coupon.success = true;
        return ctx.send({ success: true, data: coupon });
        // if (couponCode == "TESTCOUPON") {
        //     try {

        //         // Verificar si el cupón está vencido
        //         if (isCouponExpired(coupon)) {
        //             return ctx.badRequest('El cupón ha expirado');
        //         }

        //         // Verificar si el usuario es válido
        //         if (!isUserValid(user)) {
        //             return ctx.badRequest('No eres apto para usar este cupón');
        //         }

        //         // Verificar si el usuario ya ha usado el cupón
        //         const hasUsedCoupon = await userHasUsedCoupon(user.id, coupon.id);
        //         if (hasUsedCoupon) {
        //             return ctx.badRequest('Ya has utilizado este cupón');
        //         }

        //         // Verificar si el usuario tiene órdenes
        //         const userOrders = await hasUserOrders(user.id);
        //         if (userOrders == 0) {
        //             return ctx.badRequest('No eres apto para usar este cupón');
        //         }

        //         // Asignar cupón al usuario
        //         await assignCouponToUser(user.id, coupon.id);

        //         return ctx.send({ success: true, data: coupon });
        //     } catch (error) {
        //         console.error(error);
        //         return ctx.internalServerError('Error interno del servidor');
        //     }
        // } else if (couponCode == "FREEALLXD") {
        //     try {


        //         // Verificar si el cupón está vencido
        //         if (isCouponExpired(coupon)) {
        //             return ctx.badRequest('El cupón ha expirado');
        //         }

        //         // Verificar si el usuario es válido
        //         if (!isUserValid(user)) {
        //             return ctx.badRequest('No eres apto para usar este cupón');
        //         }


        //         // Verificar si el usuario tiene órdenes
        //         const userOrders = await hasUserOrders(user.id);
        //         if (userOrders == 0) {
        //             return ctx.badRequest('No eres apto para usar este cupón');
        //         }


        //         // Asignar cupón al usuario
        //         await assignCouponToUser(user.id, coupon.id);

        //         return ctx.send({ success: true, data: coupon });
        //     } catch (error) {
        //         console.error(error);
        //         return ctx.internalServerError('Error interno del servidor');
        //     }
        // }
    },
};

// Función para verificar si el usuario ha usado un cupón
async function userHasUsedCoupon(userId, couponId) {
    const [user] = await strapi.entityService.findMany('api::coupon.coupon', {
        filters: { id: couponId, users: userId },
        limit: 1,
    });
    return user;
}

// Función para buscar un cupón por código
async function findCouponByCode(code) {
    const [coupon] = await strapi.entityService.findMany('api::coupon.coupon', {
        filters: { code },
        populate: { allowed_users: true },
        limit: 1,
    });
    return coupon;
}

// Función para verificar si un cupón está vencido
function isCouponExpired(coupon) {
    const currentDate = new Date();
    const validUntil = new Date(coupon.valid_until);
    return currentDate > validUntil;
}
function isCouponActive(coupon) {
    return coupon.is_active;
}
// Función para validar usuario
function isUserValid(user) {
    return user && user.id;
}



// Función para verificar si el usuario tiene órdenes
async function hasUserOrders(userId) {
    const orders = await strapi.entityService.findMany('api::order.order', {
        filters: { user: userId },
    });
    return orders.length;
}

// Función para asignar el cupón al usuario
async function assignCouponToUser(userId, couponId) {
    await strapi.entityService.update('api::user.user', userId, {
        data: {
            coupons: couponId,
        },
    });
}