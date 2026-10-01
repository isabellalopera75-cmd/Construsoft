import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';

/*
 * La sesión (documento 04 §8.1): una cookie firmada, sin tabla de sesiones.
 * Lleva la empresa, el usuario, el sello de credenciales del ingreso (D-67) y
 * su vencimiento. La firma la pone @fastify/cookie con SESSION_SECRET; lo que
 * hay aquí es qué va adentro y cómo se lee.
 */

export const NOMBRE_COOKIE = 'construsoft_sesion';

/** 8 horas (04 §8.1). */
export const DURACION_SESION_MS = 8 * 60 * 60 * 1000;

/**
 * Atributos de la cookie.
 *
 * SameSite=Strict queda CON FECHA DE REVISIÓN (04 §8.1): cuando la fase 8
 * mande los avisos de cambio de estado por correo (D-27), el primer clic desde
 * esos correos llegará sin cookie y el usuario se verá como si no hubiera
 * entrado; probablemente haya que pasar a Lax. El enlace de recuperación no
 * sufre eso: su página no necesita sesión, el token viaja en la URL.
 */
export const ATRIBUTOS_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: DURACION_SESION_MS / 1000,
  signed: true,
} as const;

export interface DatosDeSesion {
  tenantId: string;
  usuarioId: string;
  /** El sello de credenciales del ingreso, texto exacto (D-67). */
  sello: string;
  /** Instante de vencimiento, en ms desde 1970. */
  venceEn: number;
}

export function armarSesion(contexto: ContextoTenant, sello: string, ahora: number): string {
  const datos: DatosDeSesion = { ...contexto, sello, venceEn: ahora + DURACION_SESION_MS };
  return Buffer.from(JSON.stringify(datos), 'utf8').toString('base64url');
}

/**
 * Lee el contenido de una cookie YA verificada por su firma. Null si no tiene
 * la forma esperada o si venció: el vencimiento se comprueba aquí, en el
 * servidor, y no se confía en que el navegador haya borrado la cookie.
 */
export function leerSesion(valor: string, ahora: number): DatosDeSesion | null {
  try {
    const datos = JSON.parse(Buffer.from(valor, 'base64url').toString('utf8')) as Partial<DatosDeSesion>;
    if (
      typeof datos.tenantId !== 'string' ||
      typeof datos.usuarioId !== 'string' ||
      typeof datos.sello !== 'string' ||
      typeof datos.venceEn !== 'number'
    ) {
      return null;
    }
    if (datos.venceEn <= ahora) return null;
    return datos as DatosDeSesion;
  } catch {
    return null;
  }
}
