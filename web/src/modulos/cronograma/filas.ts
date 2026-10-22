import type { Actividad, Capitulo, Grupo, TipoDeRestriccion, VistaCronograma } from '../../api/tiposCronograma.ts';
import type { NodoPlegable } from '../../componentes/Niveles.tsx';

/*
 * Las filas de la tabla del cronograma, en el orden de la pantalla (CONTRATO
 * §19.5): las actividades del presupuesto bajo sus capítulos, en el orden de
 * la EDT; las que ya no están en el presupuesto; la administración; y «Hitos y
 * trámites», primero la raíz y después cada subgrupo.
 *
 * El orden de los hermanos es el de `posicion` y `orden`, que manda el
 * servidor, nunca el texto del código (DISENO §10).
 */

export type Fila =
  | { clase: 'capitulo'; clave: string; nivel: number; capitulo: Capitulo; plegable: boolean }
  | { clase: 'actividad'; clave: string; nivel: number; actividad: Actividad }
  | { clase: 'titulo'; clave: string; nivel: number; texto: string; id: 'fuera' | 'hitos'; inicio: string | null; fin: string | null; plegable: boolean }
  | { clase: 'grupo'; clave: string; nivel: number; grupo: Grupo; inicio: string | null; fin: string | null; plegable: boolean; primero: boolean; ultimo: boolean };

export const RAIZ_DE_HITOS = 'hitos';

export function esHitoOTramite(a: Actividad): boolean {
  return a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN' || a.tipo === 'SIN_COSTO';
}

export function esHito(a: Actividad): boolean {
  return a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN';
}

/** Lo que ocupan unas actividades, para la barra resumen de un grupo. */
function extremos(acts: Actividad[]): { inicio: string | null; fin: string | null } {
  if (acts.length === 0) return { inicio: null, fin: null };
  // Una FechaHora tiene ancho fijo y va de lo grande a lo chico: compararla
  // como texto es compararla en el tiempo. No es un instante con zona.
  let inicio = acts[0]?.inicio ?? '';
  let fin = acts[0]?.fin ?? '';
  for (const a of acts) {
    if (a.inicio < inicio) inicio = a.inicio;
    if (a.fin > fin) fin = a.fin;
  }
  return { inicio, fin };
}

export function armarFilas(vista: VistaCronograma, plegados: ReadonlySet<string>): Fila[] {
  const filas: Fila[] = [];
  const porCapitulo = new Map<string, Actividad[]>();
  for (const a of vista.actividades) {
    if (a.tipo === 'ITEM' && a.capituloId) {
      const lista = porCapitulo.get(a.capituloId) ?? [];
      lista.push(a);
      porCapitulo.set(a.capituloId, lista);
    }
  }
  const hijos = new Map<string | null, Capitulo[]>();
  for (const c of vista.capitulos) {
    const lista = hijos.get(c.padreId) ?? [];
    lista.push(c);
    hijos.set(c.padreId, lista);
  }
  for (const lista of hijos.values()) lista.sort((a, b) => a.posicion - b.posicion);

  const recorrer = (padre: string | null, nivel: number) => {
    for (const c of hijos.get(padre) ?? []) {
      const subcapitulos = hijos.get(c.id) ?? [];
      const actividades = porCapitulo.get(c.id) ?? [];
      filas.push({ clase: 'capitulo', clave: c.id, nivel, capitulo: c, plegable: subcapitulos.length + actividades.length > 0 });
      if (plegados.has(c.id)) continue;
      // D-75: en un nivel, los subcapítulos van antes que las actividades.
      recorrer(c.id, nivel + 1);
      for (const a of actividades) filas.push({ clase: 'actividad', clave: a.id, nivel: nivel + 1, actividad: a });
    }
  };
  recorrer(null, 0);

  const fuera = vista.actividades.filter((a) => a.tipo === 'ITEM' && !a.enPresupuesto);
  if (fuera.length > 0) {
    filas.push({ clase: 'titulo', clave: 'fuera', id: 'fuera', nivel: 0, texto: 'Ya no están en el presupuesto', ...extremos(fuera), plegable: true });
    if (!plegados.has('fuera')) for (const a of fuera) filas.push({ clase: 'actividad', clave: a.id, nivel: 1, actividad: a });
  }

  for (const a of vista.actividades) if (a.tipo === 'ADMINISTRACION') filas.push({ clase: 'actividad', clave: a.id, nivel: 0, actividad: a });

  const hitos = vista.actividades.filter(esHitoOTramite);
  filas.push({ clase: 'titulo', clave: RAIZ_DE_HITOS, id: 'hitos', nivel: 0, texto: 'Hitos y trámites', ...extremos(hitos), plegable: hitos.length > 0 || vista.grupos.length > 0 });
  if (!plegados.has(RAIZ_DE_HITOS)) {
    for (const a of hitos.filter((x) => x.grupoId === null).sort((x, y) => x.orden - y.orden)) filas.push({ clase: 'actividad', clave: a.id, nivel: 1, actividad: a });
    const grupos = [...vista.grupos].sort((a, b) => a.orden - b.orden);
    grupos.forEach((g, i) => {
      const suyas = hitos.filter((x) => x.grupoId === g.id).sort((x, y) => x.orden - y.orden);
      filas.push({ clase: 'grupo', clave: g.id, nivel: 1, grupo: g, ...extremos(suyas), plegable: suyas.length > 0, primero: i === 0, ultimo: i === grupos.length - 1 });
      if (!plegados.has(g.id)) for (const a of suyas) filas.push({ clase: 'actividad', clave: a.id, nivel: 2, actividad: a });
    });
  }
  return filas;
}

/**
 * Las filas que se pliegan, con su profundidad (1 es la raíz), y cuántos
 * niveles tiene la tabla contando las actividades (componentes/Niveles.tsx).
 * Se calcula sobre la vista entera, no sobre las filas que se ven: un capítulo
 * plegado esconde a sus hijos, pero sus hijos siguen teniendo su nivel.
 */
export function nivelesDelCronograma(vista: VistaCronograma): { nodos: NodoPlegable[]; niveles: number } {
  const nodos: NodoPlegable[] = [];
  let niveles = 1;
  const conActividades = new Set(vista.actividades.filter((a) => a.tipo === 'ITEM' && a.capituloId).map((a) => a.capituloId));
  const hijos = new Map<string | null, Capitulo[]>();
  for (const c of vista.capitulos) hijos.set(c.padreId, [...(hijos.get(c.padreId) ?? []), c]);
  const recorrer = (padre: string | null, profundidad: number) => {
    for (const c of hijos.get(padre) ?? []) {
      const subcapitulos = hijos.get(c.id) ?? [];
      const actividades = conActividades.has(c.id);
      niveles = Math.max(niveles, profundidad + (actividades ? 1 : 0));
      if (subcapitulos.length > 0 || actividades) nodos.push({ clave: c.id, profundidad });
      recorrer(c.id, profundidad + 1);
    }
  };
  recorrer(null, 1);
  if (vista.actividades.some((a) => a.tipo === 'ITEM' && !a.enPresupuesto)) {
    nodos.push({ clave: 'fuera', profundidad: 1 });
    niveles = Math.max(niveles, 2);
  }
  const hitos = vista.actividades.filter(esHitoOTramite);
  if (hitos.length > 0 || vista.grupos.length > 0) {
    nodos.push({ clave: RAIZ_DE_HITOS, profundidad: 1 });
    niveles = Math.max(niveles, 2);
  }
  for (const g of vista.grupos) {
    if (hitos.some((a) => a.grupoId === g.id)) {
      nodos.push({ clave: g.id, profundidad: 2 });
      niveles = Math.max(niveles, 3);
    }
  }
  return { nodos, niveles };
}

// --- Restricciones (RN-30) ---------------------------------------------------------

export const NOMBRE_DE_RESTRICCION: Record<TipoDeRestriccion, string> = {
  INICIO_EL: 'Inicio el',
  INICIO_ANTES: 'Inicio en o antes de',
  INICIO_DESPUES: 'Inicio en o después de',
  FIN_EL: 'Fin el',
  FIN_ANTES: 'Fin en o antes de',
  FIN_DESPUES: 'Fin en o después de',
  LO_MAS_TARDE: 'Lo más tarde posible',
  INICIO_OBLIGATORIO: 'Inicio obligatorio',
  FIN_OBLIGATORIO: 'Fin obligatorio',
};

const TODAS: TipoDeRestriccion[] = ['INICIO_EL', 'INICIO_ANTES', 'INICIO_DESPUES', 'FIN_EL', 'FIN_ANTES', 'FIN_DESPUES', 'LO_MAS_TARDE', 'INICIO_OBLIGATORIO', 'FIN_OBLIGATORIO'];
const VENTANA: TipoDeRestriccion[] = ['INICIO_ANTES', 'INICIO_DESPUES', 'FIN_ANTES', 'FIN_DESPUES'];
const SIN_SECUNDARIA: TipoDeRestriccion[] = ['INICIO_EL', 'FIN_EL', 'INICIO_OBLIGATORIO', 'FIN_OBLIGATORIO'];
const esDeInicio = (t: TipoDeRestriccion) => t.startsWith('INICIO_');
const esDeFin = (t: TipoDeRestriccion) => t.startsWith('FIN_');

/** Un hito de fin no lleva restricciones de inicio, ni uno de inicio de fin. */
function admite(a: Actividad, t: TipoDeRestriccion): boolean {
  if (a.tipo === 'HITO_FIN' && esDeInicio(t)) return false;
  if (a.tipo === 'HITO_INICIO' && esDeFin(t)) return false;
  return true;
}

export function principalesPosibles(a: Actividad): TipoDeRestriccion[] {
  return TODAS.filter((t) => admite(a, t));
}

/** Las secundarias que deja la principal (RN-30). Sin principal, ninguna. */
export function secundariasPosibles(a: Actividad, principal: TipoDeRestriccion | null): TipoDeRestriccion[] {
  if (principal === null || SIN_SECUNDARIA.includes(principal)) return [];
  return VENTANA.filter((t) => t !== principal && admite(a, t));
}

/**
 * Si las dos son de inicio o las dos de fin, el «antes de» no puede quedar
 * antes del «después de». Devuelve el texto del error o null.
 */
export function ventanaInvertida(p: { tipo: TipoDeRestriccion; fecha: string | null }, s: { tipo: TipoDeRestriccion; fecha: string | null }): string | null {
  const mismaClase = (esDeInicio(p.tipo) && esDeInicio(s.tipo)) || (esDeFin(p.tipo) && esDeFin(s.tipo));
  if (!mismaClase || !p.fecha || !s.fecha) return null;
  const antes = p.tipo.endsWith('_ANTES') ? p : s.tipo.endsWith('_ANTES') ? s : null;
  const despues = p.tipo.endsWith('_DESPUES') ? p : s.tipo.endsWith('_DESPUES') ? s : null;
  if (!antes?.fecha || !despues?.fecha) return null;
  return antes.fecha < despues.fecha ? `«${NOMBRE_DE_RESTRICCION[antes.tipo]}» no puede ser una fecha anterior a «${NOMBRE_DE_RESTRICCION[despues.tipo]}».` : null;
}

export const NOMBRE_DE_TIPO: Record<Actividad['tipo'], string> = {
  ITEM: 'Actividad del presupuesto',
  HITO_INICIO: 'Hito de inicio',
  HITO_FIN: 'Hito de fin',
  SIN_COSTO: 'Trámite o espera, sin costo',
  ADMINISTRACION: 'Administración',
};

export const NOMBRE_DE_RELACION: Record<'FC' | 'CC' | 'FF' | 'CF', string> = {
  FC: 'Fin a comienzo (FC)',
  CC: 'Comienzo a comienzo (CC)',
  FF: 'Fin a fin (FF)',
  CF: 'Comienzo a fin (CF)',
};
