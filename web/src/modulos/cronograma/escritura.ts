import { ErrorDeApi } from '../../api/cliente.ts';
import type { VistaCronograma } from '../../api/tiposCronograma.ts';

/*
 * Toda escritura del cronograma pasa por una sola función que vive en la
 * pantalla (Cronograma.tsx): pone la `version` que se está viendo, reemplaza la
 * vista por la que responde el servidor y atiende los tres rechazos propios del
 * módulo (CONTRATO §19.1). Los formularios solo reciben `escribir`.
 */

export type Metodo = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * `descripcion` dice el cambio en palabras («Duración manual de 1.2»): si
 * otra persona cambió el cronograma mientras tanto, la franja del 409 la
 * muestra y ofrece volver a aplicarlo sobre la versión nueva.
 */
export type Escribir = (descripcion: string, metodo: Metodo, ruta: string, cuerpo?: Record<string, unknown>) => Promise<VistaCronograma>;

/**
 * Un 409 de versión ya lo atendió la pantalla: mostró la versión nueva y
 * guardó el cambio rechazado en la franja. Quien llamó no repite el mensaje.
 */
export function yaAtendido(e: unknown): boolean {
  return e instanceof ErrorDeApi && (e.estado === 409 && hayVista(e.cuerpo) || (e.estado === 422 && e.campo === undefined));
}

export function hayVista(cuerpo: unknown): cuerpo is { cronograma: VistaCronograma } {
  return typeof cuerpo === 'object' && cuerpo !== null && 'cronograma' in cuerpo && typeof (cuerpo as { cronograma: unknown }).cronograma === 'object' && (cuerpo as { cronograma: unknown }).cronograma !== null;
}

/** Los ids del círculo de un 422 de relación (RF-PRG-05). */
export function cicloDe(e: unknown): string[] | null {
  if (!(e instanceof ErrorDeApi) || typeof e.cuerpo !== 'object' || e.cuerpo === null) return null;
  const c = (e.cuerpo as { ciclo?: unknown }).ciclo;
  return Array.isArray(c) && c.every((x) => typeof x === 'string') ? c : null;
}

export function mensaje(e: unknown, generico: string): string {
  return e instanceof ErrorDeApi ? e.message : generico;
}
