import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { leerPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { leerMesa, type MesaDeTrabajo } from '../infraestructura/basedatos/mesa.js';
import {
  agregarCapitulo,
  agregarSubcapitulo,
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

/**
 * La mesa con su «editable» (contrato §4.1): Abierto y, además, que
 * fn_exigir_permiso('PRESUPUESTOS.EDITAR') pase ahora mismo. Se le PREGUNTA a
 * la función que rechazaría la escritura —rol, cuenta, suscripción (D-65)—
 * en vez de replicar sus reglas, así que la pantalla y el rechazo no pueden
 * contradecirse. Es una cortesía para esconder controles: la base rechaza
 * igual.
 */
async function mesaConEditable(
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
    // Se comprueba que exista ANTES de insertar: la llave foránea no mira la
    // RLS, y un id ajeno llegaría a la base en vez de responder 404.
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
}
