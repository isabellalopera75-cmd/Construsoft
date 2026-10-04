import { z } from 'zod';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { listarUnidadesParaElegir, type UnidadMedida } from '../infraestructura/basedatos/configuracionEmpresa.js';

/**
 * Las unidades de la empresa, y la elegida tiene que estar entre ellas. Una
 * unidad que no está es un dato del formulario, con su campo: sin esto
 * llegaría a la base como una llave foránea rota. El permiso es el del módulo
 * cuya pantalla pide la unidad.
 */
export async function unidadesExigiendo(
  contexto: ContextoTenant,
  unidadId: string,
  permiso: 'RECURSOS.VER' | 'APU.VER',
): Promise<UnidadMedida[]> {
  const unidades = await listarUnidadesParaElegir(contexto, permiso);
  if (!unidades.some((u) => u.id === unidadId)) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['unidadId'],
        message: 'Esa unidad de medida no existe en su empresa. Elija otra de la lista.',
        input: unidadId,
      },
    ]);
  }
  return unidades;
}
