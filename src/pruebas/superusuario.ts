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
  await moverVencimiento(tenantId, -1);
}

/**
 * Pone el vencimiento de la suscripción a `dias` de hoy: negativo es vencida
 * hace tantos días. Como superusuario y sin SET ROLE, el cambio no se firma
 * (D-72): es la preparación del escenario, no una acción del panel.
 */
export async function moverVencimiento(tenantId: string, dias: number): Promise<void> {
  await comoSuperusuario((cliente) =>
    cliente.query(
      `UPDATE plataforma.suscripcion
          SET fecha_inicio = least(fecha_inicio, current_date + $2::int, current_date - 40),
              fecha_vencimiento = current_date + $2::int
        WHERE tenant_id = $1`,
      [tenantId, dias],
    ),
  );
}

/**
 * Deja la suscripción ACTIVA, como si hubiera pagado, vencida o por vencer a
 * `dias` de hoy. Los plazos de D-74 —dos días hábiles, 60 días suspendida—
 * solo corren para una ACTIVA; la prueba vencida sigue su regla de siempre.
 */
export async function activarYMoverVencimiento(tenantId: string, dias: number): Promise<void> {
  await comoSuperusuario((cliente) =>
    cliente.query(`UPDATE plataforma.suscripcion SET estado = 'ACTIVA' WHERE tenant_id = $1 AND estado = 'EN_PRUEBA'`, [tenantId]),
  );
  await moverVencimiento(tenantId, dias);
}

/** Corre hacia atrás la fecha en que se canceló: `dias` negativo es hace tantos días. */
export async function moverCancelacion(tenantId: string, dias: number): Promise<void> {
  await comoSuperusuario((cliente) =>
    cliente.query(
      `UPDATE plataforma.suscripcion SET cancelada_en = now() + make_interval(days => $2::int)
        WHERE tenant_id = $1 AND estado = 'CANCELADA'`,
      [tenantId, dias],
    ),
  );
}

/**
 * Corre la purga como el rol de la aplicación, para comprobar que NO puede:
 * es irreversible y solo la llama el panel (CONTRATO §15.5).
 */
export async function purgarComoLaAplicacion(): Promise<void> {
  await comoSuperusuario(async (cliente) => {
    await cliente.query('BEGIN');
    try {
      await cliente.query('SET LOCAL ROLE construsoft_app');
      await cliente.query('SELECT * FROM plataforma.fn_purgar_empresas()');
    } finally {
      await cliente.query('ROLLBACK');
    }
  });
}

/** Desactiva a un superadministrador: no hay ruta ni comando que lo haga todavía. */
export async function desactivarSuperadmin(email: string): Promise<void> {
  await comoSuperusuario((cliente) =>
    cliente.query('UPDATE plataforma.usuario_plataforma SET activo = false WHERE email = $1', [email]),
  );
}
