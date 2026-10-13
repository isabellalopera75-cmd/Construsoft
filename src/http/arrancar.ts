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
 *                     Es el nombre exacto de una carpeta de legal/ con su
 *                     legal.html; sin ella no arranca. Mientras el texto no
 *                     pase por un abogado: PROVISIONAL-<fecha>, y entonces la
 *                     API solo arranca con TERMINOS_PROVISIONALES=si y
 *                     CONTACTO_TERMINOS (a quién escribir).
 *   PROXIES_DE_CONFIANZA  opcional; direcciones o subredes del proxy, separadas
 *                     por comas. Nunca «true» (ver configuracion.ts).
 *   PUERTO            opcional; 3000 por defecto.
 *
 * Además, las de las tres conexiones a la base (APP_DB_*, AUTH_DB_* y, para el
 * panel del superadministrador, SUPERADMIN_DB_*), que leen los módulos de la
 * capa de datos. La del panel se abre recién la primera vez que alguien entra
 * a /api/superadmin, o cuando corre la purga.
 *
 * La purga diaria (CONTRATO §15.5) corre aquí, a las 00:05 de Bogotá, por la
 * conexión del panel: es la única a la que la base le concede
 * fn_purgar_empresas. Lo que elimina queda en este registro y, en la base,
 * como un evento TENANT_ELIMINADO. Para correrla a mano: npm run purgar.
 */
import { purgarEmpresas } from '../infraestructura/basedatos/plataforma.js';
import { programarPurgaDiaria } from '../purga/purgaDiaria.js';
import { leerConfiguracion } from './configuracion.js';
import { construirServidor } from './servidor.js';

// Lo que falta o está mal se rechaza aquí, antes de escuchar.
const configuracion = leerConfiguracion(process.env);
const app = await construirServidor(configuracion);
if (configuracion.terminosProvisionales) {
  console.warn(`⚠ Términos PROVISIONALES (${configuracion.versionTerminos}): esta instalación no es para uso real.`);
}
const puerto = Number(process.env.PUERTO ?? 3000);
await app.listen({ port: puerto, host: '127.0.0.1' });
console.log(`→ API de Construsoft escuchando en http://127.0.0.1:${puerto}`);
programarPurgaDiaria({ purgar: purgarEmpresas, avisar: (texto) => console.log(`[${new Date().toISOString()}] ${texto}`) });
