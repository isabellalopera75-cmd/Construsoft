import { registrarEmpresa, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { crearPresupuesto, editarPorcentajes } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo, agregarSubcapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';

/*
 * Una empresa de demostración lista para mostrarle a un cliente (rebanada
 * 6.4): el presupuesto de referencia del 06 §8 —Casa campestre El Retiro,
 * $180.590.155— activado y con su versión 1, para enseñar la línea base y la
 * exportación; y una bodega por EDT, abierta, con subcapítulos, para enseñar
 * la mesa de trabajo.
 *
 * Todo se arma con los mismos módulos que usa la aplicación, sin una fila
 * escrita a mano: si una regla de la base cambia, el guion falla en vez de
 * sembrar datos que la aplicación no podría haber producido.
 *
 * No inventa credenciales (CLAUDE.md, regla 8): el correo y el hash de la
 * contraseña los recibe de quien lo llama.
 */

export const NIT_DEMOSTRACION = '900999999-1';

export interface DatosDemostracion {
  correo: string;
  /** Argon2id, ya calculado: este módulo nunca ve la contraseña. */
  hashContrasena: string;
  versionTerminos: string;
}

export async function sembrarDemostracion(datos: DatosDemostracion): Promise<ContextoTenant> {
  let empresa;
  try {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora Demostración SAS',
      nit: NIT_DEMOSTRACION,
      plan: 'EMPRESARIAL',
      adminNombre: 'Usuario de demostración',
      adminEmail: datos.correo,
      adminHash: datos.hashContrasena,
      versionTerminos: datos.versionTerminos,
    });
  } catch (error) {
    if ((error as { constraint?: string }).constraint === 'ux_tenant_nit') {
      throw new Error(
        `La empresa de demostración ya existe (NIT ${NIT_DEMOSTRACION}). El guion no la duplica ni la modifica: ` +
          'si hace falta sembrarla de nuevo, se recrea la base.',
      );
    }
    throw error;
  }
  const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };

  // El presupuesto de referencia, activado: su versión 1 es la línea base.
  const referencia = await armarPresupuestoDeReferencia(contexto, 'DEMO-001');
  await activarPresupuesto(contexto, referencia.presupuestoId);

  // Una bodega por EDT, abierta, con los APU que ya existen en la empresa.
  const apu = (descripcion: string) => referencia.actividades[descripcion]!.apuId;
  const bodega = await crearPresupuesto(contexto, {
    codigo: 'DEMO-002',
    nombre: 'Bodega industrial Rionegro',
    ubicacion: 'Rionegro, Antioquia',
    modoEstructura: 'WBS',
  });
  const preliminares = await agregarCapitulo(contexto, bodega.id, { nombre: 'PRELIMINARES', clasificacion: 'INDIRECTO' });
  await agregarActividad(contexto, preliminares.id, apu('Topografía y replanteo'), '1');
  await agregarActividad(contexto, preliminares.id, apu('Director de obra'), '4');

  const estructura = await agregarCapitulo(contexto, bodega.id, { nombre: 'ESTRUCTURA', clasificacion: 'DIRECTO' });
  const cimentacion = await agregarSubcapitulo(contexto, estructura.id, { nombre: 'Cimentación' });
  await agregarActividad(contexto, cimentacion.id, apu('Excavación manual'), '240');
  await agregarActividad(contexto, cimentacion.id, referencia.concreto.id, '180');
  const columnas = await agregarSubcapitulo(contexto, estructura.id, { nombre: 'Columnas' });
  await agregarActividad(contexto, columnas.id, apu('Acero de refuerzo 60.000 PSI'), '6200');
  await agregarActividad(contexto, columnas.id, apu('Formaleta metálica'), '520');

  await editarPorcentajes(contexto, bodega.id, {
    aiuAdministracion: '10',
    aiuImprevistos: '5',
    aiuUtilidad: '5',
    ivaUtilidadPct: '19',
  });

  return contexto;
}
