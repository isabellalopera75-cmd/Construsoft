import { Pool } from 'pg';
import { leerEnvObligatoria } from './env.js';

/**
 * Pool de conexiones como auth_login (grupo construsoft_autenticador).
 *
 * Esta conexión atiende peticiones SIN autenticar (D-46): resolver un correo
 * o un token antes de que exista cualquier contexto de inquilino. Por eso
 * este módulo NUNCA llama a set_config ni abre una transacción con
 * app.tenant_id/app.usuario_id — no hay contexto que fijar todavía. Ese
 * contexto lo fija después ejecutarComoTenant (contextoTenant.ts), con los
 * valores que este módulo le entrega.
 *
 * Y por la misma razón no expone un cliente genérico como ClienteEnContexto:
 * solo dos funciones, cada una atada a UNA de las dos funciones que
 * construsoft_autenticador puede ejecutar (D-50). Ampliar esta conexión más
 * allá de eso es exactamente el error que D-50 cerró.
 */
const pool = new Pool({
  host: leerEnvObligatoria('AUTH_DB_HOST'),
  port: Number(leerEnvObligatoria('AUTH_DB_PORT')),
  database: leerEnvObligatoria('AUTH_DB_NAME'),
  user: leerEnvObligatoria('AUTH_DB_USER'),
  password: leerEnvObligatoria('AUTH_DB_PASSWORD'),
});

/** Estados posibles de app.usuario.estado (CHECK de la tabla). */
export type EstadoUsuario = 'PENDIENTE' | 'ACTIVO' | 'REVOCADO';

/** Lo que devuelve app.fn_autenticar: de acá salen tenantId y usuarioId para ejecutarComoTenant. */
export interface UsuarioAutenticado {
  usuarioId: string;
  tenantId: string;
  rolId: string;
  nombre: string;
  /**
   * Hash Argon2id. El backend lo compara; Postgres no sabe calcularlo. Null en
   * un usuario PENDIENTE: nace sin contraseña y la elige al consumir su enlace.
   */
  passwordHash: string | null;
  estado: EstadoUsuario;
  /**
   * D-67 · El sello de credenciales: lo mueve tg_usuario_credenciales cada vez
   * que cambia la contraseña. La cookie de sesión lo lleva desde el ingreso, y
   * una cookie con un sello viejo ya no vale.
   */
  credencialesEn: Date;
}

/** Lo que devuelve app.fn_resolver_token. */
export interface TokenResuelto {
  tokenId: string;
  usuarioId: string;
  tenantId: string;
  expiraEn: Date;
  usadoEn: Date | null;
  anuladoEn: Date | null;
}

interface FilaAutenticar {
  usuario_id: string;
  tenant_id: string;
  rol_id: string;
  nombre: string;
  password_hash: string | null;
  estado: EstadoUsuario;
  credenciales_en: Date;
}

interface FilaResolverToken {
  token_id: string;
  usuario_id: string;
  tenant_id: string;
  expira_en: Date;
  usado_en: Date | null;
  anulado_en: Date | null;
}

/**
 * Resuelve un correo a su usuario (RF-AUT-04). Devuelve `null` si no existe
 * — nunca lanza por "no encontrado": no hay nada que distinga ese caso de
 * cualquier otro correo inexistente, que es justo el punto (D-46: no sirve
 * para enumerar usuarios).
 */
export async function autenticar(email: string): Promise<UsuarioAutenticado | null> {
  const { rows } = await pool.query<FilaAutenticar>('SELECT * FROM app.fn_autenticar($1)', [
    email,
  ]);
  const fila = rows[0];
  if (!fila) return null;
  return {
    usuarioId: fila.usuario_id,
    tenantId: fila.tenant_id,
    rolId: fila.rol_id,
    nombre: fila.nombre,
    passwordHash: fila.password_hash,
    estado: fila.estado,
    credencialesEn: fila.credenciales_en,
  };
}

/**
 * Resuelve un token de recuperación/activación a su usuario (RF-AUT-06..09).
 * Recibe el HASH del token, nunca el token en claro — igual que
 * app.fn_resolver_token. Devuelve `null` si no existe.
 */
export async function resolverToken(tokenHash: string): Promise<TokenResuelto | null> {
  const { rows } = await pool.query<FilaResolverToken>(
    'SELECT * FROM app.fn_resolver_token($1)',
    [tokenHash],
  );
  const fila = rows[0];
  if (!fila) return null;
  return {
    tokenId: fila.token_id,
    usuarioId: fila.usuario_id,
    tenantId: fila.tenant_id,
    expiraEn: fila.expira_en,
    usadoEn: fila.usado_en,
    anuladoEn: fila.anulado_en,
  };
}
