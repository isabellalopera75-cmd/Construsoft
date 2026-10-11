import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { leerEnvObligatoria } from './env.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';

/**
 * El panel del superadministrador (CONTRATO §12), sobre su PROPIA conexión:
 * superadmin_login, miembro de construsoft_superadmin (§16.8 del esquema).
 * Ninguna ruta de las empresas pasa por aquí, y ninguna del panel pasa por
 * app_login ni por auth_login.
 *
 * El rol del panel tiene BYPASSRLS: ve todas las empresas a la vez, que es
 * lo que necesita para el resumen y la lista. Por eso este módulo no fija
 * app.tenant_id y por eso nunca expone un cliente genérico: cada lectura y
 * cada acción tiene su función, y la aplicación de las empresas no la importa.
 *
 * Cada escritura va firmada (D-72). Las que son un UPDATE —suspender,
 * reactivar, plan y vencimiento, cancelar— fijan plataforma.usuario_id y
 * plataforma.motivo en la misma transacción, antes del cambio; sin las dos,
 * la base las rechaza. Las que son una función —registrar un pago, designar
 * administrador, eliminar— reciben el autor como argumento.
 *
 * El pool se abre la primera vez que se usa: la API de las empresas arranca
 * aunque el .env todavía no tenga las variables del panel.
 */
let pool: Pool | undefined;

function elPool(): Pool {
  pool ??= new Pool({
    host: leerEnvObligatoria('SUPERADMIN_DB_HOST'),
    port: Number(leerEnvObligatoria('SUPERADMIN_DB_PORT')),
    database: leerEnvObligatoria('SUPERADMIN_DB_NAME'),
    user: leerEnvObligatoria('SUPERADMIN_DB_USER'),
    password: leerEnvObligatoria('SUPERADMIN_DB_PASSWORD'),
  });
  return pool;
}

/** Quién hace la acción y por qué. Las dos quedan en plataforma.evento_plataforma. */
export interface Firma {
  autor: string;
  motivo: string;
}

async function enTransaccion<T>(firma: Firma | null, operacion: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await elPool().connect();
  try {
    await cliente.query('BEGIN');
    if (firma) {
      // El `true` es «local»: la firma muere con la transacción y no se
      // filtra a la siguiente petición que reutilice esta conexión.
      await cliente.query(
        `SELECT set_config('plataforma.usuario_id', $1, true), set_config('plataforma.motivo', $2, true)`,
        [firma.autor, firma.motivo],
      );
    }
    const resultado = await operacion(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }
}

async function consultar<T>(texto: string, parametros: unknown[] = []): Promise<T[]> {
  const { rows } = await elPool().query(texto, parametros);
  return rows as T[];
}

// --- La sesión del panel ----------------------------------------------------------

export interface Superadmin {
  id: string;
  nombre: string;
  email: string;
}

export interface SuperadminParaIngresar extends Superadmin {
  passwordHash: string;
  activo: boolean;
  /** Cambia cuando cambia la contraseña: una cookie con el sello viejo ya no vale. */
  sello: string;
}

/**
 * El sello de credenciales del panel: un resumen del hash guardado. La tabla
 * de superadministradores no tiene credenciales_en como app.usuario (D-67);
 * el hash cambia con cada contraseña nueva, y con él el sello.
 */
function selloDe(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 32);
}

interface FilaSuperadmin {
  id: string;
  nombre: string;
  email: string;
  password_hash: string;
  activo: boolean;
}

function superadminDe(fila: FilaSuperadmin): SuperadminParaIngresar {
  return {
    id: fila.id,
    nombre: fila.nombre,
    email: fila.email,
    passwordHash: fila.password_hash,
    activo: fila.activo,
    sello: selloDe(fila.password_hash),
  };
}

const COLUMNAS_SUPERADMIN = 'id, nombre, email::text AS email, password_hash, activo';

/** Null si el correo no es de ningún superadministrador. */
export async function buscarSuperadmin(email: string): Promise<SuperadminParaIngresar | null> {
  const [fila] = await consultar<FilaSuperadmin>(
    `SELECT ${COLUMNAS_SUPERADMIN} FROM plataforma.usuario_plataforma WHERE email = $1::citext`,
    [email],
  );
  return fila ? superadminDe(fila) : null;
}

/** El superadministrador de una cookie, si sigue activo y con la misma contraseña. */
export async function superadminVigente(id: string, sello: string): Promise<Superadmin | null> {
  const [fila] = await consultar<FilaSuperadmin>(
    `SELECT ${COLUMNAS_SUPERADMIN} FROM plataforma.usuario_plataforma WHERE id = $1`,
    [id],
  );
  if (!fila || !fila.activo || selloDe(fila.password_hash) !== sello) return null;
  return { id: fila.id, nombre: fila.nombre, email: fila.email };
}

/** El alta por terminal (npm run superadmin). Recibe el hash, nunca la contraseña. */
export async function altaSuperadmin(email: string, nombre: string, hash: string): Promise<string> {
  const [fila] = await consultar<{ id: string }>(
    'SELECT plataforma.fn_alta_usuario_plataforma($1::citext, $2, $3) AS id',
    [email, nombre, hash],
  );
  return fila!.id;
}

/** Contraseña nueva: por terminal, o al ingresar con un hash de parámetros viejos. Devuelve el sello nuevo. */
export async function cambiarClaveSuperadmin(email: string, hash: string): Promise<string> {
  await consultar('SELECT plataforma.fn_clave_usuario_plataforma($1::citext, $2)', [email, hash]);
  return selloDe(hash);
}

// --- Las formas (CONTRATO §12.2) ---------------------------------------------------

export type EstadoComercial = 'EN_PRUEBA' | 'ACTIVA' | 'VENCIDA' | 'CANCELADA' | 'SIN_SUSCRIPCION';

export interface FilaDeEmpresa {
  id: string;
  razonSocial: string;
  nit: string;
  planCodigo: 'PERSONAL' | 'EMPRESARIAL' | null;
  estado: EstadoComercial;
  suspendida: boolean;
  venceEl: string | null;
  diasRestantes: number | null;
  usuarios: number;
  proyectos: number;
  registradaEn: Date;
  eliminableDesde: string | null;
}

export interface PagoDePlataforma {
  id: string;
  fecha: string;
  concepto: string;
  monto: string;
  moneda: string;
  metodo: string;
  referencia: string | null;
  periodoMeses: number | null;
  cubreHasta: string;
  soporteId: string | null;
  registradoPor: string;
  registradoEn: Date;
  empresa: { id: string; razonSocial: string };
}

export interface EventoDePlataforma {
  id: string;
  tipo: string;
  descripcion: string;
  justificacion: string | null;
  ocurridoEn: Date;
  autor: string | null;
  empresa: { id: string; razonSocial: string } | null;
}

/**
 * La suscripción que cuenta de cada empresa: la misma elección que
 * plataforma.fn_estado_suscripcion (la vigente primero, después la más
 * reciente). Esa función no sirve aquí tal cual: para una empresa
 * suspendida devuelve SUSPENDIDA y se pierde su estado comercial, y el
 * panel muestra los dos por separado (CONTRATO §12.2).
 */
const SUSCRIPCION_QUE_CUENTA = `
  LEFT JOIN LATERAL (
         SELECT sx.* FROM plataforma.suscripcion sx
          WHERE sx.tenant_id = t.id
          ORDER BY (sx.estado IN ('EN_PRUEBA','ACTIVA')) DESC,
                   sx.fecha_vencimiento DESC, sx.creado_en DESC, sx.id DESC
          LIMIT 1) s ON true
  LEFT JOIN plataforma.plan pl ON pl.id = s.plan_id`;

const PAGO_EXITOSO_DE_LA_EMPRESA = `
  SELECT 1 FROM plataforma.pago px
    JOIN plataforma.suscripcion sp ON sp.id = px.suscripcion_id
   WHERE sp.tenant_id = t.id AND px.estado = 'EXITOSO'`;

/**
 * Una fila por empresa. `eliminableDesde` es la regla de fn_eliminar_tenant
 * vista desde antes: solo una prueba que nunca pagó ni pasó a otro estado, y
 * diez días después de vencer (RF-SAD-13). La que decide al eliminar sigue
 * siendo la base; esto solo dice desde cuándo la pantalla ofrece el botón.
 */
const FILAS_DE_EMPRESA = `
  SELECT t.id, t.razon_social AS "razonSocial", t.nit,
         pl.codigo AS "planCodigo",
         CASE WHEN s.id IS NULL                       THEN 'SIN_SUSCRIPCION'
              WHEN s.estado = 'CANCELADA'             THEN 'CANCELADA'
              WHEN s.fecha_vencimiento < current_date THEN 'VENCIDA'
              WHEN s.estado = 'EN_PRUEBA'             THEN 'EN_PRUEBA'
              ELSE                                         'ACTIVA' END AS estado,
         t.estado = 'SUSPENDIDO' AS suspendida,
         s.fecha_vencimiento::text AS "venceEl",
         (s.fecha_vencimiento - current_date) AS "diasRestantes",
         (SELECT count(*)::int FROM app.usuario u
           WHERE u.tenant_id = t.id AND u.estado <> 'REVOCADO') AS usuarios,
         (SELECT count(*)::int FROM app.presupuesto p WHERE p.tenant_id = t.id) AS proyectos,
         t.creado_en AS "registradaEn",
         CASE WHEN s.estado = 'EN_PRUEBA'
               AND NOT EXISTS (${PAGO_EXITOSO_DE_LA_EMPRESA})
               AND NOT EXISTS (SELECT 1 FROM plataforma.suscripcion so
                                WHERE so.tenant_id = t.id AND so.estado <> 'EN_PRUEBA')
              THEN (s.fecha_vencimiento + 10)::text END AS "eliminableDesde"
    FROM plataforma.tenant t
    ${SUSCRIPCION_QUE_CUENTA}`;

const PAGOS = `
  SELECT p.id, p.fecha::text AS fecha, p.concepto, p.monto, btrim(p.moneda) AS moneda, p.metodo,
         p.referencia, p.periodo_meses AS "periodoMeses", p.cubre_hasta::text AS "cubreHasta",
         p.soporte_ruta AS "soporteId",
         COALESCE(up.nombre, 'Pasarela ' || p.pasarela) AS "registradoPor",
         p.registrado_en AS "registradoEn",
         json_build_object('id', t.id, 'razonSocial', t.razon_social) AS empresa
    FROM plataforma.pago p
    JOIN plataforma.suscripcion s ON s.id = p.suscripcion_id
    JOIN plataforma.tenant t ON t.id = s.tenant_id
    LEFT JOIN plataforma.usuario_plataforma up ON up.id = p.registrado_por`;

const EVENTOS = `
  SELECT e.id::text AS id, e.tipo, e.descripcion, e.justificacion, e.ocurrido_en AS "ocurridoEn",
         up.nombre AS autor,
         CASE WHEN t.id IS NULL THEN NULL
              ELSE json_build_object('id', t.id, 'razonSocial', t.razon_social) END AS empresa
    FROM plataforma.evento_plataforma e
    LEFT JOIN plataforma.tenant t ON t.id = e.tenant_id
    LEFT JOIN plataforma.usuario_plataforma up ON up.id = e.usuario_plataforma_id`;

// --- Lecturas -----------------------------------------------------------------------

export interface FiltrosDeEmpresas {
  texto?: string;
  /** Uno de EstadoComercial, o SUSPENDIDA. */
  estado?: EstadoComercial | 'SUSPENDIDA';
  plan?: 'PERSONAL' | 'EMPRESARIAL';
}

/**
 * RF-SAD-03. `texto` busca en la razón social sin mayúsculas ni tildes
 * (plataforma.fn_sin_tildes: «rios» encuentra «Ríos»), y en el NIT por sus
 * dígitos, con o sin puntos y guion. strpos y no LIKE: un «%» o un «_» que
 * escriba la persona es un carácter, no un comodín.
 */
export async function listarEmpresas(filtros: FiltrosDeEmpresas = {}): Promise<FilaDeEmpresa[]> {
  return consultar<FilaDeEmpresa>(
    `SELECT * FROM (${FILAS_DE_EMPRESA}) f
      WHERE ($1::text IS NULL
             OR strpos(plataforma.fn_sin_tildes(f."razonSocial"), plataforma.fn_sin_tildes($1)) > 0
             OR (regexp_replace($1, '\\D', '', 'g') <> ''
                 AND strpos(regexp_replace(f.nit, '\\D', '', 'g'), regexp_replace($1, '\\D', '', 'g')) > 0))
        AND ($2::text IS NULL OR ($2 = 'SUSPENDIDA' AND f.suspendida) OR f.estado = $2)
        AND ($3::text IS NULL OR f."planCodigo" = $3)
      ORDER BY f."razonSocial", f.id`,
    [filtros.texto?.trim() || null, filtros.estado ?? null, filtros.plan ?? null],
  );
}

export interface Resumen {
  empresas: { total: number; enPrueba: number; activas: number; vencidas: number; canceladas: number; suspendidas: number };
  nuevasEsteMes: number;
  ingresosDelMes: string;
  moneda: 'COP';
  proyectos: number;
  porPlan: { PERSONAL: number; EMPRESARIAL: number };
  porVencer: FilaDeEmpresa[];
  pruebasSinConvertir: FilaDeEmpresa[];
}

/** RF-SAD-02 y RF-SAD-10. Son decenas de empresas: se cuentan sobre la misma lista. */
export async function leerResumen(): Promise<Resumen> {
  const filas = await listarEmpresas();
  const [cifras] = await consultar<{ nuevas: number; ingresos: string; proyectos: number }>(
    `SELECT (SELECT count(*)::int FROM plataforma.tenant
              WHERE date_trunc('month', creado_en) = date_trunc('month', now())) AS nuevas,
            (SELECT COALESCE(sum(monto), 0)::text FROM plataforma.pago
              WHERE estado = 'EXITOSO' AND moneda = 'COP'
                AND date_trunc('month', fecha) = date_trunc('month', current_date)) AS ingresos,
            (SELECT count(*)::int FROM app.presupuesto) AS proyectos`,
  );
  const cuantas = (condicion: (f: FilaDeEmpresa) => boolean) => filas.filter(condicion).length;
  const porVencimiento = (a: FilaDeEmpresa, b: FilaDeEmpresa) => (a.venceEl ?? '').localeCompare(b.venceEl ?? '');
  return {
    empresas: {
      total: filas.length,
      enPrueba: cuantas((f) => f.estado === 'EN_PRUEBA'),
      activas: cuantas((f) => f.estado === 'ACTIVA'),
      vencidas: cuantas((f) => f.estado === 'VENCIDA'),
      canceladas: cuantas((f) => f.estado === 'CANCELADA'),
      suspendidas: cuantas((f) => f.suspendida),
    },
    nuevasEsteMes: cifras!.nuevas,
    ingresosDelMes: cifras!.ingresos,
    moneda: 'COP',
    proyectos: cifras!.proyectos,
    porPlan: {
      PERSONAL: cuantas((f) => f.planCodigo === 'PERSONAL'),
      EMPRESARIAL: cuantas((f) => f.planCodigo === 'EMPRESARIAL'),
    },
    porVencer: filas
      .filter((f) => (f.estado === 'EN_PRUEBA' || f.estado === 'ACTIVA') && f.diasRestantes !== null && f.diasRestantes <= 7)
      .sort(porVencimiento),
    pruebasSinConvertir: filas.filter((f) => f.estado === 'VENCIDA' && f.eliminableDesde !== null).sort(porVencimiento),
  };
}

export interface FichaDeEmpresa {
  empresa: {
    id: string;
    razonSocial: string;
    nit: string;
    direccion: string | null;
    telefono: string | null;
    emailRecuperacion: string | null;
    registradaEn: Date;
    suspendida: boolean;
  };
  suscripcion: {
    id: string;
    planCodigo: string;
    estado: EstadoComercial;
    fechaInicio: string;
    venceEl: string;
    diasRestantes: number;
    canceladaEn: Date | null;
    canceladaMotivo: string | null;
  } | null;
  usuarios: {
    id: string;
    nombre: string;
    email: string;
    rolNombre: string;
    rolTipo: string;
    estado: string;
    ultimoAcceso: Date | null;
  }[];
  cifras: { proyectos: number; recursos: number; apus: number };
  pagos: PagoDePlataforma[];
  eventos: EventoDePlataforma[];
  eliminableDesde: string | null;
}

/** Null si la empresa no existe. Solo conteos de lo técnico: el panel no ve obras (01 §9). */
export async function leerFicha(tenantId: string): Promise<FichaDeEmpresa | null> {
  const [empresa] = await consultar<FichaDeEmpresa['empresa'] & { fila: FilaDeEmpresa; suscripcion: FichaDeEmpresa['suscripcion'] }>(
    `SELECT t.id, t.razon_social AS "razonSocial", t.nit, t.direccion, t.telefono,
            t.email_recuperacion::text AS "emailRecuperacion", t.creado_en AS "registradaEn",
            t.estado = 'SUSPENDIDO' AS suspendida,
            CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
              'id', s.id, 'planCodigo', pl.codigo, 'estado', f.estado,
              'fechaInicio', s.fecha_inicio::text, 'venceEl', s.fecha_vencimiento::text,
              'diasRestantes', s.fecha_vencimiento - current_date,
              'canceladaEn', s.cancelada_en, 'canceladaMotivo', s.cancelada_motivo) END AS suscripcion,
            row_to_json(f) AS fila
       FROM plataforma.tenant t
       ${SUSCRIPCION_QUE_CUENTA}
       JOIN (${FILAS_DE_EMPRESA}) f ON f.id = t.id
      WHERE t.id = $1`,
    [tenantId],
  );
  if (!empresa) return null;

  const usuarios = await consultar<FichaDeEmpresa['usuarios'][number]>(
    `SELECT u.id, u.nombre, u.email::text AS email, r.nombre AS "rolNombre", r.tipo AS "rolTipo",
            u.estado, u.ultimo_acceso AS "ultimoAcceso"
       FROM app.usuario u
       JOIN app.rol r ON r.tenant_id = u.tenant_id AND r.id = u.rol_id
      WHERE u.tenant_id = $1
      ORDER BY u.nombre, u.id`,
    [tenantId],
  );
  const [cifras] = await consultar<FichaDeEmpresa['cifras']>(
    `SELECT (SELECT count(*)::int FROM app.presupuesto WHERE tenant_id = $1) AS proyectos,
            (SELECT count(*)::int FROM app.recurso     WHERE tenant_id = $1) AS recursos,
            (SELECT count(*)::int FROM app.apu         WHERE tenant_id = $1) AS apus`,
    [tenantId],
  );
  const { fila, suscripcion, ...datos } = empresa;
  return {
    empresa: { ...datos, registradaEn: new Date(datos.registradaEn) },
    suscripcion,
    usuarios,
    cifras: cifras!,
    pagos: await consultar<PagoDePlataforma>(`${PAGOS} WHERE t.id = $1 ORDER BY p.fecha DESC, p.registrado_en DESC`, [tenantId]),
    eventos: await listarEventos(tenantId),
    eliminableDesde: fila.eliminableDesde,
  };
}

/** RF-SAD-08. Los pagos con fecha entre las dos, y el total de los exitosos. */
export async function listarPagos(desde: string, hasta: string): Promise<{ pagos: PagoDePlataforma[]; total: string; moneda: 'COP' }> {
  const pagos = await consultar<PagoDePlataforma>(
    `${PAGOS} WHERE p.fecha BETWEEN $1::date AND $2::date ORDER BY p.fecha DESC, p.registrado_en DESC`,
    [desde, hasta],
  );
  const [suma] = await consultar<{ total: string }>(
    `SELECT COALESCE(sum(monto), 0)::text AS total FROM plataforma.pago
      WHERE estado = 'EXITOSO' AND moneda = 'COP' AND fecha BETWEEN $1::date AND $2::date`,
    [desde, hasta],
  );
  return { pagos, total: suma!.total, moneda: 'COP' };
}

/** Los 200 más recientes, de una empresa o de todas. */
export async function listarEventos(tenantId: string | null = null): Promise<EventoDePlataforma[]> {
  return consultar<EventoDePlataforma>(
    `${EVENTOS} WHERE ($1::uuid IS NULL OR e.tenant_id = $1)
      ORDER BY e.ocurrido_en DESC, e.id DESC LIMIT 200`,
    [tenantId],
  );
}

// --- Comprobantes de pago (D-71) ------------------------------------------------

export type TipoDeSoporte = 'image/png' | 'image/jpeg' | 'application/pdf';

export async function subirSoporte(autor: string, contenido: Buffer, tipo: TipoDeSoporte): Promise<string> {
  const [fila] = await consultar<{ id: string }>(
    `INSERT INTO plataforma.soporte_pago (sha256, tipo, contenido, subido_por)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [createHash('sha256').update(contenido).digest('hex'), tipo, contenido, autor],
  );
  return fila!.id;
}

export async function leerSoporte(id: string): Promise<{ contenido: Buffer; tipo: TipoDeSoporte } | null> {
  const [fila] = await consultar<{ contenido: Buffer; tipo: TipoDeSoporte }>(
    'SELECT contenido, tipo FROM plataforma.soporte_pago WHERE id = $1',
    [id],
  );
  return fila ?? null;
}

// --- Acciones ---------------------------------------------------------------------

const empresaNoExiste = () => new ErrorParaElUsuario('Esa empresa no existe.', 'NO_EXISTE');

/**
 * La suscripción vigente (en prueba o activa), bloqueada para la acción. Una
 * empresa cancelada no tiene: el panel no la reabre sin una regla escrita.
 */
async function suscripcionVigente(c: PoolClient, tenantId: string): Promise<string> {
  const empresa = await c.query('SELECT 1 FROM plataforma.tenant WHERE id = $1', [tenantId]);
  if (empresa.rows.length === 0) throw empresaNoExiste();
  const { rows } = await c.query<{ id: string }>(
    `SELECT id FROM plataforma.suscripcion
      WHERE tenant_id = $1 AND estado IN ('EN_PRUEBA','ACTIVA')
      FOR UPDATE`,
    [tenantId],
  );
  if (!rows[0]) {
    throw new ErrorParaElUsuario(
      'La suscripción de esta empresa está cancelada: no admite pagos ni cambios de plan.',
      'RECHAZADO',
    );
  }
  return rows[0].id;
}

/** RF-SAD-04 y 05. Suspender corta el acceso sin tocar la suscripción. */
export async function cambiarSuspension(firma: Firma, tenantId: string, suspender: boolean): Promise<void> {
  await enTransaccion(firma, async (c) => {
    const { rows } = await c.query<{ estado: string }>('SELECT estado FROM plataforma.tenant WHERE id = $1 FOR UPDATE', [tenantId]);
    if (rows.length === 0) throw empresaNoExiste();
    const nuevo = suspender ? 'SUSPENDIDO' : 'ACTIVO';
    if (rows[0]!.estado === nuevo) {
      throw new ErrorParaElUsuario(
        suspender ? 'La empresa ya está suspendida.' : 'La empresa no está suspendida.',
        'RECHAZADO',
      );
    }
    await c.query('UPDATE plataforma.tenant SET estado = $2 WHERE id = $1', [tenantId, nuevo]);
  });
}

/**
 * RF-SAD-06. El paso a un plan menor lo frena tg_plan_cabe con su mensaje.
 * Un vencimiento en el pasado no lo prohíbe la base, pero dejaría a la
 * empresa vencida en el acto: lo rechaza el contrato (§12.3).
 */
export async function cambiarSuscripcion(
  firma: Firma,
  tenantId: string,
  datos: { planCodigo: 'PERSONAL' | 'EMPRESARIAL'; venceEl: string },
): Promise<void> {
  await enTransaccion(firma, async (c) => {
    const suscripcion = await suscripcionVigente(c, tenantId);
    const { rows } = await c.query<{ pasada: boolean }>('SELECT $1::date < current_date AS pasada', [datos.venceEl]);
    if (rows[0]!.pasada) {
      throw new ErrorParaElUsuario('Esa fecha ya pasó. Elija hoy o una fecha futura.', 'RECHAZADO', 'venceEl');
    }
    await c.query(
      `UPDATE plataforma.suscripcion
          SET plan_id = (SELECT id FROM plataforma.plan WHERE codigo = $2),
              fecha_vencimiento = $3::date
        WHERE id = $1`,
      [suscripcion, datos.planCodigo, datos.venceEl],
    );
  });
}

/** RF-SAD-07. Comercial y manual (D-25): conserva todo. */
export async function cancelarSuscripcion(firma: Firma, tenantId: string): Promise<void> {
  await enTransaccion(firma, async (c) => {
    const suscripcion = await suscripcionVigente(c, tenantId);
    await c.query(
      `UPDATE plataforma.suscripcion
          SET estado = 'CANCELADA', cancelada_en = now(), cancelada_motivo = $2
        WHERE id = $1`,
      [suscripcion, firma.motivo],
    );
  });
}

/** La fecha que dejaría un pago de `meses`: la calcula la base, no la pantalla. */
export async function proponerCubreHasta(tenantId: string, meses: number): Promise<string> {
  return enTransaccion(null, async (c) => {
    const suscripcion = await suscripcionVigente(c, tenantId);
    const { rows } = await c.query<{ fecha: string }>(
      'SELECT plataforma.fn_proponer_cubre_hasta($1, $2::smallint)::text AS fecha',
      [suscripcion, meses],
    );
    return rows[0]!.fecha;
  });
}

export interface PagoNuevo {
  fecha: string;
  concepto: string;
  monto: string;
  metodo: string;
  referencia: string | null;
  periodoMeses: number | null;
  cubreHasta: string | null;
  soporteId: string | null;
}

/** RF-SAD-09 y 12, con fn_registrar_pago: el pago, el vencimiento nuevo y su evento. */
export async function registrarPago(autor: string, tenantId: string, pago: PagoNuevo): Promise<void> {
  await enTransaccion(null, async (c) => {
    const suscripcion = await suscripcionVigente(c, tenantId);
    // pago.soporte_ruta no tiene llave en el esquema: el comprobante se comprueba aquí.
    if (pago.soporteId) {
      const { rows } = await c.query('SELECT 1 FROM plataforma.soporte_pago WHERE id = $1', [pago.soporteId]);
      if (rows.length === 0) {
        throw new ErrorParaElUsuario('Ese comprobante no existe. Súbalo otra vez.', 'RECHAZADO', 'soporteId');
      }
    }
    try {
      await c.query(
        `SELECT plataforma.fn_registrar_pago($1, $2::date, $3, $4::numeric, $5, $6, $7::smallint, $8,
                                             NULL, NULL, NULL, $9::date, $10)`,
        [
          suscripcion,
          pago.fecha,
          pago.concepto,
          pago.monto,
          pago.metodo,
          pago.referencia,
          pago.periodoMeses,
          autor,
          pago.cubreHasta,
          pago.soporteId,
        ],
      );
    } catch (error) {
      // Con la fecha escrita a mano, el único rechazo de la función es que ya
      // pasó (D-36): su mensaje va tal cual, marcando el campo.
      if (pago.cubreHasta && (error as { code?: string }).code === 'P0001') {
        throw new ErrorParaElUsuario((error as Error).message, 'RECHAZADO', 'cubreHasta');
      }
      throw error;
    }
  });
}

/** RF-SAD-14. Si el correo no está en la empresa, la persona nace PENDIENTE. */
export async function designarAdministrador(
  autor: string,
  tenantId: string,
  datos: { email: string; nombre: string; justificacion: string },
): Promise<void> {
  await enTransaccion(null, async (c) => {
    const { rows } = await c.query('SELECT 1 FROM plataforma.tenant WHERE id = $1', [tenantId]);
    if (rows.length === 0) throw empresaNoExiste();
    await c.query('SELECT app.fn_designar_admin($1, $2::citext, $3, $4, $5, NULL)', [
      tenantId,
      datos.email,
      datos.nombre,
      datos.justificacion,
      autor,
    ]);
  });
}

/**
 * RF-SAD-13 y 15. La confirmación es la razón social escrita a mano. Las
 * condiciones —no pagó, prueba vencida hace 10 días— las decide la base.
 */
export async function eliminarEmpresa(
  autor: string,
  tenantId: string,
  datos: { justificacion: string; confirmacion: string },
): Promise<void> {
  await enTransaccion(null, async (c) => {
    const { rows } = await c.query<{ razon_social: string }>(
      'SELECT razon_social FROM plataforma.tenant WHERE id = $1 FOR UPDATE',
      [tenantId],
    );
    if (rows.length === 0) throw empresaNoExiste();
    const razonSocial = rows[0]!.razon_social;
    if (datos.confirmacion.trim() !== razonSocial.trim()) {
      throw new ErrorParaElUsuario(
        `La confirmación no coincide. Escriba la razón social exactamente como aparece: «${razonSocial}».`,
        'RECHAZADO',
        'confirmacion',
      );
    }
    await c.query('SELECT app.fn_eliminar_tenant($1, $2, $3)', [tenantId, datos.justificacion, autor]);
  });
}
