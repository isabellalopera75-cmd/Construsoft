import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/*
 * El proxy existe por la cookie, no por comodidad. La sesión viaja en una
 * cookie HttpOnly con SameSite=Strict (04 §8.1): si el navegador cargara la
 * interfaz desde un origen y la API desde otro, no la mandaría nunca y toda
 * petición respondería 401. Con el proxy, para el navegador todo sale del
 * mismo origen, que es además como se va a desplegar.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // El formateador de cifras es compartido con el PDF y el Excel: un
      // segundo formateador haría que el mismo número se viera distinto en la
      // pantalla y en la oferta. Cuando el archivo se mueva a src/comun/,
      // cambia esta línea y nada más.
      '@compartido/formatoNumerico': fileURLToPath(
        new URL('../src/comun/formatoNumerico.ts', import.meta.url),
      ),
    },
  },
  build: {
    /*
     * Vite borra dist/ antes de compilar, y en este entorno el borrado dentro
     * de la carpeta del proyecto no está permitido: la compilación moría con
     * «Operation not permitted» en cuanto dist/ ya existía. Apagarlo deja
     * archivos viejos acumulados ahí, que es inofensivo porque Vite pone un
     * hash en cada nombre y el index.html solo referencia los nuevos; dist/
     * está además en .gitignore. Quien despliegue limpia la carpeta de destino
     * de su lado, que es donde corresponde.
     */
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
    fs: { allow: ['..'] },
  },
});
