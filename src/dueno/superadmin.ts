/**
 * Da de alta un superadministrador del panel (CONTRATO §12.1), o le cambia la
 * contraseña.
 *
 *     npm run superadmin -- correo@dominio "Nombre Apellido"
 *     npm run superadmin -- correo@dominio --cambiar-clave
 *
 * Lo corre el dueño de ConstruSoft, contra la base que diga su .env (las
 * variables SUPERADMIN_DB_*). La contraseña se pide DOS veces en la terminal,
 * sin mostrarla, y a la base solo llega su hash argon2id: ni el comando ni la
 * base la guardan en claro, y nunca pasa por un argumento, que quedaría en el
 * historial de la terminal (regla 8 del CLAUDE.md).
 */
import { hashearContrasena } from '../http/contrasenas.js';
import { altaSuperadmin, cambiarClaveSuperadmin } from '../infraestructura/basedatos/plataforma.js';

const MINIMO = 8;

/** Lee una línea de la terminal sin mostrar lo que se escribe. Ctrl+C cancela. */
function pedirOculta(pregunta: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const entrada = process.stdin;
    process.stdout.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let texto = '';
    const alTeclear = (trozo: string) => {
      for (const caracter of trozo) {
        if (caracter === '\r' || caracter === '\n') {
          terminar();
          process.stdout.write('\n');
          resolver(texto);
          return;
        }
        if (caracter === '\u0003') {
          terminar();
          process.stdout.write('\n');
          rechazar(new Error('Cancelado: no se cambió nada.'));
          return;
        }
        if (caracter === '\u007f' || caracter === '\b') texto = texto.slice(0, -1);
        else texto += caracter;
      }
    };
    const terminar = () => {
      entrada.off('data', alTeclear);
      entrada.setRawMode(false);
      entrada.pause();
    };
    entrada.on('data', alTeclear);
  });
}

const [correo, segundo] = process.argv.slice(2).map((a) => a.trim());
const cambiarClave = segundo === '--cambiar-clave';
if (!correo || !segundo) {
  console.error(
    'Uso:\n' +
      '  npm run superadmin -- correo@dominio "Nombre Apellido"   da de alta un superadministrador\n' +
      '  npm run superadmin -- correo@dominio --cambiar-clave     le pone una contraseña nueva',
  );
  process.exit(1);
}
// Un «--cambiar-clave.» o un «--cambiar» mal escritos no son un nombre: si
// se tomaran como tal, el comando intentaría dar de alta a quien ya existe.
if (segundo.startsWith('-') && !cambiarClave) {
  console.error(`«${segundo}» no es una opción. La única es --cambiar-clave, escrita así, sin nada más.`);
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Este comando pide la contraseña en la terminal, sin mostrarla: córralo en una terminal interactiva.');
  process.exit(1);
}

try {
  const contrasena = await pedirOculta('Contraseña (no se muestra): ');
  if (contrasena.length < MINIMO) throw new Error(`La contraseña necesita al menos ${MINIMO} caracteres. No se cambió nada.`);
  if ((await pedirOculta('Repítala: ')) !== contrasena) throw new Error('Las dos contraseñas no coinciden. No se cambió nada.');
  const hash = await hashearContrasena(contrasena);
  if (cambiarClave) {
    await cambiarClaveSuperadmin(correo, hash);
    console.log(`→ Contraseña cambiada para ${correo}. Sus sesiones abiertas en el panel quedaron cerradas.`);
  } else {
    await altaSuperadmin(correo, segundo, hash);
    console.log(`→ Superadministrador creado: ${segundo} <${correo}>. Ingresa en /superadmin/.`);
  }
  process.exit(0);
} catch (error) {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(mensaje);
  if (/^Ya existe un superadministrador/.test(mensaje)) {
    console.error(`Para ponerle otra contraseña:  npm run superadmin -- ${correo} --cambiar-clave`);
  }
  process.exit(1);
}
