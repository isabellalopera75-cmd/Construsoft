import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';
import { porFila } from './enBloque.js';

/** Los cuatro tipos de app.recurso.tipo (RF-REC-01), y ningún otro string. */
export type TipoRecurso = 'MATERIAL' | 'EQUIPO' | 'PERSONAL' | 'ACTIVIDAD_TODO_COSTO';

/** Qué campo escribió el usuario al capturar el precio (RF-REC-07/10). Decide cuál igualdad exige ck_recurso_precios_cuadran. */
export type ViaCaptura = 'BASE' | 'TOTAL';

/**
 * Lo que hace falta para crear un recurso (RF-REC-06). precioBase, ivaPct y
 * precioTotal viajan como texto, no como number: son app.dinero/app.porcentaje
 * (numeric de Postgres) y esta capa no hace aritmética con ellos — los pasa
 * tal cual a la base, que es quien de verdad decide si cuadran
 * (ck_recurso_precios_cuadran). El cálculo del precio complementario en
 * tiempo real (RF-REC-09) y el bloqueo cruzado de campos (RF-REC-10) son de
 * la interfaz, no de este backend (CLAUDE.md, regla 2).
 */
export interface DatosRecurso {
  nombre: string;
  tipo: TipoRecurso;
  unidadId: string;
  precioBase: string;
  ivaPct: string;
  precioTotal: string;
  viaCaptura: ViaCaptura;
}

/** Un recurso tal como vive en app.recurso, con su código ya asignado. */
export interface Recurso extends DatosRecurso {
  id: string;
  codigo: string;
  activo: boolean;
}

interface FilaRecurso {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  unidad_id: string;
  precio_base: string;
  iva_pct: string;
  precio_total: string;
  via_captura: ViaCaptura;
  activo: boolean;
}

function filaARecurso(fila: FilaRecurso): Recurso {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    tipo: fila.tipo,
    unidadId: fila.unidad_id,
    precioBase: fila.precio_base,
    ivaPct: fila.iva_pct,
    precioTotal: fila.precio_total,
    viaCaptura: fila.via_captura,
    activo: fila.activo,
  };
}

/**
 * Crea un recurso (RF-REC-02/06/07/11). El código sale de
 * app.fn_siguiente_codigo, dentro de la MISMA transacción que el INSERT: no
 * lo genera esta función a mano ni lo acepta como dato de entrada, y queda
 * inmutable en cuanto la fila existe (tg_recurso_inmutable).
 *
 * No valida ni recalcula precioBase/ivaPct/precioTotal: eso es
 * ck_recurso_precios_cuadran, direccional según viaCaptura. Si los números
 * no cuadran para la vía declarada, Postgres lo rechaza y el error de la
 * base llega tal cual — el mismo patrón que ya usa registrarEmpresa con el
 * NIT vacío (D-34).
 */
/**
 * Decisión del dueño, 7 de octubre de 2026: no hay dos recursos con el mismo
 * nombre en una empresa, sin importar mayúsculas ni espacios de los bordes.
 * Corre dentro de la MISMA transacción que el INSERT o el UPDATE. Hasta que
 * el esquema la defienda con un índice único, la comprueba esta capa en los
 * tres caminos que escriben un nombre: crear, editar y crear en bloque.
 */
async function exigirNombreLibre(cliente: ClienteEnContexto, nombre: string, excepto: string | null): Promise<void> {
  const { rows } = await cliente.query<{ nombre: string; codigo: string }>(
    `SELECT nombre, codigo FROM app.recurso
      WHERE lower(btrim(nombre)) = lower(btrim($1)) AND id IS DISTINCT FROM $2
      LIMIT 1`,
    [nombre, excepto],
  );
  const existente = rows[0];
  if (existente) {
    throw new ErrorParaElUsuario(
      `Ya existe un recurso llamado «${existente.nombre}» (${existente.codigo}). Use otro nombre, o edite el que ya existe.`,
      'RECHAZADO',
      'nombre',
    );
  }
}

export async function crearRecurso(contexto: ContextoTenant, datos: DatosRecurso): Promise<Recurso> {
  return ejecutarConPermiso(contexto, 'RECURSOS.CREAR', async (cliente) => {
    await exigirNombreLibre(cliente, datos.nombre, null);
    const { rows: filasCodigo } = await cliente.query<{ fn_siguiente_codigo: string }>(
      `SELECT app.fn_siguiente_codigo($1, 'RECURSO')`,
      [contexto.tenantId],
    );
    const codigo = filasCodigo[0]!.fn_siguiente_codigo;

    const { rows } = await cliente.query<FilaRecurso>(
      `INSERT INTO app.recurso
             (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct,
              precio_total, via_captura, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct,
                 precio_total, via_captura, activo`,
      [
        contexto.tenantId,
        codigo,
        datos.nombre,
        datos.tipo,
        datos.unidadId,
        datos.precioBase,
        datos.ivaPct,
        datos.precioTotal,
        datos.viaCaptura,
        contexto.usuarioId,
      ],
    );
    return filaARecurso(rows[0]!);
  });
}

/** Una fila, o null si no existe en esta empresa — igual que resolverToken/autenticar: el "no está" no es un error, es un resultado. */
export async function leerRecurso(contexto: ContextoTenant, id: string): Promise<Recurso | null> {
  return ejecutarConPermiso(contexto, 'RECURSOS.VER', async (cliente) => {
    const { rows } = await cliente.query<FilaRecurso>(
      `SELECT id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct,
              precio_total, via_captura, activo
         FROM app.recurso
        WHERE id = $1`,
      [id],
    );
    return rows[0] ? filaARecurso(rows[0]) : null;
  });
}

/**
 * RF-REC-14. `texto` es opcional a propósito: sin él, "todos los registros"
 * (RF-REC-04) es la ausencia de filtro, no un camino aparte. `tipo` ausente
 * es lo que RF-REC-03 llama "romper el filtro por pestañas".
 */
export interface FiltrosRecurso {
  tipo?: TipoRecurso;
  /** Coincidencia parcial por nombre O por código (RF-REC-03/14): las dos las resuelve fn_buscar_recurso. */
  texto?: string;
  unidadId?: string;
  precioMin?: string;
  precioMax?: string;
  /** Solo se usa junto con `texto`: fn_buscar_recurso lo exige (D-47). Por defecto, el mismo 50 de la función. */
  limite?: number;
}

/**
 * RF-REC-03/04/14 en una sola función. `texto` —nombre o código, coincidencia
 * parcial— pasa por app.fn_buscar_recurso (D-47, índices trigrama compuestos
 * con tenant_id) y nunca por un LIKE/ILIKE directo contra la tabla: bajo RLS
 * esos operadores no son LEAKPROOF y Postgres termina leyendo el catálogo
 * entero en cada tecla. La función devuelve ids; el resto de los filtros
 * —unidad, rango de precio— son comparaciones LEAKPROOF y se aplican directo
 * contra app.recurso, que sigue bajo RLS.
 */
export async function listarRecursos(
  contexto: ContextoTenant,
  filtros: FiltrosRecurso = {},
): Promise<Recurso[]> {
  return ejecutarConPermiso(contexto, 'RECURSOS.VER', async (cliente) => {
    const texto = filtros.texto?.trim();
    const parametros: unknown[] = [];
    const condiciones: string[] = [];

    if (texto) {
      // fn_buscar_recurso ya filtra por tipo si se lo pasamos, así que ese
      // filtro no se repite más abajo cuando hay texto de búsqueda.
      //
      // El alias "AS encontrado(id)" ya no es obligatorio (28 de septiembre
      // de 2026): fn_buscar_recurso pasó de RETURNS SETOF uuid a RETURNS
      // TABLE (id uuid), y con la columna nombrada en la propia función "id"
      // se resuelve contra ella sin escaparse a la consulta externa. Antes sí
      // hacía falta: sin nombre de columna, "SELECT id FROM
      // fn_buscar_recurso(...)" dejaba a Postgres resolver "id" contra
      // app.recurso de la consulta EXTERNA, la subconsulta quedaba
      // correlacionada sin querer, y "id IN (id)" era trivialmente cierto
      // para cualquier fila en cuanto la función devolvía al menos un
      // resultado — el bug real que encontró la prueba de este archivo. Se
      // deja el alias explícito de todos modos, por claridad.
      parametros.push(texto, filtros.tipo ?? null, filtros.limite ?? 50);
      condiciones.push(
        'id IN (SELECT encontrado.id FROM app.fn_buscar_recurso($1, $2, $3) AS encontrado(id))',
      );
    } else if (filtros.tipo) {
      parametros.push(filtros.tipo);
      condiciones.push(`tipo = $${parametros.length}`);
    }

    if (filtros.unidadId) {
      parametros.push(filtros.unidadId);
      condiciones.push(`unidad_id = $${parametros.length}`);
    }
    if (filtros.precioMin) {
      parametros.push(filtros.precioMin);
      condiciones.push(`precio_total >= $${parametros.length}`);
    }
    if (filtros.precioMax) {
      parametros.push(filtros.precioMax);
      condiciones.push(`precio_total <= $${parametros.length}`);
    }

    const dondeSql = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await cliente.query<FilaRecurso>(
      `SELECT id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct,
              precio_total, via_captura, activo
         FROM app.recurso
         ${dondeSql}
        ORDER BY lower(nombre)`,
      parametros,
    );
    return rows.map(filaARecurso);
  });
}

/**
 * RF-REC-13. app.fn_eliminar_recurso ya cuenta el uso —incluidas versiones
 * de APU que dejaron de ser vigentes, no solo la actual— y rechaza si hay
 * alguno; esta función no repite ese conteo, solo llama y propaga.
 *
 * Corre como construsoft_owner, que NO tiene BYPASSRLS: RLS le esconde la
 * fila de un recurso de otra empresa antes de que la función llegue a
 * comprobar nada por su cuenta (RN-01), y su propio chequeo explícito de
 * tenant_id es la segunda barrera para cuando ese no fuera el caso.
 */
export async function eliminarRecurso(contexto: ContextoTenant, id: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'RECURSOS.ELIMINAR', (cliente) =>
    cliente.query('SELECT app.fn_eliminar_recurso($1)', [id]),
  );
}

/** Un presupuesto ABIERTO candidato a reapuntarse (RF-REC-12). */
export interface PresupuestoAfectado {
  id: string;
  codigo: string;
  nombre: string;
}

/**
 * RF-REC-12: qué presupuestos ABIERTOS usan este recurso hoy, para que la
 * interfaz arme la pregunta ANTES de guardar un cambio de precio, nunca
 * después. Solo tiene sentido llamarla cuando la edición en curso va a
 * cambiar precio_base, precio_total o iva_pct — si no cambia nada de eso,
 * no hay ninguna pregunta que hacer, y quien orquesta la pantalla es quien
 * decide si corresponde llamarla.
 *
 * ACTIVO y CERRADO nunca aparecen acá, ni aunque usen el recurso:
 * fn_propagar_recurso los ignora igual si se le pasan (el trigger de línea
 * base los rechaza, D-5), así que ofrecerlos como opción prometería un
 * reapunte que después no ocurre.
 */
export async function listarPresupuestosAfectados(
  contexto: ContextoTenant,
  recursoId: string,
): Promise<PresupuestoAfectado[]> {
  return ejecutarConPermiso(contexto, 'RECURSOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<PresupuestoAfectado>(
      `SELECT DISTINCT p.id, p.codigo, p.nombre
         FROM app.apu a
         JOIN app.apu_version_recurso avr ON avr.apu_version_id = a.version_vigente_id
         JOIN app.presupuesto_item pi ON pi.apu_id = a.id
         JOIN app.presupuesto p ON p.id = pi.presupuesto_id AND p.estado = 'ABIERTO'
        WHERE avr.recurso_id = $1
        ORDER BY p.codigo`,
      [recursoId],
    );
    return rows;
  });
}

/** Lo que devuelve actualizarRecurso: el recurso ya guardado, y cuántos APU quedaron con una versión nueva. */
export interface ResultadoActualizarRecurso {
  recurso: Recurso;
  /** 0 si el precio no cambió: entonces fn_propagar_recurso no se llamó en absoluto, no que se haya llamado y no encontrado nada. */
  apusVersionados: number;
}

/**
 * RF-REC-12/D-22. Propaga —crea una versión nueva de cada APU afectado y
 * reapunta los presupuestos ABIERTOS de `presupuestosAReapuntar`— SOLO
 * cuando la edición cambió precio_base, precio_total o iva_pct. Ningún otro
 * campo lo justifica: tg_historia_recurso, el único trigger que audita
 * cambios de este recurso, dispara por esas mismas tres columnas y ninguna
 * más, y fn_propagar_recurso escribe un motivo que dice literalmente
 * "Cambio de precio" — llamarla porque cambió el nombre dejaría una entrada
 * de historial que miente sobre qué pasó (D-45).
 *
 * La comparación es entre lo que YA estaba guardado y lo que el UPDATE
 * acaba de guardar —dos lecturas de la misma columna numeric, con el mismo
 * formato canónico de Postgres—, nunca contra el texto que llegó de
 * `datos`: comparar contra la entrada arriesgaría un falso "cambió" por una
 * diferencia de formato ("100" vs "100.000000") que no es un cambio real.
 */
export async function actualizarRecurso(
  contexto: ContextoTenant,
  id: string,
  datos: DatosRecurso,
  presupuestosAReapuntar?: string[],
): Promise<ResultadoActualizarRecurso> {
  return ejecutarConPermiso(contexto, 'RECURSOS.EDITAR', async (cliente) => {
    const { rows: filasAntes } = await cliente.query<{
      precio_base: string;
      precio_total: string;
      iva_pct: string;
    }>('SELECT precio_base, precio_total, iva_pct FROM app.recurso WHERE id = $1', [id]);
    const antes = filasAntes[0];
    if (!antes) {
      throw new ErrorParaElUsuario('El recurso no existe en esta empresa.', 'NO_EXISTE');
    }
    await exigirNombreLibre(cliente, datos.nombre, id);

    const { rows } = await cliente.query<FilaRecurso>(
      `UPDATE app.recurso
          SET nombre = $1, tipo = $2, unidad_id = $3, precio_base = $4,
              iva_pct = $5, precio_total = $6, via_captura = $7,
              actualizado_en = now()
        WHERE id = $8
      RETURNING id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct,
                precio_total, via_captura, activo`,
      [
        datos.nombre,
        datos.tipo,
        datos.unidadId,
        datos.precioBase,
        datos.ivaPct,
        datos.precioTotal,
        datos.viaCaptura,
        id,
      ],
    );
    const fila = rows[0]!;

    const cambioElPrecio =
      antes.precio_base !== fila.precio_base ||
      antes.precio_total !== fila.precio_total ||
      antes.iva_pct !== fila.iva_pct;

    let apusVersionados = 0;
    if (cambioElPrecio) {
      const { rows: filasPropagacion } = await cliente.query<{ fn_propagar_recurso: number }>(
        'SELECT app.fn_propagar_recurso($1, $2)',
        [id, presupuestosAReapuntar ?? null],
      );
      apusVersionados = filasPropagacion[0]!.fn_propagar_recurso;
    }

    return { recurso: filaARecurso(fila), apusVersionados };
  });
}

/** Una fila de la plantilla de recursos ya validada (CONTRATO §10.3). */
export interface RecursoImportado {
  fila: number;
  nombre: string;
  tipo: TipoRecurso;
  unidadId: string;
  /** El precio que escribió la persona; el otro lo calcula la base. */
  viaCaptura: ViaCaptura;
  precio: string;
  ivaPct: string;
}

/**
 * CONTRATO §10 · Crear recursos en bloque, todo o nada (ver enBloque.ts). El
 * código lo asigna fn_siguiente_codigo, como en el formulario.
 *
 * El precio complementario lo calcula PostgreSQL en el mismo INSERT, con la
 * misma igualdad de ck_recurso_precios_cuadran escrita una segunda vez: la
 * base no tiene una función que la exponga. Si alguna vez se separan, el
 * CHECK rechaza la fila en vez de guardar dos precios que no cuadran.
 */
export async function crearRecursosEnBloque(contexto: ContextoTenant, recursos: RecursoImportado[]): Promise<number> {
  return ejecutarConPermiso(contexto, 'RECURSOS.CREAR', (cliente) =>
    porFila(cliente, recursos, async (r) => {
      await exigirNombreLibre(cliente, r.nombre, null);
      await cliente.query(
        `INSERT INTO app.recurso
               (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct,
                precio_total, via_captura, creado_por)
         VALUES ($1, app.fn_siguiente_codigo($1, 'RECURSO'), $2, $3, $4,
                 CASE WHEN $5 = 'BASE' THEN $6::numeric
                      ELSE round($6::numeric / (1 + $7::numeric / 100), 6) END,
                 $7::numeric,
                 CASE WHEN $5 = 'TOTAL' THEN $6::numeric
                      ELSE round($6::numeric * (1 + $7::numeric / 100), 6) END,
                 $5, $8)`,
        [contexto.tenantId, r.nombre, r.tipo, r.unidadId, r.viaCaptura, r.precio, r.ivaPct, contexto.usuarioId],
      );
    }),
  );
}
