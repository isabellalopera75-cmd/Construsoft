/**
 * Genera el enlace de activación de una cuenta invitada (CONTRATO §11.4).
 *
 *     npm run activacion -- correo@empresa.com
 *
 * Lo corre el dueño de ConstruSoft, contra la base que diga su .env, y le pasa
 * el enlace a la persona invitada. Solo para cuentas PENDIENTE; vence a las 72
 * horas y anula cualquier enlace de activación anterior de esa persona.
 *
 *   URL_ACTIVACION  opcional: el comienzo del enlace de la pantalla de
 *                   activación, al que se le pega el token. Sin ella, se
 *                   imprime solo el token.
 *                   Va ENTRE COMILLAS en el .env: sin ellas, el «#» de la
 *                   dirección empieza un comentario y la corta.
 */
import { prepararEnlaceDeActivacion } from './enlaceDeActivacion.js';

const correo = process.argv[2]?.trim();
if (!correo) {
  console.error('Indique el correo de la cuenta invitada:  npm run activacion -- correo@empresa.com');
  process.exit(1);
}

try {
  const { token, expiraEn } = await prepararEnlaceDeActivacion(correo);
  const prefijo = process.env.URL_ACTIVACION?.trim();
  if (prefijo && !prefijo.endsWith('token=')) {
    // En el .env, «#» empieza un comentario: sin comillas, la dirección queda
    // cortada en «http://localhost:5173/» y el enlace abre la página de inicio.
    console.error(
      `URL_ACTIVACION quedó como «${prefijo}»: le falta el final «…token=». En el .env ponga el valor entre comillas, ` +
        'porque el «#» empieza un comentario.',
    );
    process.exit(1);
  }
  console.log(prefijo ? `→ Enlace de activación: ${prefijo}${token}` : `→ Token de activación: ${token}`);
  console.log(`  Vence: ${new Date(expiraEn).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (hora de Bogotá).`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
