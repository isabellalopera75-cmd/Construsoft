/**
 * Genera el enlace de recuperación de contraseña de una cuenta (04 §8.5).
 *
 *     npm run enlace -- correo@empresa.com
 *
 * Lo corre el dueño, contra la base que diga su .env, y le pasa el enlace a
 * la persona por un canal que ya la identifique. Vence a los 30 minutos y
 * anula cualquier enlace anterior de esa cuenta.
 *
 *   URL_RECUPERACION  opcional: el comienzo del enlace de la pantalla de
 *                     recuperación, al que se le pega el token. Sin ella, se
 *                     imprime solo el token.
 *                   Va ENTRE COMILLAS en el .env: sin ellas, el «#» de la
 *                   dirección empieza un comentario y la corta.
 */
import { prepararEnlaceDeRecuperacion } from './enlaceDeRecuperacion.js';

const correo = process.argv[2]?.trim();
if (!correo) {
  console.error('Indique el correo de la cuenta:  npm run enlace -- correo@empresa.com');
  process.exit(1);
}

try {
  const { token, expiraEn } = await prepararEnlaceDeRecuperacion(correo);
  const prefijo = process.env.URL_RECUPERACION?.trim();
  if (prefijo && !prefijo.endsWith('token=')) {
    // En el .env, «#» empieza un comentario: sin comillas, la dirección queda
    // cortada en «http://localhost:5173/» y el enlace abre la página de inicio.
    console.error(
      `URL_RECUPERACION quedó como «${prefijo}»: le falta el final «…token=». En el .env ponga el valor entre comillas, ` +
        'porque el «#» empieza un comentario.',
    );
    process.exit(1);
  }
  console.log(prefijo ? `→ Enlace: ${prefijo}${token}` : `→ Token de recuperación: ${token}`);
  console.log(`  Vence: ${new Date(expiraEn).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (hora de Bogotá).`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
