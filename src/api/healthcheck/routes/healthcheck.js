module.exports = {
    routes: [
        {
            method: 'GET',
            path: '/healthcheck',
            handler: 'healthcheck.index',
            config: {
                auth: false, // No requiere autenticación
            },
        },
    ],
};