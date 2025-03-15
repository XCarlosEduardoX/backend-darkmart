const { getPlaiceholder } = require('plaiceholder');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function generateBlurDataURL(imageUrl, imageId) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(response.data, 'binary');
    const { base64 } = await getPlaiceholder(buffer);
    //guardar el base64 en un archivo local.
    // fs.writeFileSync(path.join(__dirname, `${imageId}.txt`), base64);
    // console.log(`blurDataURL generado para ${imageId}`);
    return base64;
  } catch (error) {
    console.error(`Error al generar blurDataURL para ${imageUrl}:`, error);
    return null;
  }
}

module.exports = {
  generateBlurDataURL,
};