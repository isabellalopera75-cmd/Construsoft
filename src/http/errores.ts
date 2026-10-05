import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';

/**
 * La respuesta HTTP de un rechazo. `borrarCookie` cuando la sesión ya no se
 * recupera: seguir mandándola solo hace que el usuario reintente contra una
 * puerta cerrada.
 */
export interface RespuestaDeError {
  estado: number;
  mensaje: string;
  /** El dato del pedido al que se refiere el rechazo, cuando la base lo dice (contrato §2). */
  campo?: string;
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
  ux_unidad_simbolo:
    'Ya existe una unidad con ese símbolo en su empresa. «Kg» y «kg» son el mismo símbolo: use otro.',
  ck_presupuesto_texto_no_vacio: 'El código, el nombre y la ubicación del presupuesto son obligatorios.',
  ck_recurso_precios_cuadran:
    'El precio base y el precio total no cuadran con el IVA: el que se calcula es el otro multiplicado o dividido por (1 + IVA/100), redondeado a seis decimales.',
};

/**
 * El campo del formulario al que corresponde una restricción de unicidad: con
 * él, la pantalla marca el control en vez de recargar (contrato §2). Solo las
 * que son de un único dato que la persona escribió.
 */
const CAMPO_DE_RESTRICCION: Record<string, string> = {
  presupuesto_tenant_id_codigo_key: 'codigo',
  ux_tenant_nit: 'nit',
  usuario_email_key: 'email',
  ux_unidad_simbolo: 'simbolo',
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

/**
 * La columna que el propio rechazo declara: RAISE … USING COLUMN = 'posicion'
 * llega en error.column. Es la base la que dice de qué dato habla; aquí no se
 * adivina nada leyendo el texto del mensaje.
 */
function columnaDe(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'column' in error && typeof error.column === 'string'
    ? error.column
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
    case 'P0001': {
      const campo = columnaDe(error);
      return campo
        ? { estado: 422, mensaje: mensajeDeLaBase, campo, borrarCookie: false }
        : { estado: 422, mensaje: mensajeDeLaBase, borrarCookie: false };
    }
    case '23505': {
      const restriccion = restriccionDe(error) ?? '';
      const mensaje = MENSAJES_DE_RESTRICCION[restriccion] ?? 'Ese dato ya existe y no puede repetirse.';
      const campo = CAMPO_DE_RESTRICCION[restriccion];
      return campo ? { estado: 409, mensaje, campo, borrarCookie: false } : { estado: 409, mensaje, borrarCookie: false };
    }
    case '23503':
      // Una llave foránea apunta a algo que no está. Las de inquilino son
      // compuestas (tenant_id, id): lo ajeno y lo inexistente fallan igual,
      // así que el mensaje no delata nada.
      return {
        estado: 422,
        mensaje: 'Algo de lo que eligió ya no existe en su empresa. Recargue la pantalla y elija de nuevo.',
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
