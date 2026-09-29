import { ejecutarConPermiso, type ContextoTenant } from './contextoTenant.js';

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
}

interface FilaPreferencias {
  moneda_base: string;
  separador_miles: string;
  separador_decimal: string;
  decimales_vista: number;
  notif_vencimiento: boolean;
  notif_cambio_estado: boolean;
}

export async function leerPreferencias(contexto: ContextoTenant): Promise<Preferencias> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<FilaPreferencias>(
      `SELECT moneda_base, separador_miles, separador_decimal, decimales_vista,
              notif_vencimiento, notif_cambio_estado
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
              actualizado_en = now()
        WHERE tenant_id = $7`,
      [
        datos.monedaBase,
        datos.separadorMiles,
        datos.separadorDecimal,
        datos.decimalesVista,
        datos.notifVencimiento,
        datos.notifCambioEstado,
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
 * Eliminar una unidad en uso lo rechaza la base (FK desde app.recurso/app.apu).
 * Un id de otra empresa, o inexistente, no borra nada: RLS lo esconde y el
 * DELETE afecta cero filas en silencio, el mismo modo de falla que el resto
 * del sistema.
 */
export async function eliminarUnidad(contexto: ContextoTenant, unidadId: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', (cliente) =>
    cliente.query('DELETE FROM app.unidad_medida WHERE id = $1', [unidadId]),
  );
}

// -----------------------------------------------------------------------------
//  CONFIG.SUSCRIPCION — consultar suscripción y facturación. Sin escritura:
//  la descripción del propio catálogo dice "Consultar" (VER), no "Editar".
// -----------------------------------------------------------------------------

export interface PagoRealizado {
  id: string;
  fecha: string;
  concepto: string;
  /** app.dinero llega como texto (node-postgres no convierte NUMERIC): se muestra, no se calcula (CLAUDE.md, regla 2). */
  monto: string;
  moneda: string;
  metodo: string;
  estado: string;
  facturaNumero: string | null;
}

export interface Suscripcion {
  plan: string;
  estado: string;
  fechaInicio: string;
  fechaVencimiento: string;
  renovacionAutomatica: boolean;
  pagos: PagoRealizado[];
}

interface FilaSuscripcion {
  plan: string;
  estado: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renovacion_automatica: boolean;
}

interface FilaPago {
  id: string;
  fecha: string;
  concepto: string;
  monto: string;
  moneda: string;
  metodo: string;
  estado: string;
  factura_numero: string | null;
}

export async function leerSuscripcion(contexto: ContextoTenant): Promise<Suscripcion> {
  return ejecutarConPermiso(contexto, 'CONFIG.SUSCRIPCION', async (cliente) => {
    const { rows: filasSuscripcion } = await cliente.query<FilaSuscripcion>(
      `SELECT p.codigo AS plan, s.estado, s.fecha_inicio, s.fecha_vencimiento,
              s.renovacion_automatica
         FROM plataforma.suscripcion s
         JOIN plataforma.plan p ON p.id = s.plan_id
        WHERE s.tenant_id = $1
          AND s.estado IN ('EN_PRUEBA', 'ACTIVA')`,
      [contexto.tenantId],
    );
    const filaSuscripcion = filasSuscripcion[0]!;

    const { rows: filasPago } = await cliente.query<FilaPago>(
      `SELECT pg.id, pg.fecha, pg.concepto, pg.monto, pg.moneda, pg.metodo,
              pg.estado, pg.factura_numero
         FROM plataforma.pago pg
         JOIN plataforma.suscripcion s ON s.id = pg.suscripcion_id
        WHERE s.tenant_id = $1
        ORDER BY pg.fecha DESC`,
      [contexto.tenantId],
    );

    return {
      plan: filaSuscripcion.plan,
      estado: filaSuscripcion.estado,
      fechaInicio: filaSuscripcion.fecha_inicio,
      fechaVencimiento: filaSuscripcion.fecha_vencimiento,
      renovacionAutomatica: filaSuscripcion.renovacion_automatica,
      pagos: filasPago.map((fila) => ({
        id: fila.id,
        fecha: fila.fecha,
        concepto: fila.concepto,
        monto: fila.monto,
        moneda: fila.moneda,
        metodo: fila.metodo,
        estado: fila.estado,
        facturaNumero: fila.factura_numero,
      })),
    };
  });
}
