import type { Tramo } from '../../api/tiposCronograma.ts';
import { minutosDelDia } from '../cronograma/tiempo.ts';

/*
 * Un día de un calendario visto como 48 bloques de media hora (07 §6.2): así
 * se pinta en la tabla, como en P6. Por debajo viaja como tramos con inicio y
 * fin. Los bloques son enteros del dibujo, no dinero (CONTRATO §19.1): al
 * guardar se manda lo que se pintó y se muestra lo que devuelve el servidor.
 */

export const BLOQUES = 48;
export type Dia = boolean[];

export function horaDeBloque(i: number): string {
  const min = i * 30;
  const h = Math.floor(min / 60);
  return `${h < 10 ? '0' : ''}${h}:${min % 60 === 0 ? '00' : '30'}`;
}

export function bloquesDe(tramos: Tramo[]): Dia {
  const dia: Dia = Array.from({ length: BLOQUES }, () => false);
  for (const t of tramos) {
    const desde = Math.floor(minutosDelDia(t.inicio) / 30);
    const hasta = Math.ceil(minutosDelDia(t.fin) / 30);
    for (let i = desde; i < hasta && i < BLOQUES; i += 1) dia[i] = true;
  }
  return dia;
}

export function tramosDe(dia: Dia): Tramo[] {
  const tramos: Tramo[] = [];
  let desde: number | null = null;
  for (let i = 0; i <= BLOQUES; i += 1) {
    const marcado = i < BLOQUES && dia[i] === true;
    if (marcado && desde === null) desde = i;
    if (!marcado && desde !== null) {
      tramos.push({ inicio: horaDeBloque(desde), fin: horaDeBloque(i) });
      desde = null;
    }
  }
  return tramos;
}

/** Bloques marcados → horas con un decimal, «8.0» o «8.5». */
export function horasDeBloques(n: number): string {
  return `${Math.floor(n / 2)}.${n % 2 === 0 ? '0' : '5'}`;
}

export function contar(dia: Dia): number {
  return dia.filter(Boolean).length;
}

/** «07:00–12:00, 13:00–16:00», o «No laborable». */
export function describirTramos(tramos: Tramo[]): string {
  if (tramos.length === 0) return 'No laborable';
  return tramos.map((t) => `${t.inicio}–${t.fin}`).join(', ');
}

export interface LlenadoRapido {
  /** «07:00» */
  desde: string;
  /** Horas de trabajo, en medias horas: 16 = 8 h. */
  mediasHoras: number;
  /** Almuerzo, o null si es corrido. */
  almuerzo: { desde: string; hasta: string } | null;
  /** Qué días: 0 = lunes. */
  dias: boolean[];
  /** El sábado, si va con otra jornada (medio sábado). null = como los demás. */
  sabado: number | null;
}

/**
 * El llenado rápido (07 §6.2): «8 horas desde las 7:00 con almuerzo de 12:00
 * a 13:00» pinta la tabla entera. Las horas se cuentan trabajadas, así que el
 * almuerzo corre la salida.
 */
export function llenar(ll: LlenadoRapido): Dia[] {
  const inicio = Math.floor(minutosDelDia(ll.desde) / 30);
  const almDesde = ll.almuerzo ? Math.floor(minutosDelDia(ll.almuerzo.desde) / 30) : -1;
  const almHasta = ll.almuerzo ? Math.ceil(minutosDelDia(ll.almuerzo.hasta) / 30) : -1;
  const pintar = (medias: number): Dia => {
    const dia: Dia = Array.from({ length: BLOQUES }, () => false);
    let faltan = medias;
    for (let i = inicio; i < BLOQUES && faltan > 0; i += 1) {
      if (i >= almDesde && i < almHasta) continue;
      dia[i] = true;
      faltan -= 1;
    }
    return dia;
  };
  return ll.dias.map((si, i) => {
    if (!si) return Array.from({ length: BLOQUES }, () => false);
    if (i === 5 && ll.sabado !== null) return pintar(ll.sabado);
    return pintar(ll.mediasHoras);
  });
}
