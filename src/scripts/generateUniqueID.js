function generateUniqueID() {
    const now = new Date();

    // Obtener los componentes de la fecha y hora
    const year = now.getFullYear(); // Año
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Mes (con 2 dígitos)
    const day = String(now.getDate()).padStart(2, '0'); // Día (con 2 dígitos)
    const hour = String(now.getHours()).padStart(2, '0'); // Hora (con 2 dígitos)
    const minute = String(now.getMinutes()).padStart(2, '0'); // Minuto (con 2 dígitos)
    const second = String(now.getSeconds()).padStart(2, '0'); // Segundo (con 2 dígitos)
    const millisecond = String(now.getMilliseconds()).padStart(3, '0'); // Milisegundos (con 3 dígitos)

    // Concatenar todo en un solo número
    const dateNumber = `${year}${month}${day}${hour}${minute}${second}${millisecond}`;


    return dateNumber;
}

module.exports = generateUniqueID;