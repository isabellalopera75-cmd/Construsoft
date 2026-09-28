import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { leerEnvObligatoria } from './env.js';
import { resolverToken } from './autenticacion.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pool de conexiones como app_login (grupo construsoft_app, RLS forzado).
 *
 * PRIVADO A PROPÓSITO: no se exporta. Las únicas dos formas de obtener algo
 * con qué hablarle a esta base son ejecutarComoTenant (trabajo con un
 * contexto de inquilino que YA existe) y registrarEmpresa (la única
 * operación que lo crea por primera vez, y por eso es la única que no lo
 * recibe). Ninguna de las dos expone el pool ni un cliente genérico — no es
 * una convención que alguien pueda olvidar, es que no hay ningún
 * identificador exportado con el que hacerlo.
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
 * Abre una transacción explícita, fija app.tenant_id y app.usuario_id
 * (RN-01, RNF-01) y corre `operacion` dentro de ella. Hace COMMIT si
 * `operacion` resuelve y ROLLBACK si lanza, y siempre libera el cliente al
 * final.
 *
 * Ningún código de la aplicación puede consultar esta base sin que el
 * contexto de inquilino quede fijado primero — salvo registrarEmpresa, que
 * es quien lo crea.
 */
export async function ejecutarComoTenant<T>(
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
 * tenantId que reciba por fuera— abre la transacción con ejecutarComoTenant.
 * Así una empresa nunca puede terminar actuando sobre el token de otra: el
 * contexto sale siempre del propio token, no de quien llama.
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
  await ejecutarComoTenant(contexto, async (cliente) => {
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
