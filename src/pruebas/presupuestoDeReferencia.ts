import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { crearRecurso, listarRecursos, type DatosRecurso, type Recurso } from '../infraestructura/basedatos/recurso.js';
import { crearApu, type Apu } from '../infraestructura/basedatos/apu.js';
import { crearPresupuesto, editarPorcentajes } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad, type Actividad } from '../infraestructura/basedatos/actividad.js';

/**
 * El presupuesto de referencia del documento 06 §8 —Casa campestre El
 * Retiro—, armado desde cero con los módulos de la mesa de trabajo, sin una
 * sola fila escrita a mano. Cierra en $180.590.155. Lo usan los cierres de
 * fase: es la cifra que atraviesa todas las fórmulas a la vez.
 *
 * Solo el concreto tiene composición documentada (06 §8.2) y se arma con
 * ella: es el que ejercita D-1 (precio con IVA, desperdicio, cantidad ×
 * rendimiento). Para las demás actividades el documento da el valor y la
 * cantidad; su APU es un solo recurso cuyo precio es el precio unitario que
 * resulta.
 */
export interface PresupuestoDeReferencia {
  presupuestoId: string;
  /** Los dos recursos documentados en 06 §8.1: los únicos que componen el APU del concreto. */
  premezclado: Recurso;
  oficial: Recurso;
  concreto: Apu;
  /** Por descripción, en el orden de la oferta: «Topografía y replanteo», «Excavación manual»… */
  actividades: Record<string, Actividad>;
}

export async function armarPresupuestoDeReferencia(
  contexto: ContextoTenant,
  codigo: string,
): Promise<PresupuestoDeReferencia> {
  const unidad = async (simbolo: string): Promise<string> =>
    ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        'SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = $2',
        [contexto.tenantId, simbolo],
      );
      return rows[0]!.id;
    });

  // No hay dos recursos con el mismo nombre en una empresa (decisión del
  // dueño, 7 de octubre de 2026). Armar la referencia dos veces en la misma
  // empresa reutiliza los recursos que ya creó la primera.
  const recurso = async (datos: DatosRecurso): Promise<Recurso> => {
    const existente = (await listarRecursos(contexto, { texto: datos.nombre })).find(
      (r) => r.nombre.toLowerCase() === datos.nombre.toLowerCase(),
    );
    return existente ?? crearRecurso(contexto, datos);
  };

  const recursoSinIva = async (nombre: string, simbolo: string, precio: string): Promise<Recurso> =>
    recurso({
      nombre,
      tipo: 'PERSONAL',
      unidadId: await unidad(simbolo),
      precioBase: precio,
      ivaPct: '0',
      precioTotal: precio,
      viaCaptura: 'BASE',
    });

  const apuDePrecio = async (nombre: string, simbolo: string, precio: string): Promise<Apu> => {
    const recurso = await recursoSinIva(`Recurso · ${nombre}`, simbolo, precio);
    return crearApu(contexto, {
      nombre,
      unidadId: await unidad(simbolo),
      lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });
  };

  // 06 §8.1 · Los dos recursos documentados.
  const premezclado = await recurso({
    nombre: 'Concreto premezclado 3000 PSI',
    tipo: 'MATERIAL',
    unidadId: await unidad('m³'),
    precioBase: '500000',
    ivaPct: '19',
    precioTotal: '595000',
    viaCaptura: 'BASE',
  });
  const oficial = await recursoSinIva('Oficial de obra', 'Jr', '120000');

  // 06 §8.2 · 1 × 1,00 × 1,05 × 595.000 + 2 × 0,05 × 1 × 120.000 = 636.750.
  const concreto = await crearApu(contexto, {
    nombre: 'Concreto 3000 PSI para zapatas',
    unidadId: await unidad('m³'),
    lineas: [
      { recursoId: premezclado.id, cantidad: '1', rendimiento: '1', desperdicioPct: '5' },
      { recursoId: oficial.id, cantidad: '2', rendimiento: '0.05', desperdicioPct: '0' },
    ],
  });

  const topografia = await apuDePrecio('Topografía y replanteo', 'Glb', '3200000');
  const suelos = await apuDePrecio('Estudio de suelos', 'Glb', '4800000');
  const director = await apuDePrecio('Director de obra', 'Ms', '7500000');
  const excavacion = await apuDePrecio('Excavación manual', 'm³', '38500');
  const acero = await apuDePrecio('Acero de refuerzo 60.000 PSI', 'Kg', '6850');
  const formaleta = await apuDePrecio('Formaleta metálica', 'm²', '18200');

  // 06 §8.3 · Por ítems: capítulo → actividad.
  const presupuesto = await crearPresupuesto(contexto, {
    codigo,
    nombre: 'Casa campestre El Retiro',
    ubicacion: 'El Retiro, Antioquia',
    modoEstructura: 'ITEMS',
  });
  const presupuestoId = presupuesto.id;
  const actividades: Record<string, Actividad> = {};
  const agregar = async (capituloId: string, apu: Apu, cantidad: string) => {
    actividades[apu.nombre] = await agregarActividad(contexto, capituloId, apu.id, cantidad);
  };

  const preliminares = await agregarCapitulo(contexto, presupuestoId, {
    nombre: 'PRELIMINARES',
    clasificacion: 'INDIRECTO',
  });
  await agregar(preliminares.id, topografia, '1');
  await agregar(preliminares.id, suelos, '1');
  await agregar(preliminares.id, director, '6');

  const cimentacion = await agregarCapitulo(contexto, presupuestoId, { nombre: 'CIMENTACIÓN', clasificacion: 'DIRECTO' });
  await agregar(cimentacion.id, excavacion, '120');
  await agregar(cimentacion.id, concreto, '100');

  const estructura = await agregarCapitulo(contexto, presupuestoId, { nombre: 'ESTRUCTURA', clasificacion: 'DIRECTO' });
  await agregar(estructura.id, acero, '4500');
  await agregar(estructura.id, formaleta, '350');

  // 06 §8.4 · AIU 10/5/5 e IVA 19 % sobre la utilidad.
  await editarPorcentajes(contexto, presupuestoId, {
    aiuAdministracion: '10',
    aiuImprevistos: '5',
    aiuUtilidad: '5',
    ivaUtilidadPct: '19',
  });

  return { presupuestoId, premezclado, oficial, concreto, actividades };
}
