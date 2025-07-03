module.exports = {
    // Método seguro para validar cupones sin exponer detalles
    async validateCoupon(ctx) {
        try {
            const { couponCode, userId } = ctx.request.body;

            console.log('[COUPON-SECURE] Validando cupón:', { couponCode, userId });

            // Validar datos de entrada
            if (!couponCode || !userId) {
                return ctx.badRequest('Código de cupón y ID de usuario son requeridos');
            }

            const couponCodeString = couponCode.toString().toUpperCase();

            // Buscar cupón
            const coupon = await findCouponByCode(couponCodeString);
            if (!coupon) {
                return ctx.badRequest('Cupón no encontrado');
            }

            // Validar cupón básico
            if (!isCouponActive(coupon)) {
                return ctx.badRequest('El cupón no está activo');
            }

            if (isCouponExpired(coupon)) {
                return ctx.badRequest('El cupón ha expirado');
            }

            // Verificar si el usuario ya usó este cupón
            const hasUsedCoupon = await checkIfUserUsedCoupon(userId, coupon.id);
            if (hasUsedCoupon) {
                return ctx.badRequest('Ya has utilizado este cupón');
            }

            // Validar reglas específicas del cupón si las tiene
            if (coupon.rules) {
                const rules = typeof coupon.rules === 'string' ? JSON.parse(coupon.rules) : coupon.rules;

                // Validar nuevos usuarios si aplica
                if (rules.new_user) {
                    const userOrderCount = await hasUserOrders(userId);
                    if (userOrderCount > 0) {
                        return ctx.badRequest('El cupón es solo para nuevos usuarios');
                    }
                }
                // Validar mínimo de compra
                // Si el mínimo de compra es 0, no hay límite

                // Validar máximo de compra
            }

            // Respuesta segura: solo confirmar que es válido y devolver ID
            return ctx.send({
                success: true,
                couponId: coupon.id,
                message: `Cupón ${couponCodeString} es válido`
            });

        } catch (error) {
            console.error('[COUPON-SECURE] Error:', error);
            return ctx.internalServerError('Error interno del servidor');
        }
    },

    async applyCoupon(ctx) {
        try {
            const { couponCode, user, summary } = ctx.request.body;

            // Log para depuración
            console.log('[COUPON] Datos recibidos:', {
                couponCode: couponCode,
                user: user ? { id: user.id, email: user.email } : null,
                summary: summary ? {
                    totalPriceProducts: summary.totalPriceProducts,
                    totalItems: summary.totalItems
                } : null
            });

            // Validar datos de entrada de forma más específica
            if (!couponCode) {
                console.log('[COUPON] Error: couponCode faltante');
                return ctx.badRequest('El código del cupón es requerido');
            }

            if (!user || !user.id) {
                console.log('[COUPON] Error: user o user.id faltante');
                return ctx.badRequest('Usuario no válido');
            }

            if (!summary || !summary.totalPriceProducts) {
                console.log('[COUPON] Error: summary faltante o incompleto');
                return ctx.badRequest('Resumen de compra no válido');
            }

            //convertir a string couponcode
            let couponCodeString = couponCode.toString().toUpperCase();

            let totalPurchase = summary.totalPriceProducts * 0.01; // Convertir a pesos mexicanos

            console.log('[COUPON] Análisis de compra (básico):', {
                totalPriceProductsCentavos: summary.totalPriceProducts,
                totalPurchasePesos: totalPurchase,
                totalItems: summary.totalItems
            });

            // Obtener datos del usuario de forma segura
            let userData;
            try {
                userData = await strapi.entityService.findOne('plugin::users-permissions.user', user.id);
            } catch (error) {
                console.error('Error obteniendo datos del usuario:', error);
                userData = { orders: [] }; // Valor por defecto
            }

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

            // Verificar usuarios permitidos solo si existen
            try {
                // Comentado temporalmente hasta reiniciar servidor
                // if (coupon.allowed_users && Array.isArray(coupon.allowed_users) && coupon.allowed_users.length > 0) {
                //     const allowedUsers = coupon.allowed_users.find((allowedUser) => allowedUser.id === user.id);
                //     if (!allowedUsers) {
                //         return ctx.badRequest('El cupón no está permitido para este usuario');
                //     }
                // }
                console.log('Validación de usuarios permitidos omitida temporalmente');
            } catch (error) {
                console.log('Error verificando usuarios permitidos (campo puede no existir aún):', error.message);
            }

            // Verificar si el usuario ya ha usado el cupón usando un enfoque temporal
            const hasUsedCoupon = await userHasUsedCouponTemporary(user.id, coupon.id);
            if (hasUsedCoupon) {
                return ctx.badRequest('Ya has utilizado este cupón');
            }

            const rules = typeof coupon.rules === 'string' ? JSON.parse(coupon.rules) : coupon.rules;
            
            console.log('[COUPON] Reglas del cupón:', {
                couponCode: couponCodeString,
                rules: rules,
                totalPurchasePesos: totalPurchase
            });
            
            // 2. Validar reglas 
            if (rules) {

                // Verificar nuevos usuarios solo si existe la relación de órdenes
                try {
                    // Comentado temporalmente hasta reiniciar servidor
                    // if (rules.new_user && userData.orders && userData.orders.length > 0) {
                    //     return ctx.badRequest('El cupón es solo para nuevos usuarios');
                    // }
                    console.log('Validación de nuevos usuarios omitida temporalmente');
                } catch (error) {
                    console.log('Error verificando órdenes de usuario (campo puede no existir aún):', error.message);
                }

                if (rules.min_purchase > 0) {
                    console.log(`[COUPON] Validando mínimo de compra: ${totalPurchase} >= ${rules.min_purchase}`);
                    if (totalPurchase < rules.min_purchase) {
                        const minPurchaseInPesos = rules.min_purchase / 100; // Convertir centavos a pesos
                        return ctx.badRequest(`El mínimo de compra es de $${minPurchaseInPesos} MXN`);
                    }
                }
                //si max_purchase es  0, entonces no hay limite de compra
                if (rules.max_purchase > 0) {
                    console.log(`[COUPON] Validando máximo de compra: ${totalPurchase} <= ${rules.max_purchase}`);
                    if (totalPurchase > rules.max_purchase) {
                        const maxPurchaseInPesos = rules.max_purchase / 100; // Convertir centavos a pesos
                        return ctx.badRequest(`El máximo de compra para este cupón es de $${maxPurchaseInPesos} MXN`);
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

            // NO registrar el uso del cupón aquí - solo validar
            // El registro se hará cuando se complete la compra
            console.log(`Cupón ${couponCodeString} validado exitosamente para usuario ${user.id} - pendiente de uso en compra`);
            console.log(`⚠️ [COUPON] IMPORTANTE: Cupón NO registrado como usado aún - se registrará al completar la orden`);

            // Preparar respuesta exitosa
            const response = {
                success: true,
                couponId: coupon.id, // Agregar el ID del cupón
                code: coupon.code,
                discount: coupon.discount,
                is_active: coupon.is_active,
                valid_until: coupon.valid_until,
                message: `Cupón ${couponCodeString} aplicado correctamente`
            };

            return ctx.send(response);

        } catch (error) {
            console.error('Error general en applyCoupon:', error);
            return ctx.internalServerError('Error interno del servidor');
        }
    },

    // Método seguro para validar cupones sin exponer detalles

};

// Función temporal para verificar si el usuario ha usado un cupón (usando órdenes completadas)
async function userHasUsedCouponTemporary(userId, couponId) {
    try {
        console.log(`🔍 [COUPON-TEMP] Verificando uso temporal de cupón ${couponId} por usuario ${userId}`);

        // Buscar el cupón con la relación used_by_users poblada
        const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId, {
            populate: { used_by_users: true }
        });

        if (!coupon || !coupon.used_by_users) {
            console.log(`✅ [COUPON-TEMP] Cupón ${couponId} no tiene usuarios registrados como usados`);
            return false;
        }

        // Verificar si el usuario está en la lista de usuarios que ya usaron el cupón
        const hasUsed = coupon.used_by_users.some(user => user.id === parseInt(userId));

        console.log(`✅ [COUPON-TEMP] Usuario ${userId} ${hasUsed ? 'ya ha usado' : 'no ha usado'} el cupón ${couponId}`);
        return hasUsed;
    } catch (error) {
        console.error('❌ [COUPON-TEMP] Error verificando uso de cupón:', error);
        return false;
    }
}

// Función temporal para asignar cupón al usuario (se registrará cuando se complete la orden)
async function assignCouponToUserTemporary(userId, couponId) {
    try {
        // Intentar registrar inmediatamente usando el nuevo sistema
        try {
            const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId, {
                populate: { used_by_users: true },
            });

            if (coupon && coupon.used_by_users) {
                // Verificar si el usuario ya está en la lista
                const currentUserIds = coupon.used_by_users.map(user => user.id);

                if (!currentUserIds.includes(userId)) {
                    // Usar la API de Strapi para conectar la relación
                    await strapi.db.query('api::coupon.coupon').update({
                        where: { id: couponId },
                        data: {
                            used_by_users: {
                                connect: [userId]
                            }
                        }
                    });

                    console.log(`✅ Usuario ${userId} registrado inmediatamente en used_by_users del cupón ${couponId}`);
                    return true;
                }
            }
        } catch (error) {
            console.log(`⚠️ Campo used_by_users no disponible aún, el registro se hará cuando se complete la orden:`, error.message);
        }

        // Por ahora solo loggeamos, el registro real se hará cuando se complete la orden
        console.log(`📝 Cupón ${couponId} marcado para registro cuando se complete la orden del usuario ${userId}`);
        return true;
    } catch (error) {
        console.error('Error al asignar cupón temporalmente:', error);
        throw error;
    }
}

// Función para buscar un cupón por código
async function findCouponByCode(code) {
    try {
        const [coupon] = await strapi.entityService.findMany('api::coupon.coupon', {
            filters: { code },
            // populate: { allowed_users: true }, // Comentado temporalmente
            limit: 1,
        });
        return coupon;
    } catch (error) {
        console.error('Error buscando cupón:', error);
        return null;
    }
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
    try {
        const orders = await strapi.entityService.findMany('api::order.order', {
            filters: { user: userId },
        });
        return orders.length;
    } catch (error) {
        console.error('Error verificando órdenes del usuario:', error);
        return 0;
    }
}

// Función para verificar si un usuario ha usado un cupón (sin exponer detalles)
async function checkIfUserUsedCoupon(userId, couponId) {
    try {
        console.log(`🔍 [COUPON-CHECK] Verificando si usuario ${userId} ya usó cupón ${couponId}`);

        // Buscar el cupón con la relación used_by_users poblada
        const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId, {
            populate: { used_by_users: true }
        });

        if (!coupon || !coupon.used_by_users) {
            console.log(`✅ [COUPON-CHECK] Cupón ${couponId} no tiene usuarios registrados como usados`);
            return false;
        }

        // Verificar si el usuario está en la lista de usuarios que ya usaron el cupón
        const hasUsed = coupon.used_by_users.some(user => user.id === parseInt(userId));

        console.log(`✅ [COUPON-CHECK] Usuario ${userId} ${hasUsed ? 'YA HA USADO' : 'NO HA USADO'} el cupón ${couponId}`);
        console.log(`📋 [COUPON-CHECK] Usuarios que han usado este cupón: [${coupon.used_by_users.map(u => u.id).join(', ')}]`);

        return hasUsed;
    } catch (error) {
        console.error('❌ [COUPON-CHECK] Error verificando uso de cupón:', error);
        return false;
    }
}