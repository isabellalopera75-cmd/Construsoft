/*
 * La única puerta hacia la API. Ningún componente llama a fetch por su cuenta:
 * así el manejo de un 401 o de un 402 vive en un solo lugar y no en veinte.
 */

/** Un rechazo de la API, con el estado que la pantalla necesita para decidir. */
export class ErrorDeApi extends Error {
  readonly estado: number;
  readonly campo: string | undefined;

  constructor(estado: number, mensaje: string, campo?: string) {
    super(mensaje);
    this.name = 'ErrorDeApi';
    this.estado = estado;
    this.campo = campo;
  }
}

const SIN_RED =
  'No se pudo hablar con el servidor. Revise su conexión e intente de nuevo; ' +
  'nada de lo que hizo se guardó.';

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
}

export async function pedir<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const { metodo = 'GET', cuerpo } = opciones;
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      // La cookie de sesión es HttpOnly y SameSite=Strict: viaja sola mientras
      // la interfaz y la API compartan origen, que es lo que garantizan el
      // proxy en desarrollo y el despliegue en producción.
      credentials: 'same-origin',
      headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
    });
  } catch {
    // Una red caída no es un rechazo del servidor y no debe parecerlo: el
    // estado 0 dice «no llegó», que es distinto de «llegó y dijo no».
    throw new ErrorDeApi(0, SIN_RED);
  }

  if (respuesta.status === 204) return undefined as T;

  const texto = await respuesta.text();
  let cuerpoLeido: unknown = null;
  if (texto !== '') {
    try {
      cuerpoLeido = JSON.parse(texto) as unknown;
    } catch {
      // Un cuerpo que no es JSON es casi siempre la página de un proxy o de un
      // servidor caído. No se muestra tal cual: diría algo que no tiene que
      // ver con lo que el usuario intentaba hacer.
      throw new ErrorDeApi(respuesta.status, SIN_RED);
    }
  }

  if (!respuesta.ok) {
    const error = (cuerpoLeido as { error?: { mensaje?: string; campo?: string } } | null)?.error;
    throw new ErrorDeApi(
      respuesta.status,
      error?.mensaje ?? SIN_RED,
      error?.campo,
    );
  }
  return cuerpoLeido as T;
}
