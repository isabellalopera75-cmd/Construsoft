/**
 * Aplica a la base del .env las migraciones que le falten (D-77, CONTRATO §18.1).
 *
 *     npm run migrar
 *
 * Antes de aplicar nada compara la huella de las ya aplicadas contra su
 * archivo y SE DETIENE si alguna cambió: una migración publicada no se edita,
 * se escribe otra. Después aplica las que falten, en orden, cada una con
 * psql —usan \set, que es de psql— y anota su huella.
 *
 * Aplicar migraciones lo exige la base al superusuario, como cargar el
 * esquema. Lee del .env, que escribe el dueño:
 *
 *   APP_DB_HOST, APP_DB_PORT, APP_DB_NAME     la base, la misma de la aplicación
 *   MIGRACION_DB_USER, MIGRACION_DB_PASSWORD  el superusuario que migra
 *
 * La contraseña le llega a psql por PGPASSWORD, nunca por un argumento, que
 * quedaría a la vista en la lista de procesos. Todo va por psql, también leer
 * y anotar las huellas: así este comando no abre una conexión de pg aparte de
 * las tres autorizadas (eslint.config.js).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerEnvObligatoria } from '../infraestructura/basedatos/env.js';
import { huella, leerNombreDeArchivo, planDeMigracion, type ArchivoDeMigracion, type MigracionAplicada } from './migraciones.js';

const CARPETA = fileURLToPath(new URL('../../docs/migraciones/', import.meta.url));

const destino = {
  host: leerEnvObligatoria('APP_DB_HOST'),
  port: leerEnvObligatoria('APP_DB_PORT'),
  database: leerEnvObligatoria('APP_DB_NAME'),
  user: leerEnvObligatoria('MIGRACION_DB_USER'),
  password: leerEnvObligatoria('MIGRACION_DB_PASSWORD'),
};

/**
 * Corre psql contra el destino y devuelve lo que imprime. Con `entrada`, el
 * SQL va por stdin: así psql reemplaza las variables (-v), citándolas él
 * —:'sha'—, en vez de armar el texto a mano.
 */
function psql(argumentos: string[], entrada?: string, variables: Record<string, string> = {}): string {
  const r = spawnSync(
    'psql',
    [
      '-v', 'ON_ERROR_STOP=1', '-q', '-At',
      '-h', destino.host, '-p', destino.port, '-U', destino.user, '-d', destino.database,
      ...Object.entries(variables).flatMap(([k, v]) => ['-v', `${k}=${v}`]),
      ...argumentos,
    ],
    {
      env: { ...process.env, PGPASSWORD: destino.password, PGCLIENTENCODING: 'UTF8' },
      encoding: 'utf8',
      ...(entrada === undefined ? {} : { input: entrada }),
    },
  );
  if (r.error) throw new Error(`No se pudo correr psql (${r.error.message}). ¿Está en el PATH?`);
  if (r.status !== 0) throw new Error(r.stderr.trim() || 'psql falló sin decir por qué.');
  return r.stdout;
}

function leerAplicadas(): MigracionAplicada[] {
  try {
    return psql(['-c', "SELECT numero || '|' || coalesce(sha256, '') FROM plataforma.migracion ORDER BY numero"])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((linea) => {
        const [numero, sha] = linea.split('|');
        return { numero: Number(numero), sha256: sha ? sha : null };
      });
  } catch (error) {
    if (/plataforma\.migracion/.test((error as Error).message)) {
      throw new Error('Esta base es anterior a las migraciones (no tiene plataforma.migracion): hay que recargarla una vez desde el 05.');
    }
    throw error;
  }
}

function anotarHuella(m: ArchivoDeMigracion): void {
  psql(['-f', '-'], "UPDATE plataforma.migracion SET sha256 = :'sha' WHERE numero = :numero;\n", {
    sha: m.huella,
    numero: String(m.numero),
  });
}

function archivos(): ArchivoDeMigracion[] {
  return readdirSync(CARPETA).flatMap((nombreDeArchivo) => {
    const leido = leerNombreDeArchivo(nombreDeArchivo);
    if (!leido) return [];
    const ruta = join(CARPETA, nombreDeArchivo);
    return [{ ...leido, ruta, huella: huella(readFileSync(ruta, 'utf8')) }];
  });
}

const etiqueta = (m: ArchivoDeMigracion) => `${String(m.numero).padStart(4, '0')}-${m.nombre}`;

try {
  const plan = planDeMigracion(leerAplicadas(), archivos());

  if (plan.faltanArchivos.length > 0) {
    throw new Error(
      `La base tiene aplicadas migraciones que no están en docs/migraciones: ${plan.faltanArchivos.join(', ')}. ` +
        'Actualice el repositorio antes de migrar. No se aplicó nada.',
    );
  }
  if (plan.cambiadas.length > 0) {
    throw new Error(
      `Estas migraciones ya aplicadas cambiaron desde que se aplicaron: ${plan.cambiadas.map(etiqueta).join(', ')}. ` +
        'Una migración publicada no se edita: devuelva el archivo a como estaba y escriba una migración nueva. No se aplicó nada.',
    );
  }
  for (const m of plan.sinHuella) {
    anotarHuella(m);
    console.log(`→ ${etiqueta(m)}: ya estaba aplicada sin huella; se anotó la del archivo.`);
  }
  for (const m of plan.aplicar) {
    // Cada migración es una sola transacción: si psql falla, no queda a medias.
    psql(['-f', m.ruta]);
    anotarHuella(m);
    console.log(`→ ${etiqueta(m)}: aplicada.`);
  }
  console.log(plan.aplicar.length === 0 ? '→ Nada que aplicar: la base está al día.' : `→ Listo: ${plan.aplicar.length} aplicada(s).`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
