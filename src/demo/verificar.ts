/**
 * Comprueba la demostración de punta a punta, POR HTTP, contra la API en
 * marcha: ingresa con DEMO_CORREO y DEMO_CONTRASENA, busca DEMO-001 en la
 * vista maestra, lee su mesa y exige que el valor total sea el del 06 §8.
 *
 *     npm run api            (en otra ventana)
 *     npm run verificar-demo
 *
 * La cifra la lee la API, no SQL: si algo entre la base y la pantalla
 * estuviera roto —la sesión, el aislamiento, la mesa—, esto falla.
 *
 *   API_URL   opcional; por defecto http://127.0.0.1:<PUERTO o 3000>.
 */
const ESPERADO = '180590155.000000';
const base = process.env.API_URL?.trim() || `http://127.0.0.1:${process.env.PUERTO ?? 3000}`;

function falla(mensaje: string): never {
  console.error(`✗ ${mensaje}`);
  process.exit(1);
}

const correo = process.env.DEMO_CORREO?.trim() || falla('Falta DEMO_CORREO en el entorno.');
const contrasena = process.env.DEMO_CONTRASENA || falla('Falta DEMO_CONTRASENA en el entorno.');

async function pedir(ruta: string, opciones: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${base}${ruta}`, opciones);
  } catch {
    return falla(`La API no responde en ${base}. ¿Está corriendo npm run api?`);
  }
}

const ingreso = await pedir('/api/sesion', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: correo, contrasena }),
});
if (ingreso.status !== 200) falla(`El ingreso respondió ${ingreso.status}: ${await ingreso.text()}`);
const cookie = ingreso.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
console.log(`✓ Ingreso por HTTP como ${correo}`);

const lista = await pedir('/api/presupuestos', { headers: { cookie } });
const presupuestos = (await lista.json()) as { id: string; codigo: string; estado: string }[];
const referencia = presupuestos.find((p) => p.codigo === 'DEMO-001') ?? falla('La vista maestra no trae DEMO-001: ¿corrió npm run demo?');
console.log(`✓ Vista maestra: ${presupuestos.map((p) => `${p.codigo} (${p.estado})`).join(', ')}`);

const mesa = (await (await pedir(`/api/presupuestos/${referencia.id}/mesa`, { headers: { cookie } })).json()) as {
  actividades: unknown[];
  pie: { valorTotal: string };
};
if (mesa.pie.valorTotal !== ESPERADO) falla(`DEMO-001 cierra en ${mesa.pie.valorTotal}, y tiene que cerrar en ${ESPERADO}.`);
console.log(`✓ Mesa de DEMO-001: ${mesa.actividades.length} actividades, valor total ${mesa.pie.valorTotal}`);
console.log('✓ La demostración está lista.');
process.exit(0);
