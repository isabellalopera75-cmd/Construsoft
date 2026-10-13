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

/**
 * fn_estado_comercial (D-74): sin la suspensión del panel encima, que va
 * aparte en `suspendida`. SUSPENDIDA aquí es la suspensión por falta de pago.
 */
export type EstadoComercial = 'EN_PRUEBA' | 'ACTIVA' | 'POR_PAGAR' | 'VENCIDA' | 'SUSPENDIDA' | 'CANCELADA' | 'SIN_SUSCRIPCION';
export type EstadoDePago = 'EXITOSO' | 'PENDIENTE' | 'RECHAZADO';

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
  /** Nulo mientras espera verificación. */
  cubreHasta: string | null;
  soporteId: string | null;
  estado: EstadoDePago;
  origen: 'MANUAL' | 'REPORTADO' | 'PASARELA';
  /** Nulo mientras espera verificación. */
  registradoPor: string | null;
  reportadoPor: string | null;
  rechazoMotivo: string | null;
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
 * La suscripción que cuenta de cada empresa, para el plan y las fechas: la
 * misma elección que plataforma.fn_estado_comercial (la vigente primero,
 * después la más reciente). El ESTADO no se deduce aquí: lo da esa función.
 */
const SUSCRIPCION_QUE_CUENTA = `
  LEFT JOIN LATERAL (
         SELECT sx.* FROM plataforma.suscripcion sx
          WHERE sx.tenant_id = t.id
          ORDER BY (sx.estado IN ('EN_PRUEBA','ACTIVA')) DESC,
                   sx.fecha_vencimiento DESC, sx.creado_en DESC, sx.id DESC
          LIMIT 1) s ON true
  LEFT JOIN plataforma.plan pl ON pl.id = s.plan_id`;

/**
 * Una fila por empresa. El estado comercial y desde cuándo es eliminable los
 * da la base (D-73): fn_estado_comercial, sin la suspensión encima, y
 * fn_eliminable_desde, la misma regla que aplica fn_eliminar_tenant.
 */
const FILAS_DE_EMPRESA = `
  SELECT t.id, t.razon_social AS "razonSocial", t.nit,
         pl.codigo AS "planCodigo",
         plataforma.fn_estado_comercial(t.id) AS estado,
         t.estado = 'SUSPENDIDO' AS suspendida,
         s.fecha_vencimiento::text AS "venceEl",
         (s.fecha_vencimiento - current_date) AS "diasRestantes",
         (SELECT count(*)::int FROM app.usuario u
           WHERE u.tenant_id = t.id AND u.estado <> 'REVOCADO') AS usuarios,
         (SELECT count(*)::int FROM app.presupuesto p WHERE p.tenant_id = t.id) AS proyectos,
         t.creado_en AS "registradaEn",
         plataforma.fn_eliminable_desde(t.id)::text AS "eliminableDesde"
    FROM plataforma.tenant t
    ${SUSCRIPCION_QUE_CUENTA}`;

/**
 * `registradoPor` es quien lo registró o lo verificó; nulo mientras un pago
 * reportado espera. `reportadoPor`, la persona de la empresa que lo reportó
 * (D-73).
 */
const PAGOS = `
  SELECT p.id, p.fecha::text AS fecha, p.concepto, p.monto, btrim(p.moneda) AS moneda, p.metodo,
         p.referencia, p.periodo_meses AS "periodoMeses", p.cubre_hasta::text AS "cubreHasta",
         p.soporte_ruta AS "soporteId", p.estado, p.origen,
         COALESCE(up.nombre, CASE WHEN p.origen = 'PASARELA' THEN 'Pasarela ' || p.pasarela END) AS "registradoPor",
         ur.nombre AS "reportadoPor", p.rechazo_motivo AS "rechazoMotivo",
         p.registrado_en AS "registradoEn",
         json_build_object('id', t.id, 'razonSocial', t.razon_social) AS empresa
    FROM plataforma.pago p
    JOIN plataforma.suscripcion s ON s.id = p.suscripcion_id
    JOIN plataforma.tenant t ON t.id = s.tenant_id
    LEFT JOIN plataforma.usuario_plataforma up ON up.id = p.registrado_por
    LEFT JOIN app.usuario ur ON ur.id = p.reportado_por`;

/** El autor de un PAGO_REPORTADO es la persona de la empresa, con «(empresa)» detrás (CONTRATO §14.2). */
const EVENTOS = `
  SELECT e.id::text AS id, e.tipo, e.descripcion, e.justificacion, e.ocurrido_en AS "ocurridoEn",
         COALESCE(up.nombre,
                  CASE WHEN e.tipo = 'PAGO_REPORTADO' THEN (e.datos->>'reportado_por') || ' (empresa)' END) AS autor,
         CASE WHEN t.id IS NULL THEN NULL
              ELSE json_build_object('id', t.id, 'razonSocial', t.razon_social) END AS empresa
    FROM plataforma.evento_plataforma e
    LEFT JOIN plataforma.tenant t ON t.id = e.tenant_id
    LEFT JOIN plataforma.usuario_plataforma up ON up.id = e.usuario_plataforma_id`;

// --- Lecturas -----------------------------------------------------------------------

export interface FiltrosDeEmpresas {
  texto?: string;
  /** Uno de EstadoComercial. SUSPENDIDA trae las dos suspensiones: la del panel y la de falta de pago. */
  estado?: EstadoComercial;
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
  empresas: {
    total: number;
    enPrueba: number;
    activas: number;
    porPagar: number;
    vencidas: number;
    canceladas: number;
    /** Las dos suspensiones: la del panel y la de falta de pago. */
    suspendidas: number;
  };
  nuevasEsteMes: number;
  ingresosDelMes: string;
  moneda: 'COP';
  proyectos: number;
  porPlan: { PERSONAL: number; EMPRESARIAL: number };
  /** Los pagos reportados que esperan verificación, del más antiguo al más reciente (D-73). */
  porVerificar: PagoDePlataforma[];
  porVencer: FilaDeEmpresa[];
  pruebasSinConvertir: FilaDeEmpresa[];
  /**
   * Las que se pueden eliminar en los próximos 7 días o antes, por fecha
   * (CONTRATO §15.4). Las pruebas vencidas no: esas siguen en
   * pruebasSinConvertir y se eliminan a mano.
   */
  porEliminar: FilaDeEmpresa[];
}

/** RF-SAD-02 y RF-SAD-10. Son decenas de empresas: se cuentan sobre la misma lista. */
export async function leerResumen(): Promise<Resumen> {
  const filas = await listarEmpresas();
  const [cifras] = await consultar<{ nuevas: number; ingresos: string; proyectos: number; enUnaSemana: string }>(
    `SELECT (current_date + 7)::text AS "enUnaSemana",
            (SELECT count(*)::int FROM plataforma.tenant
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
      porPagar: cuantas((f) => f.estado === 'POR_PAGAR'),
      vencidas: cuantas((f) => f.estado === 'VENCIDA'),
      canceladas: cuantas((f) => f.estado === 'CANCELADA'),
      suspendidas: cuantas((f) => f.suspendida || f.estado === 'SUSPENDIDA'),
    },
    nuevasEsteMes: cifras!.nuevas,
    ingresosDelMes: cifras!.ingresos,
    moneda: 'COP',
    proyectos: cifras!.proyectos,
    porPlan: {
      PERSONAL: cuantas((f) => f.planCodigo === 'PERSONAL'),
      EMPRESARIAL: cuantas((f) => f.planCodigo === 'EMPRESARIAL'),
    },
    porVerificar: await consultar<PagoDePlataforma>(
      `${PAGOS} WHERE p.origen = 'REPORTADO' AND p.estado = 'PENDIENTE' ORDER BY p.registrado_en, p.id`,
    ),
    porVencer: filas
      .filter((f) => (f.estado === 'EN_PRUEBA' || f.estado === 'ACTIVA') && f.diasRestantes !== null && f.diasRestantes <= 7)
      .sort(porVencimiento),
    pruebasSinConvertir: filas.filter((f) => f.estado === 'VENCIDA' && f.eliminableDesde !== null).sort(porVencimiento),
    // Las fechas aaaa-mm-dd se ordenan y se comparan como texto; «hoy» es el de la base.
    porEliminar: filas
      .filter((f) => f.estado !== 'VENCIDA' && f.eliminableDesde !== null && f.eliminableDesde <= cifras!.enUnaSemana)
      .sort((a, b) => a.eliminableDesde!.localeCompare(b.eliminableDesde!)),
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
    /** D-74, de fn_ciclo_suscripcion(id, false): los plazos, sin la suspensión del panel encima. */
    /** PRUEBA: la prueba gratuita que terminó sin pago (D-76). */
    canceladaPor: 'EMPRESA' | 'PLATAFORMA' | 'PRUEBA' | null;
    pagarAMasTardar: string | null;
    suspendidaDesde: string | null;
    reactivableHasta: string | null;
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
              'canceladaEn', s.cancelada_en, 'canceladaMotivo', s.cancelada_motivo,
              'canceladaPor', c.cancelada_por, 'pagarAMasTardar', c.pagar_a_mas_tardar::text,
              'suspendidaDesde', c.suspendida_desde::text,
              'reactivableHasta', c.reactivable_hasta::text) END AS suscripcion,
            row_to_json(f) AS fila
       FROM plataforma.tenant t
       ${SUSCRIPCION_QUE_CUENTA}
       JOIN (${FILAS_DE_EMPRESA}) f ON f.id = t.id
       LEFT JOIN LATERAL plataforma.fn_ciclo_suscripcion(t.id, false) c ON true
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

/** RF-SAD-08. Los pagos con fecha entre las dos, de un estado o de todos, y el total de los exitosos. */
export async function listarPagos(
  desde: string,
  hasta: string,
  estado: EstadoDePago | null = null,
): Promise<{ pagos: PagoDePlataforma[]; total: string; moneda: 'COP' }> {
  const pagos = await consultar<PagoDePlataforma>(
    `${PAGOS} WHERE p.fecha BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR p.estado = $3)
      ORDER BY p.fecha DESC, p.registrado_en DESC`,
    [desde, hasta, estado],
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

/**
 * La fecha que dejaría un pago de `meses`: la calcula la base, no la pantalla.
 * Una cancelada no admite pagos del panel, pero sí confirmar el pago reportado
 * que la reactiva (CONTRATO §15.4): con uno pendiente, la propuesta es sobre
 * esa suscripción, la misma que tomará fn_confirmar_pago.
 */
export async function proponerCubreHasta(tenantId: string, meses: number): Promise<string> {
  return enTransaccion(null, async (c) => {
    const { rows: porReactivar } = await c.query<{ id: string }>(
      `SELECT s.id FROM plataforma.suscripcion s
        WHERE s.tenant_id = $1 AND s.estado = 'CANCELADA'
          AND EXISTS (SELECT 1 FROM plataforma.pago p
                       WHERE p.suscripcion_id = s.id AND p.origen = 'REPORTADO' AND p.estado = 'PENDIENTE')
          AND NOT EXISTS (SELECT 1 FROM plataforma.suscripcion v
                           WHERE v.tenant_id = s.tenant_id AND v.estado IN ('EN_PRUEBA','ACTIVA'))`,
      [tenantId],
    );
    const suscripcion = porReactivar[0]?.id ?? (await suscripcionVigente(c, tenantId));
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
    // El SAVEPOINT deja consultar después de un rechazo, que aborta la transacción.
    await c.query('SAVEPOINT registrar');
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
      // La fecha escrita a mano que ya pasó (D-36) marca su campo. Pero no es
      // el único rechazo de la función: una suscripción cancelada, guardada o
      // derivada (D-74, D-76), también lo es, y ese no es culpa de la fecha.
      // Se distingue mirando la fecha, como en confirmarPago, no el texto.
      if (pago.cubreHasta && (error as { code?: string }).code === 'P0001') {
        await c.query('ROLLBACK TO SAVEPOINT registrar');
        const { rows } = await c.query<{ pasada: boolean }>('SELECT $1::date < current_date AS pasada', [pago.cubreHasta]);
        if (rows[0]!.pasada) throw new ErrorParaElUsuario((error as Error).message, 'RECHAZADO', 'cubreHasta');
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

/** La empresa de un pago, para devolver su ficha. Null si el pago no existe. */
async function empresaDelPago(c: PoolClient, pagoId: string): Promise<string | null> {
  const { rows } = await c.query<{ tenant_id: string }>(
    `SELECT s.tenant_id FROM plataforma.pago p
       JOIN plataforma.suscripcion s ON s.id = p.suscripcion_id
      WHERE p.id = $1`,
    [pagoId],
  );
  return rows[0]?.tenant_id ?? null;
}

const pagoNoExiste = () => new ErrorParaElUsuario('Ese pago no existe.', 'NO_EXISTE');

/**
 * D-73. Confirmar un pago reportado: lo mismo que registrarlo, sobre el que
 * ya está. Llega el período, la fecha o ninguno (vale el período que pidió la
 * empresa). Devuelve la empresa del pago.
 */
export async function confirmarPago(
  autor: string,
  pagoId: string,
  datos: { periodoMeses: number | null; cubreHasta: string | null },
): Promise<string> {
  return enTransaccion(null, async (c) => {
    const empresa = await empresaDelPago(c, pagoId);
    if (!empresa) throw pagoNoExiste();
    // Como al registrar: con la fecha escrita a mano, el rechazo de la fecha
    // pasada va marcando el campo. Pero aquí la función rechaza también un
    // pago que ya no espera, con la fecha escrita o sin ella: se distingue
    // mirando la fecha, no el texto. El SAVEPOINT deja consultar después del
    // rechazo, que aborta la transacción.
    await c.query('SAVEPOINT confirmar');
    try {
      await c.query('SELECT plataforma.fn_confirmar_pago($1, $2, $3::date, $4::smallint)', [
        pagoId,
        autor,
        datos.cubreHasta,
        datos.periodoMeses,
      ]);
    } catch (error) {
      if (datos.cubreHasta && (error as { code?: string }).code === 'P0001') {
        await c.query('ROLLBACK TO SAVEPOINT confirmar');
        const { rows } = await c.query<{ pasada: boolean }>(
          `SELECT $1::date < current_date
                  AND EXISTS (SELECT 1 FROM plataforma.pago
                               WHERE id = $2 AND origen = 'REPORTADO' AND estado = 'PENDIENTE') AS pasada`,
          [datos.cubreHasta, pagoId],
        );
        if (rows[0]!.pasada) throw new ErrorParaElUsuario((error as Error).message, 'RECHAZADO', 'cubreHasta');
      }
      throw error;
    }
    return empresa;
  });
}

/** D-73. Rechazar un pago reportado; la empresa lee el motivo tal cual. Devuelve la empresa del pago. */
export async function rechazarPago(autor: string, pagoId: string, motivo: string): Promise<string> {
  return enTransaccion(null, async (c) => {
    const empresa = await empresaDelPago(c, pagoId);
    if (!empresa) throw pagoNoExiste();
    await c.query('SELECT plataforma.fn_rechazar_pago($1, $2, $3)', [pagoId, autor, motivo]);
    return empresa;
  });
}

// --- La purga diaria (D-74, CONTRATO §15.5) -----------------------------------------

export interface EmpresaPurgada {
  tenantId: string;
  razonSocial: string;
  motivo: string;
}

/**
 * Elimina, con plataforma.fn_purgar_empresas, las suspendidas que cumplieron
 * 60 días y las canceladas fuera de su plazo para reactivar. Es IRREVERSIBLE.
 * Solo el rol del panel la puede ejecutar (la base no se la concede a la
 * aplicación), y por eso vive en esta conexión y en ninguna otra. Qué empresa
 * cumplió su plazo lo decide la base; la prueba vencida no la toca.
 */
export async function purgarEmpresas(): Promise<EmpresaPurgada[]> {
  return enTransaccion(null, async (c) => {
    const { rows } = await c.query<EmpresaPurgada>(
      `SELECT tenant_id AS "tenantId", razon_social AS "razonSocial", motivo
         FROM plataforma.fn_purgar_empresas()`,
    );
    return rows;
  });
}
