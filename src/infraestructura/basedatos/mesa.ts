import { ejecutarConPermiso, type ContextoTenant } from './contextoTenant.js';
import type { Clasificacion } from './edt.js';
import { leerPresupuestoEnCliente, type EstadoPresupuesto, type ModoEstructura } from './presupuesto.js';

/*
 * La mesa de trabajo en una sola lectura (web/CONTRATO.md §4.1, 04 §4.3):
 * cabecera, nodos, actividades y pie, en UNA transacción. Cien actividades no
 * son cien peticiones, y las cuatro partes salen del mismo instante: el pie
 * no puede corresponder a otro árbol que el que viaja con él.
 *
 * Todo lo calculado lo calcula la base. Aquí solo se lee y se le cambia el
 * nombre a los campos. «editable» no está aquí: lo decide la capa HTTP
 * preguntándole a fn_exigir_permiso, porque clasificar su rechazo es cosa
 * del único traductor de SQLSTATE (errores.ts).
 */

export interface MesaDeTrabajo {
  cabecera: {
    id: string;
    codigo: string;
    nombre: string;
    ubicacion: string;
    moneda: string;
    estado: EstadoPresupuesto;
    modoEstructura: ModoEstructura;
    fechaElaboracion: Date;
    fechaModificacion: Date;
  };
  nodos: NodoDeMesa[];
  actividades: ActividadDeMesa[];
  pie: {
    costoIndirecto: string;
    costoDirecto: string;
    administracion: string;
    imprevistos: string;
    utilidad: string;
    aiu: string;
    iva: string;
    valorTotal: string;
    porcentajes: { a: string; i: string; u: string; iva: string };
    aiuEnCero: boolean;
    sinBaseAiu: boolean;
  };
}

export interface NodoDeMesa {
  id: string;
  padreId: string | null;
  codigoWbs: string;
  nivel: number;
  /** Lugar entre sus hermanos, nodos y actividades juntos, de 1 a n. */
  posicion: number;
  nombre: string;
  clasificacion: Clasificacion;
  montoAcumulado: string;
  incidenciaPct: string | null;
}

export interface ActividadDeMesa {
  id: string;
  nodoId: string;
  codigoItem: string;
  posicion: number;
  codigoApu: string;
  descripcion: string;
  unidadSimbolo: string;
  cantidad: string;
  precioUnitario: string;
  costoTotal: string;
  apuId: string;
  apuVersionId: string;
}

/*
 * La posición de cada nodo y actividad entre sus hermanos. Es EXACTAMENTE la
 * expresión con que fn_mover_en_edt cuenta y renumera —los hermanos de los
 * dos tipos bajo el mismo padre, ORDER BY orden, es_nodo DESC, id—, con el
 * desempate incluido: la posición que lee la pantalla tiene que ser la que la
 * función acepta. Con otro desempate, un nodo y una actividad que compartan
 * orden quedarían invertidos, y un «mover a la 2» caería una corrida.
 *
 * Hoy el desempate no se puede observar: fn_renumerar_wbs reescribe orden al
 * final de cada sentencia con esta misma expresión, así que en el estado
 * guardado orden ya vale de 1 a n entre hermanos y no hay empates. Se
 * calcula igual por si eso cambia: si la renumeración dejara de normalizar
 * orden, la posición seguiría siendo la que fn_mover_en_edt acepta.
 */
const POSICIONES = `
  WITH hermanos AS (
      SELECT n.id, n.padre_id AS padre, true AS es_nodo, n.orden
        FROM app.wbs_nodo n WHERE n.presupuesto_id = $1
      UNION ALL
      SELECT i.id, i.wbs_nodo_id, false, i.orden
        FROM app.presupuesto_item i WHERE i.presupuesto_id = $1
  ), posiciones AS (
      SELECT id, row_number() OVER (PARTITION BY padre ORDER BY orden, es_nodo DESC, id)::integer AS posicion
        FROM hermanos
  )`;

/** null si el presupuesto no existe o es de otra empresa: la RLS no deja distinguirlos. */
export async function leerMesa(contexto: ContextoTenant, presupuestoId: string): Promise<MesaDeTrabajo | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const p = await leerPresupuestoEnCliente(cliente, presupuestoId);
    if (!p) return null;

    const { rows: nodos } = await cliente.query<{
      id: string;
      padre_id: string | null;
      codigo_wbs: string;
      nivel: number;
      posicion: number;
      nombre: string;
      clasificacion: Clasificacion;
      monto_acumulado: string;
      incidencia_pct: string | null;
    }>(
      `${POSICIONES}
       SELECT e.id, e.padre_id, e.codigo_wbs, e.nivel, s.posicion, e.nombre, e.clasificacion,
              e.monto_acumulado, e.incidencia_pct
         FROM app.fn_leer_edt($1) e
         JOIN posiciones s ON s.id = e.id
        ORDER BY string_to_array(e.codigo_wbs, '.')::int[]`,
      [presupuestoId],
    );

    const { rows: actividades } = await cliente.query<{
      id: string;
      wbs_nodo_id: string;
      codigo_item: string;
      posicion: number;
      codigo_apu: string;
      descripcion: string;
      unidad_simbolo: string;
      cantidad: string;
      precio_unitario: string;
      costo_total: string;
      apu_id: string;
      apu_version_id: string;
    }>(
      `${POSICIONES}
       SELECT i.id, i.wbs_nodo_id, i.codigo_item, s.posicion, i.codigo_apu, i.descripcion,
              i.unidad_simbolo, i.cantidad, i.precio_unitario, i.costo_total, i.apu_id, i.apu_version_id
         FROM app.presupuesto_item i
         JOIN posiciones s ON s.id = i.id
        WHERE i.presupuesto_id = $1
        ORDER BY string_to_array(i.codigo_item, '.')::int[]`,
      [presupuestoId],
    );

    return {
      cabecera: {
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        ubicacion: p.ubicacion,
        moneda: p.moneda,
        estado: p.estado,
        modoEstructura: p.modoEstructura,
        fechaElaboracion: p.fechaElaboracion,
        fechaModificacion: p.fechaModificacion,
      },
      nodos: nodos.map((n) => ({
        id: n.id,
        padreId: n.padre_id,
        codigoWbs: n.codigo_wbs,
        nivel: n.nivel,
        posicion: n.posicion,
        nombre: n.nombre,
        clasificacion: n.clasificacion,
        montoAcumulado: n.monto_acumulado,
        incidenciaPct: n.incidencia_pct,
      })),
      actividades: actividades.map((a) => ({
        id: a.id,
        nodoId: a.wbs_nodo_id,
        codigoItem: a.codigo_item,
        posicion: a.posicion,
        codigoApu: a.codigo_apu,
        descripcion: a.descripcion,
        unidadSimbolo: a.unidad_simbolo,
        cantidad: a.cantidad,
        precioUnitario: a.precio_unitario,
        costoTotal: a.costo_total,
        apuId: a.apu_id,
        apuVersionId: a.apu_version_id,
      })),
      pie: {
        costoIndirecto: p.totalCostoIndirecto,
        costoDirecto: p.totalCostoDirecto,
        administracion: p.totalAdministracion,
        imprevistos: p.totalImprevistos,
        utilidad: p.totalUtilidad,
        aiu: p.totalAiu,
        iva: p.totalIva,
        valorTotal: p.valorTotal,
        porcentajes: { a: p.aiuAdministracion, i: p.aiuImprevistos, u: p.aiuUtilidad, iva: p.ivaUtilidadPct },
        aiuEnCero: p.aiuEnCero,
        sinBaseAiu: p.sinBaseAiu,
      },
    };
  });
}
