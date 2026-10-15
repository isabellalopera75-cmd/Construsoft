import { createHash } from 'node:crypto';

/*
 * D-77, CONTRATO §18.1 · Qué migraciones le faltan a una base y si alguna ya
 * aplicada cambió. Aquí solo se decide; aplicarlas es de psql (las
 * migraciones usan \set, que es de psql y no de pg), en migrar.ts.
 *
 * La migración 0 es el propio 05: la registra el esquema al cargarse y no
 * tiene archivo en docs/migraciones, así que no se compara.
 */

export interface ArchivoDeMigracion {
  numero: number;
  nombre: string;
  ruta: string;
  huella: string;
}

export interface MigracionAplicada {
  numero: number;
  sha256: string | null;
}

export interface PlanDeMigracion {
  /** Las que faltan, en orden de número. */
  aplicar: ArchivoDeMigracion[];
  /** Aplicadas cuyo archivo ya no es el que se aplicó: una migración publicada no se edita. */
  cambiadas: ArchivoDeMigracion[];
  /** Aplicadas sin huella anotada: se les anota la del archivo de hoy. */
  sinHuella: ArchivoDeMigracion[];
  /** Números aplicados en la base sin archivo en el repositorio. */
  faltanArchivos: number[];
}

const PATRON = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.sql$/;

/** «0001-parametros-del-ciclo.sql» → { 1, 'parametros-del-ciclo' }. El .revertir.sql y lo demás → null. */
export function leerNombreDeArchivo(archivo: string): { numero: number; nombre: string } | null {
  if (archivo.endsWith('.revertir.sql')) return null;
  const m = PATRON.exec(archivo);
  return m ? { numero: Number(m[1]), nombre: m[2]! } : null;
}

/**
 * sha256 del archivo con los fines de línea normalizados. Con core.autocrlf,
 * el mismo archivo llega con \r\n a un clon de Windows y con \n a otro: sin
 * normalizar, migrar diría «cambió» sin que nadie lo hubiera tocado.
 */
export function huella(contenido: string): string {
  return createHash('sha256').update(contenido.replace(/\r\n/g, '\n')).digest('hex');
}

export function planDeMigracion(aplicadas: MigracionAplicada[], archivos: ArchivoDeMigracion[]): PlanDeMigracion {
  const enOrden = [...archivos].sort((a, b) => a.numero - b.numero);
  const porNumero = new Map(aplicadas.map((a) => [a.numero, a.sha256]));
  const archivoDe = new Map(enOrden.map((a) => [a.numero, a]));
  return {
    aplicar: enOrden.filter((a) => !porNumero.has(a.numero)),
    cambiadas: enOrden.filter((a) => porNumero.has(a.numero) && porNumero.get(a.numero) !== null && porNumero.get(a.numero) !== a.huella),
    sinHuella: enOrden.filter((a) => porNumero.has(a.numero) && porNumero.get(a.numero) === null),
    faltanArchivos: aplicadas.map((a) => a.numero).filter((n) => n !== 0 && !archivoDe.has(n)),
  };
}
