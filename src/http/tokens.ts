import { createHash, randomBytes } from 'node:crypto';

/*
 * Tokens de activación, recuperación y restablecimiento (app.token_recuperacion).
 * La base guarda el HASH, nunca el token. El esquema no fija el algoritmo; se
 * fija aquí, en un solo lugar, porque el que emite un enlace y el que lo
 * consume tienen que coincidir:
 *
 *   token = 32 bytes aleatorios, en base64url (va en el enlace)
 *   hash  = SHA-256 del token, en hexadecimal (va en la base)
 *
 * SHA-256 y no Argon2: un token de 256 bits aleatorios no se adivina por
 * fuerza bruta, así que no necesita un hash lento como el de una contraseña
 * elegida por una persona. Lo que sí lo protege de una serie de intentos es el
 * límite de intentos de la ruta que lo consume.
 */

export function generarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDeToken(token) };
}

export function hashDeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
