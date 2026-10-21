import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { horasDeDias } from '../cronograma/duraciones.js';
import type { FilaActividad, FilasDelCronograma } from '../cronograma/filas.js';
import { armarVista } from '../cronograma/vista.js';
import { generarGanttPdf } from '../exportacion/gantt.js';
import { generarXmlProject } from '../exportacion/project.js';
import { generarXer, type VersionDeP6 } from '../exportacion/xer.js';
import { leerLogoParaExportar } from '../infraestructura/basedatos/exportacion.js';
import { adjunto } from './rutasExportacion.js';
import { copiarFestivosEn, ponerExcepcionEn, quitarExcepcionEn, reemplazarSemanaEn } from '../infraestructura/basedatos/calendarios.js';
import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import {
  cerrarAvisoDelPresupuesto,
  crearCronograma,
  editarCronograma,
  eliminarLineaBase,
  guardarLineaBase,
  leerCronograma,
  leerCronogramaDelPresupuesto,
  leerCronogramaParaExportar,
  leerCurvas,
  listarLineasBase,
  type CronogramaLeido,
  type ResultadoDeEdicion,
  type ResultadoDeLineaBase,
} from '../infraestructura/basedatos/cronograma.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { esNegacionDePermiso } from './errores.js';
import { UUID } from './rechazo.js';
import { esquemaCalendario, esquemaCopiarFestivos, esquemaExcepcion, fechaDeLaRuta } from './rutasCalendarios.js';
import { SIN_CAMPOS_DE_MAS, esFecha } from './validacion.js';

/*
 * El cronograma (CONTRATO §19.5–§19.6). Leer pide PRESUPUESTOS.VER y puede
 * recalcular; toda escritura pide PRESUPUESTOS.EDITAR, lleva la versión que la
 * persona está viendo y responde la vista entera ya recalculada. Las reglas
 * —parejas de restricciones, círculos, códigos, lo que no se borra— las
 * defiende la base; aquí se valida la forma, y lo que depende del tipo de
 * actividad, para poder dar el campo.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

/** "2026-10-21": el día de hoy en Colombia, para la cabecera del XER. */
const DIA_EN_COLOMBIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });
const hoyEnColombia = () => DIA_EN_COLOMBIA.format(new Date());
const OTRA_PERSONA = 'Otra persona cambió el cronograma mientras usted lo editaba. Esta es la versión nueva; su cambio no se guardó.';

const version = z.number('Falta la versión del cronograma que está viendo.').int('Falta la versión del cronograma que está viendo.').min(1, 'Falta la versión del cronograma que está viendo.');
const fecha = (mensaje: string) => z.string(mensaje).refine(esFecha, mensaje);
const id = (mensaje: string) => z.string(mensaje).regex(UUID, mensaje);
const dias = (campo: string, negativos: boolean) =>
  z
    .string(`${campo} va en días, como texto con hasta un decimal: «2.5».`)
    .regex(negativos ? /^-?\d{1,5}(\.\d)?$/ : /^\d{1,5}(\.\d)?$/, `${campo} va en días, con hasta un decimal${negativos ? '' : ', y no puede ser negativa'}: «2.5».`);

const TIPOS_DE_RESTRICCION = [
  'INICIO_EL',
  'INICIO_ANTES',
  'INICIO_DESPUES',
  'FIN_EL',
  'FIN_ANTES',
  'FIN_DESPUES',
  'LO_MAS_TARDE',
  'INICIO_OBLIGATORIO',
  'FIN_OBLIGATORIO',
] as const;
const restriccion = z
  .strictObject(
    {
      tipo: z.enum(TIPOS_DE_RESTRICCION, 'Elija una restricción de la lista.'),
      fecha: z.union([z.null(), fecha('Escriba la fecha de la restricción como AAAA-MM-DD.')]),
    },
    SIN_CAMPOS_DE_MAS,
  )
  .nullable();

const esquemaCrear = z.strictObject(
  {
    fechaInicio: fecha('Escriba la fecha de inicio del cronograma como AAAA-MM-DD.'),
    calendarioId: id('Elija el calendario de la obra.').nullable().optional(),
  },
  SIN_CAMPOS_DE_MAS,
);
const esquemaFechaInicio = z.strictObject({ version, fechaInicio: fecha('Escriba la fecha de inicio como AAAA-MM-DD.') }, SIN_CAMPOS_DE_MAS);
const esquemaReemplazarCalendario = z.strictObject({ version, calendarioId: id('Elija un calendario de la empresa.') }, SIN_CAMPOS_DE_MAS);
const esquemaCalendarioObra = esquemaCalendario.extend({ version });
const esquemaExcepcionObra = esquemaExcepcion.extend({ version });
const esquemaFestivosObra = esquemaCopiarFestivos.extend({ version });
const esquemaPosicion = z.strictObject(
  { version, posicion: z.number('La posición es un número entero desde 1.').int('La posición es un número entero desde 1.').min(1, 'La posición es un número entero desde 1.') },
  SIN_CAMPOS_DE_MAS,
);
const nombre = (que: string) => z.string(`Escriba el nombre ${que}.`).trim().min(1, `Escriba el nombre ${que}.`);
const esquemaNuevaActividad = z.strictObject(
  {
    version,
    tipo: z.enum(['HITO_INICIO', 'HITO_FIN', 'SIN_COSTO'], 'Solo se crean hitos y trámites: las actividades del presupuesto nacen con sus ítems.'),
    nombre: nombre('de la actividad'),
    codigo: z.string().trim().nullable().optional(),
    grupoId: id('Elija un subgrupo de «Hitos y trámites».').nullable().optional(),
    duracionManualDias: dias('La duración', false).nullable().optional(),
    usaCorrido: z.boolean('Indique si la espera usa el calendario corrido.').optional(),
  },
  SIN_CAMPOS_DE_MAS,
);
const esquemaEditarActividad = z.strictObject(
  {
    version,
    nombre: nombre('de la actividad').optional(),
    codigo: z.string('Escriba el código.').trim().min(1, 'Escriba el código.').optional(),
    cuadrillas: z.number('Las cuadrillas son un número entero desde 1.').int('Las cuadrillas son un número entero desde 1.').min(1, 'Las cuadrillas son un número entero desde 1.').optional(),
    duracionManualDias: dias('La duración', false).nullable().optional(),
    usaCorrido: z.boolean('Indique si la espera usa el calendario corrido.').optional(),
    grupoId: id('Elija un subgrupo de «Hitos y trámites».').nullable().optional(),
    restriccion: restriccion.optional(),
    restriccionSecundaria: restriccion.optional(),
  },
  SIN_CAMPOS_DE_MAS,
);
const esquemaGrupo = z.strictObject({ version, nombre: nombre('del subgrupo') }, SIN_CAMPOS_DE_MAS);
const TIPO_DE_RELACION = z.enum(['FC', 'CC', 'FF', 'CF'], 'El tipo de relación es FC, CC, FF o CF.');
const esquemaNuevaDependencia = z.strictObject(
  {
    version,
    predecesoraId: id('Elija la actividad predecesora.'),
    sucesoraId: id('Elija la actividad sucesora.'),
    tipo: TIPO_DE_RELACION,
    desfaseDias: dias('El desfase', true),
  },
  SIN_CAMPOS_DE_MAS,
);
const esquemaEditarDependencia = z.strictObject(
  { version, tipo: TIPO_DE_RELACION.optional(), desfaseDias: dias('El desfase', true).optional() },
  SIN_CAMPOS_DE_MAS,
);

/** La versión en un DELETE viaja como ?version=n (§19.6). */
const versionDeLaRuta = (texto: string | undefined) => z.object({ version: z.coerce.number().pipe(version) }).parse({ version: texto }).version;

const ES_HITO_O_TRAMITE = (a: FilaActividad) => a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN' || a.tipo === 'SIN_COSTO';

/** «1 día = X h» del calendario de una actividad: el corrido, si es una espera que lo usa (RN-29). */
const factorDe = (filas: FilasDelCronograma, usaCorrido: boolean) => (usaCorrido ? filas.calendarios.corrido.horasPorDia : filas.calendarios.obra.horasPorDia);

/** Escribe `orden` 1…n en el orden que llega. */
async function reordenarEn(cliente: ClienteEnContexto, tabla: 'actividad_programada' | 'grupo_tramite', ids: string[]): Promise<void> {
  await cliente.query(
    `UPDATE app.${tabla} t SET orden = x.n FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, n) WHERE t.id = x.id AND t.orden IS DISTINCT FROM x.n`,
    [ids],
  );
}

/** §1.4 · La posición final, absoluta, entre sus hermanos. */
function moverEn(hermanos: string[], id: string, posicion: number): string[] {
  if (posicion > hermanos.length) {
    throw new ErrorParaElUsuario(`La posición va de 1 a ${hermanos.length}.`, 'RECHAZADO', 'posicion');
  }
  const resto = hermanos.filter((x) => x !== id);
  resto.splice(posicion - 1, 0, id);
  return resto;
}

const hermanosDe = (filas: FilasDelCronograma, grupoId: string | null) =>
  filas.actividades
    .filter((a) => ES_HITO_O_TRAMITE(a) && a.grupoId === grupoId)
    .sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo))
    .map((a) => a.id);

async function siguienteOrdenEn(cliente: ClienteEnContexto, cronogramaId: string, grupoId: string | null): Promise<number> {
  const { rows } = await cliente.query<{ n: number }>(
    `SELECT (COALESCE(max(orden), 0) + 1)::int AS n FROM app.actividad_programada
      WHERE cronograma_id = $1 AND grupo_id IS NOT DISTINCT FROM $2 AND tipo IN ('HITO_INICIO', 'HITO_FIN', 'SIN_COSTO')`,
    [cronogramaId, grupoId],
  );
  return rows[0]!.n;
}

function exigirGrupo(filas: FilasDelCronograma, grupoId: string | null | undefined): void {
  if (grupoId && !filas.grupos.some((g) => g.id === grupoId)) {
    throw new ErrorParaElUsuario('Ese subgrupo no existe en este cronograma.', 'RECHAZADO', 'grupoId');
  }
}

export function registrarRutasDeCronograma(app: FastifyInstance, sesionDe: SesionDe): void {
  const cronogramaNoExiste = () => new ErrorParaElUsuario('Ese cronograma no existe en su empresa.', 'NO_EXISTE');
  const lineaBaseNoExiste = () => new ErrorParaElUsuario('Esa línea base no existe en este cronograma.', 'NO_EXISTE');
  const idDe = (texto: string, noExiste: () => ErrorParaElUsuario) => {
    if (!UUID.test(texto)) throw noExiste();
    return texto;
  };

  /**
   * «editable» (§19.5): EDITAR, suscripción vigente y presupuesto no Cerrado.
   * Se le PREGUNTA a fn_exigir_permiso, como la mesa (§4.1), en vez de
   * replicar sus reglas.
   */
  async function editable(contexto: ContextoTenant, leido: CronogramaLeido): Promise<boolean> {
    if (leido.filas.presupuesto.estado === 'CERRADO') return false;
    try {
      await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async () => undefined);
      return true;
    } catch (error) {
      if (!esNegacionDePermiso(error)) throw error;
      return false;
    }
  }

  async function vista(contexto: ContextoTenant, leido: CronogramaLeido) {
    return armarVista(leido.filas, { editable: await editable(contexto, leido), recalculado: leido.recalculado, lineaBase: leido.lineaBase });
  }

  /** La respuesta de toda escritura: la vista, el 409 con la versión nueva, o el 404. */
  async function responder(
    reply: FastifyReply,
    contexto: ContextoTenant,
    cronogramaId: string,
    resultado: ResultadoDeEdicion | null,
    lineaBaseId: string | null,
  ) {
    if (!resultado) throw cronogramaNoExiste();
    if (resultado.tipo === 'VERSION_VIEJA') {
      const actual = await leerCronograma(contexto, cronogramaId, lineaBaseId);
      if (!actual) throw cronogramaNoExiste();
      return reply.code(409).send({ mensaje: OTRA_PERSONA, cronograma: await vista(contexto, actual) });
    }
    return reply.send(await vista(contexto, resultado.leido));
  }

  /**
   * Un cambio sobre el cronograma de la ruta, con la versión del cuerpo o de
   * ?version=. Con ?lineaBase=, la respuesta (y la del 409) trae esa línea
   * base, como el GET (§19.6, 21 de octubre).
   */
  async function editar(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    versionPedida: number,
    cambio: (cliente: ClienteEnContexto, filas: FilasDelCronograma) => Promise<void>,
  ) {
    const contexto = await sesionDe(request, reply);
    const cronogramaId = idDe(request.params.id, cronogramaNoExiste);
    const { lineaBase } = request.query as { lineaBase?: string };
    const lineaBaseId = lineaBase === undefined ? null : idDe(lineaBase, lineaBaseNoExiste);
    return responder(reply, contexto, cronogramaId, await editarCronograma(contexto, cronogramaId, versionPedida, cambio, lineaBaseId), lineaBaseId);
  }

  // --- §19.5 · Leer y crear -----------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { lineaBase?: string } }>('/api/presupuestos/:id/cronograma', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const noExiste = () => new ErrorParaElUsuario('Ese presupuesto no existe en su empresa.', 'NO_EXISTE');
    const presupuestoId = idDe(request.params.id, noExiste);
    const { lineaBase } = request.query;
    const lineaBaseId = lineaBase === undefined ? null : idDe(lineaBase, lineaBaseNoExiste);
    const leido = await leerCronogramaDelPresupuesto(contexto, presupuestoId, lineaBaseId);
    if (leido === null) throw noExiste();
    if (leido === 'SIN_CRONOGRAMA') return reply.send({ cronograma: null });
    return reply.send(await vista(contexto, leido));
  });

  app.post<{ Params: { id: string } }>('/api/presupuestos/:id/cronograma', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const noExiste = () => new ErrorParaElUsuario('Ese presupuesto no existe en su empresa.', 'NO_EXISTE');
    const presupuestoId = idDe(request.params.id, noExiste);
    const { fechaInicio, calendarioId } = esquemaCrear.parse(request.body);
    const leido = await crearCronograma(contexto, presupuestoId, fechaInicio, calendarioId ?? null);
    if (!leido) throw noExiste();
    return reply.code(201).send(await vista(contexto, leido));
  });

  // --- §19.6 · La cabecera y los calendarios ------------------------------------------
  app.patch<{ Params: { id: string } }>('/api/cronogramas/:id', async (request, reply) => {
    const datos = esquemaFechaInicio.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      await cliente.query('UPDATE app.cronograma SET fecha_inicio = $2::date WHERE id = $1', [filas.cabecera.id, datos.fechaInicio]);
    });
  });

  app.put<{ Params: { id: string } }>('/api/cronogramas/:id/calendario', async (request, reply) => {
    const datos = esquemaReemplazarCalendario.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      await cliente.query('SELECT app.fn_cambiar_calendario_cronograma($1, $2)', [filas.cabecera.id, datos.calendarioId]);
    });
  });

  app.put<{ Params: { id: string } }>('/api/cronogramas/:id/calendario-obra', async (request, reply) => {
    const datos = esquemaCalendarioObra.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const obra = filas.calendarios.obra.id;
      await cliente.query('UPDATE app.calendario SET nombre = $2, horas_por_dia = $3 WHERE id = $1', [obra, datos.nombre, datos.horasPorDia]);
      await reemplazarSemanaEn(cliente, filas.cabecera.tenantId, obra, datos.semana);
    });
  });

  app.put<{ Params: { id: string; fecha: string } }>('/api/cronogramas/:id/calendario-obra/excepciones/:fecha', async (request, reply) => {
    const dia = fechaDeLaRuta(request.params.fecha);
    const datos = esquemaExcepcionObra.parse(request.body);
    return editar(request, reply, datos.version, (cliente, filas) =>
      ponerExcepcionEn(cliente, filas.cabecera.tenantId, filas.calendarios.obra.id, dia, datos.motivo, datos.tramos),
    );
  });

  app.delete<{ Params: { id: string; fecha: string }; Querystring: { version?: string } }>(
    '/api/cronogramas/:id/calendario-obra/excepciones/:fecha',
    async (request, reply) => {
      const dia = fechaDeLaRuta(request.params.fecha);
      return editar(request, reply, versionDeLaRuta(request.query.version), (cliente, filas) => quitarExcepcionEn(cliente, filas.calendarios.obra.id, dia));
    },
  );

  app.post<{ Params: { id: string } }>('/api/cronogramas/:id/calendario-obra/festivos', async (request, reply) => {
    const datos = esquemaFestivosObra.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      await copiarFestivosEn(cliente, filas.calendarios.obra.id, datos.listaId, datos.propia);
    });
  });

  // --- §19.6 · Actividades ----------------------------------------------------------------
  const actividadNoExiste = () => new ErrorParaElUsuario('Esa actividad no existe en este cronograma.', 'NO_EXISTE');
  const actividadDe = (filas: FilasDelCronograma, id: string) => {
    const a = filas.actividades.find((x) => x.id === id);
    if (!a) throw actividadNoExiste();
    return a;
  };

  app.post<{ Params: { id: string } }>('/api/cronogramas/:id/actividades', async (request, reply) => {
    const datos = esquemaNuevaActividad.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const hito = datos.tipo !== 'SIN_COSTO';
      if (hito && datos.duracionManualDias !== undefined && datos.duracionManualDias !== null) {
        throw new ErrorParaElUsuario('Un hito dura cero: no lleva duración (RN-28).', 'RECHAZADO', 'duracionManualDias');
      }
      if (hito && datos.usaCorrido) throw new ErrorParaElUsuario('Solo las esperas usan el calendario corrido (D-86).', 'RECHAZADO', 'usaCorrido');
      exigirGrupo(filas, datos.grupoId);
      const grupoId = datos.grupoId ?? null;
      const usaCorrido = datos.usaCorrido ?? false;
      const horas = datos.duracionManualDias ? horasDeDias(datos.duracionManualDias, factorDe(filas, usaCorrido)) : null;
      await cliente.query(
        `INSERT INTO app.actividad_programada
             (tenant_id, cronograma_id, tipo, nombre, codigo, grupo_id, orden, usa_corrido, duracion_manual_horas)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9)`,
        [filas.cabecera.tenantId, filas.cabecera.id, datos.tipo, datos.nombre, datos.codigo ?? null, grupoId, await siguienteOrdenEn(cliente, filas.cabecera.id, grupoId), usaCorrido, horas],
      );
    });
  });

  app.patch<{ Params: { id: string; actividadId: string } }>('/api/cronogramas/:id/actividades/:actividadId', async (request, reply) => {
    const datos = esquemaEditarActividad.parse(request.body);
    const actividadId = idDe(request.params.actividadId, actividadNoExiste);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const a = actividadDe(filas, actividadId);
      const permitidos: Record<string, readonly FilaActividad['tipo'][]> = {
        nombre: ['HITO_INICIO', 'HITO_FIN', 'SIN_COSTO', 'ADMINISTRACION'],
        codigo: ['HITO_INICIO', 'HITO_FIN', 'SIN_COSTO', 'ADMINISTRACION'],
        cuadrillas: ['ITEM'],
        duracionManualDias: ['ITEM', 'SIN_COSTO'],
        usaCorrido: ['SIN_COSTO'],
        grupoId: ['HITO_INICIO', 'HITO_FIN', 'SIN_COSTO'],
        restriccion: ['ITEM', 'HITO_INICIO', 'HITO_FIN', 'SIN_COSTO'],
        restriccionSecundaria: ['ITEM', 'HITO_INICIO', 'HITO_FIN', 'SIN_COSTO'],
      };
      for (const [campo, tipos] of Object.entries(permitidos)) {
        if (datos[campo as keyof typeof datos] !== undefined && !tipos.includes(a.tipo)) {
          throw new ErrorParaElUsuario(
            a.tipo === 'ITEM' && (campo === 'nombre' || campo === 'codigo')
              ? 'El nombre y el número de una actividad del presupuesto son los de su ítem (RN-42): se cambian en la mesa de trabajo.'
              : 'Ese dato no se edita en este tipo de actividad.',
            'RECHAZADO',
            campo,
          );
        }
      }
      exigirGrupo(filas, datos.grupoId);

      const columnas: string[] = [];
      const valores: unknown[] = [];
      const poner = (columna: string, valor: unknown) => {
        valores.push(valor);
        columnas.push(`${columna} = $${valores.length + 1}`);
      };
      if (datos.nombre !== undefined) poner('nombre', datos.nombre);
      if (datos.codigo !== undefined) poner('codigo', datos.codigo);
      if (datos.cuadrillas !== undefined) poner('cuadrillas', datos.cuadrillas);
      const usaCorrido = datos.usaCorrido ?? a.usaCorrido;
      if (datos.usaCorrido !== undefined) poner('usa_corrido', datos.usaCorrido);
      // Se escribe en días del calendario de la actividad y se guarda en horas (07 §6.9).
      if (datos.duracionManualDias !== undefined) {
        poner('duracion_manual_horas', datos.duracionManualDias === null ? null : horasDeDias(datos.duracionManualDias, factorDe(filas, usaCorrido)));
      }
      if (datos.grupoId !== undefined && datos.grupoId !== a.grupoId) {
        poner('grupo_id', datos.grupoId);
        poner('orden', await siguienteOrdenEn(cliente, filas.cabecera.id, datos.grupoId));
      }
      if (datos.restriccion !== undefined) {
        poner('restriccion_tipo', datos.restriccion?.tipo ?? null);
        poner('restriccion_fecha', datos.restriccion?.fecha ?? null);
      }
      if (datos.restriccionSecundaria !== undefined) {
        poner('restriccion2_tipo', datos.restriccionSecundaria?.tipo ?? null);
        poner('restriccion2_fecha', datos.restriccionSecundaria?.fecha ?? null);
      }
      if (columnas.length > 0) {
        await cliente.query(`UPDATE app.actividad_programada SET ${columnas.join(', ')} WHERE id = $1`, [a.id, ...valores]);
      }
    });
  });

  app.put<{ Params: { id: string; actividadId: string } }>('/api/cronogramas/:id/actividades/:actividadId/posicion', async (request, reply) => {
    const datos = esquemaPosicion.parse(request.body);
    const actividadId = idDe(request.params.actividadId, actividadNoExiste);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const a = actividadDe(filas, actividadId);
      if (!ES_HITO_O_TRAMITE(a)) {
        throw new ErrorParaElUsuario('Las actividades del presupuesto siguen el orden de la EDT: se mueven en la mesa de trabajo.', 'RECHAZADO');
      }
      await reordenarEn(cliente, 'actividad_programada', moverEn(hermanosDe(filas, a.grupoId), a.id, datos.posicion));
    });
  });

  app.delete<{ Params: { id: string; actividadId: string }; Querystring: { version?: string } }>(
    '/api/cronogramas/:id/actividades/:actividadId',
    async (request, reply) => {
      const actividadId = idDe(request.params.actividadId, actividadNoExiste);
      return editar(request, reply, versionDeLaRuta(request.query.version), async (cliente, filas) => {
        const a = actividadDe(filas, actividadId);
        await cliente.query('DELETE FROM app.actividad_programada WHERE id = $1', [a.id]);
      });
    },
  );

  // --- §19.6 · Subgrupos de «Hitos y trámites» -----------------------------------------
  const grupoNoExiste = () => new ErrorParaElUsuario('Ese subgrupo no existe en este cronograma.', 'NO_EXISTE');
  const grupoDe = (filas: FilasDelCronograma, id: string) => {
    const g = filas.grupos.find((x) => x.id === id);
    if (!g) throw grupoNoExiste();
    return g;
  };

  app.post<{ Params: { id: string } }>('/api/cronogramas/:id/grupos', async (request, reply) => {
    const datos = esquemaGrupo.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      await cliente.query('INSERT INTO app.grupo_tramite (tenant_id, cronograma_id, nombre, orden) VALUES ($1, $2, $3, $4)', [
        filas.cabecera.tenantId,
        filas.cabecera.id,
        datos.nombre,
        Math.max(0, ...filas.grupos.map((g) => g.orden)) + 1,
      ]);
    });
  });

  app.patch<{ Params: { id: string; grupoId: string } }>('/api/cronogramas/:id/grupos/:grupoId', async (request, reply) => {
    const datos = esquemaGrupo.parse(request.body);
    const grupoId = idDe(request.params.grupoId, grupoNoExiste);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      await cliente.query('UPDATE app.grupo_tramite SET nombre = $2 WHERE id = $1', [grupoDe(filas, grupoId).id, datos.nombre]);
    });
  });

  app.put<{ Params: { id: string; grupoId: string } }>('/api/cronogramas/:id/grupos/:grupoId/posicion', async (request, reply) => {
    const datos = esquemaPosicion.parse(request.body);
    const grupoId = idDe(request.params.grupoId, grupoNoExiste);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const g = grupoDe(filas, grupoId);
      const hermanos = [...filas.grupos].sort((a, b) => a.orden - b.orden).map((x) => x.id);
      await reordenarEn(cliente, 'grupo_tramite', moverEn(hermanos, g.id, datos.posicion));
    });
  });

  app.delete<{ Params: { id: string; grupoId: string }; Querystring: { version?: string } }>('/api/cronogramas/:id/grupos/:grupoId', async (request, reply) => {
    const grupoId = idDe(request.params.grupoId, grupoNoExiste);
    return editar(request, reply, versionDeLaRuta(request.query.version), async (cliente, filas) => {
      await cliente.query('DELETE FROM app.grupo_tramite WHERE id = $1', [grupoDe(filas, grupoId).id]);
    });
  });

  // --- §19.6 · Relaciones (RF-PRG-04) -------------------------------------------------------
  const dependenciaNoExiste = () => new ErrorParaElUsuario('Esa relación no existe en este cronograma.', 'NO_EXISTE');

  app.post<{ Params: { id: string } }>('/api/cronogramas/:id/dependencias', async (request, reply) => {
    const datos = esquemaNuevaDependencia.parse(request.body);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const buscar = (id: string, campo: string) => {
        const a = filas.actividades.find((x) => x.id === id);
        if (!a) throw new ErrorParaElUsuario('Esa actividad no existe en este cronograma.', 'RECHAZADO', campo);
        return a;
      };
      buscar(datos.predecesoraId, 'predecesoraId');
      const sucesora = buscar(datos.sucesoraId, 'sucesoraId');
      if (datos.predecesoraId === datos.sucesoraId) {
        throw new ErrorParaElUsuario('Una actividad no puede depender de sí misma (RF-PRG-05).', 'RECHAZADO', 'predecesoraId');
      }
      // RN-29 · El desfase se escribe en días del calendario de la sucesora y se guarda en horas.
      await cliente.query(
        `INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id, tipo, desfase_horas)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [filas.cabecera.tenantId, filas.cabecera.id, datos.predecesoraId, datos.sucesoraId, datos.tipo, horasDeDias(datos.desfaseDias, factorDe(filas, sucesora.usaCorrido))],
      );
    });
  });

  app.patch<{ Params: { id: string; dependenciaId: string } }>('/api/cronogramas/:id/dependencias/:dependenciaId', async (request, reply) => {
    const datos = esquemaEditarDependencia.parse(request.body);
    const dependenciaId = idDe(request.params.dependenciaId, dependenciaNoExiste);
    return editar(request, reply, datos.version, async (cliente, filas) => {
      const d = filas.dependencias.find((x) => x.id === dependenciaId);
      if (!d) throw dependenciaNoExiste();
      const sucesora = filas.actividades.find((a) => a.id === d.sucesoraId)!;
      await cliente.query('UPDATE app.dependencia SET tipo = $2, desfase_horas = $3 WHERE id = $1', [
        d.id,
        datos.tipo ?? d.tipo,
        datos.desfaseDias === undefined ? d.desfaseHoras : horasDeDias(datos.desfaseDias, factorDe(filas, sucesora.usaCorrido)),
      ]);
    });
  });

  app.delete<{ Params: { id: string; dependenciaId: string }; Querystring: { version?: string } }>(
    '/api/cronogramas/:id/dependencias/:dependenciaId',
    async (request, reply) => {
      const dependenciaId = idDe(request.params.dependenciaId, dependenciaNoExiste);
      return editar(request, reply, versionDeLaRuta(request.query.version), async (cliente, filas) => {
        if (!filas.dependencias.some((x) => x.id === dependenciaId)) throw dependenciaNoExiste();
        await cliente.query('DELETE FROM app.dependencia WHERE id = $1', [dependenciaId]);
      });
    },
  );

  // --- §19.7 · Las curvas ---------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { granularidad?: string; lineaBase?: string } }>('/api/cronogramas/:id/curvas', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const cronogramaId = idDe(request.params.id, cronogramaNoExiste);
    const { granularidad, lineaBase } = request.query;
    if (granularidad !== 'SEMANA' && granularidad !== 'MES') {
      throw new ErrorParaElUsuario('Las curvas se ven por semana o por mes: SEMANA o MES.', 'RECHAZADO', 'granularidad');
    }
    const lineaBaseId = lineaBase === undefined ? null : idDe(lineaBase, lineaBaseNoExiste);
    const curvas = await leerCurvas(contexto, cronogramaId, granularidad, lineaBaseId);
    if (!curvas) throw cronogramaNoExiste();
    return reply.send(curvas);
  });

  // --- §19.8 · Líneas base ----------------------------------------------------------------------
  const esquemaLineaBase = z.strictObject({ version, nombre: nombre('de la línea base') }, SIN_CAMPOS_DE_MAS);
  const esquemaReemplazo = z.strictObject({ version }, SIN_CAMPOS_DE_MAS);

  /** Las cuatro salidas de guardar (§19.8): la foto, el 409 de versión, el de presupuesto cambiado y el de nombre. */
  async function responderLineaBase(reply: FastifyReply, contexto: ContextoTenant, resultado: ResultadoDeLineaBase | null, codigo: 200 | 201, cronogramaId: string | null) {
    if (!resultado) throw cronogramaId === null ? lineaBaseNoExiste() : cronogramaNoExiste();
    if (resultado.tipo === 'HECHO') return reply.code(codigo).send({ lineaBase: resultado.lineaBase });
    if (resultado.tipo === 'NOMBRE_REPETIDO') {
      return reply.code(409).send({ mensaje: `Ya hay una línea base «${resultado.nombre}». ¿Quiere reemplazarla?`, campo: 'nombre', lineaBaseId: resultado.id });
    }
    if (resultado.tipo === 'DESACTUALIZADO') {
      return reply.code(409).send({
        mensaje: 'El presupuesto cambió desde que usted abrió el cronograma. Revise las fechas nuevas y vuelva a guardar la línea base.',
        cronograma: await vista(contexto, resultado.leido),
      });
    }
    const actual = await leerCronograma(contexto, resultado.cronogramaId);
    if (!actual) throw cronogramaNoExiste();
    return reply.code(409).send({ mensaje: OTRA_PERSONA, cronograma: await vista(contexto, actual) });
  }

  app.get<{ Params: { id: string } }>('/api/cronogramas/:id/lineas-base', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const lineasBase = await listarLineasBase(contexto, idDe(request.params.id, cronogramaNoExiste));
    if (!lineasBase) throw cronogramaNoExiste();
    return reply.send({ lineasBase });
  });

  app.post<{ Params: { id: string } }>('/api/cronogramas/:id/lineas-base', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const cronogramaId = idDe(request.params.id, cronogramaNoExiste);
    const datos = esquemaLineaBase.parse(request.body);
    return responderLineaBase(reply, contexto, await guardarLineaBase(contexto, { cronogramaId }, datos.version, datos.nombre), 201, cronogramaId);
  });

  app.post<{ Params: { id: string } }>('/api/lineas-base/:id/reemplazar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const reemplazaId = idDe(request.params.id, lineaBaseNoExiste);
    const datos = esquemaReemplazo.parse(request.body);
    return responderLineaBase(reply, contexto, await guardarLineaBase(contexto, { reemplazaId }, datos.version, null), 200, null);
  });

  app.delete<{ Params: { id: string } }>('/api/lineas-base/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!(await eliminarLineaBase(contexto, idDe(request.params.id, lineaBaseNoExiste)))) throw lineaBaseNoExiste();
    return reply.code(204).send();
  });

  // --- §19.9 · Exportar: el Gantt en PDF, y Project y P6 -----------------------------------
  // Las versiones de P6 son las de los archivos de muestra del dueño (§19.9): la
  // primera es la antigua, que abren casi todas las versiones (07 §6.9).
  const VERSIONES_DE_P6: { id: VersionDeP6; nombre: string }[] = [
    { id: '8.2', nombre: 'P6 8.2' },
    { id: '15.2', nombre: 'P6 15.2' },
    { id: '21.12', nombre: 'P6 21.12 o posterior' },
  ];

  app.get('/api/exportacion/p6', async (request, reply) => {
    await sesionDe(request, reply);
    return reply.send({ versiones: VERSIONES_DE_P6 });
  });

  app.get<{ Params: { id: string }; Querystring: { formato?: string; escala?: string; lineaBase?: string; p6?: string; costo?: string } }>(
    '/api/cronogramas/:id/exportar',
    async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      const cronogramaId = idDe(request.params.id, cronogramaNoExiste);
      const { formato, escala, lineaBase, p6, costo } = request.query;
      if (formato !== 'pdf' && formato !== 'xml' && formato !== 'xer') {
        throw new ErrorParaElUsuario('Elija el formato: pdf, xml (Project) o xer (P6).', 'RECHAZADO', 'formato');
      }
      if (formato === 'pdf' && escala !== 'DIA' && escala !== 'SEMANA' && escala !== 'MES') {
        throw new ErrorParaElUsuario('Elija la escala del Gantt: DIA, SEMANA o MES.', 'RECHAZADO', 'escala');
      }
      if (formato === 'xer' && !VERSIONES_DE_P6.some((v) => v.id === p6)) {
        throw new ErrorParaElUsuario('Elija una versión de P6 de la lista para exportar el XER.', 'RECHAZADO', 'p6');
      }
      if (costo !== undefined && costo !== 'true' && costo !== 'false') {
        throw new ErrorParaElUsuario('Indique si el costo va en el archivo: costo=true o costo=false.', 'RECHAZADO', 'costo');
      }
      const lineaBaseId = lineaBase === undefined ? null : idDe(lineaBase, lineaBaseNoExiste);
      const datos = await leerCronogramaParaExportar(contexto, cronogramaId, lineaBaseId);
      if (!datos) throw cronogramaNoExiste();
      if (formato === 'xer') {
        const vistaXer = armarVista(datos.leido.filas, { editable: false, recalculado: datos.leido.recalculado, lineaBase: null });
        return reply
          .header('content-type', 'application/octet-stream')
          .header('content-disposition', adjunto(`${datos.presupuesto.codigo} - Cronograma.xer`))
          .send(
            generarXer({
              vista: vistaXer,
              filas: datos.leido.filas,
              presupuesto: datos.presupuesto,
              costo: costo === 'true',
              version: p6 as VersionDeP6,
              hoy: hoyEnColombia(),
            }),
          );
      }
      if (formato === 'xml') {
        // RF-PRG-11 · El costo es opcional, y por defecto no va.
        const vistaXml = armarVista(datos.leido.filas, { editable: false, recalculado: datos.leido.recalculado, lineaBase: null });
        return reply
          .header('content-type', 'application/xml; charset=utf-8')
          .header('content-disposition', adjunto(`${datos.presupuesto.codigo} - Cronograma.xml`))
          .send(generarXmlProject({ vista: vistaXml, filas: datos.leido.filas, presupuesto: datos.presupuesto, costo: costo === 'true' }));
      }
      const vistaLeida = armarVista(datos.leido.filas, { editable: false, recalculado: datos.leido.recalculado, lineaBase: datos.leido.lineaBase });
      const archivo = await generarGanttPdf({
        vista: vistaLeida,
        empresa: datos.empresa,
        presupuesto: datos.presupuesto,
        formato: datos.formato,
        escala: escala as 'DIA' | 'SEMANA' | 'MES',
        logo: await leerLogoParaExportar(contexto, datos.empresa.logoRuta),
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', adjunto(`${datos.presupuesto.codigo} - Cronograma.pdf`))
        .send(archivo);
    },
  );

  // --- §19.6 · Cerrar la franja: sin versión, y no la sube (D-93) ----------------------------
  app.post<{ Params: { id: string } }>('/api/cronogramas/:id/aviso/cerrar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!(await cerrarAvisoDelPresupuesto(contexto, idDe(request.params.id, cronogramaNoExiste)))) throw cronogramaNoExiste();
    return reply.code(204).send();
  });
}
