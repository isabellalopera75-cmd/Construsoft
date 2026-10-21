import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import {
  crearListaPropia,
  eliminarListaPropia,
  leerListaPropia,
  listarFestivos,
  reemplazarListaPropia,
  type FechaFestiva,
} from '../infraestructura/basedatos/festivos.js';
import { UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS, comoUnCampo, esFecha } from './validacion.js';

/*
 * Las listas propias de festivos de la empresa (CONTRATO §19.4, D-90).
 * Escribir pide CONFIG.PREFERENCIAS. Una fecha repetida se rechaza aquí, con
 * su campo: la llave primaria de la base es el respaldo.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

/** El primer problema de una lista de fechas, o null. Los nombres vacíos quedan en null. */
function problemaDeFechas(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'Las fechas van como una lista de { fecha, nombre }.';
  const vistas = new Set<string>();
  for (const f of valor) {
    if (typeof f !== 'object' || f === null) return 'Cada fecha va como { fecha, nombre }.';
    const { fecha, nombre } = f as Record<string, unknown>;
    if (!esFecha(fecha)) return `«${String(fecha)}» no es una fecha. Escríbala como AAAA-MM-DD.`;
    if (nombre !== undefined && nombre !== null && typeof nombre !== 'string') return 'El nombre de un festivo es un texto, o se deja vacío.';
    if (vistas.has(fecha)) return `La fecha ${fecha} está dos veces en la lista.`;
    vistas.add(fecha);
  }
  return null;
}

const fechas = comoUnCampo<{ fecha: string; nombre?: string | null }[]>(problemaDeFechas).transform((lista): FechaFestiva[] =>
  lista.map((f) => ({ fecha: f.fecha, nombre: f.nombre?.trim() || null })),
);

const esquemaLista = z.strictObject(
  {
    nombre: z.string('Escriba el nombre de la lista.').trim().min(1, 'Escriba el nombre de la lista.'),
    fechas,
  },
  SIN_CAMPOS_DE_MAS,
);

export function registrarRutasDeFestivos(app: FastifyInstance, sesionDe: SesionDe): void {
  const noExiste = () => new ErrorParaElUsuario('Esa lista de festivos no existe en su empresa.', 'NO_EXISTE');
  const idDe = (id: string) => {
    if (!UUID.test(id)) throw noExiste();
    return id;
  };

  // El desplegable: las listas de la plataforma y las propias (§19.4), con el
  // mismo permiso que el de los calendarios.
  app.get('/api/festivos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { para } = z.object({ para: z.enum(['CONFIG'], 'Para leer los festivos desde la configuración, use ?para=CONFIG.').optional() }).parse(request.query);
    return reply.send(await listarFestivos(contexto, para === 'CONFIG' ? 'CONFIG.PREFERENCIAS' : 'PRESUPUESTOS.VER'));
  });

  app.get<{ Params: { id: string } }>('/api/configuracion/festivos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const lista = await leerListaPropia(contexto, idDe(request.params.id));
    if (!lista) throw noExiste();
    return reply.send(lista);
  });

  app.post('/api/configuracion/festivos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.code(201).send(await crearListaPropia(contexto, esquemaLista.parse(request.body)));
  });

  app.put<{ Params: { id: string } }>('/api/configuracion/festivos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const id = idDe(request.params.id);
    const lista = await reemplazarListaPropia(contexto, id, esquemaLista.parse(request.body));
    if (!lista) throw noExiste();
    return reply.send(lista);
  });

  app.delete<{ Params: { id: string } }>('/api/configuracion/festivos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!(await eliminarListaPropia(contexto, idDe(request.params.id)))) throw noExiste();
    return reply.code(204).send();
  });
}
