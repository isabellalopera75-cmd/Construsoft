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
  /**
   * Las llaves de más que el contrato le permite a un rechazo puntual. Hoy una
   * sola: `ciclo`, los ids de un círculo de relaciones (§19.6), que la base
   * manda en el DETAIL del error.
   */
  extra?: Record<string, unknown>;
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
  presupuesto_tenant_id_codigo_key: 'Ya existe un proyecto con ese código en esta empresa. Use otro código.',
  ux_tenant_nit: 'Ya hay una empresa registrada con ese NIT. Si es la suya, ingrese con su cuenta o recupere la contraseña.',
  usuario_email_key: 'Ese correo ya tiene una cuenta. Ingrese con él, o use otro correo para registrarse.',
  ux_recurso_nombre: 'Ya existe un recurso con ese nombre en su empresa. Use otro nombre, o edite el que ya existe.',
  ux_apu_nombre: 'Ya existe un APU con ese nombre en su empresa. Use otro nombre, o edite el que ya existe.',
  ux_unidad_simbolo:
    'Ya existe una unidad con ese símbolo en su empresa. «Kg» y «kg» son el mismo símbolo: use otro.',
  ux_calendario_nombre: 'Ya hay un calendario con ese nombre en su empresa. Use otro nombre, o edite el que ya existe.',
  ux_lista_festivos_propia_nombre: 'Ya hay una lista de festivos con ese nombre en su empresa. Use otro nombre, o edite la que ya existe.',
  ux_dependencia_par: 'Ya hay una relación entre esas dos actividades. Edite esa en vez de crear otra.',
  ux_actividad_codigo: 'Ya hay una actividad con ese código en este cronograma (RN-42). Use otro.',
  ux_grupo_tramite_nombre: 'Ya hay un subgrupo con ese nombre en este cronograma. Use otro nombre.',
  ck_presupuesto_texto_no_vacio: 'El código, el nombre y la ubicación del proyecto son obligatorios.',
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
  ux_recurso_nombre: 'nombre',
  ux_apu_nombre: 'nombre',
  ux_calendario_nombre: 'nombre',
  ux_lista_festivos_propia_nombre: 'nombre',
  ux_dependencia_par: 'predecesoraId',
  ux_actividad_codigo: 'codigo',
  ux_grupo_tramite_nombre: 'nombre',
};

/**
 * La base marca las restricciones de una actividad con el nombre de su
 * columna (USING COLUMN = 'restriccion2Tipo'); el contrato las nombra como
 * el campo anidado que manda la pantalla (CONTRATO §19.6).
 */
const CAMPO_DE_COLUMNA: Record<string, string> = {
  restriccionTipo: 'restriccion.tipo',
  restriccionFecha: 'restriccion.fecha',
  restriccion2Tipo: 'restriccionSecundaria.tipo',
  restriccion2Fecha: 'restriccionSecundaria.fecha',
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
  const columna = typeof error === 'object' && error !== null && 'column' in error && typeof error.column === 'string' ? error.column : undefined;
  return columna === undefined ? undefined : (CAMPO_DE_COLUMNA[columna] ?? columna);
}

/** `ciclo` del DETAIL de un rechazo de la base, si lo trae como JSON (CONTRATO §19.6). */
function extraDe(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null || !('detail' in error) || typeof error.detail !== 'string') return undefined;
  try {
    const detalle: unknown = JSON.parse(error.detail);
    if (typeof detalle === 'object' && detalle !== null && Array.isArray((detalle as { ciclo?: unknown }).ciclo)) {
      return { ciclo: (detalle as { ciclo: unknown[] }).ciclo };
    }
  } catch {
    // Un detalle que no es JSON no trae nada para la pantalla.
  }
  return undefined;
}

function restriccionDe(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error && typeof error.constraint === 'string'
    ? error.constraint
    : undefined;
}

/**
 * ¿El rechazo dice «esta persona no puede hacer esto ahora»? Es el rol sin el
 * permiso (CS004), la suscripción que no deja escribir (CS005) o la cuenta
 * detenida que solo entra a la suscripción (CS006). Lo usa quien
 * le PREGUNTA a fn_exigir_permiso para decidir qué mostrar —la mesa, para su
 * «editable»— en vez de replicar sus reglas. Cualquier otro rechazo no es un
 * «no», es un error, y se propaga.
 */
export function esNegacionDePermiso(error: unknown): boolean {
  const codigo = codigoDe(error);
  return codigo === 'CS004' || codigo === 'CS005' || codigo === 'CS006';
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
 *   CS006  cuenta suspendida o cancelada, y la acción no es la suscripción → 423
 */
export function traducirError(error: unknown): RespuestaDeError {
  if (error instanceof ErrorParaElUsuario) {
    const estado = error.motivo === 'NO_EXISTE' ? 404 : error.motivo === 'CONFLICTO' ? 409 : 422;
    return error.campo
      ? { estado, mensaje: error.message, campo: error.campo, borrarCookie: false }
      : { estado, mensaje: error.message, borrarCookie: false };
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
    // D-74 · La interfaz relee el arranque y muestra la cuenta detenida (CONTRATO §15.2).
    case 'CS006':
      return { estado: 423, mensaje: mensajeDeLaBase, borrarCookie: false };
    // Una regla de negocio levantada por un disparador: su texto está escrito
    // para la pantalla, que lo muestra tal cual (02 §2).
    case 'P0001': {
      const campo = columnaDe(error);
      const extra = extraDe(error);
      return {
        estado: 422,
        mensaje: mensajeDeLaBase,
        ...(campo ? { campo } : {}),
        ...(extra ? { extra } : {}),
        borrarCookie: false,
      };
    }
    case '23505': {
      const restriccion = restriccionDe(error) ?? '';
      const mensaje = MENSAJES_DE_RESTRICCION[restriccion] ?? 'Ese dato ya existe y no puede repetirse.';
      const campo = CAMPO_DE_RESTRICCION[restriccion];
      return campo ? { estado: 409, mensaje, campo, borrarCookie: false } : { estado: 409, mensaje, borrarCookie: false };
    }
    case '22003':
      // numeric_value_out_of_range: una cifra que no cabe en su columna —un
      // precio con IVA que desborda numeric(24,6)—. Es un dato, no un fallo.
      return {
        estado: 422,
        mensaje: 'Una de las cifras es demasiado grande para guardarse. Revísela.',
        borrarCookie: false,
      };
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
