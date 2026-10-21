import type { Calendario } from '../infraestructura/basedatos/calendarios.js';
import { diasDeHoras, diasDeMinutos, minutosDeDuracionManual } from './duraciones.js';
import type { FilaActividad, FilaCalculo, FilasDelCronograma } from './filas.js';
import type { Restriccion } from './motor.js';
import { conHorizonte, type CalendariosCompilados } from './recalculo.js';
import { aMinutos, deMinutos } from './tiempo.js';

/*
 * La VistaCronograma del CONTRATO §19.5, armada desde lo que guardó el último
 * cálculo. Puro: no lee la base ni recalcula. Las duraciones, holguras y
 * desfases salen en días con un decimal, convertidos con el factor del
 * calendario que corresponde (§19.1); el dinero sale como texto, tal cual lo
 * leyó la base.
 */

export interface LineaBaseLeida {
  id: string;
  nombre: string;
  guardadaEn: Date;
  actividades: { actividadId: string; inicio: string; fin: string; duracionMinutos: number }[];
}

export interface OpcionesDeLaVista {
  editable: boolean;
  recalculado: boolean;
  lineaBase: LineaBaseLeida | null;
}

export interface ActividadEnVista {
  id: string;
  tipo: FilaActividad['tipo'];
  codigo: string;
  nombre: string;
  capituloId: string | null;
  grupoId: string | null;
  orden: number;
  presupuestoItemId: string | null;
  enPresupuesto: boolean;
  cantidad: string | null;
  unidad: string | null;
  rendimiento: string | null;
  costo: string;
  cuadrillas: number;
  usaCorrido: boolean;
  duracionCalculadaDias: string | null;
  duracionManualDias: string | null;
  duracionDias: string;
  restriccion: Restriccion | null;
  restriccionSecundaria: Restriccion | null;
  inicio: string;
  fin: string;
  inicioTardio: string | null;
  finTardio: string | null;
  holguraTotalDias: string | null;
  holguraLibreDias: string | null;
  critica: boolean;
  finAMitadDeJornada: boolean;
}

export interface VistaCronograma {
  cronograma: {
    id: string;
    presupuestoId: string;
    version: number;
    fechaInicio: string;
    inicioSemana: number;
    editable: boolean;
    recalculado: boolean;
    inicio: string;
    fin: string;
    duracionDias: string;
  };
  calendarios: { obra: Calendario; corrido: Calendario };
  capitulos: {
    id: string;
    padreId: string | null;
    codigo: string;
    nombre: string;
    nivel: number;
    posicion: number;
    inicio: string | null;
    fin: string | null;
    duracionDias: string | null;
    critico: boolean;
  }[];
  grupos: { id: string; nombre: string; orden: number }[];
  actividades: ActividadEnVista[];
  dependencias: { id: string; predecesoraId: string; sucesoraId: string; tipo: string; desfaseDias: string }[];
  revision: {
    sinProgramar: string[];
    yaNoEstan: string[];
    manualDistinta: string[];
    sinRendimiento: string[];
    sinPredecesora: string[];
    sinSucesora: string[];
    holguraNegativa: string[];
  };
  avisos: {
    presupuesto: unknown;
    festivos: { hasta: number; finDelProyecto: string } | null;
    administracion: { lineaBaseId: string; finLineaBase: string; finActual: string; diasDeMas: string } | null;
  };
  lineasBase: { id: string; nombre: string; guardadaEn: Date; guardadaPor: string | null; fin: string }[];
  lineaBase: {
    id: string;
    nombre: string;
    guardadaEn: Date;
    actividades: {
      actividadId: string;
      inicio: string;
      fin: string;
      duracionDias: string;
      variacionInicioDias: string | null;
      variacionFinDias: string | null;
    }[];
  } | null;
}

/** El orden de la pantalla (§19.5): presupuesto por EDT, las que ya no están, la administración, y hitos y trámites. */
function ordenar(filas: FilasDelCronograma): FilaActividad[] {
  const posicionDelGrupo = new Map(filas.grupos.map((g) => [g.id, g.orden]));
  const clave = (a: FilaActividad): [number, number, number] => {
    if (a.tipo === 'ITEM') return [a.item ? 0 : 1, 0, a.orden];
    if (a.tipo === 'ADMINISTRACION') return [2, 0, 0];
    // La raíz del grupo va antes que cualquier subgrupo, cuyo orden nunca es negativo.
    return [3, a.grupoId === null ? -1 : (posicionDelGrupo.get(a.grupoId) ?? 0), a.orden];
  };
  return [...filas.actividades].sort((x, y) => {
    const [a, b] = [clave(x), clave(y)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || x.codigo.localeCompare(y.codigo);
  });
}

export function armarVista(filas: FilasDelCronograma, opciones: OpcionesDeLaVista): VistaCronograma {
  const { obra, corrido } = filas.calendarios;
  const factorDe = (a: FilaActividad | undefined) => (a?.usaCorrido ? corrido.horasPorDia : obra.horasPorDia);
  const calculo = (id: string): FilaCalculo => {
    const c = filas.calculos.get(id);
    if (!c) throw new Error(`La actividad ${id} no tiene cálculo: la vista se arma después de recalcular.`);
    return c;
  };
  const porId = new Map(filas.actividades.map((a) => [a.id, a]));
  const actividades = ordenar(filas);

  // Las fechas que el horizonte tiene que cubrir para las cuentas de la vista.
  const fechas = [filas.cabecera.fechaInicio];
  for (const c of filas.calculos.values()) fechas.push(c.inicio.slice(0, 10), c.fin.slice(0, 10));
  for (const a of opciones.lineaBase?.actividades ?? []) fechas.push(a.inicio.slice(0, 10), a.fin.slice(0, 10));

  return conHorizonte(filas, fechas, (cal: CalendariosCompilados) => {
    const calDe = (a: FilaActividad | undefined) => (a?.usaCorrido ? cal.CORRIDO : cal.OBRA);
    const sinAdm = actividades.filter((a) => a.tipo !== 'ADMINISTRACION');
    const delProyecto = sinAdm.length > 0 ? sinAdm : actividades;
    const inicio = Math.min(...delProyecto.map((a) => aMinutos(calculo(a.id).inicio)));
    const fin = Math.max(...delProyecto.map((a) => aMinutos(calculo(a.id).fin)));
    const diasDeObra = (minutos: number) => diasDeMinutos(minutos, obra.horasPorDia);

    // --- Actividades -----------------------------------------------------------
    const enVista: ActividadEnVista[] = actividades.map((a) => {
      const c = calculo(a.id);
      const factor = factorDe(a);
      const dias = (minutos: number | null) => (minutos === null ? null : diasDeMinutos(minutos, factor));
      const hito = a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN';
      return {
        id: a.id,
        tipo: a.tipo,
        codigo: a.codigo,
        nombre: a.nombre,
        capituloId: a.item?.wbsNodoId ?? null,
        grupoId: a.grupoId,
        orden: a.orden,
        presupuestoItemId: a.presupuestoItemId,
        enPresupuesto: a.item !== null,
        cantidad: a.item?.cantidad ?? null,
        unidad: a.item?.unidad ?? null,
        rendimiento: a.item?.rendimiento ?? null,
        costo: a.tipo === 'ADMINISTRACION' ? filas.presupuesto.totalAdministracion : (a.item?.costo ?? '0.000000'),
        cuadrillas: a.cuadrillas,
        usaCorrido: a.usaCorrido,
        duracionCalculadaDias: dias(c.duracionCalculadaMinutos),
        duracionManualDias: a.duracionManualHoras === null ? null : diasDeHoras(a.duracionManualHoras, factor),
        duracionDias: diasDeMinutos(c.duracionMinutos, factor),
        restriccion: a.restriccion,
        restriccionSecundaria: a.restriccionSecundaria,
        inicio: c.inicio,
        fin: c.fin,
        inicioTardio: c.inicioTardio,
        finTardio: c.finTardio,
        holguraTotalDias: dias(c.holguraTotalMinutos),
        holguraLibreDias: dias(c.holguraLibreMinutos),
        critica: c.critica,
        finAMitadDeJornada: !hito && c.duracionMinutos > 0 && !calDe(a).esCierreDeJornada(aMinutos(c.fin)),
      };
    });

    // --- Capítulos: barras resumen de sus actividades del presupuesto -----------
    const hijos = new Map<string, string[]>();
    for (const k of filas.capitulos) if (k.padreId) hijos.set(k.padreId, [...(hijos.get(k.padreId) ?? []), k.id]);
    const delNodo = new Map<string, ActividadEnVista[]>();
    for (const a of enVista) if (a.enPresupuesto && a.capituloId) delNodo.set(a.capituloId, [...(delNodo.get(a.capituloId) ?? []), a]);
    const debajo = (id: string): ActividadEnVista[] => [...(delNodo.get(id) ?? []), ...(hijos.get(id) ?? []).flatMap(debajo)];
    const capitulos = filas.capitulos.map((k) => {
      const suyas = debajo(k.id);
      if (suyas.length === 0) return { ...k, inicio: null, fin: null, duracionDias: null, critico: false };
      const i = Math.min(...suyas.map((a) => aMinutos(a.inicio)));
      const f = Math.max(...suyas.map((a) => aMinutos(a.fin)));
      return { ...k, inicio: deMinutos(i), fin: deMinutos(f), duracionDias: diasDeObra(cal.OBRA.minutosLaborablesEntre(i, f)), critico: suyas.some((a) => a.critica) };
    });

    // --- Revisión (RF-PRG-07): el estado de ahora ---------------------------------
    const conPredecesora = new Set(filas.dependencias.map((d) => d.sucesoraId));
    const conSucesora = new Set(filas.dependencias.map((d) => d.predecesoraId));
    const ids = (filtro: (a: FilaActividad) => boolean) => actividades.filter(filtro).map((a) => a.id);
    const revision = {
      sinProgramar: ids((a) => a.tipo === 'ITEM' && a.item !== null && !conPredecesora.has(a.id) && !conSucesora.has(a.id)),
      yaNoEstan: ids((a) => a.tipo === 'ITEM' && a.item === null),
      manualDistinta: ids((a) => {
        const calculada = calculo(a.id).duracionCalculadaMinutos;
        return a.duracionManualHoras !== null && calculada !== null && minutosDeDuracionManual(a.duracionManualHoras) !== calculada;
      }),
      sinRendimiento: ids((a) => a.tipo === 'ITEM' && a.item !== null && a.item.rendimiento === null && a.duracionManualHoras === null),
      sinPredecesora: ids((a) => a.tipo !== 'ADMINISTRACION' && !conPredecesora.has(a.id)),
      sinSucesora: ids((a) => a.tipo !== 'ADMINISTRACION' && !conSucesora.has(a.id)),
      holguraNegativa: ids((a) => (calculo(a.id).holguraTotalMinutos ?? 0) < 0),
    };

    // --- Avisos ------------------------------------------------------------------
    const finDelProyecto = deMinutos(fin);
    const festivos =
      obra.festivos.hasta !== null && Number(finDelProyecto.slice(0, 4)) > obra.festivos.hasta
        ? { hasta: obra.festivos.hasta, finDelProyecto: finDelProyecto.slice(0, 10) }
        : null;

    let lineaBase: VistaCronograma['lineaBase'] = null;
    let administracion: VistaCronograma['avisos']['administracion'] = null;
    if (opciones.lineaBase) {
      const lb = opciones.lineaBase;
      lineaBase = {
        id: lb.id,
        nombre: lb.nombre,
        guardadaEn: lb.guardadaEn,
        actividades: lb.actividades.map((x) => {
          const actual = porId.get(x.actividadId);
          const c = actual ? filas.calculos.get(actual.id) : undefined;
          const variacion = (antes: string, ahora: string) => diasDeMinutos(calDe(actual).minutosLaborablesEntre(aMinutos(antes), aMinutos(ahora)), factorDe(actual));
          return {
            actividadId: x.actividadId,
            inicio: x.inicio,
            fin: x.fin,
            duracionDias: diasDeMinutos(x.duracionMinutos, factorDe(actual)),
            variacionInicioDias: c ? variacion(x.inicio, c.inicio) : null,
            variacionFinDias: c ? variacion(x.fin, c.fin) : null,
          };
        }),
      };
      const finLineaBase = Math.max(...lb.actividades.map((x) => aMinutos(x.fin)));
      if (lb.actividades.length > 0 && fin > finLineaBase) {
        administracion = {
          lineaBaseId: lb.id,
          finLineaBase: deMinutos(finLineaBase),
          finActual: finDelProyecto,
          diasDeMas: diasDeObra(cal.OBRA.minutosLaborablesEntre(finLineaBase, fin)),
        };
      }
    }

    return {
      cronograma: {
        id: filas.cabecera.id,
        presupuestoId: filas.cabecera.presupuestoId,
        version: filas.cabecera.version,
        fechaInicio: filas.cabecera.fechaInicio,
        inicioSemana: filas.cabecera.inicioSemana,
        editable: opciones.editable,
        recalculado: opciones.recalculado,
        inicio: deMinutos(inicio),
        fin: finDelProyecto,
        duracionDias: diasDeObra(cal.OBRA.minutosLaborablesEntre(inicio, fin)),
      },
      calendarios: { obra, corrido },
      capitulos,
      grupos: [...filas.grupos].sort((a, b) => a.orden - b.orden),
      actividades: enVista,
      dependencias: filas.dependencias.map((d) => ({
        id: d.id,
        predecesoraId: d.predecesoraId,
        sucesoraId: d.sucesoraId,
        tipo: d.tipo,
        desfaseDias: diasDeHoras(d.desfaseHoras, factorDe(porId.get(d.sucesoraId))),
      })),
      revision,
      avisos: { presupuesto: filas.cabecera.aviso ?? null, festivos, administracion },
      lineasBase: filas.lineasBase,
      lineaBase,
    };
  });
}
