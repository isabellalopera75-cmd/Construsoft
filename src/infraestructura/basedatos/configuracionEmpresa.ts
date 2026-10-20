import { createHash } from 'node:crypto';
import { COLUMNAS_DEL_CICLO } from './columnasDelCiclo.js';
import {
  ejecutarConPermiso,
  type ContextoTenant,
  type ClienteEnContexto,
  type Suscripcion as CicloDeSuscripcion,
} from './contextoTenant.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';

/**
 * Este módulo no abre ningún pool propio: compone ejecutarConPermiso, la
 * única puerta exportada de contextoTenant.ts para operaciones de negocio.
 * Es el primer módulo que la consume, así que cada función de acá abajo
 * declara su propio CodigoPermiso — nunca un string suelto — y confía en que
 * ejecutarConPermiso haga cumplir RF-CFG-25 antes de correr una sola línea.
 */

// -----------------------------------------------------------------------------
//  CONFIG.EMPRESA — datos de empresa y logo (RF-CFG-04/05).
// -----------------------------------------------------------------------------

/**
 * Los datos editables de plataforma.tenant (RF-CFG-04/05). No incluye
 * acepto_terminos_en ni version_terminos aunque construsoft_app tenga UPDATE
 * sobre esas columnas: aceptar términos es un trámite legal aparte, no un
 * campo más del formulario de "editar mi empresa".
 */
export interface DatosEmpresa {
  razonSocial: string;
  nit: string;
  logoRuta: string | null;
  direccion: string | null;
  telefono: string | null;
  emailRecuperacion: string | null;
}

interface FilaDatosEmpresa {
  razon_social: string;
  nit: string;
  logo_ruta: string | null;
  direccion: string | null;
  telefono: string | null;
  email_recuperacion: string | null;
}

export async function leerDatosEmpresa(contexto: ContextoTenant): Promise<DatosEmpresa> {
  return ejecutarConPermiso(contexto, 'CONFIG.EMPRESA', async (cliente) => {
    const { rows } = await cliente.query<FilaDatosEmpresa>(
      `SELECT razon_social, nit, logo_ruta, direccion, telefono, email_recuperacion
         FROM plataforma.tenant
        WHERE id = $1`,
      [contexto.tenantId],
    );
    const fila = rows[0]!;
    return {
      razonSocial: fila.razon_social,
      nit: fila.nit,
      logoRuta: fila.logo_ruta,
      direccion: fila.direccion,
      telefono: fila.telefono,
      emailRecuperacion: fila.email_recuperacion,
    };
  });
}

/**
 * El NIT único (ux_tenant_nit) y el NIT no vacío (CHECK de la tabla) los
 * defiende la base: un NIT repetido o vacío llega acá como el error de
 * Postgres tal cual, igual que ya hace registrarEmpresa con D-34.
 */
export async function actualizarDatosEmpresa(
  contexto: ContextoTenant,
  datos: DatosEmpresa,
): Promise<void> {
  await ejecutarConPermiso(contexto, 'CONFIG.EMPRESA', (cliente) =>
    cliente.query(
      `UPDATE plataforma.tenant
          SET razon_social = $1, nit = $2, logo_ruta = $3,
              direccion = $4, telefono = $5, email_recuperacion = $6
        WHERE id = $7`,
      [
        datos.razonSocial,
        datos.nit,
        datos.logoRuta,
        datos.direccion,
        datos.telefono,
        datos.emailRecuperacion,
        contexto.tenantId,
      ],
    ),
  );
}

/** Los dos formatos que admite app.logo (D-71). */
export type TipoDeLogo = 'image/png' | 'image/jpeg';

/**
 * 02 §11.2, CONTRATO §13 · Subir el logotipo. La llave de app.logo es
 * (empresa, sha256): la misma imagen subida dos veces es la misma fila. La
 * nueva queda vigente en plataforma.tenant.logo_ruta, y las anteriores NO se
 * borran: una versión congelada puede estar nombrándolas (D-64). El tipo y el
 * tope de 1 MB los defiende un CHECK; la firma del archivo la mira la ruta.
 */
export async function subirLogo(contexto: ContextoTenant, contenido: Buffer, tipo: TipoDeLogo): Promise<string> {
  const sha256 = createHash('sha256').update(contenido).digest('hex');
  return ejecutarConPermiso(contexto, 'CONFIG.EMPRESA', async (cliente) => {
    await cliente.query(
      `INSERT INTO app.logo (tenant_id, sha256, tipo, contenido) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, sha256) DO NOTHING`,
      [contexto.tenantId, sha256, tipo, contenido],
    );
    const { rows } = await cliente.query<{ id: string }>('SELECT id FROM app.logo WHERE tenant_id = $1 AND sha256 = $2', [
      contexto.tenantId,
      sha256,
    ]);
    const id = rows[0]!.id;
    await cliente.query('UPDATE plataforma.tenant SET logo_ruta = $2 WHERE id = $1', [contexto.tenantId, id]);
    return id;
  });
}

/** Quitar el logotipo vigente. La imagen se queda en app.logo (D-64): solo deja de ser la vigente. */
export async function quitarLogo(contexto: ContextoTenant): Promise<void> {
  await ejecutarConPermiso(contexto, 'CONFIG.EMPRESA', (cliente) =>
    cliente.query('UPDATE plataforma.tenant SET logo_ruta = NULL WHERE id = $1', [contexto.tenantId]),
  );
}

// -----------------------------------------------------------------------------
//  CONFIG.PREFERENCIAS — moneda, formatos y unidades de medida (RF-CFG-13..20).
//
//  D-41: el AIU y el IVA NO viven en app.configuracion_empresa ni en esta
//  interfaz. Son de cada presupuesto —se negocian obra por obra— y esa es la
//  razón por la que este módulo, deliberadamente, no tiene ningún campo para
//  ellos: precargarlos desde una configuración general es la forma más
//  barata de que una obra salga con el AIU de otra.
// -----------------------------------------------------------------------------

/** app.configuracion_empresa completa, para la pantalla que la edita. */
export interface Preferencias {
  monedaBase: string;
  separadorMiles: string;
  separadorDecimal: string;
  decimalesVista: number;
  notifVencimiento: boolean;
  notifCambioEstado: boolean;
  /** D-84: lo que dura un jornal en los APU de la empresa, "8.00". Cada presupuesto se lleva su copia. */
  horasPorJornal: string;
  /** RF-CFG-33: 1 = lunes … 7 = domingo. Lo usan la curva semanal y el Gantt. */
  inicioSemana: number;
}

interface FilaPreferencias {
  moneda_base: string;
  separador_miles: string;
  separador_decimal: string;
  decimales_vista: number;
  notif_vencimiento: boolean;
  notif_cambio_estado: boolean;
  horas_por_jornal: string;
  inicio_semana: number;
}

export async function leerPreferencias(contexto: ContextoTenant): Promise<Preferencias> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<FilaPreferencias>(
      `SELECT moneda_base, separador_miles, separador_decimal, decimales_vista,
              notif_vencimiento, notif_cambio_estado, horas_por_jornal, inicio_semana
         FROM app.configuracion_empresa
        WHERE tenant_id = $1`,
      [contexto.tenantId],
    );
    const fila = rows[0]!;
    return {
      monedaBase: fila.moneda_base,
      separadorMiles: fila.separador_miles,
      separadorDecimal: fila.separador_decimal,
      decimalesVista: fila.decimales_vista,
      notifVencimiento: fila.notif_vencimiento,
      notifCambioEstado: fila.notif_cambio_estado,
      horasPorJornal: fila.horas_por_jornal,
      inicioSemana: fila.inicio_semana,
    };
  });
}

/**
 * La moneda inexistente (FK a plataforma.moneda) y los separadores iguales
 * (CHECK separador_miles <> separador_decimal) los rechaza la base tal cual;
 * este módulo no repite esas validaciones.
 */
export async function actualizarPreferencias(
  contexto: ContextoTenant,
  datos: Preferencias,
): Promise<void> {
  await ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', (cliente) =>
    cliente.query(
      `UPDATE app.configuracion_empresa
          SET moneda_base = $1, separador_miles = $2, separador_decimal = $3,
              decimales_vista = $4, notif_vencimiento = $5, notif_cambio_estado = $6,
              horas_por_jornal = $7, inicio_semana = $8, actualizado_en = now()
        WHERE tenant_id = $9`,
      [
        datos.monedaBase,
        datos.separadorMiles,
        datos.separadorDecimal,
        datos.decimalesVista,
        datos.notifVencimiento,
        datos.notifCambioEstado,
        datos.horasPorJornal,
        datos.inicioSemana,
        contexto.tenantId,
      ],
    ),
  );
}

export interface UnidadMedida {
  id: string;
  simbolo: string;
  descripcion: string;
}

export async function listarUnidades(contexto: ContextoTenant): Promise<UnidadMedida[]> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<UnidadMedida>(
      `SELECT id, simbolo, descripcion
         FROM app.unidad_medida
        WHERE tenant_id = $1
        ORDER BY simbolo`,
      [contexto.tenantId],
    );
    return rows;
  });
}

/**
 * Las unidades para los selectores de Recursos y APU. listarUnidades pide
 * CONFIG.PREFERENCIAS porque es la pantalla que las administra; quien crea
 * un recurso o un APU las necesita para elegir, sin poder administrarlas.
 * El permiso lo nombra quien llama: el del módulo cuya pantalla las pide.
 */
export async function listarUnidadesParaElegir(
  contexto: ContextoTenant,
  permiso: 'RECURSOS.VER' | 'APU.VER',
): Promise<UnidadMedida[]> {
  return ejecutarConPermiso(contexto, permiso, async (cliente) => {
    const { rows } = await cliente.query<UnidadMedida>(
      `SELECT id, simbolo, descripcion
         FROM app.unidad_medida
        WHERE tenant_id = $1
        ORDER BY simbolo`,
      [contexto.tenantId],
    );
    return rows;
  });
}

export interface DatosUnidadMedida {
  simbolo: string;
  descripcion: string;
}

/** El símbolo duplicado sin distinguir mayúsculas (ux_unidad_simbolo, D-31) lo rechaza la base tal cual. */
export async function crearUnidad(
  contexto: ContextoTenant,
  datos: DatosUnidadMedida,
): Promise<UnidadMedida> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.unidad_medida (tenant_id, simbolo, descripcion)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [contexto.tenantId, datos.simbolo, datos.descripcion],
    );
    return { id: rows[0]!.id, simbolo: datos.simbolo, descripcion: datos.descripcion };
  });
}

/**
 * 02 §11.6 · Editar símbolo o descripción. El símbolo duplicado sin
 * distinguir mayúsculas lo rechaza ux_unidad_simbolo, igual que al crear.
 * Devuelve null si el id no existe en esta empresa.
 */
export async function actualizarUnidad(
  contexto: ContextoTenant,
  unidadId: string,
  datos: DatosUnidadMedida,
): Promise<UnidadMedida | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<UnidadMedida>(
      `UPDATE app.unidad_medida SET simbolo = $2, descripcion = $3
        WHERE id = $1
      RETURNING id, simbolo, descripcion`,
      [unidadId, datos.simbolo, datos.descripcion],
    );
    return rows[0] ?? null;
  });
}

/**
 * 02 §11.6 · Una unidad en uso en algún recurso o APU no se elimina, y el
 * mensaje dice dónde. Las llaves foráneas desde app.recurso y app.apu la
 * defienden igual, pero su rechazo es un 23503 que no dice nada útil: el
 * conteo previo es para el mensaje, no para la regla. Un id de otra empresa,
 * o inexistente, no borra nada: la RLS lo esconde.
 */
export async function eliminarUnidad(contexto: ContextoTenant, unidadId: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ simbolo: string; recursos: string; apus: string }>(
      `SELECT u.simbolo,
              (SELECT count(*) FROM app.recurso r WHERE r.unidad_id = u.id) AS recursos,
              (SELECT count(*) FROM app.apu a WHERE a.unidad_id = u.id) AS apus
         FROM app.unidad_medida u
        WHERE u.id = $1`,
      [unidadId],
    );
    const uso = rows[0];
    if (uso && (uso.recursos !== '0' || uso.apus !== '0')) {
      const donde = [
        uso.recursos !== '0' ? `${uso.recursos} ${uso.recursos === '1' ? 'recurso' : 'recursos'}` : null,
        uso.apus !== '0' ? `${uso.apus} APU` : null,
      ]
        .filter(Boolean)
        .join(' y ');
      throw new ErrorParaElUsuario(
        `La unidad «${uso.simbolo}» está en uso en ${donde}: no se puede eliminar mientras la usen.`,
        'RECHAZADO',
      );
    }
    await cliente.query('DELETE FROM app.unidad_medida WHERE id = $1', [unidadId]);
  });
}

// -----------------------------------------------------------------------------
//  CONFIG.SUSCRIPCION — consultar suscripción y facturación. Sin escritura:
//  la descripción del propio catálogo dice "Consultar" (VER), no "Editar".
// -----------------------------------------------------------------------------

export interface PagoRealizado {
  id: string;
  /** Texto aaaa-mm-dd: un date de Postgres convertido a Date cae en la medianoche local y puede retroceder un día. */
  fecha: string;
  concepto: string;
  /** app.dinero llega como texto (node-postgres no convierte NUMERIC): se muestra, no se calcula (CLAUDE.md, regla 2). */
  monto: string;
  moneda: string;
  metodo: string;
  estado: 'EXITOSO' | 'PENDIENTE' | 'RECHAZADO';
  origen: 'MANUAL' | 'REPORTADO' | 'PASARELA';
  periodoMeses: number | null;
  /** Nulo mientras el pago reportado espera verificación (D-73). */
  cubreHasta: string | null;
  /** Lo que escribió el superadministrador al rechazarlo; la empresa lo lee tal cual. */
  rechazoMotivo: string | null;
  facturaNumero: string | null;
}

/**
 * La pestaña Suscripción (02 §11.3, CONTRATO §15.3). El estado, el acceso y
 * los plazos salen de plataforma.fn_estado_suscripcion, la MISMA función que
 * usan el arranque de sesión y fn_exigir_permiso: la pestaña no puede decir
 * «activa» mientras el rechazo dice «suspendida». Y cubre todos los estados,
 * no solo los vigentes: es justo cuando no está vigente que la persona viene
 * a mirarla, y por eso responde también con la cuenta detenida.
 */
export interface Suscripcion
  extends Pick<
    CicloDeSuscripcion,
    | 'estado'
    | 'acceso'
    | 'suspension'
    | 'pagarAMasTardar'
    | 'suspendidaDesde'
    | 'reactivableHasta'
    | 'seEliminaEl'
    | 'canceladaPor'
    | 'pagoEnVerificacion'
  > {
  plan: string | null;
  /** Texto aaaa-mm-dd; null sin suscripción. */
  venceEl: string | null;
  diasRestantes: number | null;
  pagos: PagoRealizado[];
  /**
   * Quien lee esta pestaña ya tiene CONFIG.SUSCRIPCION, que es lo que pide
   * fn_reportar_pago (§14.1). Con la suscripción vencida es verdadero: es
   * justo cuando hace falta. Cancelada, reportar es reactivar, y eso es solo
   * del Administrador y dentro de su plazo (D-74).
   */
  puedeReportar: boolean;
  /** Administrador, la suscripción en prueba o activa (incluye POR_PAGAR) y ningún pago esperando. */
  puedeCancelar: boolean;
  /** Administrador, y cancelada pero todavía dentro de lo pagado. */
  puedeReanudar: boolean;
  /**
   * Los plazos que rigen hoy (D-78, CONTRATO §18.2), para los textos que
   * explican qué pasaría. Las fechas de lo que ya pasa siguen saliendo de
   * fn_ciclo_suscripcion: estos números no se usan para calcular nada.
   */
  plazos: PlazosVigentes;
}

/** En días; los dos primeros, hábiles. */
export interface PlazosVigentes {
  graciaPago: number;
  plazoTrasRechazo: number;
  suspension: number;
  pruebaSoloLectura: number;
  reactivacion: number;
}

type FilaDelCiclo = CicloDeSuscripcion & {
  puedeReanudar: boolean;
  puedeReactivar: boolean;
  vigente: boolean;
  esAdministrador: boolean;
};

/**
 * Lee la pestaña dentro de una transacción ya abierta con su permiso: la
 * usan la lectura y las dos acciones, que responden con la pestaña al día.
 */
async function pestanaDeSuscripcion(cliente: ClienteEnContexto, contexto: ContextoTenant): Promise<Suscripcion> {
  const { rows: filasEstado } = await cliente.query<FilaDelCiclo>(
    `SELECT ${COLUMNAS_DEL_CICLO},
            puede_reanudar AS "puedeReanudar", puede_reactivar AS "puedeReactivar",
            EXISTS (SELECT 1 FROM plataforma.suscripcion
                     WHERE tenant_id = $1 AND estado IN ('EN_PRUEBA','ACTIVA')) AS vigente,
            EXISTS (SELECT 1 FROM app.usuario u JOIN app.rol r ON r.id = u.rol_id
                     WHERE u.id = $2 AND r.tipo = 'ADMIN') AS "esAdministrador"
       FROM plataforma.fn_estado_suscripcion($1)`,
    [contexto.tenantId, contexto.usuarioId],
  );
  const fila = filasEstado[0];
  if (!fila) {
    // Cero filas es «sin acceso a ese inquilino», nunca «al día».
    throw new ErrorParaElUsuario('La empresa no existe en esta instalación.', 'NO_EXISTE');
  }

  const { rows: filasPlazos } = await cliente.query<PlazosVigentes>(
    `SELECT plataforma.fn_parametro('GRACIA_PAGO', current_date)         AS "graciaPago",
            plataforma.fn_parametro('PLAZO_TRAS_RECHAZO', current_date)  AS "plazoTrasRechazo",
            plataforma.fn_parametro('SUSPENSION', current_date)          AS "suspension",
            plataforma.fn_parametro('PRUEBA_SOLO_LECTURA', current_date) AS "pruebaSoloLectura",
            plataforma.fn_parametro('REACTIVACION', current_date)        AS "reactivacion"`,
  );

  // Por registro y no por fecha del pago: el último rechazo y el pendiente
  // se leen primero (CONTRATO §14.1).
  const { rows: pagos } = await cliente.query<PagoRealizado>(
    `SELECT pg.id, pg.fecha::text AS fecha, pg.concepto, pg.monto, pg.moneda, pg.metodo,
            pg.estado, pg.origen, pg.periodo_meses AS "periodoMeses",
            pg.cubre_hasta::text AS "cubreHasta", pg.rechazo_motivo AS "rechazoMotivo",
            pg.factura_numero AS "facturaNumero"
       FROM plataforma.pago pg
       JOIN plataforma.suscripcion s ON s.id = pg.suscripcion_id
      WHERE s.tenant_id = $1
      ORDER BY pg.registrado_en DESC, pg.id DESC`,
    [contexto.tenantId],
  );

  // Guardada en prueba o activa no basta: la prueba que pasó sus diez días
  // sin pago sigue guardada EN_PRUEBA, pero ya está cancelada (D-76). Eso lo
  // dice el estado que deriva la base, no la columna.
  const sigueEnCurso = fila.vigente && fila.estado !== 'CANCELADA';

  return {
    estado: fila.estado,
    plan: fila.planCodigo,
    venceEl: fila.venceEl,
    diasRestantes: fila.diasRestantes,
    acceso: fila.acceso,
    suspension: fila.suspension,
    pagarAMasTardar: fila.pagarAMasTardar,
    suspendidaDesde: fila.suspendidaDesde,
    reactivableHasta: fila.reactivableHasta,
    seEliminaEl: fila.seEliminaEl,
    canceladaPor: fila.canceladaPor,
    pagoEnVerificacion: fila.pagoEnVerificacion,
    pagos,
    puedeReportar: sigueEnCurso || (fila.esAdministrador && fila.puedeReactivar),
    puedeCancelar: fila.esAdministrador && sigueEnCurso && !fila.pagoEnVerificacion,
    puedeReanudar: fila.esAdministrador && fila.puedeReanudar,
    plazos: filasPlazos[0]!,
  };
}

export async function leerSuscripcion(contexto: ContextoTenant): Promise<Suscripcion> {
  return ejecutarConPermiso(contexto, 'CONFIG.SUSCRIPCION', (cliente) => pestanaDeSuscripcion(cliente, contexto));
}

/**
 * CONTRATO §15.3 · Cancelar es definitivo: la cuenta funciona hasta lo pagado
 * y después tiene diez días para reactivarla pagando. Que sea el
 * Administrador, que no esté ya cancelada y que no haya un pago esperando lo
 * decide plataforma.fn_cancelar_suscripcion_empresa. CONFIG.SUSCRIPCION es de
 * VER: pasa también con la cuenta vencida o detenida.
 */
export async function cancelarSuscripcionEmpresa(contexto: ContextoTenant, motivo: string | null): Promise<Suscripcion> {
  return ejecutarConPermiso(contexto, 'CONFIG.SUSCRIPCION', async (cliente) => {
    await cliente.query('SELECT plataforma.fn_cancelar_suscripcion_empresa($1)', [motivo]);
    return pestanaDeSuscripcion(cliente, contexto);
  });
}

/** CONTRATO §15.3 · Desistir de la cancelación antes de la fecha pagada; no pide pago. */
export async function reanudarSuscripcion(contexto: ContextoTenant): Promise<Suscripcion> {
  return ejecutarConPermiso(contexto, 'CONFIG.SUSCRIPCION', async (cliente) => {
    await cliente.query('SELECT plataforma.fn_reanudar_suscripcion()');
    return pestanaDeSuscripcion(cliente, contexto);
  });
}
