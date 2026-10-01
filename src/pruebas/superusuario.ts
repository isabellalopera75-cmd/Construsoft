import pg from 'pg';

/**
 * Una conexión de SUPERUSUARIO para preparar escenarios que ninguna conexión
 * legítima puede fabricar: vencer una suscripción, suspender un inquilino.
 * Solo para las pruebas, y solo contra la base de PRUEBAS: se niega a abrir
 * si la base no termina en «_test», para que un .env.test mal escrito no
 * termine moviendo fechas en la base de desarrollo.
 *
 * No es una puerta de la aplicación: vive en src/pruebas, la aplicación no la
 * importa, y lo que prueba sigue pasando por app_login y auth_login.
 */
export async function comoSuperusuario<T>(operacion: (cliente: pg.PoolClient) => Promise<T>): Promise<T> {
  const base = process.env.TEST_SUPERUSER_DB ?? '';
  if (!base.endsWith('_test')) {
    throw new Error(
      `comoSuperusuario se niega a abrir: la base «${base}» no es de pruebas (tiene que terminar en _test).`,
    );
  }
  const pool = new pg.Pool({
    host: process.env.TEST_SUPERUSER_HOST,
    port: Number(process.env.TEST_SUPERUSER_PORT ?? 5432),
    database: base,
    user: process.env.TEST_SUPERUSER_USER,
    password: process.env.TEST_SUPERUSER_PASSWORD,
    max: 1,
  });
  const cliente = await pool.connect();
  try {
    return await operacion(cliente);
  } finally {
    cliente.release();
    await pool.end();
  }
}

/** Deja vencida desde ayer la suscripción del inquilino. */
export async function vencerSuscripcion(tenantId: string): Promise<void> {
  await comoSuperusuario((cliente) =>
    cliente.query(
      `UPDATE plataforma.suscripcion
          SET fecha_inicio = current_date - 40, fecha_vencimiento = current_date - 1
        WHERE tenant_id = $1`,
      [tenantId],
    ),
  );
}
