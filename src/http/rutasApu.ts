import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import {
  cambiarActivoApu,
  crearApu,
  editarApu,
  eliminarApu,
  leerApu,
  listarApus,
  listarPresupuestosDelApu,
  type Apu,
  type ResumenApu,
} from '../infraestructura/basedatos/apu.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { UUID } from './rechazo.js';
import { unidadesExigiendo } from './unidades.js';
import { SIN_CAMPOS_DE_MAS, decimalComoTexto } from './validacion.js';

/*
 * El módulo APU (02 §6). Los subtotales y el costo directo los calcula la
 * base al guardar la versión (fn_nueva_version_apu); el recálculo en tiempo
 * real mientras se escribe es de la interfaz (RF-APU). Las versiones son un
 * mecanismo interno que la persona no ve (02 §6.4): no viajan en la API.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const MINIMO = 'El mínimo es 0.000001: con seis decimales, un valor menor sería cero.';

/** 02 §6.2: cantidad y rendimiento no admiten cero; seis decimales, mínimo 0,000001. */
const FACTOR = (nombre: string) =>
  decimalComoTexto(18, nombre, `Escriba ${nombre.toLowerCase()} con punto decimal y hasta seis decimales. ${MINIMO}`).refine(
    (v) => /[1-9]/.test(v),
    `${nombre} no puede ser cero. ${MINIMO}`,
  );

const esquemaLinea = z.strictObject(
  {
    recursoId: z.string('Elija un recurso de la lista.').regex(UUID, 'Elija un recurso de la lista.'),
    cantidad: FACTOR('La cantidad'),
    rendimiento: FACTOR('El rendimiento'),
    // Solo los materiales tienen desperdicio; en los demás lo rechaza la base.
    desperdicioPct: decimalComoTexto(3, 'El desperdicio', 'Escriba el desperdicio en puntos: 5 es 5 %.').optional(),
  },
  SIN_CAMPOS_DE_MAS,
);

const camposDelApu = {
  nombre: z.string('Escriba el nombre de la actividad.').trim().min(1, 'Escriba el nombre de la actividad.'),
  unidadId: z.string('Elija una unidad de medida.').regex(UUID, 'Elija una unidad de medida.'),
  lineas: z
    .array(esquemaLinea, 'Agregue al menos una línea de recurso.')
    .min(1, 'Un APU necesita al menos una línea de recurso: sin líneas no tiene costo directo (D-21).'),
};

const esquemaApu = z.strictObject(camposDelApu, SIN_CAMPOS_DE_MAS);

const esquemaEdicion = z.strictObject(
  {
    ...camposDelApu,
    // 02 §6.4: los presupuestos abiertos que la persona eligió actualizar.
    presupuestosAReapuntar: z.array(z.string().regex(UUID, 'Elija los proyectos de la lista.')).optional(),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaActivo = z.strictObject({ activo: z.boolean('Indique si el APU queda activo o inactivo.') }, SIN_CAMPOS_DE_MAS);

const esquemaFiltros = z.object({
  texto: z.string().optional(),
  unidadId: z.string().regex(UUID, 'Elija una unidad de medida.').optional(),
});

/** La fila de la vista maestra, sin el mecanismo interno de versiones. */
function resumen(a: ResumenApu) {
  return {
    id: a.id,
    codigo: a.codigo,
    nombre: a.nombre,
    unidadId: a.unidadId,
    unidadSimbolo: a.unidadSimbolo,
    activo: a.activo,
    costoDirecto: a.costoDirecto,
  };
}

/** El APU con su composición, en el orden en que se armó. */
function detalle(a: Apu) {
  return {
    ...resumen(a),
    lineas: a.lineas.map((l) => ({
      recursoId: l.recursoId,
      recursoCodigo: l.recursoCodigo,
      recursoNombre: l.recursoNombre,
      recursoTipo: l.recursoTipo,
      unidadSimbolo: l.unidadSimbolo,
      precioUnitario: l.precioUnitario,
      cantidad: l.cantidad,
      rendimiento: l.rendimiento,
      desperdicioPct: l.desperdicioPct,
      subtotal: l.subtotal,
    })),
  };
}

const lineasConDesperdicio = (lineas: z.infer<typeof esquemaLinea>[]) =>
  lineas.map((l) => ({ ...l, desperdicioPct: l.desperdicioPct ?? '0' }));

export function registrarRutasDeApu(app: FastifyInstance, sesionDe: SesionDe): void {
  // El mismo texto que da fn_eliminar_apu: un id ajeno, uno inexistente y
  // algo que ni es un id responden IGUAL (RN-01).
  const apuNoExiste = () => new ErrorParaElUsuario('El APU no existe en esta empresa.', 'NO_EXISTE');

  async function apuExistente(contexto: ContextoTenant, id: string): Promise<Apu> {
    const apu = UUID.test(id) ? await leerApu(contexto, id) : null;
    if (!apu) throw apuNoExiste();
    return apu;
  }

  // --- 02 §6.1 · La vista maestra: búsqueda y filtro por unidad ---------------
  // Incluye los inactivos: es donde se reactivan.
  app.get('/api/apus', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const filtros = esquemaFiltros.parse(request.query);
    const apus = await listarApus(contexto, {
      ...(filtros.texto?.trim() ? { texto: filtros.texto } : {}),
      ...(filtros.unidadId ? { unidadId: filtros.unidadId } : {}),
    });
    return reply.send({ apus: apus.map(resumen) });
  });

  // --- 02 §6.3 · Consultar ------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/apus/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.send(detalle(await apuExistente(contexto, request.params.id)));
  });

  // --- 02 §6.2 · Crear: el código lo pone el servidor --------------------------
  app.post('/api/apus', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaApu.parse(request.body);
    await unidadesExigiendo(contexto, datos.unidadId, 'APU.VER');
    const apu = await crearApu(contexto, { ...datos, lineas: lineasConDesperdicio(datos.lineas) });
    return reply.code(201).send(detalle(apu));
  });

  // --- 02 §6.4 · Dónde está en uso, para la pregunta antes de guardar ----------
  // Todos, con su estado: la interfaz pregunta solo por los ABIERTOS.
  app.get<{ Params: { id: string } }>('/api/apus/:id/presupuestos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    await apuExistente(contexto, request.params.id);
    return reply.send({ presupuestos: await listarPresupuestosDelApu(contexto, request.params.id) });
  });

  // --- 02 §6.3/6.4 · Editar: siempre versión nueva; el código no cambia --------
  app.put<{ Params: { id: string } }>('/api/apus/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { presupuestosAReapuntar, ...datos } = esquemaEdicion.parse(request.body);
    await apuExistente(contexto, request.params.id);
    await unidadesExigiendo(contexto, datos.unidadId, 'APU.VER');
    const { apu, itemsReapuntados } = await editarApu(
      contexto,
      request.params.id,
      { ...datos, lineas: lineasConDesperdicio(datos.lineas) },
      presupuestosAReapuntar,
    );
    return reply.send({ apu: detalle(apu), itemsReapuntados });
  });

  // --- 02 §6.5 · Activo o inactivo --------------------------------------------
  app.patch<{ Params: { id: string } }>('/api/apus/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { activo } = esquemaActivo.parse(request.body);
    if (!UUID.test(request.params.id)) throw apuNoExiste();
    const apu = await cambiarActivoApu(contexto, request.params.id, activo);
    if (!apu) throw apuNoExiste();
    return reply.send(resumen(apu));
  });

  // --- 02 §6.5 · Eliminar: solo sin uso; si no, la base ofrece desactivarlo ----
  app.delete<{ Params: { id: string } }>('/api/apus/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    await apuExistente(contexto, request.params.id);
    await eliminarApu(contexto, request.params.id);
    return reply.code(204).send();
  });
}
