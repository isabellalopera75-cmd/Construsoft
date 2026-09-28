import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { leerEnvObligatoria } from './env.js';
import { resolverToken } from './autenticacion.js';

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
 *   3. listarMisPermisos — preguntar los permisos propios no puede exigir un
 *      permiso previo sin caer en una paradoja (¿qué permiso hace falta para
 *      preguntar qué permisos hay?), y es la operación que la interfaz
 *      necesita para decidir qué mostrar en el menú.
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

/**
 * Los permisos del usuario de la sesión, en vivo, en cada llamada — nunca
 * guardados en el login ni en la sesión. Guardarlos sería la misma caché que
 * ya se descartó para app.tenant_id, con otro nombre: quedarían viejos en
 * cuanto un administrador le cambiara el rol a alguien que sigue conectado.
 * Es la operación que la interfaz necesita para dibujar el menú según lo que
 * esa persona puede hacer, y por eso está exenta de exigir un permiso propio.
 */
export async function listarMisPermisos(contexto: ContextoTenant): Promise<CodigoPermiso[]> {
  return ejecutarSinPermiso(contexto, async (cliente) => {
    const { rows } = await cliente.query<{ permiso_codigo: CodigoPermiso }>(
      `SELECT rp.permiso_codigo
         FROM app.usuario u
         JOIN app.rol_permiso rp ON rp.rol_id = u.rol_id
        WHERE u.id = $1
        ORDER BY rp.permiso_codigo`,
      [contexto.usuarioId],
    );
    return rows.map((fila) => fila.permiso_codigo);
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
 * Registra una empresa nueva contra app.fn_alta_tenant (RN-01, D-51).
 *
 * No pasa por ejecutarComoTenant: todavía no hay tenant_id que fijar —
 * es lo que esta llamada está a punto de crear. Tampoco abre una
 * transacción explícita: fn_alta_tenant YA es una transacción completa por
 * sí sola (una única sentencia, RETURN QUERY al final), así que envolverla
 * en un BEGIN/COMMIT propio no protegería nada que Postgres no proteja ya.
 *
 * No usa fn_autenticar para descubrir la identidad del administrador que
 * acaba de nacer: D-51 hizo que fn_alta_tenant devuelva sus tres ids
 * porque ese uso de fn_autenticar es justo el que D-46 estrechó — esa
 * función verifica credenciales, no resuelve identidades.
 */
export async function registrarEmpresa(datos: DatosRegistroEmpresa): Promise<EmpresaRegistrada> {
  const { rows } = await pool.query<FilaAltaTenant>(
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
  return {
    tenantId: fila.id_tenant,
    usuarioId: fila.id_usuario,
    rolAdminId: fila.id_rol_admin,
  };
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
    throw new Error('El enlace no es válido: no corresponde a ningún token emitido.');
  }
  if (token.anuladoEn) {
    throw new Error(
      'Este enlace ya no es válido: se emitió uno más reciente para el mismo trámite. ' +
        'Use el último enlace que se envió.',
    );
  }
  if (token.usadoEn) {
    throw new Error('Este enlace ya fue usado. Si necesita otro, pida que se lo reenvíen.');
  }
  if (token.expiraEn.getTime() <= Date.now()) {
    throw new Error('Este enlace expiró. Pida que se lo reenvíen.');
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
      throw new Error('Este enlace ya no se puede usar: alguien más lo consumió primero.');
    }

    const actualizado = await cliente.query(
      `UPDATE app.usuario
          SET password_hash = $1,
              estado = CASE WHEN estado = 'PENDIENTE' THEN 'ACTIVO' ELSE estado END
        WHERE id = $2`,
      [passwordHash, token.usuarioId],
    );
    if (actualizado.rowCount !== 1) {
      throw new Error('El enlace no corresponde a un usuario válido.');
    }
  });

  return contexto;
}
