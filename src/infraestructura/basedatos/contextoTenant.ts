import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { leerEnvObligatoria } from './env.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pool de conexiones como app_login (grupo construsoft_app, RLS forzado).
 *
 * PRIVADO A PROPÓSITO: no se exporta. La única forma de obtener algo con
 * qué consultar esta base es llamar a ejecutarComoTenant, que fija el
 * contexto de inquilino ANTES de entregar el cliente. No existe en este
 * módulo, ni en ningún otro, una vía para hacer una consulta "suelta" que
 * corra sin ese contexto — no es una convención que alguien pueda olvidar,
 * es que no hay ningún identificador exportado con el que hacerlo.
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
 * Es la ÚNICA función de este módulo que se exporta: no hay pool, ni
 * cliente, ni query accesibles desde afuera de acá. Ningún código de la
 * aplicación puede consultar esta base sin que el contexto de inquilino
 * quede fijado primero.
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
