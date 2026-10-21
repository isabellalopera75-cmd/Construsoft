import { z } from 'zod';

/*
 * Piezas de validación que comparten las rutas. Validan la FORMA del pedido;
 * las reglas de negocio las defiende la base.
 */

/** Un campo que el pedido no lleva —un precio, un código— se rechaza nombrándolo. */
export const SIN_CAMPOS_DE_MAS = {
  error: (problema: { code?: string; keys?: string[] }) =>
    problema.code === 'unrecognized_keys'
      ? `«${problema.keys?.[0] ?? ''}» no se envía: ese dato lo pone o lo calcula el servidor.`
      : undefined,
};

/**
 * Un número decimal no negativo como texto, con punto: nunca pasa por Number
 * (contrato §1.1). `enteros` es la parte entera del numeric de la base:
 * 18 para app.dinero y app.cantidad (24,6), 3 para app.porcentaje (9,6).
 */
export function decimalComoTexto(enteros: number, tipo: string, mensaje: string) {
  const forma = new RegExp(String.raw`^\d{1,${enteros}}(\.\d{1,6})?$`);
  return z.string(`${tipo} va como texto, con punto decimal: «12.5».`).regex(forma, mensaje);
}

/** Una fecha AAAA-MM-DD que existe en el calendario: «2026-02-30» no. */
export function esFecha(texto: unknown): texto is string {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!)).toISOString().slice(0, 10) === texto;
}

/**
 * Valida un valor entero —una semana de tramos, una lista de fechas— como un
 * solo campo: el error se marca en el control (`semana`, `fechas`) y no en una
 * celda suya (`semana.0.1.inicio`), que la pantalla no tiene cómo señalar.
 * `problema` devuelve el mensaje del primer error, o null si no hay.
 */
export function comoUnCampo<T>(problema: (v: unknown) => string | null) {
  return z
    .unknown()
    .superRefine((v, ctx) => {
      const mensaje = problema(v);
      if (mensaje) ctx.addIssue({ code: 'custom', message: mensaje });
    })
    .transform((v) => v as T);
}
