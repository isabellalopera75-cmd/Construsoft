import type { ClienteEnContexto } from './contextoTenant.js';

/*
 * Crear muchas filas en UNA transacción, todo o nada (CONTRATO §10.2). Cada
 * fila corre en su propio SAVEPOINT: si la base la rechaza, se anota a qué
 * fila del archivo pertenece y se sigue con las demás, para informar TODOS los
 * rechazos de una vez. Al final, si hubo alguno, se lanza FallasEnBloque y la
 * transacción entera vuelve atrás: no entra ninguna.
 */

export interface FallaDeFila {
  fila: number;
  error: unknown;
}

export class FallasEnBloque extends Error {
  constructor(readonly fallas: FallaDeFila[]) {
    super(`${fallas.length} filas rechazadas por la base`);
  }
}

export async function porFila<T extends { fila: number }>(
  cliente: ClienteEnContexto,
  filas: T[],
  operacion: (fila: T) => Promise<void>,
): Promise<number> {
  const fallas: FallaDeFila[] = [];
  for (const fila of filas) {
    await cliente.query('SAVEPOINT fila');
    try {
      await operacion(fila);
      await cliente.query('RELEASE SAVEPOINT fila');
    } catch (error) {
      await cliente.query('ROLLBACK TO SAVEPOINT fila');
      fallas.push({ fila: fila.fila, error });
    }
  }
  if (fallas.length > 0) throw new FallasEnBloque(fallas);
  return filas.length;
}
