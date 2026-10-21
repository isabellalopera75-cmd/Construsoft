/**
 * Agrega DEMO-003, el edificio con su cronograma completo, a la empresa de
 * demostración que ya existe (la de npm run demo).
 *
 *     npm run demo-cronograma
 *
 * Lo corre el dueño, contra la base que diga su .env. Lee del entorno (las
 * escribe el dueño; ningún asistente):
 *
 *   DEMO_CORREO       el correo del usuario de la empresa de demostración.
 *   DEMO_CONTRASENA   su contraseña. El guion ingresa con ella, como lo haría
 *                     una persona; nunca la imprime.
 *   VERSION_TERMINOS  la versión de los términos publicados, como en npm run demo:
 *                     la API no arranca sin su carpeta en legal/.
 *
 * Además, las de las dos conexiones a la base (APP_DB_* y AUTH_DB_*).
 *
 * La API no escucha en ningún puerto: el guion le habla en el mismo proceso.
 * Por eso no usa SESSION_SECRET: la cookie se firma y se verifica aquí mismo,
 * con una clave al azar que vive en memoria y muere con el proceso, como en
 * las pruebas. Correrlo dos veces no duplica nada: la segunda se niega.
 */
import { randomBytes } from 'node:crypto';
import { redondear } from '../comun/formatoNumerico.js';
import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { leerDatosEmpresa } from '../infraestructura/basedatos/configuracionEmpresa.js';
import { NOMBRE_COOKIE } from '../http/sesion.js';
import { construirServidor } from '../http/servidor.js';
import { NIT_DEMOSTRACION } from './sembrarDemostracion.js';
import { CODIGO_DEMO_CRONOGRAMA, sembrarCronogramaDemostracion, type Pedir } from './sembrarCronogramaDemostracion.js';

function obligatoria(nombre: string, para: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}: ${para}.`);
    process.exit(1);
  }
  return valor;
}

const correo = obligatoria('DEMO_CORREO', 'el correo del usuario de la empresa de demostración');
const contrasena = obligatoria('DEMO_CONTRASENA', 'la contraseña de ese usuario');
const versionTerminos = obligatoria('VERSION_TERMINOS', 'la versión de los términos publicados');

const app = await construirServidor({ secretoSesion: randomBytes(32).toString('hex'), versionTerminos });
try {
  const ingreso = await app.inject({ method: 'POST', url: '/api/sesion', remoteAddress: '127.0.0.1', payload: { email: correo, contrasena } });
  const sesion = ingreso.cookies.find((c) => c.name === NOMBRE_COOKIE)?.value;
  if (ingreso.statusCode !== 200 || !sesion) {
    throw new Error(`No se pudo ingresar con DEMO_CORREO y DEMO_CONTRASENA: ${ingreso.json<{ mensaje?: string }>().mensaje ?? ingreso.statusCode}`);
  }
  const usuario = (await autenticar(correo))!;
  const contexto = { tenantId: usuario.tenantId, usuarioId: usuario.usuarioId };
  // Un correo equivocado no siembra el edificio en la empresa de un cliente.
  if ((await leerDatosEmpresa(contexto)).nit !== NIT_DEMOSTRACION) {
    throw new Error(`${correo} no es de la empresa de demostración (NIT ${NIT_DEMOSTRACION}). Corra primero npm run demo, o revise DEMO_CORREO.`);
  }

  const pedir: Pedir = async (metodo, url, cuerpo) => {
    const r = await app.inject({
      method: metodo, url, remoteAddress: '127.0.0.1', headers: { cookie: `${NOMBRE_COOKIE}=${sesion}` }, ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
    });
    if (r.statusCode >= 300) throw new Error(`${metodo} ${url} respondió ${r.statusCode}: ${r.json<{ mensaje?: string }>().mensaje ?? r.body}`);
    return r.json<Record<string, any>>();
  };

  const r = await sembrarCronogramaDemostracion(contexto, pedir);
  console.log(`→ ${CODIGO_DEMO_CRONOGRAMA} Edificio Mirador del Valle sembrado en la empresa de demostración (activo).`);
  console.log(`  Valor total: $${redondear(r.valorTotal, 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`);
  console.log(`  Cronograma: del ${r.inicio.replace('T', ' ')} al ${r.fin.replace('T', ' ')}, ${r.duracionDias} días. Director de obra: ${r.directorDias} días.`);
  console.log(`  Holgura de H-002, que debe terminar en o antes del 30 de septiembre de 2027: ${r.holguraDelFin ?? '—'} días (negativa sería pasarse).`);
  if (r.aviso) console.log(`  Línea base «Contrato»: fin ${r.aviso.finLineaBase.replace('T', ' ')}; con el muro a 3 cuadrillas, ${r.aviso.diasDeMas} días de más.`);
  await app.close();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await app.close();
  process.exit(1);
}
