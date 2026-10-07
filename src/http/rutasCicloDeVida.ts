import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import {
  archivarPresupuesto,
  cambiarModoEstructura,
  desarchivarPresupuesto,
  editarCabecera,
  leerPresupuesto,
} from '../infraestructura/basedatos/presupuesto.js';
import {
  activarPresupuesto,
  cerrarPresupuesto,
  eliminarPresupuesto,
  reabrirPresupuesto,
} from '../infraestructura/basedatos/cicloDeVida.js';
import { duplicarPresupuesto, leerPieConApuVigentes, listarApusDesactualizados } from '../infraestructura/basedatos/duplicar.js';
import { guardarVersion, leerVersion } from '../infraestructura/basedatos/versiones.js';
import { TIPOS_EVENTO, listarHistorial } from '../infraestructura/basedatos/historial.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { UUID } from './rechazo.js';
import { mesaConEditable } from './rutasMesa.js';
import { SIN_CAMPOS_DE_MAS } from './validacion.js';

/*
 * La rebanada 6.4 (02 §9 y §10): el ciclo de vida del presupuesto, la
 * cabecera, las versiones, archivar, duplicar, eliminar y el historial. Cada
 * regla la defiende la base —quién puede activar (solo el Administrador),
 * desde qué estado, D-20, la versión automática, el evento del historial—;
 * aquí se valida la forma del pedido y se comprueba primero que el
 * presupuesto exista en la empresa, para que uno ajeno responda el mismo 404
 * que uno inexistente y no un rechazo de la base.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;
type ConId = { Params: { id: string } };

const texto = (mensaje: string) => z.string(mensaje).trim().min(1, mensaje);

const esquemaJustificacion = z.strictObject(
  { justificacion: texto('Escriba por qué se reabre: queda en el historial (02 §9.3).') },
  SIN_CAMPOS_DE_MAS,
);
const esquemaMotivoVersion = z.strictObject({ motivo: texto('Escriba el motivo de la versión.') }, SIN_CAMPOS_DE_MAS);
const esquemaMotivoBorrado = z.strictObject(
  { motivo: texto('Escriba por qué se elimina: es lo único que queda del proyecto.') },
  SIN_CAMPOS_DE_MAS,
);
const esquemaCabecera = z.strictObject(
  {
    codigo: texto('Escriba el código del proyecto.'),
    nombre: texto('Escriba el nombre del proyecto.'),
    ubicacion: texto('Escriba la ubicación.'),
  },
  SIN_CAMPOS_DE_MAS,
);
const esquemaEstructura = z.strictObject(
  { modoEstructura: z.enum(['ITEMS', 'WBS'], 'Elija la estructura: por ítems o por EDT.') },
  SIN_CAMPOS_DE_MAS,
);
const esquemaDuplicado = z.strictObject(
  {
    codigo: texto('Escriba el código del proyecto nuevo.'),
    nombre: z.string().trim().min(1, 'Escriba el nombre del proyecto.').optional(),
    actualizarApu: z.boolean('Indique si se actualizan los APU desactualizados.'),
  },
  SIN_CAMPOS_DE_MAS,
);
const esquemaFiltrosHistorial = z.object({
  desde: z.iso.datetime({ offset: true, message: 'La fecha «desde» va como instante ISO.' }).optional(),
  hasta: z.iso.datetime({ offset: true, message: 'La fecha «hasta» va como instante ISO.' }).optional(),
  tipo: z.enum(TIPOS_EVENTO, 'Ese tipo de evento no existe.').optional(),
  usuarioId: z.string().regex(UUID, 'Elija un usuario de la lista.').optional(),
});

export function registrarRutasDeCicloDeVida(app: FastifyInstance, sesionDe: SesionDe): void {
  const presupuestoNoExiste = () => new ErrorParaElUsuario('Ese proyecto no existe en su empresa.', 'NO_EXISTE');
  const versionNoExiste = () => new ErrorParaElUsuario('Esa versión no existe en su empresa.', 'NO_EXISTE');

  async function exigirPresupuesto(contexto: ContextoTenant, id: string): Promise<void> {
    if (!UUID.test(id) || !(await leerPresupuesto(contexto, id))) throw presupuestoNoExiste();
  }

  async function responderMesa(reply: FastifyReply, contexto: ContextoTenant, id: string) {
    const mesa = await mesaConEditable(contexto, id);
    if (!mesa) throw presupuestoNoExiste();
    return reply.send(mesa);
  }

  // --- 02 §9.1, §9.2 · Activar y cerrar: responden con la mesa en su estado nuevo -
  for (const [accion, transicion] of [
    ['activar', activarPresupuesto],
    ['cerrar', cerrarPresupuesto],
  ] as const) {
    app.post<ConId>(`/api/presupuestos/:id/${accion}`, async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigirPresupuesto(contexto, request.params.id);
      await transicion(contexto, request.params.id);
      return responderMesa(reply, contexto, request.params.id);
    });
  }

  // --- 02 §9.3 · Reabrir: la justificación no es un campo que se pueda omitir ---
  app.post<ConId>('/api/presupuestos/:id/reabrir', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { justificacion } = esquemaJustificacion.parse(request.body);
    await exigirPresupuesto(contexto, request.params.id);
    await reabrirPresupuesto(contexto, request.params.id, justificacion);
    return responderMesa(reply, contexto, request.params.id);
  });

  // --- 02 §7.1 y §8.1 · La cabecera y la estructura, mientras esté Abierto ------
  app.put<ConId>('/api/presupuestos/:id/cabecera', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaCabecera.parse(request.body);
    await exigirPresupuesto(contexto, request.params.id);
    await editarCabecera(contexto, request.params.id, datos);
    return responderMesa(reply, contexto, request.params.id);
  });

  app.put<ConId>('/api/presupuestos/:id/estructura', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { modoEstructura } = esquemaEstructura.parse(request.body);
    await exigirPresupuesto(contexto, request.params.id);
    await cambiarModoEstructura(contexto, request.params.id, modoEstructura);
    return responderMesa(reply, contexto, request.params.id);
  });

  // --- 02 §10.1 · «Guardar versión», con motivo, y consultar una en solo lectura -
  app.post<ConId>('/api/presupuestos/:id/versiones', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { motivo } = esquemaMotivoVersion.parse(request.body);
    await exigirPresupuesto(contexto, request.params.id);
    return reply.code(201).send(await guardarVersion(contexto, request.params.id, motivo));
  });

  app.get<ConId>('/api/versiones/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const version = UUID.test(request.params.id) ? await leerVersion(contexto, request.params.id) : null;
    if (!version) throw versionNoExiste();
    return reply.send(version);
  });

  // --- 02 §9.6 · Archivar: no borra ni cambia el estado; es reversible ----------
  for (const [accion, operacion] of [
    ['archivar', archivarPresupuesto],
    ['desarchivar', desarchivarPresupuesto],
  ] as const) {
    app.post<ConId>(`/api/presupuestos/:id/${accion}`, async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigirPresupuesto(contexto, request.params.id);
      const presupuesto = await operacion(contexto, request.params.id);
      if (!presupuesto) throw presupuestoNoExiste();
      return reply.send(presupuesto);
    });
  }

  // --- 02 §9.4 · Duplicar: el diálogo (antes y después) y la copia ---------------
  app.get<ConId>('/api/presupuestos/:id/duplicacion', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { id } = request.params;
    await exigirPresupuesto(contexto, id);
    const apusDesactualizados = await listarApusDesactualizados(contexto, id);
    const actual = (await leerPresupuesto(contexto, id))!;
    const conApuVigentes = await leerPieConApuVigentes(contexto, id);
    return reply.send({
      apusDesactualizados,
      valorTotalActual: actual.valorTotal,
      valorTotalConApuVigentes: conApuVigentes?.valorTotal ?? actual.valorTotal,
    });
  });

  app.post<ConId>('/api/presupuestos/:id/duplicar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaDuplicado.parse(request.body);
    await exigirPresupuesto(contexto, request.params.id);
    const id = await duplicarPresupuesto(contexto, request.params.id, {
      codigo: datos.codigo,
      actualizarApu: datos.actualizarApu,
      ...(datos.nombre ? { nombre: datos.nombre } : {}),
    });
    return reply.code(201).send({ id });
  });

  // --- 02 §9.7 · Eliminar: solo lo nunca activado, con motivo, por el Administrador -
  app.post<ConId>('/api/presupuestos/:id/eliminar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { motivo } = esquemaMotivoBorrado.parse(request.body);
    await exigirPresupuesto(contexto, request.params.id);
    await eliminarPresupuesto(contexto, request.params.id, motivo);
    return reply.code(204).send();
  });

  // --- 02 §10.2 · El historial de cambios, del más reciente al más antiguo ------
  app.get<ConId>('/api/presupuestos/:id/historial', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const filtros = esquemaFiltrosHistorial.parse(request.query);
    await exigirPresupuesto(contexto, request.params.id);
    const eventos = await listarHistorial(contexto, request.params.id, {
      ...(filtros.desde ? { desde: new Date(filtros.desde) } : {}),
      ...(filtros.hasta ? { hasta: new Date(filtros.hasta) } : {}),
      ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
      ...(filtros.usuarioId ? { usuarioId: filtros.usuarioId } : {}),
    });
    return reply.send({ eventos });
  });
}
