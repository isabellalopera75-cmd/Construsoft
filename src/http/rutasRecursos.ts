import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { listarUnidadesParaElegir, type UnidadMedida } from '../infraestructura/basedatos/configuracionEmpresa.js';
import {
  actualizarRecurso,
  crearRecurso,
  eliminarRecurso,
  leerRecurso,
  listarPresupuestosAfectados,
  listarRecursos,
  type Recurso,
} from '../infraestructura/basedatos/recurso.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS, decimalComoTexto } from './validacion.js';

/*
 * El módulo Recursos (02 §5). El precio complementario lo calcula la
 * interfaz mientras se escribe (RF-REC-09) y la base comprueba que los dos
 * cuadren para la vía declarada (ck_recurso_precios_cuadran): aquí no se
 * hace ninguna cuenta.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const TIPO = z.enum(
  ['MATERIAL', 'EQUIPO', 'PERSONAL', 'ACTIVIDAD_TODO_COSTO'],
  'Elija el tipo: material, equipo, personal o actividad a todo costo.',
);
const PRECIO = decimalComoTexto(18, 'El precio', 'Escriba un precio mayor o igual a cero, con punto decimal y hasta seis decimales.');
const IVA = decimalComoTexto(3, 'El IVA', 'Escriba el IVA en puntos, con punto decimal: 19 o 5.');

const camposDelRecurso = {
  nombre: z.string('Escriba el nombre.').trim().min(1, 'Escriba el nombre.'),
  tipo: TIPO,
  unidadId: z.string('Elija una unidad de medida.').regex(UUID, 'Elija una unidad de medida.'),
  precioBase: PRECIO,
  // RF-REC-08: el IVA es opcional; vacío es 0 % y los dos precios coinciden.
  ivaPct: IVA.optional(),
  precioTotal: PRECIO,
  viaCaptura: z.enum(['BASE', 'TOTAL'], 'Indique por cuál precio se capturó: el base o el total.'),
};

const esquemaRecurso = z.strictObject(camposDelRecurso, SIN_CAMPOS_DE_MAS);

const esquemaEdicion = z.strictObject(
  {
    ...camposDelRecurso,
    // 02 §5.3: los presupuestos abiertos que la persona eligió actualizar.
    presupuestosAReapuntar: z.array(z.string().regex(UUID, 'Elija los presupuestos de la lista.')).optional(),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaFiltros = z.object({
  tipo: TIPO.optional(),
  texto: z.string().optional(),
  unidadId: z.string().regex(UUID, 'Elija una unidad de medida.').optional(),
  precioMin: PRECIO.optional(),
  precioMax: PRECIO.optional(),
});

export function registrarRutasDeRecursos(app: FastifyInstance, sesionDe: SesionDe): void {
  // El mismo texto que da la capa de datos para un recurso que no existe: un
  // id ajeno, uno inexistente y algo que ni es un id responden IGUAL (RN-01).
  const recursoNoExiste = () => new ErrorParaElUsuario('El recurso no existe en esta empresa.', 'NO_EXISTE');

  /** El recurso con el símbolo de su unidad, que es lo que muestra la tabla. */
  const conSimbolo = (r: Recurso, unidades: UnidadMedida[]) => ({
    ...r,
    unidadSimbolo: unidades.find((u) => u.id === r.unidadId)?.simbolo ?? '',
  });

  /**
   * Las unidades de la empresa, y la elegida tiene que estar entre ellas. Una
   * unidad que no está es un dato del formulario, con su campo: sin esto
   * llegaría a la base como una llave foránea rota.
   */
  async function unidadesExigiendo(contexto: ContextoTenant, unidadId: string): Promise<UnidadMedida[]> {
    const unidades = await listarUnidadesParaElegir(contexto, 'RECURSOS.VER');
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

  async function recursoExistente(contexto: ContextoTenant, id: string): Promise<Recurso> {
    const recurso = UUID.test(id) ? await leerRecurso(contexto, id) : null;
    if (!recurso) throw recursoNoExiste();
    return recurso;
  }

  // --- Las unidades, para los selectores de Recursos ---------------------------
  app.get('/api/unidades', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.send({ unidades: await listarUnidadesParaElegir(contexto, 'RECURSOS.VER') });
  });

  // --- 02 §5.1 · La vista maestra: pestañas, búsqueda y filtros ---------------
  // Con texto, el filtro por pestaña se rompe… salvo que la pestaña venga
  // explícita en el pedido: entonces la interfaz pidió las dos cosas.
  app.get('/api/recursos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const filtros = esquemaFiltros.parse(request.query);
    const [recursos, unidades] = await Promise.all([
      listarRecursos(contexto, {
        ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
        ...(filtros.texto?.trim() ? { texto: filtros.texto } : {}),
        ...(filtros.unidadId ? { unidadId: filtros.unidadId } : {}),
        ...(filtros.precioMin ? { precioMin: filtros.precioMin } : {}),
        ...(filtros.precioMax ? { precioMax: filtros.precioMax } : {}),
      }),
      listarUnidadesParaElegir(contexto, 'RECURSOS.VER'),
    ]);
    return reply.send({ recursos: recursos.map((r) => conSimbolo(r, unidades)) });
  });

  app.get<{ Params: { id: string } }>('/api/recursos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const recurso = await recursoExistente(contexto, request.params.id);
    return reply.send(conSimbolo(recurso, await listarUnidadesParaElegir(contexto, 'RECURSOS.VER')));
  });

  // --- 02 §5.2 · Crear: el código lo pone el servidor --------------------------
  app.post('/api/recursos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaRecurso.parse(request.body);
    const unidades = await unidadesExigiendo(contexto, datos.unidadId);
    const recurso = await crearRecurso(contexto, { ...datos, ivaPct: datos.ivaPct ?? '0' });
    return reply.code(201).send(conSimbolo(recurso, unidades));
  });

  // --- 02 §5.3 · La pregunta antes de guardar un cambio de precio --------------
  app.get<{ Params: { id: string } }>('/api/recursos/:id/presupuestos-afectados', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    await recursoExistente(contexto, request.params.id);
    return reply.send({ presupuestos: await listarPresupuestosAfectados(contexto, request.params.id) });
  });

  // --- 02 §5.3 · Editar: siempre versión nueva de cada APU afectado (D-22) ------
  app.put<{ Params: { id: string } }>('/api/recursos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { presupuestosAReapuntar, ...datos } = esquemaEdicion.parse(request.body);
    if (!UUID.test(request.params.id)) throw recursoNoExiste();
    const unidades = await unidadesExigiendo(contexto, datos.unidadId);
    const { recurso, apusVersionados } = await actualizarRecurso(
      contexto,
      request.params.id,
      { ...datos, ivaPct: datos.ivaPct ?? '0' },
      presupuestosAReapuntar,
    );
    return reply.send({ recurso: conSimbolo(recurso, unidades), apusVersionados });
  });

  // --- 02 §5.4 · Eliminar: solo si ningún APU lo usa; si no, la base dice dónde -
  app.delete<{ Params: { id: string } }>('/api/recursos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    await recursoExistente(contexto, request.params.id);
    await eliminarRecurso(contexto, request.params.id);
    return reply.code(204).send();
  });
}
