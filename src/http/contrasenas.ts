import { randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/*
 * Argon2id con los parámetros del documento 04 §8.2: el piso que recomienda
 * OWASP, no un techo. PostgreSQL no sabe calcularlo, así que vive aquí.
 *
 * Dos reglas pegadas a estos números, y sin ellas los números no sirven:
 *
 *  · El hash falso que se verifica cuando el correo no existe se hace con
 *    ESTA MISMA constante. Si se separan, el tiempo de respuesta vuelve a
 *    delatar qué correos tienen cuenta.
 *  · Al ingresar, un hash hecho con parámetros viejos se rehace con estos
 *    (necesitaRehash). Si no, subir los números solo protege a los nuevos.
 */
export interface ParametrosArgon2 {
  memoria: number;
  iteraciones: number;
  paralelismo: number;
  salida: number;
  sal: number;
}

export const PARAMETROS_ARGON2: Readonly<ParametrosArgon2> = Object.freeze({
  /** KiB de memoria por hilo. */
  memoria: 19456,
  iteraciones: 2,
  paralelismo: 1,
  /** Bytes de salida. */
  salida: 32,
  /** Bytes de sal. */
  sal: 16,
});

export async function hashearContrasena(contrasena: string): Promise<string> {
  return hash(contrasena, {
    algorithm: Algorithm.Argon2id,
    memoryCost: PARAMETROS_ARGON2.memoria,
    timeCost: PARAMETROS_ARGON2.iteraciones,
    parallelism: PARAMETROS_ARGON2.paralelismo,
    outputLen: PARAMETROS_ARGON2.salida,
    salt: randomBytes(PARAMETROS_ARGON2.sal),
  });
}

/** Bytes que representa un trozo en base64 sin relleno, como los escribe el formato PHC. */
function bytesDeBase64(trozo: string): number {
  return Math.floor((trozo.length * 3) / 4);
}

/**
 * Los parámetros con que se hizo un hash, leídos del propio hash: Argon2 los
 * guarda en él ($argon2id$v=19$m=…,t=…,p=…$sal$salida). Null si no tiene esa
 * forma.
 */
export function parametrosDelHash(hashGuardado: string): ParametrosArgon2 | null {
  const partes = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(hashGuardado);
  if (!partes) return null;
  return {
    memoria: Number(partes[1]),
    iteraciones: Number(partes[2]),
    paralelismo: Number(partes[3]),
    salida: bytesDeBase64(partes[5]!),
    sal: bytesDeBase64(partes[4]!),
  };
}

/** ¿Este hash se hizo con otros parámetros que los de hoy? Entonces se rehace al ingresar (04 §8.2). */
export function necesitaRehash(hashGuardado: string): boolean {
  const parametros = parametrosDelHash(hashGuardado);
  if (!parametros) return true;
  return (Object.keys(PARAMETROS_ARGON2) as Array<keyof ParametrosArgon2>).some(
    (clave) => parametros[clave] !== PARAMETROS_ARGON2[clave],
  );
}

let hashFalso: Promise<string> | undefined;

/**
 * El hash contra el que se verifica cuando el correo no existe. Se hace una
 * sola vez, con la misma constante que los reales, sobre una contraseña al
 * azar que nadie conoce.
 */
function elHashFalso(): Promise<string> {
  hashFalso ??= hashearContrasena(randomBytes(32).toString('hex'));
  return hashFalso;
}

/** Solo para la prueba que comprueba que el hash falso y los reales comparten parámetros. */
export const HASH_FALSO_PARA_PRUEBAS = elHashFalso;

/**
 * Verifica una contraseña. Con `hashGuardado` null —el correo no existe— hace
 * igual un Argon2 completo contra el hash falso y responde falso: así «no
 * existe» y «existe con otra contraseña» tardan lo mismo. Un usuario
 * PENDIENTE (también sin hash) NO debe llegar aquí: tiene su propio aviso, y
 * esa concesión está escrita en el 04 §8.2.
 */
export async function verificarContrasena(hashGuardado: string | null, contrasena: string): Promise<boolean> {
  if (hashGuardado === null) {
    await verify(await elHashFalso(), contrasena);
    return false;
  }
  try {
    return await verify(hashGuardado, contrasena);
  } catch {
    // Un hash ilegible no es una contraseña correcta.
    return false;
  }
}
