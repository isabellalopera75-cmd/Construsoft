import { redondear } from '../comun/formatoNumerico.js';
import type { CalendarioCompilado } from '../cronograma/calendarioCompilado.js';
import { minutosDeDesfase } from '../cronograma/duraciones.js';
import type { FilasDelCronograma } from '../cronograma/filas.js';
import type { Restriccion, TipoDeRestriccion } from '../cronograma/motor.js';
import { conHorizonte } from '../cronograma/recalculo.js';
import { aMinutos, deMinutos } from '../cronograma/tiempo.js';
import type { ActividadEnVista, VistaCronograma } from '../cronograma/vista.js';
import type { Calendario } from '../infraestructura/basedatos/calendarios.js';
import { filasEnOrden, type Fila } from './gantt.js';

/*
 * RF-PRG-11 · El cronograma en XML de Project (MSPDI, Project 2010 en
 * adelante; D-92). Project no sabe representar todo lo de P6, y el contrato lo
 * dice antes de descargar (CONTRATO §19.9, 07 §6.9):
 *
 *   - Una sola restricción por tarea. La secundaria se conserva solo si es
 *     «fin en o antes de», como fecha límite (Deadline).
 *   - «Inicio el» e «inicio obligatorio» son la misma en Project (MSO), y
 *     «fin el» y «fin obligatorio», también (MFO).
 *   - La administración sale como tarea normal: Project no tiene Level of Effort.
 *   - Una espera del corrido, y el desfase hacia ella, van en días transcurridos
 *     (DurationFormat y LagFormat 8, «edías»). Project pasa las horas a días
 *     con los minutos por día del proyecto, no con el calendario de la tarea:
 *     168 h corridas en días de trabajo se verían como «21 días» (lo encontró
 *     el producto leyendo el archivo con MPXJ, 21 de octubre de 2026).
 *
 * Los capítulos y los grupos de «Hitos y trámites» son tareas resumen, en el
 * nivel que tienen en la EDT. Las fechas van como las calculó el motor; Project
 * las recalcula al abrir. El costo es opcional y por defecto no va (RF-PRG-11).
 *
 * Función pura: la vista y las filas adentro, el texto del archivo afuera. Sin
 * librería: es un documento de forma fija, y lo único delicado es escapar el
 * texto.
 */

export interface DatosDelXml {
  vista: VistaCronograma;
  filas: FilasDelCronograma;
  presupuesto: { codigo: string; nombre: string };
  costo: boolean;
}

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const etiqueta = (nombre: string, valor: string | number) => `<${nombre}>${typeof valor === 'string' ? escapar(valor) : valor}</${nombre}>`;
/** "2026-11-02T07:00" → "2026-11-02T07:00:00", como fecha-hora de MSPDI. */
const fechaHora = (minutos: number) => `${deMinutos(minutos)}:00`;
/** Minutos → duración ISO 8601 de MSPDI: "PT16H0M0S". */
const duracion = (minutos: number) => `PT${Math.floor(minutos / 60)}H${minutos % 60}M0S`;

/** ConstraintType de Project para cada restricción de P6 (0 es «lo antes posible»). */
const TIPO_DE_PROJECT: Record<TipoDeRestriccion, number> = {
  LO_MAS_TARDE: 1,
  INICIO_EL: 2,
  INICIO_OBLIGATORIO: 2,
  FIN_EL: 3,
  FIN_OBLIGATORIO: 3,
  INICIO_DESPUES: 4,
  INICIO_ANTES: 5,
  FIN_DESPUES: 6,
  FIN_ANTES: 7,
};
const esDeInicio = (r: Restriccion) => r.tipo.startsWith('INICIO');

/** FC, CC, FF y CF en los números de Project: FF = 0, FS = 1, SF = 2, SS = 3. */
const TIPO_DE_RELACION = { FF: 0, FC: 1, CF: 2, CC: 3 } as const;

/** DurationFormat y LagFormat de MSPDI: 7 son días de trabajo; 8, días transcurridos. */
const formatoDeDias = (a: ActividadEnVista) => (a.usaCorrido ? 8 : 7);

/** El costo en centavos, como lo guarda MSPDI. Sobre el texto: el dinero no pasa por Number (regla 1.1). */
function centavos(costo: string): string {
  const [entera, decimales] = redondear(costo, 2).split('.');
  return `${entera}${decimales}`.replace(/^0+(?=\d)/, '');
}

function calendarioXml(uid: number, c: Calendario): string {
  // DayType de Project: 1 es el domingo. La semana del sistema empieza el lunes.
  const dias = c.semana.map((tramos, i) => {
    const horas = tramos.map((t) => `<WorkingTime><FromTime>${t.inicio}:00</FromTime><ToTime>${t.fin === '24:00' ? '00:00' : t.fin}:00</ToTime></WorkingTime>`);
    return `<WeekDay><DayType>${((i + 1) % 7) + 1}</DayType><DayWorking>${tramos.length > 0 ? 1 : 0}</DayWorking>${
      horas.length > 0 ? `<WorkingTimes>${horas.join('')}</WorkingTimes>` : ''
    }</WeekDay>`;
  });
  const excepciones = c.excepciones.map((e) => {
    const horas = e.tramos.map((t) => `<WorkingTime><FromTime>${t.inicio}:00</FromTime><ToTime>${t.fin === '24:00' ? '00:00' : t.fin}:00</ToTime></WorkingTime>`);
    return (
      `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${e.fecha}T00:00:00</FromDate><ToDate>${e.fecha}T23:59:00</ToDate></TimePeriod>` +
      `<Occurrences>1</Occurrences>${etiqueta('Name', e.motivo ?? 'Excepción')}<Type>1</Type><DayWorking>${e.tramos.length > 0 ? 1 : 0}</DayWorking>` +
      `${horas.length > 0 ? `<WorkingTimes>${horas.join('')}</WorkingTimes>` : ''}</Exception>`
    );
  });
  return (
    `<Calendar><UID>${uid}</UID>${etiqueta('Name', c.nombre)}<IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID>` +
    `<WeekDays>${dias.join('')}</WeekDays>${excepciones.length > 0 ? `<Exceptions>${excepciones.join('')}</Exceptions>` : ''}</Calendar>`
  );
}

export function generarXmlProject(datos: DatosDelXml): string {
  const { vista, filas, presupuesto, costo } = datos;
  const fechas = [vista.cronograma.fechaInicio, ...vista.actividades.flatMap((a) => [a.inicio.slice(0, 10), a.fin.slice(0, 10)])];
  for (const a of vista.actividades) for (const r of [a.restriccion, a.restriccionSecundaria]) if (r?.fecha) fechas.push(r.fecha);

  return conHorizonte(filas, fechas, (cal) => {
    const calDe = (a: ActividadEnVista): CalendarioCompilado => (a.usaCorrido ? cal.CORRIDO : cal.OBRA);
    const ordenadas = filasEnOrden(vista);
    const uidDe = new Map<string, number>();
    ordenadas.forEach((f, i) => {
      if (f.tipo === 'actividad') uidDe.set(f.actividad.id, i + 1);
    });
    const desfaseDe = new Map(filas.dependencias.map((d) => [d.id, minutosDeDesfase(d.desfaseHoras)]));

    /** Inicio y fin de una tarea resumen: lo de las filas más hondas que la siguen. */
    const rangoDeResumen = (i: number, nivel: number): [number, number] | null => {
      let [desde, hasta] = [Infinity, -Infinity];
      for (let j = i + 1; j < ordenadas.length && ordenadas[j]!.nivel > nivel; j += 1) {
        const f = ordenadas[j]!;
        if (f.tipo !== 'actividad') continue;
        desde = Math.min(desde, aMinutos(f.actividad.inicio));
        hasta = Math.max(hasta, aMinutos(f.actividad.fin));
      }
      return desde === Infinity ? null : [desde, hasta];
    };

    // «Hitos y trámites» es HT y sus subgrupos HT-1, HT-2…: sin WBS, Project
    // (o MPXJ) numera el resumen por su cuenta, y ese número puede chocar con
    // el de un capítulo.
    let subgrupo = 0;
    const wbsDelTitulo = (nivel: number) => (nivel === 1 ? 'HT' : `HT-${(subgrupo += 1)}`);

    const tarea = (f: Fila, i: number): string => {
      const partes = [etiqueta('UID', i + 1), etiqueta('ID', i + 1)];
      if (f.tipo !== 'actividad') {
        const nombre = f.tipo === 'titulo' ? f.texto : f.nombre;
        const rango = rangoDeResumen(i, f.nivel) ?? [aMinutos(vista.cronograma.inicio), aMinutos(vista.cronograma.inicio)];
        partes.push(
          etiqueta('Name', nombre),
          etiqueta('WBS', f.tipo === 'capitulo' ? f.codigo : wbsDelTitulo(f.nivel)),
          etiqueta('OutlineLevel', f.nivel),
          etiqueta('Start', fechaHora(rango[0])),
          etiqueta('Finish', fechaHora(rango[1])),
          etiqueta('Duration', duracion(cal.OBRA.minutosLaborablesEntre(rango[0], rango[1]))),
          etiqueta('DurationFormat', 7),
          etiqueta('Milestone', 0),
          etiqueta('Summary', rangoDeResumen(i, f.nivel) ? 1 : 0),
        );
        return `<Task>${partes.join('')}</Task>`;
      }

      const a = f.actividad;
      const c = calDe(a);
      const [inicio, fin] = [aMinutos(a.inicio), aMinutos(a.fin)];
      const hito = a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN';
      partes.push(
        etiqueta('Name', a.nombre),
        etiqueta('WBS', a.codigo),
        etiqueta('OutlineLevel', f.nivel),
        etiqueta('Start', fechaHora(inicio)),
        etiqueta('Finish', fechaHora(fin)),
        etiqueta('Duration', duracion(hito ? 0 : c.minutosLaborablesEntre(inicio, fin))),
        etiqueta('DurationFormat', formatoDeDias(a)),
        etiqueta('Milestone', hito ? 1 : 0),
        etiqueta('Summary', 0),
      );
      const conCosto = (a.tipo === 'ITEM' && a.enPresupuesto) || a.tipo === 'ADMINISTRACION';
      if (costo && conCosto) partes.push(etiqueta('FixedCost', centavos(a.costo)), etiqueta('FixedCostAccrual', 3));
      const r = a.restriccion;
      partes.push(etiqueta('ConstraintType', r ? TIPO_DE_PROJECT[r.tipo] : 0));
      if (a.usaCorrido) partes.push(etiqueta('CalendarUID', 2));
      if (r?.fecha) partes.push(etiqueta('ConstraintDate', fechaHora(esDeInicio(r) ? c.comienzoDeJornada(r.fecha) : c.cierreDeJornada(r.fecha))));
      const s = a.restriccionSecundaria;
      if (s?.tipo === 'FIN_ANTES' && s.fecha) partes.push(etiqueta('Deadline', fechaHora(c.cierreDeJornada(s.fecha))));
      for (const d of vista.dependencias.filter((x) => x.sucesoraId === a.id)) {
        const uid = uidDe.get(d.predecesoraId);
        if (uid === undefined) continue;
        partes.push(
          `<PredecessorLink><PredecessorUID>${uid}</PredecessorUID><Type>${TIPO_DE_RELACION[d.tipo as keyof typeof TIPO_DE_RELACION]}</Type>` +
            // RN-29 · El desfase se cuenta en el calendario de la sucesora, que es esta tarea.
            `<CrossProject>0</CrossProject><LinkLag>${(desfaseDe.get(d.id) ?? 0) * 10}</LinkLag><LagFormat>${formatoDeDias(a)}</LagFormat></PredecessorLink>`,
        );
      }
      return `<Task>${partes.join('')}</Task>`;
    };

    const obra = vista.calendarios.obra;
    const minutosPorDia = Math.round(Number(obra.horasPorDia) * 60);
    const minutosPorSemana = Math.round(Number(obra.horasSemana) * 60);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Project xmlns="http://schemas.microsoft.com/project">',
      etiqueta('SaveVersion', 14),
      etiqueta('Name', `${presupuesto.codigo} - Cronograma.xml`),
      etiqueta('Title', `${presupuesto.codigo} — ${presupuesto.nombre}`),
      etiqueta('ScheduleFromStart', 1),
      etiqueta('StartDate', fechaHora(aMinutos(vista.cronograma.inicio))),
      etiqueta('FinishDate', fechaHora(aMinutos(vista.cronograma.fin))),
      etiqueta('CalendarUID', 1),
      etiqueta('MinutesPerDay', minutosPorDia),
      etiqueta('MinutesPerWeek', minutosPorSemana),
      etiqueta('DaysPerMonth', 20),
      `<Calendars>${calendarioXml(1, obra)}${calendarioXml(2, vista.calendarios.corrido)}</Calendars>`,
      `<Tasks>${ordenadas.map(tarea).join('')}</Tasks>`,
      '</Project>',
      '',
    ].join('\n');
  });
}
