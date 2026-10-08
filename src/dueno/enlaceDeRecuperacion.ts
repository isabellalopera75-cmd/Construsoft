import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { emitirTokenRecuperacion } from '../infraestructura/basedatos/contextoTenant.js';
import { generarToken } from '../http/tokens.js';

/*
 * El enlace de recuperación que el dueño entrega a mano (04 §8.5) mientras no
 * hay correo (fase 8). El token viaja solo en lo que devuelve esta función,
 * que el dueño le pasa a la persona por un canal que ya la identifique; la
 * base guarda únicamente su hash.
 */

export interface EnlaceDeRecuperacion {
  token: string;
  expiraEn: string;
}

export async function prepararEnlaceDeRecuperacion(correo: string): Promise<EnlaceDeRecuperacion> {
  const usuario = await autenticar(correo);
  if (!usuario) throw new Error(`No hay ninguna cuenta con el correo ${correo}. Revise que esté bien escrito.`);
  if (usuario.estado === 'PENDIENTE') {
    throw new Error(
      'Esa cuenta todavía no está activa: necesita un enlace de ACTIVACIÓN, no de recuperación, y ese flujo no existe todavía.',
    );
  }
  if (usuario.estado === 'REVOCADO') {
    throw new Error('Esa cuenta está revocada: la restablece un administrador de su empresa, no un enlace de recuperación.');
  }
  const { token, hash } = generarToken();
  const { expiraEn } = await emitirTokenRecuperacion({ tenantId: usuario.tenantId, usuarioId: usuario.usuarioId }, hash, 'RECUPERACION');
  return { token, expiraEn };
}
