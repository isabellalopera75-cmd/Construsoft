import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { editarPorcentajes, leerPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { leerMesa, pieDe, type MesaDeTrabajo } from '../infraestructura/basedatos/mesa.js';
import {
  agregarActividad,
  cambiarCantidad,
  eliminarActividad,
  presupuestoDeLaActividad,
} from '../infraestructura/basedatos/actividad.js';
import { buscarApusParaActividad } from '../infraestructura/basedatos/apu.js';
import {
  agregarCapitulo,
  agregarSubcapitulo,
  cantidadDeHermanos,
  eliminarNivel,
  leerContenidoDelNivel,
  moverEnEdt,
  presupuestoDelNodo,
  reclasificarCapitulo,
  renombrarNivel,
} from '../infraestructura/basedatos/edt.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { esNegacionDePermiso } from './errores.js';
import { Rechazo, UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS, decimalComoTexto } from './validacion.js';

/*
 * La mesa de trabajo (02 §8, web/CONTRATO.md §4). La lectura única y, desde
 * ella, cada mutación de estructura responde con la MESA COMPLETA
 * recalculada: la pantalla reemplaza su estado por lo que llega y nunca
 * reconstruye la numeración por su cuenta (02 §8.2). Las reglas —qué se
 * puede mover, qué no se puede clasificar, qué está congelado— las defiende
 * la base; aquí solo se valida la forma del pedido.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const CLASIFICACION = z.enum(['DIRECTO', 'INDIRECTO'], 'Elija si el capítulo es costo directo o indirecto.');
const NOMBRE = z.string('Escriba el nombre.').trim().min(1, 'Escriba el nombre.');

const esquemaCapitulo = z.strictObject({ nombre: NOMBRE, clasificacion: CLASIFICACION });

const esquemaSubnivel = z.strictObject(
  { nombre: NOMBRE },
  { error: 'Un subnivel no recibe clasificación: la hereda de su capítulo.' },
);

const esquemaCambioDeNodo = z
  .strictObject({ nombre: NOMBRE.optional(), clasificacion: CLASIFICACION.optional() })
  .refine((d) => (d.nombre === undefined) !== (d.clasificacion === undefined), {
    message: 'Cambie el nombre o la clasificación, uno por vez.',
  });

const esquemaMover = z.strictObject({
  posicion: z.number('La posición es un número.').int('La posición es un número entero.').min(1, 'La posición empieza en 1.'),
});

const esquemaBorrado = z.object({ confirmado: z.literal('si').optional() });

/** app.cantidad es numeric(24,6) y no negativa. Viaja como texto: nunca pasa por Number (contrato §1.1). */
const CANTIDAD = decimalComoTexto(
  18,
  'La cantidad',
  'Escriba una cantidad mayor o igual a cero, con punto decimal y hasta seis decimales.',
);

/** app.porcentaje es numeric(9,6) y no negativo; en puntos: 19 es 19 % (RNF-22). */
const PORCENTAJE = decimalComoTexto(3, 'El porcentaje', 'Escriba el porcentaje en puntos, con punto decimal: 10 o 10.5.');

const esquemaBuscarApu = z.object({
  q: z.string('Escriba qué APU busca.').trim().min(1, 'Escriba qué APU busca.'),
  limite: z
    .string()
    .regex(/^(?:[1-9]|[1-4]\d|50)$/, 'El límite es un número entero de 1 a 50.')
    .optional(),
});

const esquemaNuevaActividad = z.strictObject(
  { apuId: z.string('Elija un APU de la lista.').regex(UUID, 'Elija un APU de la lista.'), cantidad: CANTIDAD },
  SIN_CAMPOS_DE_MAS,
);

const esquemaCantidad = z.strictObject({ cantidad: CANTIDAD }, SIN_CAMPOS_DE_MAS);

const esquemaPorcentajes = z.strictObject(
  { a: PORCENTAJE, i: PORCENTAJE, u: PORCENTAJE, iva: PORCENTAJE },
  SIN_CAMPOS_DE_MAS,
);

/**
 * La mesa con su «editable» (contrato §4.1): Abierto y, además, que
 * fn_exigir_permiso('PRESUPUESTOS.EDITAR') pase ahora mismo. Se le PREGUNTA a
 * la función que rechazaría la escritura —rol, cuenta, suscripción (D-65)—
 * en vez de replicar sus reglas, así que la pantalla y el rechazo no pueden
 * contradecirse. Es una cortesía para esconder controles: la base rechaza
 * igual.
 */
export async function mesaConEditable(
  contexto: ContextoTenant,
  presupuestoId: string,
): Promise<(MesaDeTrabajo & { cabecera: { editable: boolean } }) | null> {
  const mesa = await leerMesa(contexto, presupuestoId);
  if (!mesa) return null;
  let editable = mesa.cabecera.estado === 'ABIERTO';
  if (editable) {
    try {
      await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async () => undefined);
    } catch (error) {
      if (!esNegacionDePermiso(error)) throw error;
      editable = false;
    }
  }
  return { ...mesa, cabecera: { ...mesa.cabecera, editable } };
}

/** «1 subnivel y 2 actividades», «3 actividades»: solo lo que hay. */
function describirContenido(subniveles: number, actividades: number): string {
  const partes = [
    subniveles > 0 ? `${subniveles} ${subniveles === 1 ? 'subnivel' : 'subniveles'}` : null,
    actividades > 0 ? `${actividades} ${actividades === 1 ? 'actividad' : 'actividades'}` : null,
  ].filter((p): p is string => p !== null);
  return partes.join(' y ');
}

export function registrarRutasDeMesa(app: FastifyInstance, sesionDe: SesionDe): void {
  // Un id ajeno, uno inexistente y algo que ni es un id responden IGUAL: un
  // 404 que se distinga de otro ya dice que el dato existe (RN-01).
  const presupuestoNoExiste = () => new ErrorParaElUsuario('Ese presupuesto no existe en su empresa.', 'NO_EXISTE');
  const nivelNoExiste = () =>
    new ErrorParaElUsuario('Ese capítulo o subcapítulo ya no existe. Recargue la mesa de trabajo.', 'NO_EXISTE');

  async function responderMesa(reply: FastifyReply, contexto: ContextoTenant, presupuestoId: string, estado = 200) {
    const mesa = await mesaConEditable(contexto, presupuestoId);
    if (!mesa) throw presupuestoNoExiste();
    return reply.code(estado).send(mesa);
  }

  const actividadNoExiste = () =>
    new ErrorParaElUsuario('Esa actividad ya no existe. Recargue la mesa de trabajo.', 'NO_EXISTE');

  /**
   * La posición fuera de rango es un dato del formulario, como «no es un
   * entero»: llega con campo y la pantalla marca el control en vez de recargar
   * la mesa. La base la rechaza igual si llegara.
   */
  async function exigirPosicionEnRango(contexto: ContextoTenant, id: string, posicion: number): Promise<void> {
    const hermanos = await cantidadDeHermanos(contexto, id);
    if (hermanos !== null && posicion > hermanos) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['posicion'],
          message: `La posición ${posicion} no existe: este nivel tiene ${hermanos} elementos, así que va de 1 a ${hermanos}.`,
          input: posicion,
        },
      ]);
    }
  }

  /** El presupuesto de la actividad, o 404. */
  async function presupuestoDeActividad(contexto: ContextoTenant, actividadId: string): Promise<string> {
    const presupuestoId = UUID.test(actividadId) ? await presupuestoDeLaActividad(contexto, actividadId) : null;
    if (!presupuestoId) throw actividadNoExiste();
    return presupuestoId;
  }

  /** El presupuesto del nodo, o 404. */
  async function presupuestoDe(contexto: ContextoTenant, nodoId: string): Promise<string> {
    const presupuestoId = UUID.test(nodoId) ? await presupuestoDelNodo(contexto, nodoId) : null;
    if (!presupuestoId) throw nivelNoExiste();
    return presupuestoId;
  }

  // --- La lectura única (contrato §4.1) ---------------------------------------
  app.get<{ Params: { id: string } }>('/api/presupuestos/:id/mesa', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!UUID.test(request.params.id)) throw presupuestoNoExiste();
    return responderMesa(reply, contexto, request.params.id);
  });

  // --- 02 §8.4 · Capítulo de primer nivel: la clasificación es obligatoria ----
  app.post<{ Params: { id: string } }>('/api/presupuestos/:id/capitulos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaCapitulo.parse(request.body);
    const { id } = request.params;
    // Se comprueba que exista ANTES de insertar. No por aislamiento: la llave
    // foránea es compuesta (tenant_id, presupuesto_id), así que un id ajeno y
    // uno inexistente fallan igual. Es porque los dos fallarían con 23503, que
    // es un 500, y lo que corresponde es el 404 de «no existe».
    if (!UUID.test(id) || !(await leerPresupuesto(contexto, id))) throw presupuestoNoExiste();
    await agregarCapitulo(contexto, id, datos);
    return responderMesa(reply, contexto, id, 201);
  });

  // --- 02 §8.2 · El «(+)»: un subnivel al final de sus hermanos ---------------
  app.post<{ Params: { id: string } }>('/api/nodos/:id/subniveles', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaSubnivel.parse(request.body);
    const presupuestoId = await presupuestoDe(contexto, request.params.id);
    await agregarSubcapitulo(contexto, request.params.id, datos);
    return responderMesa(reply, contexto, presupuestoId, 201);
  });

  // --- Renombrar, o reclasificar un capítulo raíz (RF-PRE-14, RF-PRE-19) -------
  app.patch<{ Params: { id: string } }>('/api/nodos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaCambioDeNodo.parse(request.body);
    const presupuestoId = await presupuestoDe(contexto, request.params.id);
    if (datos.nombre !== undefined) await renombrarNivel(contexto, request.params.id, datos.nombre);
    else await reclasificarCapitulo(contexto, request.params.id, datos.clasificacion!);
    return responderMesa(reply, contexto, presupuestoId);
  });

  // --- Mover a una posición absoluta entre hermanos (D-56, contrato §1.4) -----
  app.post<{ Params: { id: string } }>('/api/nodos/:id/mover', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { posicion } = esquemaMover.parse(request.body);
    const presupuestoId = await presupuestoDe(contexto, request.params.id);
    await exigirPosicionEnRango(contexto, request.params.id, posicion);
    await moverEnEdt(contexto, request.params.id, posicion);
    return responderMesa(reply, contexto, presupuestoId);
  });

  // --- Eliminar, con la alerta previa de RF-PRE-14 ----------------------------
  app.delete<{ Params: { id: string } }>('/api/nodos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { confirmado } = esquemaBorrado.parse(request.query);
    const presupuestoId = await presupuestoDe(contexto, request.params.id);
    if (confirmado !== 'si') {
      const { subniveles, actividades } = await leerContenidoDelNivel(contexto, request.params.id);
      if (subniveles + actividades > 0) {
        throw new Rechazo(
          409,
          `Este nivel tiene ${describirContenido(subniveles, actividades)}. ` +
            'Si lo elimina, se elimina todo lo que contiene. Confirme para continuar.',
        );
      }
    }
    await eliminarNivel(contexto, request.params.id);
    return responderMesa(reply, contexto, presupuestoId);
  });

  // --- 02 §8.3 · El autocompletado de APU ------------------------------------
  // Lo que hace falta para elegir, no el APU entero; solo los activos.
  app.get('/api/apu/buscar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { q, limite } = esquemaBuscarApu.parse(request.query);
    const apus = await buscarApusParaActividad(contexto, q, limite === undefined ? undefined : Number(limite));
    return reply.send({
      apus: apus.map((a) => ({
        id: a.id,
        codigo: a.codigo,
        nombre: a.nombre,
        unidadSimbolo: a.unidadSimbolo,
        costoDirecto: a.costoDirecto,
        activo: a.activo,
      })),
    });
  });

  // --- 02 §8.3 · Agregar una actividad al final de un capítulo o subcapítulo -
  // El código, la descripción, la unidad y el precio los copia la base de la
  // versión vigente del APU; la interfaz manda solo cuál y cuánto.
  app.post<{ Params: { id: string } }>('/api/nodos/:id/actividades', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { apuId, cantidad } = esquemaNuevaActividad.parse(request.body);
    const presupuestoId = await presupuestoDe(contexto, request.params.id);
    await agregarActividad(contexto, request.params.id, apuId, cantidad);
    return responderMesa(reply, contexto, presupuestoId, 201);
  });

  // --- La cantidad: lo único editable de una fila (02 §8.3) -------------------
  app.patch<{ Params: { id: string } }>('/api/actividades/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { cantidad } = esquemaCantidad.parse(request.body);
    const presupuestoId = await presupuestoDeActividad(contexto, request.params.id);
    await cambiarCantidad(contexto, request.params.id, cantidad);
    return responderMesa(reply, contexto, presupuestoId);
  });

  // --- Mover una actividad: mismo contador que los nodos (D-42, D-56) ---------
  app.post<{ Params: { id: string } }>('/api/actividades/:id/mover', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { posicion } = esquemaMover.parse(request.body);
    const presupuestoId = await presupuestoDeActividad(contexto, request.params.id);
    await exigirPosicionEnRango(contexto, request.params.id, posicion);
    await moverEnEdt(contexto, request.params.id, posicion);
    return responderMesa(reply, contexto, presupuestoId);
  });

  app.delete<{ Params: { id: string } }>('/api/actividades/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const presupuestoId = await presupuestoDeActividad(contexto, request.params.id);
    await eliminarActividad(contexto, request.params.id);
    return responderMesa(reply, contexto, presupuestoId);
  });

  // --- RF-PRE-23 · Los cuatro porcentajes, desde el panel del pie --------------
  // Responde solo con el pie (contrato §4.4): la estructura no cambió.
  app.patch<{ Params: { id: string } }>('/api/presupuestos/:id/porcentajes', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { a, i, u, iva } = esquemaPorcentajes.parse(request.body);
    if (!UUID.test(request.params.id)) throw presupuestoNoExiste();
    const presupuesto = await editarPorcentajes(contexto, request.params.id, {
      aiuAdministracion: a,
      aiuImprevistos: i,
      aiuUtilidad: u,
      ivaUtilidadPct: iva,
    });
    if (!presupuesto) throw presupuestoNoExiste();
    return reply.send(pieDe(presupuesto));
  });
}
