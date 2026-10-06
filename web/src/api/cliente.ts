/*
 * La única puerta hacia la API. Ningún componente llama a fetch por su cuenta:
 * así el manejo de un 401 o de un 429 vive en un solo lugar y no en veinte.
 */

/** Un error de una fila de un archivo importado (CONTRATO §10). */
export interface ErrorDeFila {
  hoja: string;
  fila: number;
  columna: string | null;
  mensaje: string;
}

/** Un rechazo de la API, con el estado que la pantalla necesita para decidir. */
export class ErrorDeApi extends Error {
  readonly estado: number;
  readonly campo: string | undefined;
  /** Solo en una importación rechazada: el informe fila por fila. */
  errores: ErrorDeFila[] | undefined;
  /** Segundos que pide esperar un 429, si los dijo (cabecera Retry-After). */
  readonly reintentarEn: number | undefined;

  constructor(estado: number, mensaje: string, campo?: string, reintentarEn?: number) {
    super(mensaje);
    this.name = 'ErrorDeApi';
    this.estado = estado;
    this.campo = campo;
    this.reintentarEn = reintentarEn;
  }
}

const SIN_RED =
  'No se pudo hablar con el servidor. Revise su conexión e intente de nuevo; ' +
  'nada de lo que hizo se guardó.';

// Un 500 no muestra su texto (DISENO §9): dice que algo falló y que no se
// guardó nada. El servidor tampoco lo manda, pero no se depende de eso.
const FALLA_DEL_SERVIDOR =
  'Algo falló en el servidor y no se guardó nada. Intente de nuevo en un momento; ' +
  'si vuelve a pasar, avísenos.';

/*
 * Qué hacer cuando la sesión deja de valer. Lo registra la aplicación al
 * arrancar, una sola vez: cualquier 401 de cualquier pantalla lleva al ingreso
 * sin que cada pantalla tenga que acordarse (CONTRATO §2).
 */
let alPerderLaSesion: (() => void) | null = null;
export function cuandoSePierdaLaSesion(accion: () => void): void {
  alPerderLaSesion = accion;
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  /** Un archivo que viaja tal cual, sin JSON: la importación desde Excel. */
  archivo?: File;
  /**
   * El 401 del ingreso no es «se perdió la sesión»: es «la contraseña no es
   * esa», y la pantalla de ingreso lo muestra ella misma.
   */
  el401EsDeLaPantalla?: boolean;
}

export async function pedir<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const { metodo = 'GET', cuerpo, archivo, el401EsDeLaPantalla = false } = opciones;
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      // La cookie de sesión es HttpOnly y SameSite=Strict: viaja sola mientras
      // la interfaz y la API compartan origen, que es lo que garantizan el
      // proxy en desarrollo y el despliegue en producción.
      credentials: 'same-origin',
      headers: archivo
        ? { 'content-type': archivo.type || 'application/octet-stream' }
        : cuerpo === undefined
          ? {}
          : { 'content-type': 'application/json' },
      body: archivo ?? (cuerpo === undefined ? null : JSON.stringify(cuerpo)),
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
      throw new ErrorDeApi(respuesta.status, respuesta.status >= 500 ? FALLA_DEL_SERVIDOR : SIN_RED);
    }
  }

  if (respuesta.ok) return cuerpoLeido as T;

  // El cuerpo de error es PLANO: { mensaje, campo? } (CONTRATO §2). El
  // borrador 1 del contrato lo envolvía en { error: { … } } y este archivo se
  // escribió contra ese borrador: con el sobre, todo rechazo se habría
  // mostrado como «no se pudo hablar con el servidor».
  const error = cuerpoLeido as { mensaje?: unknown; campo?: unknown; errores?: unknown } | null;
  const mensaje =
    respuesta.status >= 500
      ? FALLA_DEL_SERVIDOR
      : typeof error?.mensaje === 'string'
        ? error.mensaje
        : SIN_RED;
  const campo = typeof error?.campo === 'string' ? error.campo : undefined;

  if (respuesta.status === 401 && !el401EsDeLaPantalla) alPerderLaSesion?.();

  const rechazo = new ErrorDeApi(respuesta.status, mensaje, campo, segundosDeEspera(respuesta));
  if (Array.isArray(error?.errores)) rechazo.errores = error.errores as ErrorDeFila[];
  throw rechazo;
}

/** Retry-After en segundos. Es un entero del protocolo, no dinero. */
function segundosDeEspera(respuesta: Response): number | undefined {
  const cabecera = respuesta.headers.get('retry-after');
  if (cabecera === null || !/^\d+$/.test(cabecera)) return undefined;
  // eslint-disable-next-line no-restricted-globals -- segundos de una cabecera HTTP, no dinero
  return parseInt(cabecera, 10);
}

/** Arma una ruta con su consulta, omitiendo lo vacío. */
export function conConsulta(ruta: string, consulta: Record<string, string | undefined>): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(consulta)) {
    if (valor !== undefined && valor !== '') parametros.set(clave, valor);
  }
  const texto = parametros.toString();
  return texto === '' ? ruta : `${ruta}?${texto}`;
}
