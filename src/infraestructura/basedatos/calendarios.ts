import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';

/*
 * Los calendarios (D-86, RF-CFG-29, CONTRATO §19.3). Uno de la empresa lleva
 * cronograma_id nulo y tipo EMPRESA; la copia de una obra y su corrido cuelgan
 * de un cronograma y se editan por sus rutas, con otro permiso y subiendo la
 * versión del cronograma. Por eso las piezas de abajo reciben el cliente de la
 * transacción: las arma quien sabe qué permiso aplica.
 *
 * Las reglas —tramos que no se cruzan, un solo calendario por defecto, el
 * corrido fijo, el calendario de un cronograma que no se elimina— las
 * defiende la base. Aquí no se repiten.
 */

/** "07:00"; la medianoche del final del día es "24:00". */
export interface Tramo {
  inicio: string;
  fin: string;
}

export interface Excepcion {
  fecha: string;
  motivo: string | null;
  tramos: Tramo[];
  horas: string;
}

export interface Calendario {
  id: string;
  nombre: string;
  tipo: 'EMPRESA' | 'OBRA' | 'CORRIDO';
  horasPorDia: string;
  porDefecto: boolean;
  /** Siete listas; la 0 es el lunes. */
  semana: Tramo[][];
  horasDia: string[];
  horasSemana: string;
  excepciones: Excepcion[];
  festivos: { origen: { tipo: 'PLATAFORMA' | 'PROPIA'; id: string; nombre: string } | null; hasta: number | null };
}

export interface CalendarioResumen {
  id: string;
  nombre: string;
  horasPorDia: string;
  horasSemana: string;
  porDefecto: boolean;
}

export interface DatosDeCalendario {
  nombre: string;
  horasPorDia: string;
  semana: Tramo[][];
}

/**
 * Minutos a horas con un decimal. Los tramos van en bloques de media hora, así
 * que la cuenta es exacta: son enteros contados, no dinero.
 */
function horas(minutos: number): string {
  return (minutos / 60).toFixed(1);
}

// to_char de un time '24:00' da '24:00' solo con HH24:MI; se fija aquí para no
// depender de eso en cada consulta.
const HORA = (columna: string) => `CASE WHEN ${columna} = '24:00'::time THEN '24:00' ELSE to_char(${columna}, 'HH24:MI') END`;
const MINUTO = (columna: string) => `app.fn_minuto_del_dia(${columna})`;

interface FilaCalendario {
  id: string;
  nombre: string;
  tipo: Calendario['tipo'];
  horas_por_dia: string;
  por_defecto: boolean;
  festivos_hasta: number | null;
  origen_tipo: 'PLATAFORMA' | 'PROPIA' | null;
  origen_id: string | null;
  origen_nombre: string | null;
}

/**
 * Un calendario completo. `soloDeLaEmpresa` deja fuera las copias de los
 * cronogramas: las rutas de configuración no las ven (son de su obra).
 */
export async function leerCalendarioEn(cliente: ClienteEnContexto, id: string, soloDeLaEmpresa: boolean): Promise<Calendario | null> {
  const { rows } = await cliente.query<FilaCalendario>(
    `SELECT c.id, c.nombre, c.tipo, c.horas_por_dia, c.por_defecto, c.festivos_hasta,
            CASE WHEN c.festivos_lista_id IS NOT NULL THEN 'PLATAFORMA'
                 WHEN c.festivos_propia_id IS NOT NULL THEN 'PROPIA' END AS origen_tipo,
            COALESCE(c.festivos_lista_id, c.festivos_propia_id) AS origen_id,
            COALESCE(lp.nombre, lo.nombre) AS origen_nombre
       FROM app.calendario c
       LEFT JOIN plataforma.lista_festivos lp ON lp.id = c.festivos_lista_id
       LEFT JOIN app.lista_festivos_propia lo ON lo.id = c.festivos_propia_id
      WHERE c.id = $1 AND ($2::boolean IS FALSE OR c.cronograma_id IS NULL)`,
    [id, soloDeLaEmpresa],
  );
  const fila = rows[0];
  if (!fila) return null;

  const tramos = await cliente.query<{ dia_semana: number; inicio: string; fin: string; minutos: number }>(
    `SELECT dia_semana, ${HORA('inicio')} AS inicio, ${HORA('fin')} AS fin,
            ${MINUTO('fin')} - ${MINUTO('inicio')} AS minutos
       FROM app.calendario_tramo WHERE calendario_id = $1
      ORDER BY dia_semana, inicio`,
    [id],
  );
  const semana: Tramo[][] = Array.from({ length: 7 }, () => []);
  const minutosDia = Array.from({ length: 7 }, () => 0);
  for (const t of tramos.rows) {
    semana[t.dia_semana - 1]!.push({ inicio: t.inicio, fin: t.fin });
    minutosDia[t.dia_semana - 1]! += t.minutos;
  }

  const excepciones = await cliente.query<{ fecha: string; motivo: string | null; tramos: Tramo[]; minutos: number }>(
    `SELECT to_char(e.fecha, 'YYYY-MM-DD') AS fecha, e.motivo,
            COALESCE(json_agg(json_build_object('inicio', ${HORA('t.inicio')}, 'fin', ${HORA('t.fin')}) ORDER BY t.inicio)
                     FILTER (WHERE t.id IS NOT NULL), '[]') AS tramos,
            COALESCE(sum(${MINUTO('t.fin')} - ${MINUTO('t.inicio')}), 0)::integer AS minutos
       FROM app.calendario_excepcion e
       LEFT JOIN app.calendario_excepcion_tramo t ON t.excepcion_id = e.id
      WHERE e.calendario_id = $1
      GROUP BY e.id
      ORDER BY e.fecha`,
    [id],
  );

  return {
    id: fila.id,
    nombre: fila.nombre,
    tipo: fila.tipo,
    horasPorDia: fila.horas_por_dia,
    porDefecto: fila.por_defecto,
    semana,
    horasDia: minutosDia.map(horas),
    horasSemana: horas(minutosDia.reduce((a, b) => a + b, 0)),
    excepciones: excepciones.rows.map((e) => ({ fecha: e.fecha, motivo: e.motivo, tramos: e.tramos, horas: horas(e.minutos) })),
    festivos: {
      origen: fila.origen_tipo ? { tipo: fila.origen_tipo, id: fila.origen_id!, nombre: fila.origen_nombre! } : null,
      hasta: fila.festivos_hasta,
    },
  };
}

/** Los calendarios de la empresa, sin las copias de los cronogramas. */
export async function listarCalendariosEn(cliente: ClienteEnContexto): Promise<CalendarioResumen[]> {
  const { rows } = await cliente.query<{ id: string; nombre: string; horas_por_dia: string; por_defecto: boolean; minutos: number }>(
    `SELECT c.id, c.nombre, c.horas_por_dia, c.por_defecto,
            COALESCE(sum(${MINUTO('t.fin')} - ${MINUTO('t.inicio')}), 0)::integer AS minutos
       FROM app.calendario c
       LEFT JOIN app.calendario_tramo t ON t.calendario_id = c.id
      WHERE c.cronograma_id IS NULL
      GROUP BY c.id
      ORDER BY lower(c.nombre), c.id`,
  );
  return rows.map((r) => ({ id: r.id, nombre: r.nombre, horasPorDia: r.horas_por_dia, horasSemana: horas(r.minutos), porDefecto: r.por_defecto }));
}

/** Borra los tramos de la semana y escribe los que llegan (CONTRATO §19.3: la semana se reemplaza entera). */
export async function reemplazarSemanaEn(cliente: ClienteEnContexto, tenantId: string, calendarioId: string, semana: Tramo[][]): Promise<void> {
  await cliente.query('DELETE FROM app.calendario_tramo WHERE calendario_id = $1', [calendarioId]);
  const dias = semana.flatMap((tramos, i) => tramos.map(() => i + 1));
  const tramos = semana.flat();
  await cliente.query(
    `INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
     SELECT $1, $2, d, i::time, f::time FROM unnest($3::int[], $4::text[], $5::text[]) AS t(d, i, f)`,
    [tenantId, calendarioId, dias, tramos.map((t) => t.inicio), tramos.map((t) => t.fin)],
  );
}

/** Pone, o reemplaza, el horario propio de una fecha. Sin tramos, la fecha no se trabaja. */
export async function ponerExcepcionEn(
  cliente: ClienteEnContexto,
  tenantId: string,
  calendarioId: string,
  fecha: string,
  motivo: string | null,
  tramos: Tramo[],
): Promise<void> {
  const { rows } = await cliente.query<{ id: string }>(
    `INSERT INTO app.calendario_excepcion (tenant_id, calendario_id, fecha, motivo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (calendario_id, fecha) DO UPDATE SET motivo = EXCLUDED.motivo
     RETURNING id`,
    [tenantId, calendarioId, fecha, motivo],
  );
  const excepcionId = rows[0]!.id;
  await cliente.query('DELETE FROM app.calendario_excepcion_tramo WHERE excepcion_id = $1', [excepcionId]);
  await cliente.query(
    `INSERT INTO app.calendario_excepcion_tramo (tenant_id, excepcion_id, inicio, fin)
     SELECT $1, $2, i::time, f::time FROM unnest($3::text[], $4::text[]) AS t(i, f)`,
    [tenantId, excepcionId, tramos.map((t) => t.inicio), tramos.map((t) => t.fin)],
  );
}

export async function quitarExcepcionEn(cliente: ClienteEnContexto, calendarioId: string, fecha: string): Promise<void> {
  await cliente.query('DELETE FROM app.calendario_excepcion WHERE calendario_id = $1 AND fecha = $2', [calendarioId, fecha]);
}

/** D-90 · Copia una lista sin pisar las fechas que el calendario ya tiene. Devuelve cuántas entraron. */
export async function copiarFestivosEn(cliente: ClienteEnContexto, calendarioId: string, listaId: string, propia: boolean): Promise<number> {
  const { rows } = await cliente.query<{ copiados: number }>('SELECT app.fn_copiar_festivos($1, $2, $3) AS copiados', [calendarioId, listaId, propia]);
  return rows[0]!.copiados;
}

// -----------------------------------------------------------------------------
//  CONFIG.PREFERENCIAS · Los calendarios de la empresa (CONTRATO §19.3).
//  Cada una devuelve null si el id no es un calendario de esta empresa: lo
//  ajeno, lo inexistente y la copia de un cronograma son lo mismo (404).
// -----------------------------------------------------------------------------

async function existeDeLaEmpresa(cliente: ClienteEnContexto, id: string): Promise<boolean> {
  const { rowCount } = await cliente.query('SELECT 1 FROM app.calendario WHERE id = $1 AND cronograma_id IS NULL', [id]);
  return rowCount === 1;
}

export async function crearCalendario(contexto: ContextoTenant, datos: DatosDeCalendario): Promise<Calendario> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      'INSERT INTO app.calendario (tenant_id, nombre, horas_por_dia) VALUES ($1, $2, $3) RETURNING id',
      [contexto.tenantId, datos.nombre, datos.horasPorDia],
    );
    const id = rows[0]!.id;
    await reemplazarSemanaEn(cliente, contexto.tenantId, id, datos.semana);
    return (await leerCalendarioEn(cliente, id, true))!;
  });
}

export async function actualizarCalendario(contexto: ContextoTenant, id: string, datos: DatosDeCalendario): Promise<Calendario | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rowCount } = await cliente.query(
      'UPDATE app.calendario SET nombre = $2, horas_por_dia = $3 WHERE id = $1 AND cronograma_id IS NULL',
      [id, datos.nombre, datos.horasPorDia],
    );
    if (rowCount !== 1) return null;
    await reemplazarSemanaEn(cliente, contexto.tenantId, id, datos.semana);
    return leerCalendarioEn(cliente, id, true);
  });
}

/** El de por defecto no se elimina: lo rechaza la base al confirmar (D-86). */
export async function eliminarCalendario(contexto: ContextoTenant, id: string): Promise<boolean> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rowCount } = await cliente.query('DELETE FROM app.calendario WHERE id = $1 AND cronograma_id IS NULL', [id]);
    return rowCount === 1;
  });
}

export async function marcarCalendarioPorDefecto(contexto: ContextoTenant, id: string): Promise<CalendarioResumen[] | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    if (!(await existeDeLaEmpresa(cliente, id))) return null;
    await cliente.query('SELECT app.fn_calendario_por_defecto($1)', [id]);
    return listarCalendariosEn(cliente);
  });
}

export async function ponerExcepcion(
  contexto: ContextoTenant,
  id: string,
  fecha: string,
  motivo: string | null,
  tramos: Tramo[],
): Promise<Calendario | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    if (!(await existeDeLaEmpresa(cliente, id))) return null;
    await ponerExcepcionEn(cliente, contexto.tenantId, id, fecha, motivo, tramos);
    return leerCalendarioEn(cliente, id, true);
  });
}

export async function quitarExcepcion(contexto: ContextoTenant, id: string, fecha: string): Promise<Calendario | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    if (!(await existeDeLaEmpresa(cliente, id))) return null;
    await quitarExcepcionEn(cliente, id, fecha);
    return leerCalendarioEn(cliente, id, true);
  });
}

export async function copiarFestivos(
  contexto: ContextoTenant,
  id: string,
  listaId: string,
  propia: boolean,
): Promise<{ copiados: number; calendario: Calendario } | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    if (!(await existeDeLaEmpresa(cliente, id))) return null;
    const copiados = await copiarFestivosEn(cliente, id, listaId, propia);
    return { copiados, calendario: (await leerCalendarioEn(cliente, id, true))! };
  });
}

// -----------------------------------------------------------------------------
//  Leer (CONTRATO §19.3): el desplegable con PRESUPUESTOS.VER, o con
//  CONFIG.PREFERENCIAS desde la pestaña; el detalle, con CONFIG.PREFERENCIAS.
// -----------------------------------------------------------------------------

export async function listarCalendarios(contexto: ContextoTenant, permiso: 'PRESUPUESTOS.VER' | 'CONFIG.PREFERENCIAS'): Promise<CalendarioResumen[]> {
  return ejecutarConPermiso(contexto, permiso, (cliente) => listarCalendariosEn(cliente));
}

/** null si no es un calendario de esta empresa (lo ajeno y la copia de un cronograma son lo mismo). */
export async function leerCalendario(contexto: ContextoTenant, id: string): Promise<Calendario | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', (cliente) => leerCalendarioEn(cliente, id, true));
}
