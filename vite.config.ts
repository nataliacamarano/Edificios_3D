import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:file` (modo "file") genera un único index.html autocontenido en dist-file/,
// con el JS, el CSS y la foto del plano incrustados, para abrirlo con doble clic (file://).
export default defineConfig(({ mode }) =>
  mode === 'file'
    ? {
        plugins: [react(), viteSingleFile()],
        base: './',
        build: { outDir: 'dist-file', assetsInlineLimit: Number.MAX_SAFE_INTEGER, chunkSizeWarningLimit: 4000 },
      }
    : {
        plugins: [react()],
        // Rutas relativas: la versión web funciona en la raíz de un dominio o en una subcarpeta
        // (GitHub Pages la publica en /<repositorio>/)
        base: './',
        // Las carpetas de compilación y del instalador no se vigilan (Windows las bloquea al generarlas)
        server: { port: 5173, watch: { ignored: ['**/release/**', '**/dist/**', '**/dist-file/**'] } },
        build: { chunkSizeWarningLimit: 1500 },
      },
);
