/**
 * Una respuesta de rechazo que la API decide sin pasar por la base: un 409
 * que pide confirmación, un 429 con Retry-After, un 401 de credenciales. Los
 * rechazos de la base no son esto: los traduce errores.ts.
 */
export class Rechazo extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly cabeceras: Record<string, string> = {},
  ) {
    super(mensaje);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
