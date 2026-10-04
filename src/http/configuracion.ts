/*
 * La configuración del arranque, leída del entorno y validada ANTES de
 * escuchar. Lo que falta o está mal no arranca: un servidor a medio configurar
 * que sí arranca es el que termina en producción.
 */

export interface Configuracion {
  secretoSesion: string;
  versionTerminos: string;
  /** La versión publicada es PROVISIONAL-<fecha> y alguien autorizó arrancar así. */
  terminosProvisionales: boolean;
  /** A quién escribirle mientras los términos sean provisionales; null con términos de verdad. */
  contactoTerminos: string | null;
  /** Direcciones o subredes del proxy cuyo X-Forwarded-For se cree; null si no hay proxy. */
  proxiesDeConfianza: string[] | null;
}

const PREFIJO_PROVISIONAL = 'PROVISIONAL-';

function obligatoria(entorno: Record<string, string | undefined>, nombre: string, para: string): string {
  const valor = entorno[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}: ${para}. La API no arranca sin ella.`);
  return valor;
}

/**
 * Términos provisionales (04 §7). Mientras el texto de los términos y de la
 * política de tratamiento no exista, la versión publicada se llama
 * PROVISIONAL-<fecha>, para reconocerla después. La API se NIEGA a arrancar
 * con ella salvo que TERMINOS_PROVISIONALES=si esté escrito a mano: olvidarse
 * de configurar algo no arranca, y arrancar con términos de mentira exige que
 * alguien lo haya decidido. No depende de NODE_ENV, que es fácil de no fijar.
 *
 * Cuando se publiquen los de verdad, la provisional pasa a ser una versión
 * vieja, y el 409 «los términos cambiaron» del registro le pide a quien firmó
 * contra ella que acepte otra vez. Una firma contra un texto que no existía no
 * es un consentimiento; no hace falta tratarla aparte.
 *
 * Proxy (04 §8). trustProxy NUNCA es true: con true, Fastify cree cualquier
 * X-Forwarded-For, y si la aplicación es alcanzable sin pasar por el proxy,
 * un cliente escribe la IP que quiera y el límite de intentos por IP deja de
 * existir. Se confía solo en la dirección o la subred del proxy concreto.
 */
export function leerConfiguracion(entorno: Record<string, string | undefined>): Configuracion {
  const secretoSesion = obligatoria(entorno, 'SESSION_SECRET', 'firma la cookie de sesión (04 §8.1)');
  const versionTerminos = obligatoria(
    entorno,
    'VERSION_TERMINOS',
    'la versión de los términos y la política de datos que se publican (04 §7)',
  );

  const esProvisional = versionTerminos.startsWith(PREFIJO_PROVISIONAL);
  let contactoTerminos: string | null = null;
  if (esProvisional) {
    if (entorno.TERMINOS_PROVISIONALES !== 'si') {
      throw new Error(
        `VERSION_TERMINOS=${versionTerminos} es provisional: el texto de los términos todavía no existe. ` +
          'La API no arranca así salvo que se autorice por escrito con TERMINOS_PROVISIONALES=si, ' +
          'y nunca en una instalación con clientes reales.',
      );
    }
    contactoTerminos = obligatoria(
      entorno,
      'CONTACTO_TERMINOS',
      'a quién escribirle mientras los términos sean provisionales',
    );
  }

  let proxiesDeConfianza: string[] | null = null;
  const proxies = entorno.PROXIES_DE_CONFIANZA?.trim();
  if (proxies) {
    if (/^(true|si|\*)$/i.test(proxies)) {
      throw new Error(
        'PROXIES_DE_CONFIANZA no puede ser «true»: Fastify creería cualquier X-Forwarded-For, y si la ' +
          'aplicación es alcanzable sin pasar por el proxy, el límite de intentos por IP deja de existir. ' +
          'Escriba la dirección o la subred del proxy (por ejemplo 10.0.0.5 o 172.16.0.0/12).',
      );
    }
    proxiesDeConfianza = proxies.split(',').map((p) => p.trim()).filter(Boolean);
  }

  return {
    secretoSesion,
    versionTerminos,
    terminosProvisionales: esProvisional,
    contactoTerminos,
    proxiesDeConfianza,
  };
}

/**
 * El texto de la página de términos mientras sea provisional. Sin cláusulas, a
 * propósito: ni numeración, ni encabezados, nada que se pueda leer como un
 * borrador. Un aviso encima de cláusulas plausibles se pasa de largo y el
 * texto queda; una página que solo dice que el texto no existe no se puede
 * confundir con unos términos.
 */
export function textoProvisional(contacto: string): string {
  return (
    'El texto de los términos de uso y de la política de tratamiento de datos personales todavía no existe, ' +
    'y esta instalación no es para uso real: no registre en ella datos de una empresa ni de personas. ' +
    `Para cualquier consulta, escriba a ${contacto}.`
  );
}
