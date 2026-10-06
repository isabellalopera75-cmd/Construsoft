import { ejecutarConPermiso, type ContextoTenant } from './contextoTenant.js';

/** D-16 · La naturaleza del capítulo raíz. No tiene valor por defecto: la elige el usuario (RF-PRE-19). */
export type Clasificacion = 'DIRECTO' | 'INDIRECTO';

/**
 * Un nivel de la EDT tal como lo devuelve app.fn_leer_edt (D-57). El código,
 * el nivel, el monto y la incidencia los deriva la base; esta capa no
 * calcula ninguno. `clasificacion` es la efectiva: la del capítulo raíz,
 * heredada por los subniveles (D-8).
 *
 * `incidenciaPct` es null cuando el costo directo del presupuesto es cero
 * (RF-PRE-37, 06 §6.6). Llega como string | null y así se queda: pasarlo por
 * Number() convertiría el null en 0, que es justo el «0 %» que el requisito
 * prohíbe. El tipo obliga a quien lo muestre a tratar el caso.
 */
export interface NodoEdt {
  id: string;
  padreId: string | null;
  codigoWbs: string;
  nivel: number;
  nombre: string;
  clasificacion: Clasificacion;
  montoAcumulado: string;
  incidenciaPct: string | null;
}

interface FilaNodo {
  id: string;
  padre_id: string | null;
  codigo_wbs: string;
  nivel: number;
  nombre: string;
  clasificacion: Clasificacion;
  monto_acumulado: string;
  incidencia_pct: string | null;
}

function filaANodo(fila: FilaNodo): NodoEdt {
  return {
    id: fila.id,
    padreId: fila.padre_id,
    codigoWbs: fila.codigo_wbs,
    nivel: fila.nivel,
    nombre: fila.nombre,
    clasificacion: fila.clasificacion,
    montoAcumulado: fila.monto_acumulado,
    incidenciaPct: fila.incidencia_pct,
  };
}

/** Lo que decide una persona al agregar un capítulo de primer nivel (02 §8.4). */
export interface DatosCapitulo {
  nombre: string;
  clasificacion: Clasificacion;
}

/**
 * Lo que decide una persona al agregar un subnivel. No lleva clasificación, y
 * no por olvido: la hereda del capítulo raíz (RF-PRE-20). Que sean dos tipos
 * distintos hace que clasificar un subcapítulo no compile, antes de que lo
 * rechace la base.
 */
export interface DatosSubcapitulo {
  nombre: string;
}

const SELECT_NODO = `
  SELECT e.id, e.padre_id, e.codigo_wbs, e.nivel, e.nombre, e.clasificacion,
         e.monto_acumulado, e.incidencia_pct
    FROM app.wbs_nodo n
    CROSS JOIN LATERAL app.fn_leer_edt(n.presupuesto_id) e
   WHERE n.id = $1 AND e.id = $1`;

/**
 * RF-PRE-11/19 · «+ Agregar Capítulo». Solo se insertan los datos que decide
 * el usuario: el orden (al final), el nivel y el código los pone la base
 * (D-55, fn_renumerar_wbs). Fuera de ABIERTO lo rechaza tg_linea_base_wbs.
 */
export async function agregarCapitulo(
  contexto: ContextoTenant,
  presupuestoId: string,
  datos: DatosCapitulo,
): Promise<NodoEdt> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, nombre, clasificacion)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [contexto.tenantId, presupuestoId, datos.nombre, datos.clasificacion],
    );
    const { rows: nodos } = await cliente.query<FilaNodo>(SELECT_NODO, [rows[0]!.id]);
    return filaANodo(nodos[0]!);
  });
}

/**
 * RF-PRE-13 · El «(+)» de un capítulo o subcapítulo: un subnivel al final de
 * sus hermanos. El presupuesto sale del padre, en la misma sentencia; si el
 * padre no existe en esta empresa, tg_derivar_posicion_wbs lo dice antes que
 * ninguna otra regla. En modo ITEMS lo rechaza tg_modo_estructura (RF-PRE-44).
 */
export async function agregarSubcapitulo(
  contexto: ContextoTenant,
  padreId: string,
  datos: DatosSubcapitulo,
): Promise<NodoEdt> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre)
       VALUES ($1, (SELECT presupuesto_id FROM app.wbs_nodo WHERE id = $2), $2, $3)
       RETURNING id`,
      [contexto.tenantId, padreId, datos.nombre],
    );
    const { rows: nodos } = await cliente.query<FilaNodo>(SELECT_NODO, [rows[0]!.id]);
    return filaANodo(nodos[0]!);
  });
}

/**
 * RF-PRE-14 · Renombrar un capítulo o subcapítulo. Un id de otra empresa no
 * afecta ninguna fila: la RLS lo esconde, el mismo modo de falla que el resto
 * del sistema.
 */
export async function renombrarNivel(contexto: ContextoTenant, nodoId: string, nombre: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', (cliente) =>
    cliente.query('UPDATE app.wbs_nodo SET nombre = $2 WHERE id = $1', [nodoId, nombre]),
  );
}

/**
 * RF-PRE-19 · Cambiar la naturaleza de un capítulo raíz mientras el
 * presupuesto esté ABIERTO. Sobre un subnivel lo rechaza tg_wbs_clasificacion
 * (D-8); el recálculo de totales lo dispara tg_recalculo_wbs_upd.
 */
export async function reclasificarCapitulo(
  contexto: ContextoTenant,
  nodoId: string,
  clasificacion: Clasificacion,
): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', (cliente) =>
    cliente.query('UPDATE app.wbs_nodo SET clasificacion = $2 WHERE id = $1', [nodoId, clasificacion]),
  );
}

/**
 * RF-PRE-14, 02 §8.2 · Subir o bajar. La pantalla traduce el gesto a una
 * posición absoluta entre hermanos, y app.fn_mover_en_edt (D-56) reordena y
 * renumera en un paso. Es idempotente: repetir la llamada no mueve más.
 * Sirve igual para un capítulo que para una actividad: comparten contador.
 */
export async function moverEnEdt(contexto: ContextoTenant, id: string, posicion: number): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', (cliente) =>
    cliente.query('SELECT app.fn_mover_en_edt($1, $2)', [id, posicion]),
  );
}

/**
 * Cuántos hermanos tiene un nodo o una actividad, contándose: el rango de
 * posiciones que acepta fn_mover_en_edt (1 a n). Es su MISMO predicado —nodos
 * y actividades bajo el mismo padre del mismo presupuesto— para que la API
 * rechace un fuera de rango como dato del formulario, con su campo, antes de
 * llegar a la base. La base lo rechaza igual. null si el id no existe en esta
 * empresa.
 */
export async function cantidadDeHermanos(contexto: ContextoTenant, id: string): Promise<number | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ n: string | null }>(
      `WITH elemento AS (
           SELECT presupuesto_id, padre_id AS padre FROM app.wbs_nodo WHERE id = $1
           UNION ALL
           SELECT presupuesto_id, wbs_nodo_id FROM app.presupuesto_item WHERE id = $1
       )
       SELECT (SELECT count(*) FROM app.wbs_nodo n
                WHERE n.presupuesto_id = e.presupuesto_id AND n.padre_id IS NOT DISTINCT FROM e.padre)
            + (SELECT count(*) FROM app.presupuesto_item i
                WHERE i.presupuesto_id = e.presupuesto_id AND i.wbs_nodo_id IS NOT DISTINCT FROM e.padre) AS n
         FROM elemento e`,
      [id],
    );
    return rows[0]?.n == null ? null : Number(rows[0].n);
  });
}

/** Lo que se perdería al eliminar un nivel: todo lo que cuelga de él, a cualquier profundidad. */
export interface ContenidoDelNivel {
  subniveles: number;
  actividades: number;
}

/**
 * La «alerta previa» de RF-PRE-14: cuántos subniveles y actividades cuelgan
 * del nivel, a cualquier profundidad. Es un conteo, no una fórmula. Pide
 * PRESUPUESTOS.EDITAR y no VER porque solo existe para confirmar un borrado.
 */
export async function leerContenidoDelNivel(contexto: ContextoTenant, nodoId: string): Promise<ContenidoDelNivel> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ subniveles: string; actividades: string }>(
      `WITH RECURSIVE rama AS (
           SELECT id FROM app.wbs_nodo WHERE id = $1
           UNION ALL
           SELECT h.id FROM app.wbs_nodo h JOIN rama r ON h.padre_id = r.id
       )
       SELECT (SELECT count(*) FROM rama) - (SELECT count(*) FROM rama WHERE id = $1) AS subniveles,
              (SELECT count(*) FROM app.presupuesto_item i JOIN rama r ON i.wbs_nodo_id = r.id) AS actividades`,
      [nodoId],
    );
    return { subniveles: Number(rows[0]!.subniveles), actividades: Number(rows[0]!.actividades) };
  });
}

/**
 * RF-PRE-14 · Eliminar un nivel con todo lo que cuelga de él (ON DELETE
 * CASCADE). La renumeración y el recálculo los disparan triggers por
 * sentencia, cuando la cascada ya terminó. Un id de otra empresa no borra
 * nada: la RLS lo esconde.
 */
export async function eliminarNivel(contexto: ContextoTenant, nodoId: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', (cliente) =>
    cliente.query('DELETE FROM app.wbs_nodo WHERE id = $1', [nodoId]),
  );
}

/**
 * El presupuesto al que pertenece un capítulo o subcapítulo, o null si no
 * existe en esta empresa: la RLS no deja distinguir uno ajeno de uno que no
 * existe. Un id de actividad también da null: no es un nodo.
 */
export async function presupuestoDelNodo(contexto: ContextoTenant, nodoId: string): Promise<string | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ presupuesto_id: string }>(
      'SELECT presupuesto_id FROM app.wbs_nodo WHERE id = $1',
      [nodoId],
    );
    return rows[0]?.presupuesto_id ?? null;
  });
}

/** RF-PRE-21 · La EDT completa, en orden de código, con monto e incidencia calculados por la base. */
export async function leerEdt(contexto: ContextoTenant, presupuestoId: string): Promise<NodoEdt[]> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<FilaNodo>(
      `SELECT id, padre_id, codigo_wbs, nivel, nombre, clasificacion, monto_acumulado, incidencia_pct
         FROM app.fn_leer_edt($1)`,
      [presupuestoId],
    );
    return rows.map(filaANodo);
  });
}
