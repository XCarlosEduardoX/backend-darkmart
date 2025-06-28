const fs = require('fs');
const path = require('path');

// Función para eliminar directorios de caché
function deleteCacheDirectories() {
  const cacheDirectories = [
    '.strapi/client',
    '.cache',
    'build',
    'dist'
  ];

  cacheDirectories.forEach(dir => {
    const fullPath = path.join(__dirname, '..', dir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`Eliminado: ${dir}`);
    }
  });
}

console.log('Limpiando caché de Strapi...');
deleteCacheDirectories();
console.log('Caché limpiado. Ahora puedes reiniciar Strapi.');
