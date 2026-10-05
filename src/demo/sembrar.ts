/**
 * Siembra la empresa de demostración.
 *
 *     npm run demo
 *
 * Lo corre el dueño, contra la base que diga su .env. Lee del entorno (las
 * escribe el dueño; ningún asistente):
 *
 *   DEMO_CORREO       el correo con que se ingresará a la empresa de demostración.
 *   DEMO_CONTRASENA   su contraseña, de al menos 8 caracteres. Se guarda solo
 *                     su hash Argon2id; nunca se imprime.
 *   VERSION_TERMINOS  la versión de los términos que la empresa acepta al nacer.
 *
 * Además, las de las dos conexiones a la base (APP_DB_* y AUTH_DB_*).
 * Correrlo dos veces no duplica nada: la segunda se niega.
 */
import { hashearContrasena } from '../http/contrasenas.js';
import { sembrarDemostracion } from './sembrarDemostracion.js';

function obligatoria(nombre: string, para: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}: ${para}.`);
    process.exit(1);
  }
  return valor;
}

const correo = obligatoria('DEMO_CORREO', 'el correo con que se ingresará a la demostración');
const contrasena = obligatoria('DEMO_CONTRASENA', 'la contraseña de la demostración, de al menos 8 caracteres');
const versionTerminos = obligatoria('VERSION_TERMINOS', 'la versión de los términos que acepta la empresa');
if (contrasena.length < 8) {
  console.error('DEMO_CONTRASENA necesita al menos 8 caracteres.');
  process.exit(1);
}

try {
  await sembrarDemostracion({ correo, hashContrasena: await hashearContrasena(contrasena), versionTerminos });
  console.log(`→ Empresa de demostración sembrada. Ingrese con ${correo}.`);
  console.log('  DEMO-001 Casa campestre El Retiro (activo, versión 1) · DEMO-002 Bodega industrial Rionegro (abierto)');
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
