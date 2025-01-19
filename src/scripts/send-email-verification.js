module.exports = async (strapi) => {
    strapi.db.lifecycles.subscribe({
        models: ["plugin::users-permissions.user"],

        // Send email to new user
        async afterCreate({ params }) {
            const {
                data: { email, username },
            } = params;

            try {
                await strapi.plugins['email'].services.email.send({
                    to: email,
                    from: "noreply@everblack.store",
                    cc: 'noreply@everblack.store',
                    bcc: 'noreply@everblack.store',
                    subject: `Bienvenido a EverBlack`,
                    html: `<div>
                        <h2>Hola ${username},</h2>
                        <p>Gracias por registrarte en EverBlack.</p>
                        <p>Para completar tu registro, por favor verifica tu correo electrónico haciendo clic en el siguiente enlace:</p>
                        <a href="${process.env.CLIENT_URL}/verify-email?token=${params.data.verifyEmailToken}">Verificar correo electrónico</a>
        
                    </div>`,
                });
            
            } catch (err) {
                console.log(err);
            }
        },
    });
};
