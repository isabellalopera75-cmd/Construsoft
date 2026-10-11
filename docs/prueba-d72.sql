-- ============================================================================
--  PRUEBA DE D-72 · Las acciones firmadas del panel, el alta de
--  superadministradores, la fecha propuesta de un pago y la búsqueda sin tildes
--
--      psql -U postgres -d construsoft -f "docs/prueba-d72.sql"
--
--  Se juzga sola, como prueba-d65-d68 y prueba-d71: al final LEVANTA UNA
--  EXCEPCIÓN si algún caso discrepa. No deja nada: termina con ROLLBACK.
--  Necesita una base RECIÉN CARGADA: da de alta dos empresas con NIT fijo.
--
--  Se pone en la piel del panel con SET ROLE construsoft_superadmin, que es lo
--  que hereda la conexión superadmin_login.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d72 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT INSERT, SELECT ON resultado TO construsoft_app, construsoft_superadmin, construsoft_autenticador;

CREATE FUNCTION pg_temp.correr(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.correr(text) TO construsoft_app, construsoft_superadmin;

-- La firma se fija como lo haría el panel; vacía, es «sin firma».
CREATE FUNCTION pg_temp.firmar(p_autor text, p_motivo text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('plataforma.usuario_id', COALESCE(p_autor, ''), true),
           set_config('plataforma.motivo',     COALESCE(p_motivo, ''), true);
    SELECT NULL::void;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.firmar(text, text) TO construsoft_superadmin;

SELECT id_tenant AS t_a FROM app.fn_alta_tenant('Firma A SAS','901.772.001-1','EMPRESARIAL',
                                                'Ana Admin','ana@d72.co','hash_A') \gset
SELECT id AS s_a FROM plataforma.suscripcion WHERE tenant_id = :'t_a' \gset
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash)
VALUES ('Soporte', 'soporte@d72.co', '$argon2id$v=19$m=19456,t=2,p=1$x$y') RETURNING id AS sp \gset
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash, activo)
VALUES ('Antiguo', 'antiguo@d72.co', '$argon2id$v=19$m=19456,t=2,p=1$x$y', false) RETURNING id AS sp_inactivo \gset

SET ROLE construsoft_superadmin;

-- ============================================================================
--  Suspender y reactivar: firmados o nada
-- ============================================================================
SELECT pg_temp.firmar(NULL, NULL);
INSERT INTO resultado VALUES
  ('firma · suspender sin firma se rechaza',
   pg_temp.correr(format('UPDATE plataforma.tenant SET estado = %L WHERE id = %L', 'SUSPENDIDO', :'t_a')), 'P0001');

SELECT pg_temp.firmar(:'sp', NULL);
INSERT INTO resultado VALUES
  ('firma · con autor y sin motivo se rechaza',
   pg_temp.correr(format('UPDATE plataforma.tenant SET estado = %L WHERE id = %L', 'SUSPENDIDO', :'t_a')), 'P0001');

SELECT pg_temp.firmar(:'sp_inactivo', 'Prueba');
INSERT INTO resultado VALUES
  ('firma · un superadministrador inactivo no firma',
   pg_temp.correr(format('UPDATE plataforma.tenant SET estado = %L WHERE id = %L', 'SUSPENDIDO', :'t_a')), 'P0001');

SELECT pg_temp.firmar(gen_random_uuid()::text, 'Prueba');
INSERT INTO resultado VALUES
  ('firma · un autor que no existe no firma',
   pg_temp.correr(format('UPDATE plataforma.tenant SET estado = %L WHERE id = %L', 'SUSPENDIDO', :'t_a')), 'P0001');

SELECT pg_temp.firmar(:'sp', 'Solicitud del cliente');
INSERT INTO resultado VALUES
  ('firma · suspender firmado',
   pg_temp.correr(format('UPDATE plataforma.tenant SET estado = %L WHERE id = %L', 'SUSPENDIDO', :'t_a')), 'OK');
INSERT INTO resultado
SELECT 'firma · el evento lleva autor y motivo',
       (usuario_plataforma_id = :'sp' AND justificacion = 'Solicitud del cliente')::text, 'true'
  FROM plataforma.evento_plataforma
 WHERE tenant_id = :'t_a' AND tipo = 'TENANT_SUSPENDIDO';

SELECT pg_temp.firmar(:'sp', 'Fin de la revisión');
INSERT INTO resultado VALUES
  ('firma · reactivar firmado',
   pg_temp.correr(format('UPDATE plataforma.tenant SET estado = %L WHERE id = %L', 'ACTIVO', :'t_a')), 'OK');

-- ============================================================================
--  Plan, vencimiento y cancelación
-- ============================================================================
SELECT pg_temp.firmar(NULL, NULL);
INSERT INTO resultado VALUES
  ('firma · cambiar el vencimiento sin firma se rechaza',
   pg_temp.correr(format('UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date + 30 WHERE id = %L', :'s_a')), 'P0001'),
  ('firma · cambiar el plan sin firma se rechaza',
   pg_temp.correr(format('UPDATE plataforma.suscripcion SET plan_id = (SELECT id FROM plataforma.plan WHERE codigo = %L) WHERE id = %L', 'PERSONAL', :'s_a')), 'P0001');

SELECT pg_temp.firmar(:'sp', 'Cortesía comercial');
INSERT INTO resultado VALUES
  ('firma · cambiar el vencimiento firmado',
   pg_temp.correr(format('UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date + 30 WHERE id = %L', :'s_a')), 'OK');
INSERT INTO resultado
SELECT 'firma · el evento de vencimiento dice qué cambió',
       (descripcion LIKE 'Vencimiento %' AND usuario_plataforma_id = :'sp')::text, 'true'
  FROM plataforma.evento_plataforma
 WHERE tenant_id = :'t_a' AND tipo = 'PLAN_CAMBIADO'
 ORDER BY id DESC LIMIT 1;

-- ============================================================================
--  La fecha propuesta y el pago, que firma solo
-- ============================================================================
INSERT INTO resultado
SELECT 'propuesta · desde un vencimiento futuro suma sobre él',
       (plataforma.fn_proponer_cubre_hasta(:'s_a', 3::smallint)
          = ((current_date + 30) + interval '3 months')::date)::text, 'true';

SELECT pg_temp.firmar(NULL, NULL);
SELECT COALESCE(max(id), 0) AS ultimo_evento FROM plataforma.evento_plataforma \gset
SELECT plataforma.fn_proponer_cubre_hasta(:'s_a', 1::smallint) AS propuesta \gset
INSERT INTO resultado VALUES
  ('pago · registrar no pide firma aparte',
   pg_temp.correr(format('SELECT plataforma.fn_registrar_pago(%L, current_date, %L, 120000, %L, NULL, 1::smallint, %L)',
                         :'s_a', 'Suscripción', 'TRANSFERENCIA', :'sp')), 'OK');
INSERT INTO resultado
SELECT 'pago · deja la fecha que se propuso',
       (fecha_vencimiento = :'propuesta'::date)::text, 'true'
  FROM plataforma.suscripcion WHERE id = :'s_a';
INSERT INTO resultado
SELECT 'pago · un solo evento, el del pago',
       string_agg(tipo, ',' ORDER BY id), 'PAGO_REGISTRADO'
  FROM plataforma.evento_plataforma
 WHERE tenant_id = :'t_a' AND id > :ultimo_evento;

SELECT pg_temp.firmar(:'sp', 'No renovó');
INSERT INTO resultado VALUES
  ('firma · cancelar firmado',
   pg_temp.correr(format('UPDATE plataforma.suscripcion SET estado = %L, cancelada_en = now(), cancelada_motivo = %L WHERE id = %L',
                         'CANCELADA', 'No renovó', :'s_a')), 'OK');
INSERT INTO resultado
SELECT 'firma · la cancelación lleva autor',
       (usuario_plataforma_id = :'sp')::text, 'true'
  FROM plataforma.evento_plataforma
 WHERE tenant_id = :'t_a' AND tipo = 'SUSCRIPCION_CANCELADA';

-- ============================================================================
--  Alta y clave de superadministradores
-- ============================================================================
INSERT INTO resultado VALUES
  ('alta · con la contraseña en claro se rechaza',
   pg_temp.correr($q$SELECT plataforma.fn_alta_usuario_plataforma('nuevo@d72.co', 'Nuevo', 'MiClave123')$q$), 'P0001'),
  ('alta · con el hash argon2id entra',
   pg_temp.correr($q$SELECT plataforma.fn_alta_usuario_plataforma('nuevo@d72.co', 'Nuevo', '$argon2id$v=19$m=19456,t=2,p=1$abc$def')$q$), 'OK'),
  ('alta · el mismo correo dos veces se rechaza',
   pg_temp.correr($q$SELECT plataforma.fn_alta_usuario_plataforma('NUEVO@d72.co', 'Otro', '$argon2id$v=19$m=19456,t=2,p=1$abc$def')$q$), 'P0001'),
  ('clave · cambiarla con el hash',
   pg_temp.correr($q$SELECT plataforma.fn_clave_usuario_plataforma('nuevo@d72.co', '$argon2id$v=19$m=19456,t=2,p=1$zzz$yyy')$q$), 'OK'),
  ('clave · de un correo que no existe se rechaza',
   pg_temp.correr($q$SELECT plataforma.fn_clave_usuario_plataforma('nadie@d72.co', '$argon2id$v=19$m=19456,t=2,p=1$zzz$yyy')$q$), 'P0001');
RESET ROLE;

SET ROLE construsoft_app;
INSERT INTO resultado VALUES
  ('alta · la aplicación de las empresas no la puede llamar',
   pg_temp.correr($q$SELECT plataforma.fn_alta_usuario_plataforma('app@d72.co', 'App', '$argon2id$v=19$m=19456,t=2,p=1$abc$def')$q$), '42501');
RESET ROLE;

-- ============================================================================
--  Correos sin distinguir mayúsculas dentro de las funciones
-- ============================================================================
SET ROLE construsoft_autenticador;
INSERT INTO resultado
SELECT 'correo · ingresar con otras mayúsculas encuentra a la persona', count(*)::text, '1'
  FROM app.fn_autenticar('ANA@D72.co');
RESET ROLE;

SET ROLE construsoft_superadmin;
SELECT count(*) AS usuarios_antes FROM app.usuario WHERE tenant_id = :'t_a' \gset
INSERT INTO resultado VALUES
  ('correo · designar con otras mayúsculas no duplica a la persona',
   pg_temp.correr(format('SELECT app.fn_designar_admin(%L, %L, %L, %L, %L)',
                         :'t_a', 'Ana@D72.CO', 'Ana Admin', 'Verificada por teléfono', :'sp')), 'OK');
INSERT INTO resultado
SELECT 'correo · siguen siendo los mismos usuarios', count(*)::text, :'usuarios_antes'
  FROM app.usuario WHERE tenant_id = :'t_a';
RESET ROLE;

-- ============================================================================
--  Sin tildes
-- ============================================================================
SET ROLE construsoft_superadmin;
INSERT INTO resultado VALUES
  ('tildes · «Ingeniería Ríos» se busca como «rios»',
   (plataforma.fn_sin_tildes('Ingeniería Ríos ÁÉÑ') = 'ingenieria rios aen')::text, 'true');
RESET ROLE;

-- ============================================================================
--  El veredicto
-- ============================================================================
\echo ''
\echo '=== Casos que NO dieron lo esperado (lo correcto es ninguno)'
SELECT caso, obtenido, esperado
  FROM resultado WHERE obtenido IS DISTINCT FROM esperado ORDER BY caso;

DO $$
DECLARE v_mal integer; v_total integer;
BEGIN
    SELECT count(*) FILTER (WHERE obtenido IS DISTINCT FROM esperado), count(*)
      INTO v_mal, v_total FROM resultado;
    IF v_mal > 0 THEN
        RAISE EXCEPTION
          '% de % casos de D-72 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-72 verificado: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
