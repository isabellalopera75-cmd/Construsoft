import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { crearRecurso, listarRecursos, type Recurso, type TipoRecurso } from '../infraestructura/basedatos/recurso.js';
import { crearApu, leerApu, listarApus, type Apu, type LineaApu } from '../infraestructura/basedatos/apu.js';
import { crearPresupuesto, editarPorcentajes, listarPresupuestos } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { copiarFestivos, crearCalendario, listarCalendarios, type Tramo } from '../infraestructura/basedatos/calendarios.js';
import { listarFestivos } from '../infraestructura/basedatos/festivos.js';

/*
 * DEMO-003 · Edificio Mirador del Valle: un proyecto activo con su cronograma
 * completo, para mostrar el Gantt, las curvas S y la línea base (bitácora del
 * producto, 21 de octubre de 2026). Se agrega a la empresa de demostración
 * que ya existe; DEMO-001 y DEMO-002 no se tocan.
 *
 * Como sembrarDemostracion, no hay una fila escrita a mano:
 *   - el catálogo, el presupuesto y su activación, con los módulos de la capa
 *     de datos;
 *   - el cronograma, por la API, con una sesión de la empresa: sus reglas
 *     (qué se edita en qué tipo de actividad, días a horas, la versión de cada
 *     escritura) viven en las rutas, y así el guion hace exactamente lo que
 *     haría una persona en la pantalla.
 *
 * Los precios son razonables para Antioquia en 2026: es una demostración, no
 * una oferta. Cada ítem tiene su APU, con la cuadrilla al rendimiento de la
 * actividad (1 / rendimiento jornales por unidad) y sus insumos.
 */

export const CODIGO_DEMO_CRONOGRAMA = 'DEMO-003';

/** Una petición a la API con la sesión de la empresa. Devuelve el cuerpo; un estado que no sea 2xx es un error con su mensaje. */
export type Pedir = (metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cuerpo?: unknown) => Promise<Record<string, any>>;

export interface ResumenDemoCronograma {
  presupuestoId: string;
  cronogramaId: string;
  valorTotal: string;
  inicio: string;
  fin: string;
  duracionDias: string;
  /** La duración del director de obra: la del proyecto, en días enteros. */
  directorDias: string;
  /** La holgura total de H-002. Sería negativa si el fin pasara del 30 de septiembre de 2027, su «fin en o antes de». */
  holguraDelFin: string | null;
  lineaBaseId: string;
  aviso: { finLineaBase: string; finActual: string; diasDeMas: string } | null;
}

// --- El catálogo -----------------------------------------------------------------------------

interface Insumo {
  recurso: string;
  tipo: TipoRecurso;
  unidad: string;
  /** Precio antes de IVA, en pesos. Múltiplo de 100: así el precio con IVA es exacto. */
  precio: string;
  iva: '0' | '19';
  cantidad: string;
  desperdicio?: string;
}

const CUADRILLA = {
  topografia: { recurso: 'Cuadrilla de topografía (topógrafo y cadenero)', precio: '420000' },
  oficialAyudante: { recurso: 'Cuadrilla de un oficial y un ayudante', precio: '270000' },
  oficialDosAyudantes: { recurso: 'Cuadrilla de un oficial y dos ayudantes', precio: '385000' },
  ayudante: { recurso: 'Ayudante de obra', precio: '115000' },
  dosAyudantes: { recurso: 'Cuadrilla de dos ayudantes', precio: '230000' },
  instaladores: { recurso: 'Cuadrilla de un técnico instalador y un ayudante', precio: '300000' },
} as const;

const material = (recurso: string, unidad: string, precio: string, cantidad: string, desperdicio = '0'): Insumo => ({
  recurso, tipo: 'MATERIAL', unidad, precio, iva: '19', cantidad, desperdicio,
});
const equipo = (recurso: string, unidad: string, precio: string, cantidad: string): Insumo => ({ recurso, tipo: 'EQUIPO', unidad, precio, iva: '19', cantidad });
const todoCosto = (recurso: string, unidad: string, precio: string): Insumo => ({ recurso, tipo: 'ACTIVIDAD_TODO_COSTO', unidad, precio, iva: '0', cantidad: '1' });

const CONCRETO_2000 = (cantidad: string) => material('Concreto premezclado 2000 PSI', 'm³', '430000', cantidad, '5');
const CONCRETO_3000 = (cantidad: string) => material('Concreto premezclado 3000 PSI', 'm³', '500000', cantidad, '5');
const CONCRETO_4000 = (cantidad: string) => material('Concreto premezclado 4000 PSI', 'm³', '560000', cantidad, '5');
const ACERO = (cantidad: string) => material('Acero de refuerzo figurado 60.000 PSI', 'Kg', '4600', cantidad, '3');
const ALAMBRE = material('Alambre negro calibre 18', 'Kg', '7500', '0.02');
const MORTERO_1_4 = (cantidad: string) => material('Mortero 1:4 preparado en obra', 'm³', '420000', cantidad, '5');
const PEGANTE = material('Pegante para cerámica, bulto de 25 kg', 'Und', '32000', '0.2');
const VOLQUETA = (cantidad: string) => equipo('Retiro de sobrantes en volqueta', 'm³', '45000', cantidad);
const VIBRADOR = (cantidad: string) => equipo('Vibrador de concreto', 'Jr', '85000', cantidad);

interface Item {
  capitulo: string;
  nombre: string;
  unidad: string;
  cantidad: string;
  /** Unidades por jornal de una cuadrilla (RF-APU-25). Sin él, la duración se escribe a mano en el cronograma. */
  rendimiento?: string;
  cuadrillas?: number;
  cuadrilla?: keyof typeof CUADRILLA;
  /** Días, para los ítems sin rendimiento. El del director se calcula al final. */
  duracionManual?: string;
  insumos: Insumo[];
}

const CAPITULOS: { nombre: string; clasificacion: 'DIRECTO' | 'INDIRECTO' }[] = [
  { nombre: 'PRELIMINARES', clasificacion: 'DIRECTO' },
  { nombre: 'CIMENTACIÓN', clasificacion: 'DIRECTO' },
  { nombre: 'ESTRUCTURA', clasificacion: 'DIRECTO' },
  { nombre: 'MAMPOSTERÍA', clasificacion: 'DIRECTO' },
  { nombre: 'INSTALACIONES HIDROSANITARIAS', clasificacion: 'DIRECTO' },
  { nombre: 'INSTALACIONES ELÉCTRICAS', clasificacion: 'DIRECTO' },
  { nombre: 'PAÑETES Y ACABADOS', clasificacion: 'DIRECTO' },
  { nombre: 'PISOS', clasificacion: 'DIRECTO' },
  { nombre: 'CARPINTERÍA Y VENTANERÍA', clasificacion: 'DIRECTO' },
  { nombre: 'ASEO Y ENTREGA', clasificacion: 'DIRECTO' },
  { nombre: 'COSTOS INDIRECTOS', clasificacion: 'INDIRECTO' },
];

const ITEMS: Item[] = [
  { capitulo: 'PRELIMINARES', nombre: 'Localización y replanteo', unidad: 'm²', cantidad: '650', rendimiento: '200', cuadrillas: 1, cuadrilla: 'topografia',
    insumos: [material('Estacas, hilo y pintura de demarcación', 'm²', '700', '1')] },
  { capitulo: 'PRELIMINARES', nombre: 'Cerramiento provisional en lámina', unidad: 'm', cantidad: '120', rendimiento: '25', cuadrillas: 1, cuadrilla: 'oficialAyudante',
    insumos: [material('Lámina de zinc calibre 34 de 2,13 m', 'Und', '38000', '1.1'), material('Listón de madera de 2" × 3" de 3 m', 'Und', '9500', '1')] },
  { capitulo: 'PRELIMINARES', nombre: 'Campamento y bodega', unidad: 'Glb', cantidad: '1', duracionManual: '5',
    insumos: [todoCosto('Campamento y bodega en madera, a todo costo', 'Glb', '18000000')] },
  { capitulo: 'PRELIMINARES', nombre: 'Descapote y limpieza', unidad: 'm²', cantidad: '650', rendimiento: '80', cuadrillas: 1, cuadrilla: 'dosAyudantes',
    insumos: [VOLQUETA('0.15')] },

  { capitulo: 'CIMENTACIÓN', nombre: 'Excavación mecánica', unidad: 'm³', cantidad: '480', rendimiento: '60', cuadrillas: 1, cuadrilla: 'ayudante',
    insumos: [equipo('Retroexcavadora sobre orugas', 'Hr', '230000', '0.133333'), VOLQUETA('1.25')] },
  { capitulo: 'CIMENTACIÓN', nombre: 'Concreto de limpieza e = 5 cm', unidad: 'm²', cantidad: '420', rendimiento: '40', cuadrillas: 1, cuadrilla: 'oficialDosAyudantes',
    insumos: [CONCRETO_2000('0.05')] },
  { capitulo: 'CIMENTACIÓN', nombre: 'Acero de refuerzo de cimentación', unidad: 'Kg', cantidad: '18000', rendimiento: '400', cuadrillas: 2, cuadrilla: 'oficialDosAyudantes',
    insumos: [ACERO('1'), ALAMBRE] },
  { capitulo: 'CIMENTACIÓN', nombre: 'Concreto 3000 psi de zapatas y vigas', unidad: 'm³', cantidad: '160', rendimiento: '12', cuadrillas: 2, cuadrilla: 'oficialDosAyudantes',
    insumos: [CONCRETO_3000('1'), VIBRADOR('0.083333')] },
  { capitulo: 'CIMENTACIÓN', nombre: 'Relleno compactado', unidad: 'm³', cantidad: '220', rendimiento: '25', cuadrillas: 1, cuadrilla: 'oficialAyudante',
    insumos: [material('Material de afirmado', 'm³', '65000', '1.3'), equipo('Vibrocompactador tipo canguro', 'Jr', '95000', '0.04')] },

  { capitulo: 'ESTRUCTURA', nombre: 'Columnas en concreto 4000 psi', unidad: 'm³', cantidad: '85', rendimiento: '4', cuadrillas: 2, cuadrilla: 'oficialDosAyudantes',
    insumos: [CONCRETO_4000('1'), equipo('Formaleta metálica para columnas, alquiler', 'm²', '9000', '10'), VIBRADOR('0.25')] },
  { capitulo: 'ESTRUCTURA', nombre: 'Losa aligerada de entrepiso e = 0,40', unidad: 'm²', cantidad: '2400', rendimiento: '45', cuadrillas: 2, cuadrilla: 'oficialDosAyudantes',
    insumos: [CONCRETO_4000('0.14'), material('Casetón en icopor', 'm²', '22000', '0.8'), equipo('Formaleta de losa y obra falsa, alquiler', 'm²', '12000', '1')] },
  { capitulo: 'ESTRUCTURA', nombre: 'Acero de refuerzo de estructura', unidad: 'Kg', cantidad: '62000', rendimiento: '450', cuadrillas: 3, cuadrilla: 'oficialDosAyudantes',
    insumos: [ACERO('1'), ALAMBRE] },
  { capitulo: 'ESTRUCTURA', nombre: 'Escaleras en concreto', unidad: 'm³', cantidad: '18', rendimiento: '2', cuadrillas: 1, cuadrilla: 'oficialDosAyudantes',
    insumos: [CONCRETO_3000('1'), material('Formaleta en madera para escaleras', 'm²', '28000', '6')] },
  { capitulo: 'ESTRUCTURA', nombre: 'Losa de cubierta', unidad: 'm²', cantidad: '480', rendimiento: '45', cuadrillas: 1, cuadrilla: 'oficialDosAyudantes',
    insumos: [CONCRETO_4000('0.14'), material('Casetón en icopor', 'm²', '22000', '0.8'), equipo('Formaleta de losa y obra falsa, alquiler', 'm²', '12000', '1'),
      material('Impermeabilizante para cubierta', 'm²', '18000', '1')] },

  { capitulo: 'MAMPOSTERÍA', nombre: 'Muro en bloque #5', unidad: 'm²', cantidad: '3200', rendimiento: '14', cuadrillas: 4, cuadrilla: 'oficialAyudante',
    insumos: [material('Bloque de arcilla #5', 'Und', '2300', '13', '3'), MORTERO_1_4('0.012')] },
  { capitulo: 'MAMPOSTERÍA', nombre: 'Dinteles y columnetas', unidad: 'm', cantidad: '900', rendimiento: '30', cuadrillas: 1, cuadrilla: 'oficialAyudante',
    insumos: [CONCRETO_3000('0.02'), ACERO('2.5'), material('Formaleta en madera para columnetas', 'm', '6000', '2')] },

  { capitulo: 'INSTALACIONES HIDROSANITARIAS', nombre: 'Red de suministro en PVC presión', unidad: 'm', cantidad: '1400', rendimiento: '40', cuadrillas: 1, cuadrilla: 'instaladores',
    insumos: [material('Tubería PVC presión de 1/2" con accesorios', 'm', '9800', '1', '5')] },
  { capitulo: 'INSTALACIONES HIDROSANITARIAS', nombre: 'Red sanitaria y de aguas lluvias', unidad: 'm', cantidad: '900', rendimiento: '30', cuadrillas: 1, cuadrilla: 'instaladores',
    insumos: [material('Tubería PVC sanitaria de 4" con accesorios', 'm', '32000', '1', '5')] },
  { capitulo: 'INSTALACIONES HIDROSANITARIAS', nombre: 'Aparatos sanitarios', unidad: 'Und', cantidad: '60', rendimiento: '6', cuadrillas: 1, cuadrilla: 'instaladores',
    insumos: [material('Aparato sanitario con grifería', 'Und', '680000', '1')] },

  { capitulo: 'INSTALACIONES ELÉCTRICAS', nombre: 'Salidas eléctricas', unidad: 'Und', cantidad: '520', rendimiento: '12', cuadrillas: 2, cuadrilla: 'instaladores',
    insumos: [material('Salida eléctrica: caja, tubo y aparato', 'Und', '52000', '1')] },
  { capitulo: 'INSTALACIONES ELÉCTRICAS', nombre: 'Tablero general y acometida', unidad: 'Glb', cantidad: '1', duracionManual: '4',
    insumos: [todoCosto('Tablero general y acometida, a todo costo', 'Glb', '28000000')] },
  { capitulo: 'INSTALACIONES ELÉCTRICAS', nombre: 'Cableado', unidad: 'm', cantidad: '6500', rendimiento: '250', cuadrillas: 1, cuadrilla: 'instaladores',
    insumos: [material('Cable THHN calibre 12', 'm', '4200', '1', '5')] },

  { capitulo: 'PAÑETES Y ACABADOS', nombre: 'Pañete de muros interiores', unidad: 'm²', cantidad: '6000', rendimiento: '25', cuadrillas: 4, cuadrilla: 'oficialAyudante',
    insumos: [MORTERO_1_4('0.025')] },
  { capitulo: 'PAÑETES Y ACABADOS', nombre: 'Estuco y pintura', unidad: 'm²', cantidad: '6000', rendimiento: '40', cuadrillas: 3, cuadrilla: 'oficialAyudante',
    insumos: [material('Estuco y pintura tipo 1', 'm²', '9500', '1')] },
  { capitulo: 'PAÑETES Y ACABADOS', nombre: 'Enchape de baños', unidad: 'm²', cantidad: '650', rendimiento: '10', cuadrillas: 2, cuadrilla: 'oficialAyudante',
    insumos: [material('Cerámica de pared', 'm²', '48000', '1', '5'), PEGANTE] },

  { capitulo: 'PISOS', nombre: 'Afinado de piso', unidad: 'm²', cantidad: '2300', rendimiento: '40', cuadrillas: 2, cuadrilla: 'oficialAyudante',
    insumos: [material('Mortero 1:3 preparado en obra', 'm³', '450000', '0.04', '5')] },
  { capitulo: 'PISOS', nombre: 'Piso cerámico', unidad: 'm²', cantidad: '2300', rendimiento: '18', cuadrillas: 3, cuadrilla: 'oficialAyudante',
    insumos: [material('Piso cerámico', 'm²', '55000', '1', '5'), PEGANTE] },

  { capitulo: 'CARPINTERÍA Y VENTANERÍA', nombre: 'Puertas en madera', unidad: 'Und', cantidad: '75', rendimiento: '4', cuadrillas: 1, cuadrilla: 'oficialAyudante',
    insumos: [material('Puerta en madera con marco y cerradura', 'Und', '780000', '1')] },
  { capitulo: 'CARPINTERÍA Y VENTANERÍA', nombre: 'Ventanería en aluminio (subcontrato a todo costo)', unidad: 'm²', cantidad: '420', duracionManual: '15',
    insumos: [todoCosto('Ventanería en aluminio, a todo costo', 'm²', '420000')] },

  { capitulo: 'ASEO Y ENTREGA', nombre: 'Aseo general', unidad: 'm²', cantidad: '2400', rendimiento: '150', cuadrillas: 1, cuadrilla: 'dosAyudantes',
    insumos: [material('Materiales de aseo', 'm²', '1500', '1')] },

  { capitulo: 'COSTOS INDIRECTOS', nombre: 'Director de obra', unidad: 'Ms', cantidad: '9',
    insumos: [{ recurso: 'Director de obra, salario y prestaciones', tipo: 'PERSONAL', unidad: 'Ms', precio: '7500000', iva: '0', cantidad: '1' }] },
  { capitulo: 'COSTOS INDIRECTOS', nombre: 'Topografía de control', unidad: 'Glb', cantidad: '1', duracionManual: '3',
    insumos: [todoCosto('Topografía de control, a todo costo', 'Glb', '6500000')] },
];

// --- El cronograma ---------------------------------------------------------------------------

const H_INICIO = 'Inicio del proyecto';
const H_FIN = 'Fin del proyecto';
const ENTREGA_CIMENTACION = 'Entrega de cimentación';
const LICENCIA = 'Licencia de construcción';
const FABRICACION_VENTANERIA = 'Fabricación de ventanería';
const CURADO_CUBIERTA = 'Curado de losa de cubierta';

/** [predecesoras, sucesoras, tipo, desfase en días]: la tabla de la bitácora del producto, con los ítems por su nombre. */
const RELACIONES: [string[], string[], 'FC' | 'CC' | 'FF' | 'CF', string][] = [
  [[H_INICIO], ['Localización y replanteo', 'Cerramiento provisional en lámina', 'Campamento y bodega', LICENCIA], 'FC', '0'],
  [['Localización y replanteo'], ['Descapote y limpieza'], 'CC', '1'],
  [['Descapote y limpieza'], ['Excavación mecánica'], 'FC', '0'],
  [[LICENCIA], ['Excavación mecánica'], 'FC', '0'],
  [['Excavación mecánica'], ['Concreto de limpieza e = 5 cm'], 'CC', '3'],
  [['Concreto de limpieza e = 5 cm'], ['Acero de refuerzo de cimentación'], 'CC', '2'],
  [['Acero de refuerzo de cimentación'], ['Concreto 3000 psi de zapatas y vigas'], 'CC', '3'],
  [['Concreto 3000 psi de zapatas y vigas'], ['Relleno compactado'], 'FC', '0'],
  [['Relleno compactado'], [ENTREGA_CIMENTACION], 'FC', '0'],
  [['Concreto 3000 psi de zapatas y vigas'], ['Columnas en concreto 4000 psi'], 'FC', '0'],
  [['Columnas en concreto 4000 psi'], ['Losa aligerada de entrepiso e = 0,40'], 'CC', '5'],
  [['Columnas en concreto 4000 psi'], ['Acero de refuerzo de estructura'], 'CC', '0'],
  [['Acero de refuerzo de estructura'], ['Losa aligerada de entrepiso e = 0,40'], 'FF', '0'],
  [['Losa aligerada de entrepiso e = 0,40'], ['Escaleras en concreto'], 'CC', '10'],
  [['Losa aligerada de entrepiso e = 0,40'], ['Losa de cubierta'], 'FC', '0'],
  [['Losa de cubierta'], [CURADO_CUBIERTA], 'FC', '0'],
  [['Losa de cubierta'], [FABRICACION_VENTANERIA], 'CC', '0'],
  [[FABRICACION_VENTANERIA], ['Ventanería en aluminio (subcontrato a todo costo)'], 'FC', '0'],
  [['Losa aligerada de entrepiso e = 0,40'], ['Muro en bloque #5'], 'CC', '15'],
  [['Muro en bloque #5'], ['Dinteles y columnetas'], 'CC', '5'],
  [['Muro en bloque #5'], ['Red de suministro en PVC presión', 'Salidas eléctricas'], 'CC', '10'],
  [['Red de suministro en PVC presión'], ['Red sanitaria y de aguas lluvias'], 'CC', '0'],
  [['Salidas eléctricas'], ['Cableado'], 'CC', '5'],
  [['Cableado'], ['Tablero general y acometida'], 'FC', '0'],
  [['Muro en bloque #5'], ['Pañete de muros interiores'], 'FC', '-20'],
  [['Pañete de muros interiores'], ['Estuco y pintura'], 'CC', '15'],
  [['Pañete de muros interiores'], ['Enchape de baños'], 'CC', '10'],
  [['Enchape de baños'], ['Aparatos sanitarios'], 'FC', '0'],
  [['Pañete de muros interiores'], ['Afinado de piso'], 'CC', '10'],
  [['Afinado de piso'], ['Piso cerámico'], 'CC', '5'],
  [['Piso cerámico'], ['Puertas en madera'], 'FC', '-10'],
  [[CURADO_CUBIERTA], ['Estuco y pintura'], 'FC', '0'],
  [['Localización y replanteo'], ['Topografía de control'], 'CC', '0'],
  [['Topografía de control'], ['Excavación mecánica'], 'FC', '0'],
  [[H_INICIO], ['Director de obra'], 'CC', '0'],
  [['Director de obra'], [H_FIN], 'FF', '0'],
  [['Estuco y pintura', 'Puertas en madera', 'Ventanería en aluminio (subcontrato a todo costo)', 'Aparatos sanitarios', 'Tablero general y acometida'], ['Aseo general'], 'FC', '0'],
  [['Aseo general'], [H_FIN], 'FC', '0'],
  // Las seis que quedaban sin sucesora (bitácora del producto, 21 de octubre): en
  // un proyecto bien armado solo el hito de fin queda suelto.
  [['Cerramiento provisional en lámina', 'Campamento y bodega'], ['Excavación mecánica'], 'FC', '0'],
  [[ENTREGA_CIMENTACION, 'Escaleras en concreto', 'Red sanitaria y de aguas lluvias'], ['Afinado de piso'], 'FC', '0'],
  [['Dinteles y columnetas'], ['Pañete de muros interiores'], 'FC', '0'],
];

const SEMANA_LUNES_A_SABADO: Tramo[][] = [
  ...Array.from({ length: 5 }, () => [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '16:00' }]),
  [{ inicio: '07:00', fin: '12:00' }],
  [],
];

/** "201.5" → "202": medio día o más sube. Sobre el texto, sin pasar por Number. */
function diasEnteros(dias: string): string {
  const [entera, decimal = '0'] = dias.split('.');
  return String(BigInt(entera!) + (decimal[0]! >= '5' ? 1n : 0n));
}

// --- El guion --------------------------------------------------------------------------------

export async function sembrarCronogramaDemostracion(contexto: ContextoTenant, pedir: Pedir): Promise<ResumenDemoCronograma> {
  if ((await listarPresupuestos(contexto)).some((p) => p.codigo === CODIGO_DEMO_CRONOGRAMA)) {
    throw new Error(
      `${CODIGO_DEMO_CRONOGRAMA} ya existe en la empresa de demostración. El guion no lo duplica ni lo modifica: ` +
        'si hace falta sembrarlo de nuevo, se recrea la base.',
    );
  }

  const unidades = new Map<string, string>();
  const unidad = async (simbolo: string): Promise<string> => {
    if (!unidades.has(simbolo)) {
      const id = await ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
        const { rows } = await cliente.query<{ id: string }>('SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = $2', [contexto.tenantId, simbolo]);
        return rows[0]?.id;
      });
      if (!id) throw new Error(`La empresa no tiene la unidad «${simbolo}». El guion usa las unidades con que nace toda empresa.`);
      unidades.set(simbolo, id);
    }
    return unidades.get(simbolo)!;
  };

  // No hay dos recursos ni dos APU con el mismo nombre en una empresa: los que
  // ya existen (de DEMO-001, o de una corrida que falló a medias) se reutilizan.
  const recurso = async (i: Insumo): Promise<Recurso> => {
    const existente = (await listarRecursos(contexto, { texto: i.recurso })).find((r) => r.nombre.toLowerCase() === i.recurso.toLowerCase());
    if (existente) return existente;
    const conIva = (BigInt(i.precio) * (100n + BigInt(i.iva))) / 100n;
    return crearRecurso(contexto, {
      nombre: i.recurso, tipo: i.tipo, unidadId: await unidad(i.unidad), precioBase: i.precio, ivaPct: i.iva, precioTotal: String(conIva), viaCaptura: 'BASE',
    });
  };
  const apu = async (item: Item): Promise<Apu> => {
    const existente = (await listarApus(contexto, { texto: item.nombre })).find((a) => a.nombre.toLowerCase() === item.nombre.toLowerCase());
    if (existente) return (await leerApu(contexto, existente.id))!;
    const lineas: LineaApu[] = [];
    if (item.cuadrilla && item.rendimiento) {
      const c = CUADRILLA[item.cuadrilla];
      const mano = await recurso({ recurso: c.recurso, tipo: 'PERSONAL', unidad: 'Jr', precio: c.precio, iva: '0', cantidad: '1' });
      // Jornales por unidad: el inverso del rendimiento, con seis decimales (el mínimo de la base es 0,000001).
      lineas.push({ recursoId: mano.id, cantidad: '1', rendimiento: (1 / Number(item.rendimiento)).toFixed(6), desperdicioPct: '0' });
    }
    for (const i of item.insumos) lineas.push({ recursoId: (await recurso(i)).id, cantidad: i.cantidad, rendimiento: '1', desperdicioPct: i.desperdicio ?? '0' });
    return crearApu(contexto, { nombre: item.nombre, unidadId: await unidad(item.unidad), rendimientoActividad: item.rendimiento ?? null, lineas });
  };

  // --- El presupuesto, por EDT, y activado.
  const presupuesto = await crearPresupuesto(contexto, {
    codigo: CODIGO_DEMO_CRONOGRAMA,
    nombre: 'Edificio Mirador del Valle, 5 pisos',
    ubicacion: 'Envigado, Antioquia',
    modoEstructura: 'WBS',
  });
  const capitulos = new Map<string, string>();
  for (const c of CAPITULOS) capitulos.set(c.nombre, (await agregarCapitulo(contexto, presupuesto.id, c)).id);
  for (const item of ITEMS) await agregarActividad(contexto, capitulos.get(item.capitulo)!, (await apu(item)).id, item.cantidad);
  await editarPorcentajes(contexto, presupuesto.id, { aiuAdministracion: '10', aiuImprevistos: '5', aiuUtilidad: '5', ivaUtilidadPct: '19' });
  await activarPresupuesto(contexto, presupuesto.id);

  // --- El calendario de la empresa, con los festivos de Colombia.
  const nombreCalendario = 'Lunes a sábado medio día';
  let calendarioId = (await listarCalendarios(contexto, 'CONFIG.PREFERENCIAS')).find((c) => c.nombre === nombreCalendario)?.id;
  if (!calendarioId) {
    calendarioId = (await crearCalendario(contexto, { nombre: nombreCalendario, horasPorDia: '8', semana: SEMANA_LUNES_A_SABADO })).id;
    const colombia = (await listarFestivos(contexto, 'CONFIG.PREFERENCIAS')).plataforma.find((l) => l.pais === 'CO');
    if (!colombia) throw new Error('La plataforma no tiene la lista de festivos de Colombia: sin ella, el calendario no tendría festivos.');
    await copiarFestivos(contexto, calendarioId, colombia.id, false);
  }

  // --- El cronograma, por la API: cada escritura lleva la versión que devolvió la anterior.
  let vista = await pedir('POST', `/api/presupuestos/${presupuesto.id}/cronograma`, { fechaInicio: '2026-11-03', calendarioId });
  const cronogramaId: string = vista.cronograma.id;
  const escribir = async (metodo: 'POST' | 'PATCH', ruta: string, cuerpo: Record<string, unknown>) => {
    vista = await pedir(metodo, `/api/cronogramas/${cronogramaId}${ruta}`, { version: vista.cronograma.version, ...cuerpo });
  };
  const actividad = (nombre: string): Record<string, any> => {
    const a = vista.actividades.find((x: { nombre: string }) => x.nombre === nombre);
    if (!a) throw new Error(`El cronograma no tiene la actividad «${nombre}».`);
    return a;
  };
  const editarActividad = (nombre: string, cambios: Record<string, unknown>) => escribir('PATCH', `/actividades/${actividad(nombre).id}`, cambios);
  const grupo = async (nombre: string): Promise<string> => {
    await escribir('POST', '/grupos', { nombre });
    return vista.grupos.find((g: { nombre: string }) => g.nombre === nombre).id;
  };

  for (const item of ITEMS) {
    if (item.cuadrillas && item.cuadrillas > 1) await editarActividad(item.nombre, { cuadrillas: item.cuadrillas });
    if (item.duracionManual) await editarActividad(item.nombre, { duracionManualDias: item.duracionManual });
  }
  // El director dura lo que el proyecto, y eso se sabe al final: mientras tanto, un día.
  await editarActividad('Director de obra', { duracionManualDias: '1' });

  await escribir('POST', '/actividades', { tipo: 'HITO_FIN', nombre: ENTREGA_CIMENTACION });
  const licencias = await grupo('Licencias y trámites');
  await escribir('POST', '/actividades', { tipo: 'SIN_COSTO', nombre: LICENCIA, duracionManualDias: '20', usaCorrido: true, grupoId: licencias });
  const suministros = await grupo('Suministros');
  await escribir('POST', '/actividades', { tipo: 'SIN_COSTO', nombre: FABRICACION_VENTANERIA, duracionManualDias: '30', usaCorrido: true, grupoId: suministros });
  await escribir('POST', '/actividades', { tipo: 'SIN_COSTO', nombre: CURADO_CUBIERTA, duracionManualDias: '14', usaCorrido: true });
  await editarActividad(H_FIN, { restriccion: { tipo: 'FIN_ANTES', fecha: '2027-09-30' } });

  for (const [predecesoras, sucesoras, tipo, desfaseDias] of RELACIONES) {
    for (const p of predecesoras) {
      for (const s of sucesoras) {
        await escribir('POST', '/dependencias', { predecesoraId: actividad(p).id, sucesoraId: actividad(s).id, tipo, desfaseDias });
      }
    }
  }

  const directorDias = diasEnteros(vista.cronograma.duracionDias);
  await editarActividad('Director de obra', { duracionManualDias: directorDias });

  // --- La línea base «Contrato», y una desviación contra ella.
  const lineaBase = await pedir('POST', `/api/cronogramas/${cronogramaId}/lineas-base`, { version: vista.cronograma.version, nombre: 'Contrato' });
  const lineaBaseId: string = lineaBase.lineaBase.id;
  vista = await pedir('PATCH', `/api/cronogramas/${cronogramaId}/actividades/${actividad('Muro en bloque #5').id}?lineaBase=${lineaBaseId}`, {
    version: vista.cronograma.version,
    cuadrillas: 3,
  });

  const valorTotal = (await listarPresupuestos(contexto)).find((p) => p.id === presupuesto.id)!.valorTotal;
  const aviso = vista.avisos.administracion;
  return {
    presupuestoId: presupuesto.id,
    cronogramaId,
    valorTotal,
    inicio: vista.cronograma.inicio,
    fin: vista.cronograma.fin,
    duracionDias: vista.cronograma.duracionDias,
    directorDias,
    holguraDelFin: actividad(H_FIN).holguraTotalDias,
    lineaBaseId,
    aviso: aviso ? { finLineaBase: aviso.finLineaBase, finActual: aviso.finActual, diasDeMas: aviso.diasDeMas } : null,
  };
}
