'use strict';

module.exports = {
    async calculateOrder(ctx) {
        try {
            const { products, couponId, userId } = ctx.request.body;
            
            console.log('[CALCULATE-ORDER] Datos recibidos:', {
                products: products?.length || 0,
                couponId,
                userId
            });

            // Validar datos de entrada
            if (!products || !Array.isArray(products) || products.length === 0) {
                return ctx.badRequest('Products array is required');
            }

            if (!userId) {
                return ctx.badRequest('User ID is required');
            }

            // Validar estructura de productos
            for (const product of products) {
                if (!product.id || !product.quantity || product.quantity <= 0) {
                    return ctx.badRequest('Each product must have id and quantity > 0');
                }
                if (product.variationId && typeof product.variationId !== 'number') {
                    return ctx.badRequest('Invalid variation ID');
                }
            }

            // Obtener datos del usuario para validar direcciones
            const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
                populate: { addresses: true }
            });

            if (!user) {
                return ctx.badRequest('Usuario no encontrado');
            }

            // Verificar que tenga al menos una dirección
            const mainAddress = user.addresses?.find(addr => addr.is_main);
            if (!mainAddress) {
                return ctx.badRequest('El usuario debe tener una dirección principal configurada');
            }

            // Calcular productos del carrito
            const calculatedProducts = [];
            let subtotal = 0;

            for (const productRequest of products) {
                const { id: productId, quantity, variationId } = productRequest;

                // Obtener producto desde la base de datos
                const product = await strapi.entityService.findOne('api::product.product', productId, {
                    populate: { variations: true }
                });

                if (!product) {
                    return ctx.badRequest(`Producto con ID ${productId} no encontrado`);
                }

                let productPrice = product.price;
                let stockAvailable = product.stock;
                let productName = product.product_name;
                let sku = product.sku;

                // Manejar variaciones si existen
                if (variationId) {
                    const variation = product.variations?.find(v => v.id === variationId);
                    if (!variation) {
                        return ctx.badRequest(`Variación con ID ${variationId} no encontrada en producto ${productId}`);
                    }
                    
                    stockAvailable = variation.stock;
                    productName = `${product.product_name} - Talla: ${variation.size}`;
                    sku = variation.sku;
                }

                // Validar stock disponible
                if (quantity > stockAvailable) {
                    return ctx.badRequest(`Stock insuficiente para ${productName}. Disponible: ${stockAvailable}, Solicitado: ${quantity}`);
                }

                // Calcular precio con descuentos si los hay
                let finalPrice = productPrice;
                let discountApplied = 0;

                if (product.discount && product.discount > 0) {
                    discountApplied = product.discount;
                    finalPrice = productPrice * (1 - discountApplied / 100);
                }

                const productTotal = finalPrice * quantity;
                subtotal += productTotal;

                console.log(`📊 [CALC] Producto: ${productName}, Precio original: ${productPrice} (unidad DB), Precio final: ${finalPrice} (unidad DB), Cantidad: ${quantity}, Total: ${productTotal} (unidad DB)`);

                calculatedProducts.push({
                    id: productId,
                    variationId: variationId || null,
                    product_name: productName,
                    sku,
                    price: productPrice,
                    finalPrice,
                    discountApplied,
                    quantity,
                    total: productTotal,
                    stockAvailable
                });
            }

            // Calcular costo de envío
            // IMPORTANTE: Verificar si los precios en DB están en centavos o pesos
            const SHIPPING_COST = parseFloat(process.env.SHIPPING_COST || '17000'); // Por defecto, 17000 centavos (170 pesos)
            const MIN_FREE_SHIPPING_PESOS = parseFloat(process.env.QUANTITY_MIN_FREE_SHIPPING || '1500');
            
            // Verificar qué unidad está usando la DB basándose en el primer producto
            const firstProductPrice = calculatedProducts[0]?.price || 0;
            const isPriceInCentavos = firstProductPrice > 1000; // Si es > 1000, probablemente está en centavos
            
            let shippingCost = SHIPPING_COST; // Por defecto, costo de envío
            // if (isPriceInCentavos) {
            //     // Precios en centavos: convertir MIN_FREE_SHIPPING a centavos
            //     const MIN_FREE_SHIPPING = MIN_FREE_SHIPPING_PESOS * 100;
            //     shippingCost = subtotal >= MIN_FREE_SHIPPING ? 0 : SHIPPING_COST;
            //     console.log(`📊 [CALC] Precios detectados en CENTAVOS`);
            // } else {
            //     // Precios en pesos: comparar directamente
            //     shippingCost = subtotal >= MIN_FREE_SHIPPING_PESOS ? 0 : SHIPPING_COST;
            //     console.log(`📊 [CALC] Precios detectados en PESOS`);
            // }
            
            console.log(`💰 [CALC] ANÁLISIS DE UNIDADES:`);
            console.log(`- Primer producto precio: ${firstProductPrice} (${isPriceInCentavos ? 'centavos' : 'pesos'})`);
            console.log(`- Subtotal desde DB: ${subtotal} (${isPriceInCentavos ? 'centavos' : 'pesos'})`);
            console.log(`- Subtotal en pesos: ${isPriceInCentavos ? subtotal/100 : subtotal} pesos`);
            console.log(`- MIN_FREE_SHIPPING_PESOS: ${MIN_FREE_SHIPPING_PESOS} pesos`);
            console.log(`- Comparación resultado: envío gratis = ${shippingCost === 0}`);
            console.log(`- Envío aplicado: ${shippingCost} pesos`);

            // Aplicar cupón si existe
            let couponDiscount = 0;
            let couponData = null;
            
            if (couponId) {
                console.log(`🎫 [CALC] Procesando cupón ID: ${couponId} para usuario: ${userId}`);
                
                try {
                    const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId);

                    if (!coupon) {
                        console.error(`🎫 [CALC] Cupón ${couponId} no encontrado`);
                        return ctx.badRequest('Cupón no encontrado');
                    }

                    console.log(`🎫 [CALC] Cupón encontrado: ${coupon.code}, descuento: ${coupon.discount}%`);

                    // Validar cupón básico
                    const currentDate = new Date();
                    const validUntil = new Date(coupon.valid_until);
                    
                    if (currentDate > validUntil) {
                        console.error(`🎫 [CALC] Cupón ${coupon.code} expirado: ${validUntil}`);
                        return ctx.badRequest('El cupón ha expirado');
                    }

                    if (!coupon.is_active) {
                        console.error(`🎫 [CALC] Cupón ${coupon.code} inactivo`);
                        return ctx.badRequest('El cupón no está activo');
                    }

                    console.log(`🎫 [CALC] Cupón ${coupon.code} es válido y activo`);

                    // SKIPEAR validación de uso previo durante el cálculo
                    // La validación de uso se hará únicamente al completar la compra
                    console.log(`🎫 [CALC] SKIPPING validación de uso previo - solo para cálculo de totales`);

                    // Validar reglas del cupón
                    if (coupon.rules) {
                        console.log(`🎫 [CALC] Validando reglas del cupón...`);
                        const rules = typeof coupon.rules === 'string' ? JSON.parse(coupon.rules) : coupon.rules;
                        
                        // Convertir subtotal a pesos mexicanos para comparación
                        const subtotalInPesos = subtotal / 100;
                        
                        if (rules.min_purchase > 0 && subtotalInPesos < rules.min_purchase) {
                            return ctx.badRequest(`El mínimo de compra es de $${rules.min_purchase} MXN`);
                        }

                        if (rules.max_purchase > 0 && subtotalInPesos > rules.max_purchase) {
                            return ctx.badRequest(`El máximo de compra para este cupón es de $${rules.max_purchase} MXN`);
                        }

                        if (rules.total_items > 0) {
                            const totalItems = products.reduce((sum, p) => sum + p.quantity, 0);
                            if (totalItems > rules.total_items) {
                                return ctx.badRequest(`El máximo de items para este cupón es de ${rules.total_items}`);
                            }
                        }

                        // Validar nuevos usuarios si aplica
                        if (rules.new_user) {
                            const userOrders = await strapi.entityService.findMany('api::order.order', {
                                filters: { 
                                    user: userId,
                                    order_status: 'completed'
                                },
                                limit: 1
                            });
                            
                            if (userOrders.length > 0) {
                                return ctx.badRequest('El cupón es solo para nuevos usuarios');
                            }
                        }
                    }

                    // Calcular descuento
                    couponDiscount = (subtotal * coupon.discount) / 100;
                    couponData = {
                        id: coupon.id,
                        code: coupon.code,
                        discount: coupon.discount,
                        discountAmount: couponDiscount
                    };

                } catch (error) {
                    console.error('Error validando cupón:', error);
                    return ctx.badRequest('Error al validar el cupón');
                }
            }

            // Calcular total final
            const total = subtotal - couponDiscount + shippingCost;

            const orderSummary = {
                products: calculatedProducts,
                subtotal,
                shippingCost,
                couponDiscount,
                coupon: couponData,
                total,
                address: {
                    id: mainAddress.id,
                    street: mainAddress.street,
                    city: mainAddress.city,
                    state: mainAddress.state,
                    zip_code: mainAddress.zip_code
                },
                calculations: {
                    freeShippingMinimum: MIN_FREE_SHIPPING_PESOS,
                    appliedShipping: shippingCost,
                    appliedCouponDiscount: couponDiscount,
                    priceUnit: isPriceInCentavos ? 'centavos' : 'pesos'
                }
            };

            console.log('[CALCULATE-ORDER] Cálculo exitoso:', {
                subtotal,
                shippingCost,
                couponDiscount,
                total,
                productsCount: calculatedProducts.length
            });

            return ctx.send({
                success: true,
                data: orderSummary
            });

        } catch (error) {
            console.error('[CALCULATE-ORDER] Error:', error);
            return ctx.internalServerError('Error interno del servidor');
        }
    }
};

// Función auxiliar para verificar si el usuario ya usó un cupón
async function checkIfUserUsedCoupon(userId, couponId) {
    try {
        // TEMPORALMENTE DESHABILITADO - el campo used_by_users no existe aún en el modelo
        // Esta validación solo se debe hacer al completar la compra, no durante el cálculo
        console.log(`[CALC-COUPON] SKIP validación de uso previo para usuario ${userId} y cupón ${couponId}`);
        return false; // Permitir uso durante cálculo
        
        /* CÓDIGO COMENTADO - PARA HABILITAR CUANDO EL MODELO TENGA EL CAMPO
        // Buscar el cupón con la relación used_by_users poblada
        const coupon = await strapi.entityService.findOne('api::coupon.coupon', couponId, {
            populate: { used_by_users: true }
        });
        
        if (!coupon || !coupon.used_by_users) {
            return false;
        }
        
        // Verificar si el usuario está en la lista de usuarios que ya usaron el cupón
        const hasUsed = coupon.used_by_users.some(user => user.id === parseInt(userId));
        
        console.log(`[CALC-COUPON] Usuario ${userId} ${hasUsed ? 'YA USRÓ' : 'NO HA USADO'} el cupón ${couponId}`);
        return hasUsed;
        */
    } catch (error) {
        console.error('Error verificando uso de cupón:', error);
        return false; // En caso de error, permitir el uso
    }
}
