import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  actualizarCalendario,
  copiarFestivos,
  crearCalendario,
  eliminarCalendario,
  marcarCalendarioPorDefecto,
  ponerExcepcion,
  quitarExcepcion,
  type Tramo,
} from '../infraestructura/basedatos/calendarios.js';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS, comoUnCampo, esFecha } from './validacion.js';

/*
 * Los calendarios de la empresa (CONTRATO §19.3, RF-CFG-29, D-86). Escribir
 * pide CONFIG.PREFERENCIAS. Los tramos los valida primero esta capa para poder
 * dar el campo; la base es el respaldo y comprueba el cruce al confirmar.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const HORA = /^(?:[01]\d|2[0-3]):(?:00|30)$|^24:00$/;

function minutos(hora: string): number {
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
}

/** El primer problema de los tramos de un día, o null si están bien. */
function problemaDeTramos(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'Los tramos van como una lista de { inicio, fin }.';
  const tramos: { de: number; a: number }[] = [];
  for (const t of valor) {
    if (typeof t !== 'object' || t === null || Object.keys(t).sort().join() !== 'fin,inicio') {
      return 'Cada tramo va como { inicio, fin }, y nada más.';
    }
    const { inicio, fin } = t as Record<string, unknown>;
    if (typeof inicio !== 'string' || typeof fin !== 'string' || !HORA.test(inicio) || !HORA.test(fin)) {
      return 'Los tramos van de media hora en media hora, de «00:00» a «24:00».';
    }
    if (minutos(inicio) >= minutos(fin)) return 'Un tramo tiene que terminar después de empezar: de «07:00» a «12:00».';
    tramos.push({ de: minutos(inicio), a: minutos(fin) });
  }
  tramos.sort((x, y) => x.de - y.de);
  for (let i = 1; i < tramos.length; i += 1) {
    if (tramos[i]!.de < tramos[i - 1]!.a) return 'Dos tramos del mismo día se cruzan: un día no puede tener la misma hora dos veces.';
  }
  return null;
}

const semana = comoUnCampo<Tramo[][]>((v) => {
  if (!Array.isArray(v) || v.length !== 7) return 'La semana trae los siete días, de lunes a domingo, cada uno con sus tramos.';
  for (const dia of v) {
    const problema = problemaDeTramos(dia);
    if (problema) return problema;
  }
  return null;
});

const MENSAJE_HORAS_POR_DIA = '«1 día = X h» va de más de 0 a 24 horas, con hasta dos decimales.';

export const esquemaCalendario = z.strictObject(
  {
    nombre: z.string('Escriba el nombre del calendario.').trim().min(1, 'Escriba el nombre del calendario.'),
    // Comparar contra 0 y 24 no es dinero: es el tope físico de un día.
    horasPorDia: z
      .string(MENSAJE_HORAS_POR_DIA)
      .regex(/^\d{1,2}(\.\d{1,2})?$/, MENSAJE_HORAS_POR_DIA)
      .refine((h) => Number(h) > 0 && Number(h) <= 24, MENSAJE_HORAS_POR_DIA),
    semana,
  },
  SIN_CAMPOS_DE_MAS,
);

export const esquemaExcepcion = z.strictObject(
  {
    motivo: z.string().trim().nullable().optional().transform((v) => v || null),
    tramos: comoUnCampo<Tramo[]>(problemaDeTramos),
  },
  SIN_CAMPOS_DE_MAS,
);

export const esquemaCopiarFestivos = z.strictObject(
  {
    listaId: z.string('Elija la lista de festivos.').regex(UUID, 'Elija la lista de festivos.'),
    propia: z.boolean('Indique si la lista es de la plataforma o propia.'),
  },
  SIN_CAMPOS_DE_MAS,
);

export function fechaDeLaRuta(texto: string): string {
  if (!esFecha(texto)) throw new ErrorParaElUsuario(`«${texto}» no es una fecha. Escríbala como AAAA-MM-DD.`, 'RECHAZADO', 'fecha');
  return texto;
}

export function registrarRutasDeCalendarios(app: FastifyInstance, sesionDe: SesionDe): void {
  const noExiste = () => new ErrorParaElUsuario('Ese calendario no existe en su empresa.', 'NO_EXISTE');
  const existente = <T>(valor: T | null): T => {
    if (valor === null) throw noExiste();
    return valor;
  };
  const idDe = (id: string) => {
    if (!UUID.test(id)) throw noExiste();
    return id;
  };

  app.post('/api/configuracion/calendarios', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.code(201).send(await crearCalendario(contexto, esquemaCalendario.parse(request.body)));
  });

  app.put<{ Params: { id: string } }>('/api/configuracion/calendarios/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const id = idDe(request.params.id);
    return reply.send(existente(await actualizarCalendario(contexto, id, esquemaCalendario.parse(request.body))));
  });

  app.delete<{ Params: { id: string } }>('/api/configuracion/calendarios/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!(await eliminarCalendario(contexto, idDe(request.params.id)))) throw noExiste();
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/configuracion/calendarios/:id/por-defecto', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.send({ calendarios: existente(await marcarCalendarioPorDefecto(contexto, idDe(request.params.id))) });
  });

  app.put<{ Params: { id: string; fecha: string } }>('/api/configuracion/calendarios/:id/excepciones/:fecha', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const id = idDe(request.params.id);
    const fecha = fechaDeLaRuta(request.params.fecha);
    const { motivo, tramos } = esquemaExcepcion.parse(request.body);
    return reply.send(existente(await ponerExcepcion(contexto, id, fecha, motivo, tramos)));
  });

  app.delete<{ Params: { id: string; fecha: string } }>('/api/configuracion/calendarios/:id/excepciones/:fecha', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const id = idDe(request.params.id);
    return reply.send(existente(await quitarExcepcion(contexto, id, fechaDeLaRuta(request.params.fecha))));
  });

  app.post<{ Params: { id: string } }>('/api/configuracion/calendarios/:id/festivos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const id = idDe(request.params.id);
    const { listaId, propia } = esquemaCopiarFestivos.parse(request.body);
    return reply.send(existente(await copiarFestivos(contexto, id, listaId, propia)));
  });
}
