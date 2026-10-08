import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { emitirTokenRecuperacion } from '../infraestructura/basedatos/contextoTenant.js';
import { generarToken } from '../http/tokens.js';

/*
 * El enlace de activación que el dueño de ConstruSoft entrega a mano
 * (CONTRATO §11.4) mientras no hay correo (fase 8). Decisión del dueño, 8 de
 * octubre de 2026: el administrador de la empresa NO ve el enlace, porque
 * quien lo tiene puede fijar la contraseña de otra persona. Vence a las 72
 * horas (RF-AUT-13) y anula el anterior de esa persona (RF-AUT-18).
 */

export async function prepararEnlaceDeActivacion(correo: string): Promise<{ token: string; expiraEn: string }> {
  const usuario = await autenticar(correo);
  if (!usuario) throw new Error(`No hay ninguna cuenta con el correo ${correo}. Revise que esté bien escrito.`);
  if (usuario.estado === 'ACTIVO') {
    throw new Error('Esa cuenta ya está activa: si olvidó la contraseña, use npm run enlace para un enlace de recuperación.');
  }
  if (usuario.estado === 'REVOCADO') {
    throw new Error('Esa cuenta está revocada: primero un administrador de su empresa tiene que restituirla.');
  }
  const { token, hash } = generarToken();
  const { expiraEn } = await emitirTokenRecuperacion({ tenantId: usuario.tenantId, usuarioId: usuario.usuarioId }, hash, 'ACTIVACION');
  return { token, expiraEn };
}
