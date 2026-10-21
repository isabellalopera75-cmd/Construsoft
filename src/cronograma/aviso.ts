import { diasDeMinutos } from './duraciones.js';
import type { FilaActividad, FilasDelCronograma } from './filas.js';

/*
 * La franja «el presupuesto cambió» (D-93, D-94, CONTRATO §19.5). La arma el
 * recálculo que provoca un cambio del presupuesto, comparando su resultado con
 * el del cálculo anterior, y la acumula sobre la que ya estaba guardada hasta
 * que alguien la cierra o guarda un cambio en el cronograma. Puro: compara
 * filas y devuelve el objeto que se guarda en cronograma.aviso_presupuesto.
 *
 * Comparar dos valores totales es comparar dos textos: aquí no se hacen
 * cuentas con dinero (regla 1.1).
 */

export interface ActividadDelAviso {
  id: string;
  codigo: string;
  nombre: string;
}

export interface AvisoDelPresupuesto {
  ultimoCambio: string;
  entraron: ActividadDelAviso[];
  salieron: ActividadDelAviso[];
  duracionesCambiadas: (ActividadDelAviso & { antesDias: string; ahoraDias: string })[];
  finAntes: string;
  finAhora: string;
  valorTotalAntes: string;
  valorTotalAhora: string;
}

/** Lo guardado, si tiene la forma de un aviso; si no (nulo, u otra cosa), como si no hubiera. */
function leerGuardado(guardado: unknown): AvisoDelPresupuesto | null {
  if (typeof guardado !== 'object' || guardado === null) return null;
  const a = guardado as Partial<AvisoDelPresupuesto>;
  const listas = [a.entraron, a.salieron, a.duracionesCambiadas].every(Array.isArray);
  return listas && typeof a.finAntes === 'string' && typeof a.valorTotalAntes === 'string' ? (a as AvisoDelPresupuesto) : null;
}

/** El fin del proyecto según unos cálculos: el más tardío, sin la administración. */
function finDe(filas: Pick<FilasDelCronograma, 'actividades' | 'calculos'>): string {
  let fin = '';
  for (const a of filas.actividades) {
    if (a.tipo === 'ADMINISTRACION') continue;
    const c = filas.calculos.get(a.id);
    if (c && c.fin > fin) fin = c.fin;
  }
  return fin;
}

/**
 * El aviso nuevo, a partir del cálculo anterior (`antes`, con su
 * calculadoValorTotal) y del de ahora. 'SIN_CAMBIO': lo que cambió en el
 * presupuesto no movió nada de lo que el aviso muestra, y el guardado no se
 * toca. null: después de acumular no quedó nada, y el aviso se anula.
 */
export function acumularAviso(antes: FilasDelCronograma, ahora: FilasDelCronograma): AvisoDelPresupuesto | null | 'SIN_CAMBIO' {
  const factor = (a: FilaActividad) => (a.usaCorrido ? ahora.calendarios.corrido.horasPorDia : ahora.calendarios.obra.horasPorDia);
  const resumen = (a: FilaActividad): ActividadDelAviso => ({ id: a.id, codigo: a.codigo, nombre: a.nombre });

  // --- Lo que cambió en este recálculo -------------------------------------------
  const entraron: ActividadDelAviso[] = [];
  const salieron: ActividadDelAviso[] = [];
  const duraciones = new Map<string, { a: FilaActividad; antesDias: string; ahoraDias: string }>();
  for (const a of ahora.actividades) {
    if (a.tipo !== 'ITEM') continue;
    const previo = antes.calculos.get(a.id);
    const actual = ahora.calculos.get(a.id)!;
    if (a.item !== null && !previo) entraron.push(resumen(a));
    else if (a.item === null && previo?.enPresupuesto) salieron.push(resumen(a));
    else if (a.item !== null && previo?.enPresupuesto && previo.duracionMinutos !== actual.duracionMinutos) {
      duraciones.set(a.id, { a, antesDias: diasDeMinutos(previo.duracionMinutos, factor(a)), ahoraDias: diasDeMinutos(actual.duracionMinutos, factor(a)) });
    }
  }
  const finAntes = finDe(antes);
  const finAhora = finDe(ahora);
  const valorAntes = antes.cabecera.calculadoValorTotal ?? ahora.presupuesto.valorTotal;
  const valorAhora = ahora.presupuesto.valorTotal;
  const algoCambio =
    entraron.length > 0 || salieron.length > 0 || duraciones.size > 0 || finAntes !== finAhora || valorAntes !== valorAhora;
  if (!algoCambio) return 'SIN_CAMBIO';

  // --- Acumular sobre lo guardado (§19.5) ------------------------------------------
  const guardado = leerGuardado(ahora.cabecera.aviso);
  const existe = new Map(ahora.actividades.map((a) => [a.id, a]));
  const vigente = (x: ActividadDelAviso) => {
    const a = existe.get(x.id);
    return a ? resumen(a) : null;
  };
  const unir = (previas: ActividadDelAviso[], nuevas: ActividadDelAviso[]) => {
    const ids = new Set<string>();
    const lista: ActividadDelAviso[] = [];
    for (const x of [...previas, ...nuevas]) {
      const actual = vigente(x);
      if (actual && !ids.has(actual.id)) {
        ids.add(actual.id);
        lista.push(actual);
      }
    }
    return lista;
  };
  let todasEntraron = unir(guardado?.entraron ?? [], entraron);
  let todasSalieron = unir(guardado?.salieron ?? [], salieron);
  // Entró y salió antes de que alguien cerrara la franja: no queda en ninguna.
  const idaYVuelta = new Set(todasEntraron.filter((x) => todasSalieron.some((y) => y.id === x.id)).map((x) => x.id));
  todasEntraron = todasEntraron.filter((x) => !idaYVuelta.has(x.id));
  todasSalieron = todasSalieron.filter((x) => !idaYVuelta.has(x.id));

  // Las duraciones: «antes» es la del primer recálculo; «ahora», la de este.
  const fuera = new Set([...todasEntraron.map((x) => x.id), ...todasSalieron.map((x) => x.id), ...idaYVuelta]);
  const porId = new Map<string, AvisoDelPresupuesto['duracionesCambiadas'][number]>();
  for (const d of guardado?.duracionesCambiadas ?? []) {
    const a = existe.get(d.id);
    if (a && !fuera.has(d.id)) porId.set(d.id, { ...resumen(a), antesDias: d.antesDias, ahoraDias: d.ahoraDias });
  }
  for (const [id, d] of duraciones) {
    if (fuera.has(id)) continue;
    porId.set(id, { ...resumen(d.a), antesDias: porId.get(id)?.antesDias ?? d.antesDias, ahoraDias: d.ahoraDias });
  }
  // Una duración que volvió a su valor de antes sale de la franja.
  const duracionesCambiadas = [...porId.values()].filter((d) => d.antesDias !== d.ahoraDias);

  const aviso: AvisoDelPresupuesto = {
    ultimoCambio: ahora.presupuesto.fechaModificacion.toISOString(),
    entraron: todasEntraron,
    salieron: todasSalieron,
    duracionesCambiadas,
    finAntes: guardado?.finAntes ?? finAntes,
    finAhora,
    valorTotalAntes: guardado?.valorTotalAntes ?? valorAntes,
    valorTotalAhora: valorAhora,
  };
  const vacio =
    aviso.entraron.length === 0 &&
    aviso.salieron.length === 0 &&
    aviso.duracionesCambiadas.length === 0 &&
    aviso.finAntes === aviso.finAhora &&
    aviso.valorTotalAntes === aviso.valorTotalAhora;
  return vacio ? null : aviso;
}
