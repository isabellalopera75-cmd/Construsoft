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
