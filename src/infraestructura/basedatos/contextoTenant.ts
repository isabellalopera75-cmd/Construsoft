import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { leerEnvObligatoria } from './env.js';
import { resolverToken } from './autenticacion.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pool de conexiones como app_login (grupo construsoft_app, RLS forzado).
 *
 * PRIVADO A PROPÓSITO: no se exporta. La única forma de crear el contexto por
 * primera vez es registrarEmpresa; todo lo demás pasa por ejecutarComoTenant,
 * que TAMPOCO se exporta — sus dos únicos llamadores son ejecutarConPermiso
 * (la puerta general, con permiso) y ejecutarSinPermiso (la excepción
 * deliberada, con nombre propio y su lista de casos justificados). Ninguna
 * expone el pool ni un cliente genérico — no es una convención que alguien
 * pueda olvidar, es que no hay ningún identificador exportado con el que
 * hacerlo.
 */
const pool = new Pool({
  host: leerEnvObligatoria('APP_DB_HOST'),
  port: Number(leerEnvObligatoria('APP_DB_PORT')),
  database: leerEnvObligatoria('APP_DB_NAME'),
  user: leerEnvObligatoria('APP_DB_USER'),
  password: leerEnvObligatoria('APP_DB_PASSWORD'),
});

/** Identidad de la transacción: quién pregunta y desde qué empresa. */
export interface ContextoTenant {
  /**
   * El inquilino NUNCA se resuelve acá adentro con una consulta: llega ya
   * decidido por quien autenticó contra auth_login (D-46). Este tipo no
   * tiene default ni campo opcional a propósito: sin los dos valores, ni
   * compila el llamado.
   */
  tenantId: string;
  /** Autor de esta transacción. Lo leen los triggers de auditoría vía app.fn_usuario_actual(). */
  usuarioId: string;
}

/**
 * Lo único que la operación recibe para hablar con la base. No es el
 * PoolClient de `pg`: no tiene `.release()` ni forma de mandar BEGIN/COMMIT
 * por su cuenta, y el propio `query` solo acepta la forma parametrizada
 * (texto + arreglo de valores) — la que evita la interpolación manual que
 * el esquema marca como inyección (CLAUDE.md, regla 4).
 */
export interface ClienteEnContexto {
  query<Fila extends QueryResultRow = QueryResultRow>(
    texto: string,
    parametros?: unknown[],
  ): Promise<QueryResult<Fila>>;
}

/**
 * Espejo de app.permiso.codigo (catálogo global, RF-CFG-25). Es una copia a
 * mano a propósito —para que un código mal escrito no compile—, pero una
 * copia VERIFICADA: contextoTenant.test.ts la compara contra
 * `SELECT codigo FROM app.permiso` en los dos sentidos, así que un permiso
 * nuevo de una migración futura, o uno eliminado, rompe la prueba en vez de
 * quedar desincronizado en silencio.
 */
export const CODIGOS_PERMISO = [
  'RECURSOS.VER',
  'RECURSOS.CREAR',
  'RECURSOS.EDITAR',
  'RECURSOS.ELIMINAR',
  'APU.VER',
  'APU.CREAR',
  'APU.EDITAR',
  'APU.ELIMINAR',
  'PRESUPUESTOS.VER',
  'PRESUPUESTOS.CREAR',
  'PRESUPUESTOS.EDITAR',
  'PRESUPUESTOS.EXPORTAR',
  'PRESUPUESTOS.DUPLICAR',
  'PRESUPUESTOS.ESTADO',
  'CONFIG.EMPRESA',
  'CONFIG.PREFERENCIAS',
  'CONFIG.SUSCRIPCION',
  'USUARIOS.GESTIONAR',
] as const;

/** Un código de app.permiso, y ningún otro string: ver CODIGOS_PERMISO. */
export type CodigoPermiso = (typeof CODIGOS_PERMISO)[number];

function validarUuid(valor: string, campo: string): void {
  if (!UUID.test(valor)) {
    throw new Error(
      `${campo} debe ser un UUID válido; llegó "${valor}". Ese valor tiene ` +
        'que salir de la autenticación (fn_autenticar), no de un formulario ' +
        'o un parámetro de URL sin validar.',
    );
  }
}

/**
 * Motor de bajo nivel: abre la transacción, fija app.tenant_id y
 * app.usuario_id (RN-01, RNF-01), corre `operacion`, hace COMMIT si resuelve
 * y ROLLBACK si lanza, y siempre libera el cliente al final.
 *
 * NO se exporta. No sabe nada de permisos —eso es a propósito, para que esta
 * función pueda seguir siendo solo "abrir la transacción correcta" y no
 * duplicar la comprobación en dos lugares—, así que la única forma segura de
 * que exista es que la aplicación entera llegue acá por exactamente dos
 * caminos con nombre propio: ejecutarConPermiso o ejecutarSinPermiso. Ningún
 * otro código de este archivo la llama directo.
 */
async function ejecutarComoTenant<T>(
  contexto: ContextoTenant,
  operacion: (cliente: ClienteEnContexto) => Promise<T>,
): Promise<T> {
  validarUuid(contexto.tenantId, 'tenantId');
  validarUuid(contexto.usuarioId, 'usuarioId');

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT set_config($1, $2, true)', ['app.tenant_id', contexto.tenantId]);
    await cliente.query('SELECT set_config($1, $2, true)', ['app.usuario_id', contexto.usuarioId]);

    const clienteEnContexto: ClienteEnContexto = {
      query: (texto, parametros) => cliente.query(texto, parametros),
    };
    const resultado = await operacion(clienteEnContexto);

    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * La excepción deliberada a ejecutarConPermiso: ejecuta con contexto de
 * inquilino ya existente SIN comprobar ningún código de app.permiso.
 *
 * Tiene nombre propio, y no "está definida en este archivo", a propósito:
 * agregar un cuarto llamador es editar ESTA lista para justificarlo por
 * escrito, no mover un archivo de lugar. Los únicos casos legítimos hoy:
 *
 *   1. registrarEmpresa — no hay sesión todavía: no existe ningún usuario
 *      autenticado sobre el que preguntar "¿qué permiso tiene?". No llama a
 *      esta función (no tiene tenantId/usuarioId con qué armar un
 *      ContextoTenant: eso es justo lo que está creando); se documenta acá
 *      para que la lista de excepciones del módulo quede completa en un solo
 *      lugar, aunque tome un camino todavía más primitivo, el pool directo.
 *   2. consumirTokenRecuperacion — autoservicio sobre la identidad propia: el
 *      token ya demostró quién es la persona. No hay ningún rol que
 *      consultar para dejarla fijar su propia contraseña.
 *   3. leerArranqueDeSesion — antes se llamaba listarMisPermisos y devolvía
 *      solo los permisos; ahora también devuelve el formato numérico
 *      (separadores y decimales de vista, de app.configuracion_empresa).
 *      Preguntar los permisos propios no puede exigir un permiso previo sin
 *      caer en una paradoja (¿qué permiso hace falta para preguntar qué
 *      permisos hay?), y el formato numérico es el mismo tipo de dato: hace
 *      falta para dibujar CUALQUIER número en cualquier pantalla, incluida
 *      una cuyo permiso todavía no se comprobó (el Asistente nace sin
 *      ninguno, D-44, y aun así tiene que ver cifras bien puntuadas). Es la
 *      MISMA excepción con más carga, no una cuarta — y esa es la regla para
 *      sumar algo más acá: "hace falta antes de saber qué permiso aplica",
 *      no "es cómodo tenerlo a mano". El resto de app.configuracion_empresa
 *      (moneda, notificaciones) sigue exigiendo CONFIG.PREFERENCIAS en
 *      configuracionEmpresa.ts, porque ahí ya se sabe qué pantalla es.
 *      Desde D-65 trae también el estado de la suscripción: la interfaz lo
 *      necesita para saber qué pantalla mostrar ANTES de pedir ninguna.
 *   4. selloVigente — corre en CADA petición, antes que cualquier permiso:
 *      decide si la cookie todavía es de esta persona (D-67). Exigirle un
 *      permiso sería preguntarle a una sesión que quizá ya no vale qué puede
 *      hacer. Solo lee.
 *   5. actualizarHashAlIngresar — autoservicio sobre la identidad propia, como
 *      el 2: corre justo después de que el ingreso verificó la contraseña, para
 *      rehacer un hash con parámetros viejos (04 §8.2). Ningún rol tiene que
 *      autorizar que alguien guarde su propia contraseña de otra forma. La
 *      usa también «Cambiar contraseña» de Mi cuenta (02 §11.1), después de
 *      verificar la actual: es la misma operación sobre la misma identidad.
 *   6. leerMiCuenta — autoservicio de lectura sobre la identidad propia (02
 *      §11.1): nombre, correo y rol de quien está en sesión. Pedir un permiso
 *      para ver los datos propios no protegería nada: el Asistente nace sin
 *      ninguno (D-44) y aun así tiene una cuenta.
 */
function ejecutarSinPermiso<T>(
  contexto: ContextoTenant,
  operacion: (cliente: ClienteEnContexto) => Promise<T>,
): Promise<T> {
  return ejecutarComoTenant(contexto, operacion);
}

/**
 * La puerta general (RF-CFG-25 en cada petición): ejecuta con contexto de
 * inquilino solo si el usuario de la sesión tiene el permiso exacto que
 * `permiso` declara. La comprobación corre dentro de la MISMA transacción,
 * antes que `operacion` — si app.fn_exigir_permiso lanza, ejecutarComoTenant
 * hace ROLLBACK y libera el cliente igual que ante cualquier otro error;
 * `operacion` nunca llega a correr.
 *
 * `permiso` es CodigoPermiso, no string: un código mal escrito no compila.
 *
 * No repite "Ver es prerrequisito de las demás acciones de su módulo"
 * (RF-CFG-25): esa invariante ya la garantiza fn_rol_permisos_coherentes
 * sobre la fila GUARDADA de app.rol_permiso, así que alcanza con comprobar
 * el código puntual que esta operación exige.
 */
export async function ejecutarConPermiso<T>(
  contexto: ContextoTenant,
  permiso: CodigoPermiso,
  operacion: (cliente: ClienteEnContexto) => Promise<T>,
): Promise<T> {
  return ejecutarComoTenant(contexto, async (cliente) => {
    await cliente.query('SELECT app.fn_exigir_permiso($1)', [permiso]);
    return operacion(cliente);
  });
}

// Vive en src/comun/ porque también lo usa la interfaz; se reexporta aquí para
// quien ya lo importaba de la capa de datos.
import type { FormatoNumerico } from '../../comun/formatoNumerico.js';
export type { FormatoNumerico };

export type EstadoSuscripcion = 'EN_PRUEBA' | 'ACTIVA' | 'VENCIDA' | 'CANCELADA' | 'SUSPENDIDA' | 'SIN_SUSCRIPCION';

/**
 * plataforma.fn_estado_suscripcion tal cual (D-65). `soloLectura` sale de
 * fn_suscripcion_vigente, la MISMA función que usa fn_exigir_permiso para
 * rechazar las escrituras: la pantalla y el rechazo no pueden contradecirse.
 * No se recalcula en la interfaz.
 */
export interface Suscripcion {
  estado: EstadoSuscripcion;
  soloLectura: boolean;
  diasRestantes: number;
  /** aaaa-mm-dd. Texto y no Date: un date de Postgres convertido a Date cae en la medianoche local. */
  venceEl: string;
  planCodigo: string;
}

/** Lo que la interfaz necesita antes de dibujar la primera pantalla, y nada más. */
export interface ArranqueDeSesion {
  usuarioNombre: string;
  razonSocial: string;
  permisos: CodigoPermiso[];
  formatoNumerico: FormatoNumerico;
  /**
   * Null cuando la base no devuelve fila: es «sin acceso», nunca «al día»
   * (fn_estado_suscripcion devuelve cero filas para un inquilino que el
   * llamador no puede ver).
   */
  suscripcion: Suscripcion | null;
}

/**
 * Todo en vivo, en cada llamada — nunca guardado en el login ni en la
 * sesión. Guardarlo sería la misma caché que ya se descartó para
 * app.tenant_id, con otro nombre: los permisos quedarían viejos en cuanto un
 * administrador le cambiara el rol a alguien que sigue conectado, y el
 * formato numérico en cuanto alguien cambiara los separadores desde
 * configuracionEmpresa.ts.
 */
export async function leerArranqueDeSesion(contexto: ContextoTenant): Promise<ArranqueDeSesion> {
  return ejecutarSinPermiso(contexto, async (cliente) => {
    const { rows: filasPermiso } = await cliente.query<{ permiso_codigo: CodigoPermiso }>(
      `SELECT rp.permiso_codigo
         FROM app.usuario u
         JOIN app.rol_permiso rp ON rp.rol_id = u.rol_id
        WHERE u.id = $1
        ORDER BY rp.permiso_codigo`,
      [contexto.usuarioId],
    );

    const { rows: filasFormato } = await cliente.query<{
      separador_miles: string;
      separador_decimal: string;
      decimales_vista: number;
    }>(
      `SELECT separador_miles, separador_decimal, decimales_vista
         FROM app.configuracion_empresa
        WHERE tenant_id = $1`,
      [contexto.tenantId],
    );
    const filaFormato = filasFormato[0]!;

    const { rows: filasIdentidad } = await cliente.query<{ nombre: string; razon_social: string }>(
      `SELECT u.nombre, t.razon_social
         FROM app.usuario u JOIN plataforma.tenant t ON t.id = u.tenant_id
        WHERE u.id = $1`,
      [contexto.usuarioId],
    );
    const identidad = filasIdentidad[0]!;

    const { rows: filasSuscripcion } = await cliente.query<{
      estado: EstadoSuscripcion;
      solo_lectura: boolean;
      dias_restantes: number;
      vence_el: string;
      plan_codigo: string;
    }>(
      `SELECT estado, solo_lectura, dias_restantes, vence_el::text AS vence_el, plan_codigo
         FROM plataforma.fn_estado_suscripcion($1)`,
      [contexto.tenantId],
    );
    const fila = filasSuscripcion[0];

    return {
      usuarioNombre: identidad.nombre,
      razonSocial: identidad.razon_social,
      permisos: filasPermiso.map((f) => f.permiso_codigo),
      formatoNumerico: {
        separadorMiles: filaFormato.separador_miles,
        separadorDecimal: filaFormato.separador_decimal,
        decimalesVista: filaFormato.decimales_vista,
      },
      suscripcion: fila
        ? {
            estado: fila.estado,
            soloLectura: fila.solo_lectura,
            diasRestantes: fila.dias_restantes,
            venceEl: fila.vence_el,
            planCodigo: fila.plan_codigo,
          }
        : null,
    };
  });
}

/** 02 §11.1 · Mi cuenta: lo que se muestra de quien está en sesión. */
export interface MiCuenta {
  nombre: string;
  email: string;
  rol: string;
}

/** Ver la exención 6 de ejecutarSinPermiso. */
export async function leerMiCuenta(contexto: ContextoTenant): Promise<MiCuenta> {
  return ejecutarSinPermiso(contexto, async (cliente) => {
    const { rows } = await cliente.query<MiCuenta>(
      `SELECT u.nombre, u.email, r.nombre AS rol
         FROM app.usuario u JOIN app.rol r ON r.id = u.rol_id
        WHERE u.id = $1`,
      [contexto.usuarioId],
    );
    return rows[0]!;
  });
}

/** Lo que pide app.fn_alta_tenant. El hash llega YA calculado con Argon2id: la base no sabe calcularlo (Stack, CLAUDE.md). */
export interface DatosRegistroEmpresa {
  razonSocial: string;
  nit: string;
  plan: string;
  adminNombre: string;
  adminEmail: string;
  adminHash: string;
  emailRecuperacion?: string;
  /**
   * La versión de los términos y de la política de tratamiento que la persona
   * aceptó al registrarse (Ley 1581, documento 04 §7). Obligatoria: sin ella
   * no hay empresa.
   */
  versionTerminos: string;
}

/**
 * Los tres identificadores que fn_alta_tenant acaba de crear (D-51): el
 * inquilino, su administrador y el rol de ese administrador. Es lo que hace
 * falta para abrir la primera sesión sin volver a preguntarle nada a nadie.
 */
export interface EmpresaRegistrada {
  tenantId: string;
  usuarioId: string;
  rolAdminId: string;
}

interface FilaAltaTenant {
  id_tenant: string;
  id_usuario: string;
  id_rol_admin: string;
}

/**
 * Registra una empresa nueva contra app.fn_alta_tenant (RN-01, D-51) y deja
 * firmada la aceptación de los términos (Ley 1581, 04 §7).
 *
 * No pasa por ejecutarComoTenant: todavía no hay tenant_id que fijar —
 * es lo que esta llamada está a punto de crear—. Sí abre su propia
 * transacción, desde que firma los términos: el alta y la firma son dos
 * sentencias, y una empresa sin la aceptación registrada no debe poder
 * quedar creada si la segunda falla. Para la firma fija el contexto del
 * inquilino recién nacido, porque plataforma.tenant está bajo RLS.
 *
 * No usa fn_autenticar para descubrir la identidad del administrador que
 * acaba de nacer: D-51 hizo que fn_alta_tenant devuelva sus tres ids
 * porque ese uso de fn_autenticar es justo el que D-46 estrechó — esa
 * función verifica credenciales, no resuelve identidades.
 */
export async function registrarEmpresa(datos: DatosRegistroEmpresa): Promise<EmpresaRegistrada> {
  if (datos.versionTerminos.trim() === '') {
    throw new ErrorParaElUsuario(
      'El registro necesita la aceptación de los términos y de la política de tratamiento de datos. ' +
        'Léalos y márquelos como aceptados para continuar.',
      'RECHAZADO',
    );
  }
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query<FilaAltaTenant>(
      'SELECT * FROM app.fn_alta_tenant($1, $2, $3, $4, $5, $6, $7)',
      [
        datos.razonSocial,
        datos.nit,
        datos.plan,
        datos.adminNombre,
        datos.adminEmail,
        datos.adminHash,
        datos.emailRecuperacion ?? null,
      ],
    );
    const fila = rows[0]!;
    await cliente.query('SELECT set_config($1, $2, true)', ['app.tenant_id', fila.id_tenant]);
    await cliente.query('SELECT set_config($1, $2, true)', ['app.usuario_id', fila.id_usuario]);
    const firmado = await cliente.query(
      `UPDATE plataforma.tenant
          SET acepto_terminos_en = now(), version_terminos = $1
        WHERE id = $2`,
      [datos.versionTerminos, fila.id_tenant],
    );
    if (firmado.rowCount !== 1) {
      throw new Error('No se pudo registrar la aceptación de los términos: la empresa no se creó.');
    }
    await cliente.query('COMMIT');
    return {
      tenantId: fila.id_tenant,
      usuarioId: fila.id_usuario,
      rolAdminId: fila.id_rol_admin,
    };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

const SELLO = /^\d+\.\d{6}$/;

/**
 * D-67 · ¿Esta cookie sigue siendo de esta persona? Compara el sello que la
 * cookie trae desde el ingreso con el de la fila, en la base y en texto
 * exacto (ver UsuarioAutenticado.credencialesEn). Falso si no coinciden, si
 * el usuario no existe en esta empresa, o si el sello ni siquiera tiene la
 * forma de uno: una cookie manipulada no llega a la base como numeric.
 */
export async function selloVigente(contexto: ContextoTenant, sello: string): Promise<boolean> {
  if (!SELLO.test(sello)) return false;
  return ejecutarSinPermiso(contexto, async (cliente) => {
    const { rows } = await cliente.query<{ vigente: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM app.usuario
          WHERE id = $1 AND extract(epoch FROM credenciales_en) = $2::numeric
       ) AS vigente`,
      [contexto.usuarioId, sello],
    );
    return rows[0]!.vigente;
  });
}

/**
 * 04 §8.2 · Rehace el hash al ingresar cuando el guardado se hizo con
 * parámetros viejos. Cambiar password_hash mueve el sello (D-67), así que
 * devuelve el NUEVO, que es el que tiene que ir en la cookie: con el de antes,
 * la sesión recién abierta moriría en la petición siguiente.
 */
export async function actualizarHashAlIngresar(contexto: ContextoTenant, nuevoHash: string): Promise<string> {
  return ejecutarSinPermiso(contexto, async (cliente) => {
    const { rows } = await cliente.query<{ sello: string }>(
      `UPDATE app.usuario SET password_hash = $1 WHERE id = $2
       RETURNING extract(epoch FROM credenciales_en)::text AS sello`,
      [nuevoHash, contexto.usuarioId],
    );
    const fila = rows[0];
    if (!fila) throw new Error('El usuario de la sesión no existe en esta empresa.');
    return fila.sello;
  });
}

/**
 * Consume un enlace de activación o de recuperación (RF-AUT-06..11, 13):
 * valida que el token exista, no esté usado ni anulado y no haya expirado,
 * fija la contraseña nueva y —si el usuario todavía estaba PENDIENTE— lo deja
 * ACTIVO. Sirve para los dos propósitos porque el mecanismo es idéntico (ver
 * el comentario de app.token_recuperacion); lo único que cambia es si hay una
 * transición de estado que hacer, y eso lo decide el propio UPDATE.
 *
 * Usa resolverToken (auth_login, sin contexto) para encontrar a qué tenant y
 * usuario pertenece el token, y recién con esos dos valores —nunca con un
 * tenantId que reciba por fuera— abre la transacción con ejecutarSinPermiso
 * (autoservicio sobre la identidad propia: no hay rol que consultar). Así una
 * empresa nunca puede terminar actuando sobre el token de otra: el contexto
 * sale siempre del propio token, no de quien llama.
 *
 * El UPDATE del token exige además `usado_en IS NULL AND anulado_en IS NULL`
 * en el WHERE: sin esa comprobación dentro de la misma transacción, dos
 * peticiones concurrentes con el mismo token podrían pasar las dos la
 * validación de arriba (hecha con una lectura previa) y consumirlo dos veces.
 */
export async function consumirTokenRecuperacion(
  tokenHash: string,
  passwordHash: string,
): Promise<ContextoTenant> {
  const token = await resolverToken(tokenHash);
  if (!token) {
    throw new ErrorParaElUsuario('El enlace no es válido: no corresponde a ningún token emitido.', 'RECHAZADO');
  }
  if (token.anuladoEn) {
    throw new ErrorParaElUsuario(
      'Este enlace ya no es válido: se emitió uno más reciente para el mismo trámite. ' +
        'Use el último enlace que se envió.',
      'RECHAZADO',
    );
  }
  if (token.usadoEn) {
    throw new ErrorParaElUsuario('Este enlace ya fue usado. Si necesita otro, pida que se lo reenvíen.', 'RECHAZADO');
  }
  if (token.expiraEn.getTime() <= Date.now()) {
    throw new ErrorParaElUsuario('Este enlace expiró. Pida que se lo reenvíen.', 'RECHAZADO');
  }

  const contexto: ContextoTenant = { tenantId: token.tenantId, usuarioId: token.usuarioId };
  await ejecutarSinPermiso(contexto, async (cliente) => {
    const marcado = await cliente.query(
      `UPDATE app.token_recuperacion
          SET usado_en = now()
        WHERE id = $1 AND usado_en IS NULL AND anulado_en IS NULL`,
      [token.tokenId],
    );
    if (marcado.rowCount !== 1) {
      throw new ErrorParaElUsuario('Este enlace ya no se puede usar: alguien más lo consumió primero.', 'RECHAZADO');
    }

    const actualizado = await cliente.query(
      `UPDATE app.usuario
          SET password_hash = $1,
              estado = CASE WHEN estado = 'PENDIENTE' THEN 'ACTIVO' ELSE estado END
        WHERE id = $2`,
      [passwordHash, token.usuarioId],
    );
    if (actualizado.rowCount !== 1) {
      throw new ErrorParaElUsuario('El enlace no corresponde a un usuario válido.', 'RECHAZADO');
    }
  });

  return contexto;
}
