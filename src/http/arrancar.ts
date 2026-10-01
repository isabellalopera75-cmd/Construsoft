/**
 * Arranca la API escuchando en un puerto.
 *
 *     npm run api
 *
 * Lee del entorno (.env, que escribe el dueño; ningún asistente):
 *
 *   SESSION_SECRET    la clave con que se firma la cookie de sesión (04 §8.1).
 *                     Larga y aleatoria; cambiarla cierra todas las sesiones.
 *   VERSION_TERMINOS  la versión de los términos y de la política de
 *                     tratamiento de datos que se están publicando (04 §7).
 *                     Cambiarla obliga a aceptar de nuevo en el registro.
 *   PUERTO            opcional; 3000 por defecto.
 *
 * Además, las de las dos conexiones a la base (APP_DB_* y AUTH_DB_*), que leen
 * los módulos de la capa de datos.
 */
import { leerEnvObligatoria } from '../infraestructura/basedatos/env.js';
import { construirServidor } from './servidor.js';

const app = await construirServidor({
  secretoSesion: leerEnvObligatoria('SESSION_SECRET'),
  versionTerminos: leerEnvObligatoria('VERSION_TERMINOS'),
});
const puerto = Number(process.env.PUERTO ?? 3000);
await app.listen({ port: puerto, host: '127.0.0.1' });
console.log(`→ API de Construsoft escuchando en http://127.0.0.1:${puerto}`);
