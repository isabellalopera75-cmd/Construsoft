import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';

/**
 * La respuesta HTTP de un rechazo. `borrarCookie` cuando la sesión ya no se
 * recupera: seguir mandándola solo hace que el usuario reintente contra una
 * puerta cerrada.
 */
export interface RespuestaDeError {
  estado: number;
  mensaje: string;
  borrarCookie: boolean;
}

const INESPERADO =
  'Ocurrió un error inesperado y la operación no se hizo. Intente de nuevo; si se repite, avise a soporte.';

const SESION_INVALIDA = 'Su sesión ya no es válida. Ingrese de nuevo.';

/**
 * Mensajes para personas de las restricciones cuyo texto de PostgreSQL no lo
 * es («llave duplicada viola restricción…»). Las que no estén aquí caen al
 * mensaje genérico de su clase.
 */
const MENSAJES_DE_RESTRICCION: Record<string, string> = {
  presupuesto_tenant_id_codigo_key: 'Ya existe un presupuesto con ese código en esta empresa. Use otro código.',
  ux_tenant_nit: 'Ya hay una empresa registrada con ese NIT. Si es la suya, ingrese con su cuenta o recupere la contraseña.',
  usuario_email_key: 'Ese correo ya tiene una cuenta. Ingrese con él, o use otro correo para registrarse.',
  ck_presupuesto_texto_no_vacio: 'El código, el nombre y la ubicación del presupuesto son obligatorios.',
};

/** La sesión no sirve: no hay cookie, la firma no vale, venció, o el sello ya no es el de la base. */
export function sesionInvalida(): RespuestaDeError {
  return { estado: 401, mensaje: SESION_INVALIDA, borrarCookie: true };
}

function codigoDe(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function restriccionDe(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error && typeof error.constraint === 'string'
    ? error.constraint
    : undefined;
}

/**
 * ¿El rechazo dice «esta persona no puede hacer esto ahora»? Es el rol sin el
 * permiso (CS004) o la suscripción que no deja escribir (CS005). Lo usa quien
 * le PREGUNTA a fn_exigir_permiso para decidir qué mostrar —la mesa, para su
 * «editable»— en vez de replicar sus reglas. Cualquier otro rechazo no es un
 * «no», es un error, y se propaga.
 */
export function esNegacionDePermiso(error: unknown): boolean {
  const codigo = codigoDe(error);
  return codigo === 'CS004' || codigo === 'CS005';
}

/**
 * La traducción de un rechazo a HTTP, en UN solo lugar (documento 04 §8.4). Si
 * aparece un switch sobre SQLSTATE en otro archivo, ya se rompió: una prueba
 * lo vigila. El árbitro de la tabla es el COMMENT ON FUNCTION de
 * app.fn_exigir_permiso.
 *
 *   CS000  el permiso no existe en el catálogo   → 500, sin mostrar el texto
 *   CS001  no hay usuario en el contexto         → 401 y se borra la cookie
 *   CS002  el usuario no es de esta empresa       → 401 y se borra la cookie
 *   CS003  la cuenta no está ACTIVA               → 403 y se borra la cookie
 *   CS004  el rol no tiene el permiso             → 403
 *   CS005  suscripción no vigente y la acción escribe → 402
 */
export function traducirError(error: unknown): RespuestaDeError {
  if (error instanceof ErrorParaElUsuario) {
    return { estado: error.motivo === 'NO_EXISTE' ? 404 : 422, mensaje: error.message, borrarCookie: false };
  }

  const codigo = codigoDe(error);
  const mensajeDeLaBase = error instanceof Error ? error.message : '';
  switch (codigo) {
    case 'CS000':
      return { estado: 500, mensaje: INESPERADO, borrarCookie: false };
    case 'CS001':
    case 'CS002':
      return { estado: 401, mensaje: SESION_INVALIDA, borrarCookie: true };
    case 'CS003':
      return { estado: 403, mensaje: mensajeDeLaBase, borrarCookie: true };
    case 'CS004':
      return { estado: 403, mensaje: mensajeDeLaBase, borrarCookie: false };
    case 'CS005':
      return { estado: 402, mensaje: mensajeDeLaBase, borrarCookie: false };
    // Una regla de negocio levantada por un disparador: su texto está escrito
    // para la pantalla, que lo muestra tal cual (02 §2).
    case 'P0001':
      return { estado: 422, mensaje: mensajeDeLaBase, borrarCookie: false };
    case '23505':
      return {
        estado: 409,
        mensaje: MENSAJES_DE_RESTRICCION[restriccionDe(error) ?? ''] ?? 'Ese dato ya existe y no puede repetirse.',
        borrarCookie: false,
      };
    case '23514':
      return {
        estado: 422,
        mensaje: MENSAJES_DE_RESTRICCION[restriccionDe(error) ?? ''] ?? 'Uno de los datos no es válido. Revíselo e intente de nuevo.',
        borrarCookie: false,
      };
    default:
      return { estado: 500, mensaje: INESPERADO, borrarCookie: false };
  }
}
