/**
 * Lee una variable de entorno obligatoria. No importa `pg`, así que queda
 * afuera de la regla de ESLint que restringe quién puede importarlo
 * (eslint.config.js) — la comparten contextoTenant.ts y autenticacion.ts,
 * que sí lo importan.
 */
export function leerEnvObligatoria(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Copiá .env.example a .env ` +
        '(y .env.test para las pruebas) y completá las credenciales antes ' +
        'de continuar.',
    );
  }
  return valor;
}
