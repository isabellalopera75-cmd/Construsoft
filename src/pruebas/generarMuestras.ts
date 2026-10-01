/**
 * Genera las muestras de exportación para revisar el diseño a ojo, en
 * muestras/ (fuera del repositorio por .gitignore): el PDF y el Excel de las
 * versiones 1 y 3 del presupuesto de referencia (06 §8), y los del
 * presupuesto largo de las pruebas de paginación.
 *
 *     npm run muestras
 *
 * Corre contra la base de PRUEBAS (.env.test), nunca contra la de desarrollo:
 * registra una empresa de muestra con un correo único en cada corrida.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { registrarEmpresa } from '../infraestructura/basedatos/contextoTenant.js';
import { cambiarCantidad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto, reabrirPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { listarVersiones } from '../infraestructura/basedatos/versiones.js';
import { leerVersionParaExportar, type DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import { generarExcel } from '../exportacion/excel.js';
import { generarPdf } from '../exportacion/pdf.js';
import { armarPresupuestoDeReferencia } from './presupuestoDeReferencia.js';
import { presupuestoLargo } from './presupuestoLargo.js';

async function escribir(documento: DocumentoExportable, nombre: string): Promise<void> {
  writeFileSync(`muestras/${nombre}.pdf`, await generarPdf(documento, null));
  writeFileSync(`muestras/${nombre}.xlsx`, await generarExcel(documento, null));
  console.log(`→ muestras/${nombre}.pdf y .xlsx`);
}

mkdirSync('muestras', { recursive: true });

const empresa = await registrarEmpresa({
  razonSocial: 'Constructora El Retiro SAS',
  nit: `900${Date.now().toString().slice(-6)}-7`,
  plan: 'EMPRESARIAL',
  adminNombre: 'Ingeniera de muestras',
  adminEmail: `muestras.${Date.now()}@construsoft.test`,
  adminHash: 'hash_de_muestra_no_real',
  versionTerminos: 'terminos-de-prueba',
});
const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
const referencia = await armarPresupuestoDeReferencia(contexto, 'PRE-2026-001');
await activarPresupuesto(contexto, referencia.presupuestoId);
await reabrirPresupuesto(contexto, referencia.presupuestoId, 'El estudio de suelos pidió excavar diez metros cúbicos más');
await cambiarCantidad(contexto, referencia.actividades['Excavación manual']!.id, '130');
await activarPresupuesto(contexto, referencia.presupuestoId);

const versiones = await listarVersiones(contexto, referencia.presupuestoId);
for (const numero of [1, 3]) {
  const version = versiones.find((v) => v.numero === numero)!;
  await escribir((await leerVersionParaExportar(contexto, version.id))!, `PRE-2026-001 Casa campestre El Retiro - version ${numero}`);
}
await escribir(presupuestoLargo(), 'PRE-LARGO Presupuesto largo - 80 actividades');
process.exit(0);
