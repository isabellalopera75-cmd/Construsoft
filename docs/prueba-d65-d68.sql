-- ============================================================================
--  PRUEBA DE D-65 A D-68 · La suscripción, el sello y la vigencia de un token
--
--      psql -U postgres -d construsoft -f "docs/prueba-d65-d68.sql"
--
--  Se juzga sola. Cada caso deja una fila con lo que obtuvo y lo que debía
--  obtener, y al final el script LEVANTA UNA EXCEPCIÓN si alguno discrepa. No
--  hay que leer la salida para saber si pasó: el código de salida lo dice.
--  Imprimir «obtenido | esperado» y confiar en que alguien compare es la forma
--  más barata de tener un falso verde.
--
--  No deja nada: termina con ROLLBACK.
--
--  Necesita una base RECIÉN CARGADA, sin empresas dadas de alta: da de alta dos
--  con NIT fijo y choca con ux_tenant_nit si ya existen.
-- ============================================================================
-- ----------------------------------------------------------------------------
--  La guarda, por el mismo motivo que la de prueba-fase-0: este script usa
--  SET ROLE para ponerse en la piel de la aplicación, y antes de eso hace cosas
--  que ninguna conexión legítima puede hacer —mover una fecha de vencimiento,
--  suspender un inquilino, cambiar una restricción—. Con la conexión de la
--  aplicación no fallaría en el caso que quiere probar, fallaría antes y por otra
--  razón, que es lo que hace ilegible un rojo.
--
--  Se detiene con una excepción y no con \quit: \quit sale con código 0 y
--  «detenido sin ejecutar nada» se vería igual que «pasó».
-- ----------------------------------------------------------------------------
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\echo '      psql -U postgres -d construsoft -f "docs/prueba-d65-d68.sql"'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION
      'prueba-d65-d68 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
-- La tabla la crea el superusuario y escriben en ella los roles en cuya piel se
-- mete el script. Sin estos permisos la prueba muere con «permission denied for
-- table resultado» en el primer SET ROLE, que no es el rechazo que viene a probar.
GRANT INSERT, SELECT ON resultado TO construsoft_app, construsoft_autenticador;

-- Corre fn_exigir_permiso y devuelve el SQLSTATE en vez de estallar. El bloque
-- EXCEPTION abre una subtransacción, así que no aborta la de afuera.
CREATE FUNCTION pg_temp.permiso(p_codigo text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM app.fn_exigir_permiso(p_codigo);
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- Lo mismo para cualquier sentencia.
CREATE FUNCTION pg_temp.correr(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

SELECT id_tenant AS t_a, id_usuario AS u_a
  FROM app.fn_alta_tenant('Constructora A SAS','900.123.456-1','EMPRESARIAL',
                          'Ana Admin','ana@a.co','hash_A') \gset
SELECT id_tenant AS t_b, id_usuario AS u_b
  FROM app.fn_alta_tenant('Constructora B SAS','800.555.111-2','EMPRESARIAL',
                          'Beto Admin','beto@b.co','hash_B') \gset
SELECT id AS r_asis FROM app.rol
 WHERE tenant_id = :'t_a' AND tipo = 'ASISTENTE' \gset
INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
VALUES (:'t_a', :'r_asis','Sara Asistente','sara@a.co','hash_S','ACTIVO')
RETURNING id AS u_asis \gset
INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, estado)
VALUES (:'t_a', :'r_asis','Pedro Pendiente','pedro@a.co','PENDIENTE')
RETURNING id AS u_pend \gset

-- ============================================================================
--  D-66 · Un SQLSTATE por rechazo
-- ============================================================================
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_

SELECT set_config('app.usuario_id', '', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('CS001 · sin usuario en el contexto', pg_temp.permiso('PRESUPUESTOS.VER'), 'CS001');

SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('CS000 · permiso fuera del catálogo', pg_temp.permiso('PRESUPUESTOS.INVENTADO'), 'CS000');

SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('CS002 · usuario de otra empresa', pg_temp.permiso('PRESUPUESTOS.VER'), 'CS002');

SELECT set_config('app.usuario_id', :'u_pend', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('CS003 · cuenta PENDIENTE', pg_temp.permiso('PRESUPUESTOS.VER'), 'CS003');

SELECT set_config('app.usuario_id', :'u_asis', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('CS004 · asistente sin PRESUPUESTOS.ESTADO', pg_temp.permiso('PRESUPUESTOS.ESTADO'), 'CS004');

-- ============================================================================
--  D-65 · Al día se puede todo
-- ============================================================================
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('al día · consultar',    pg_temp.permiso('PRESUPUESTOS.VER'),      'OK'),
  ('al día · exportar',     pg_temp.permiso('PRESUPUESTOS.EXPORTAR'), 'OK'),
  ('al día · crear',        pg_temp.permiso('PRESUPUESTOS.CREAR'),    'OK'),
  ('al día · editar',       pg_temp.permiso('PRESUPUESTOS.EDITAR'),   'OK'),
  ('al día · suscripción',  pg_temp.permiso('CONFIG.SUSCRIPCION'),    'OK');

-- ============================================================================
--  D-65 · Vencida es SOLO LECTURA, no bloqueo
-- ============================================================================
RESET ROLE;
-- fecha_inicio también retrocede: hay un CHECK (fecha_vencimiento >=
-- fecha_inicio) y la suscripción nació hoy.
UPDATE plataforma.suscripcion
   SET fecha_inicio = current_date - 40, fecha_vencimiento = current_date - 1
 WHERE tenant_id = :'t_a';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id',  :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_

INSERT INTO resultado VALUES
  ('vencida · consultar presupuestos', pg_temp.permiso('PRESUPUESTOS.VER'),      'OK'),
  ('vencida · exportar',               pg_temp.permiso('PRESUPUESTOS.EXPORTAR'), 'OK'),
  ('vencida · consultar APU',          pg_temp.permiso('APU.VER'),               'OK'),
  ('vencida · consultar recursos',     pg_temp.permiso('RECURSOS.VER'),          'OK'),
  -- Sin excepción escrita a mano: CONFIG.SUSCRIPCION ya está declarado con
  -- accion = 'VER', así que la regla lo deja pasar por sí sola.
  ('vencida · ver la suscripción',     pg_temp.permiso('CONFIG.SUSCRIPCION'),    'OK');

INSERT INTO resultado VALUES
  ('vencida · crear presupuesto',   pg_temp.permiso('PRESUPUESTOS.CREAR'),    'CS005'),
  ('vencida · editar presupuesto',  pg_temp.permiso('PRESUPUESTOS.EDITAR'),   'CS005'),
  ('vencida · duplicar',            pg_temp.permiso('PRESUPUESTOS.DUPLICAR'), 'CS005'),
  ('vencida · cambiar estado',      pg_temp.permiso('PRESUPUESTOS.ESTADO'),   'CS005'),
  ('vencida · crear recurso',       pg_temp.permiso('RECURSOS.CREAR'),        'CS005'),
  ('vencida · editar APU',          pg_temp.permiso('APU.EDITAR'),            'CS005'),
  ('vencida · editar la empresa',   pg_temp.permiso('CONFIG.EMPRESA'),        'CS005'),
  ('vencida · gestionar usuarios',  pg_temp.permiso('USUARIOS.GESTIONAR'),    'CS005');

-- El orden de las ramas. Si la suscripción se comprobara ANTES del permiso del
-- rol, este asistente recibiría CS005, la interfaz lo mandaría a la pantalla de
-- pago, y esa pantalla —que exige CONFIG.SUSCRIPCION— lo rechazaría otra vez.
SELECT set_config('app.usuario_id', :'u_asis', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('orden · asistente vencido recibe CS004, no CS005',
   pg_temp.permiso('PRESUPUESTOS.ESTADO'), 'CS004');

-- La otra empresa no se enteró de nada.
SELECT set_config('app.tenant_id',  :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('aislamiento · B sigue escribiendo', pg_temp.permiso('PRESUPUESTOS.CREAR'), 'OK');
RESET ROLE;

-- ============================================================================
--  D-65 · fn_estado_suscripcion, estado por estado
-- ============================================================================
INSERT INTO resultado
SELECT 'estado · vencida ayer', estado || '/' || solo_lectura || '/' || dias_restantes,
       'VENCIDA/true/-1' FROM plataforma.fn_estado_suscripcion(:'t_a');

UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date
 WHERE tenant_id = :'t_a';
-- El último día de la prueba todavía cuenta: fn_suscripcion_vigente compara con
-- >= y no con >. Sigue en EN_PRUEBA porque aquí solo se movieron las fechas.
INSERT INTO resultado
SELECT 'estado · la prueba que vence HOY sigue vigente (el límite es >=)',
       estado || '/' || solo_lectura || '/' || dias_restantes, 'EN_PRUEBA/false/0'
  FROM plataforma.fn_estado_suscripcion(:'t_a');

UPDATE plataforma.suscripcion
   SET estado = 'EN_PRUEBA', fecha_inicio = current_date,
       fecha_vencimiento = current_date + 15
 WHERE tenant_id = :'t_a';
INSERT INTO resultado
SELECT 'estado · en prueba, quince días', estado || '/' || solo_lectura || '/' || dias_restantes,
       'EN_PRUEBA/false/15' FROM plataforma.fn_estado_suscripcion(:'t_a');

UPDATE plataforma.suscripcion
   SET estado = 'CANCELADA', cancelada_en = now(), cancelada_motivo = 'prueba'
 WHERE tenant_id = :'t_a';
INSERT INTO resultado
SELECT 'estado · cancelada, aunque la fecha no llegó',
       estado || '/' || solo_lectura, 'CANCELADA/true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');

-- Las CANCELADA no tienen tope —solo ux_suscripcion_activa limita las vigentes—,
-- así que un inquilino puede acumularlas. Sin el LATERAL con LIMIT 1 esto
-- devolvía dos filas y la API leía la que llegara primero.
INSERT INTO plataforma.suscripcion
       (tenant_id, plan_id, estado, cancelada_en, cancelada_motivo,
        fecha_inicio, fecha_vencimiento)
SELECT :'t_a', plan_id, 'CANCELADA', now(), 'vieja',
       current_date - 400, current_date - 370
  FROM plataforma.suscripcion WHERE tenant_id = :'t_a' LIMIT 1;
INSERT INTO resultado
SELECT 'estado · dos cancelaciones devuelven UNA fila', count(*)::text, '1'
  FROM plataforma.fn_estado_suscripcion(:'t_a');

UPDATE plataforma.suscripcion
   SET estado = 'ACTIVA', cancelada_en = NULL, cancelada_motivo = NULL
 WHERE tenant_id = :'t_a' AND fecha_vencimiento >= current_date;
UPDATE plataforma.tenant SET estado = 'SUSPENDIDO' WHERE id = :'t_a';
INSERT INTO resultado
SELECT 'estado · suspendido tapa el estado de la suscripción',
       estado || '/' || solo_lectura, 'SUSPENDIDA/true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');
UPDATE plataforma.tenant SET estado = 'ACTIVO' WHERE id = :'t_a';

-- Y lo que no se ve. Cero filas es «sin acceso», nunca «al día».
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
INSERT INTO resultado
SELECT 'estado · A preguntando por B recibe cero filas', count(*)::text, '0'
  FROM plataforma.fn_estado_suscripcion(:'t_b');
INSERT INTO resultado
SELECT 'estado · A preguntando por A recibe una', count(*)::text, '1'
  FROM plataforma.fn_estado_suscripcion(:'t_a');
RESET ROLE;

-- ============================================================================
--  D-67 · El sello de credenciales
-- ============================================================================
INSERT INTO resultado
SELECT 'sello · existe al nacer', (credenciales_en IS NOT NULL)::text, 'true'
  FROM app.usuario WHERE id = :'u_a';
SELECT credenciales_en AS sello0 FROM app.usuario WHERE id = :'u_a' \gset

UPDATE app.usuario SET ultimo_acceso = now() WHERE id = :'u_a';
INSERT INTO resultado
SELECT 'sello · ultimo_acceso NO lo mueve', (credenciales_en = :'sello0')::text, 'true'
  FROM app.usuario WHERE id = :'u_a';

UPDATE app.usuario SET nombre = 'Ana Administradora' WHERE id = :'u_a';
INSERT INTO resultado
SELECT 'sello · cambiar el nombre NO lo mueve', (credenciales_en = :'sello0')::text, 'true'
  FROM app.usuario WHERE id = :'u_a';

UPDATE app.usuario SET password_hash = 'hash_A' WHERE id = :'u_a';
INSERT INTO resultado
SELECT 'sello · el MISMO hash NO lo mueve', (credenciales_en = :'sello0')::text, 'true'
  FROM app.usuario WHERE id = :'u_a';

UPDATE app.usuario SET password_hash = 'hash_A_nuevo' WHERE id = :'u_a';
INSERT INTO resultado
SELECT 'sello · cambiar la contraseña SÍ lo mueve', (credenciales_en > :'sello0')::text, 'true'
  FROM app.usuario WHERE id = :'u_a';

INSERT INTO resultado VALUES
  ('sello · escribirlo a mano se rechaza, hasta como superusuario',
   pg_temp.correr(format('UPDATE app.usuario SET credenciales_en = %L WHERE id = %L',
                         '2019-07-04'::timestamptz, :'u_a')), 'P0001');

-- La aplicación tiene UPDATE sobre toda app.usuario (§16.5), así que sin la
-- segunda rama del disparador podría fijar el sello en lo que llevara la cookie.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id',  :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('sello · la aplicación tampoco lo escribe a mano',
   pg_temp.correr(format('UPDATE app.usuario SET credenciales_en = %L WHERE id = %L',
                         '2019-07-04'::timestamptz, :'u_a')), 'P0001'),
  ('sello · pero la aplicación SÍ cambia la contraseña',
   pg_temp.correr(format('UPDATE app.usuario SET password_hash = ''otro'' WHERE id = %L',
                         :'u_a')), 'OK');
RESET ROLE;
INSERT INTO resultado
SELECT 'sello · siguió al cambio hecho por la aplicación',
       (credenciales_en > :'sello0')::text, 'true'
  FROM app.usuario WHERE id = :'u_a';

-- El ingreso necesita el sello para grabarlo en la cookie, y el ingreso corre
-- por la conexión de autenticación (D-46).
SET ROLE construsoft_autenticador;
INSERT INTO resultado
SELECT 'sello · fn_autenticar lo entrega', (credenciales_en IS NOT NULL)::text, 'true'
  FROM app.fn_autenticar('ana@a.co');
RESET ROLE;

-- ============================================================================
--  D-68 · ck_token_vigencia
-- ============================================================================
INSERT INTO resultado VALUES
  ('token · RECUPERACION a 30 minutos pasa', pg_temp.correr(format(
     'INSERT INTO app.token_recuperacion (tenant_id,usuario_id,proposito,token_hash,expira_en)
      VALUES (%L,%L,''RECUPERACION'',''t30'', now() + interval ''30 minutes'')',
     :'t_a', :'u_a')), 'OK'),
  ('token · RECUPERACION a 31 se rechaza', pg_temp.correr(format(
     'INSERT INTO app.token_recuperacion (tenant_id,usuario_id,proposito,token_hash,expira_en)
      VALUES (%L,%L,''RECUPERACION'',''t31'', now() + interval ''31 minutes'')',
     :'t_a', :'u_a')), '23514'),
  ('token · ACTIVACION a 72 horas pasa', pg_temp.correr(format(
     'INSERT INTO app.token_recuperacion (tenant_id,usuario_id,proposito,token_hash,expira_en)
      VALUES (%L,%L,''ACTIVACION'',''t72'', now() + interval ''72 hours'')',
     :'t_a', :'u_a')), 'OK'),
  ('token · ACTIVACION a 73 se rechaza', pg_temp.correr(format(
     'INSERT INTO app.token_recuperacion (tenant_id,usuario_id,proposito,token_hash,expira_en)
      VALUES (%L,%L,''ACTIVACION'',''t73'', now() + interval ''73 hours'')',
     :'t_a', :'u_a')), '23514');

-- Lo que D-68 existe para garantizar: un propósito agregado al CHECK de
-- proposito SIN su rama en el CASE de la vigencia es imposible de insertar, con
-- cualquier vigencia. Antes heredaba 72 horas y nada se quejaba.
ALTER TABLE app.token_recuperacion
    DROP CONSTRAINT token_recuperacion_proposito_check;
ALTER TABLE app.token_recuperacion
    ADD CONSTRAINT token_recuperacion_proposito_check
    CHECK (proposito IN ('ACTIVACION','RECUPERACION','SIN_RAMA_A_PROPOSITO'));
INSERT INTO resultado VALUES
  ('token · propósito sin rama, a 24 horas: imposible', pg_temp.correr(format(
     'INSERT INTO app.token_recuperacion (tenant_id,usuario_id,proposito,token_hash,expira_en)
      VALUES (%L,%L,''SIN_RAMA_A_PROPOSITO'',''x24'', now() + interval ''24 hours'')',
     :'t_a', :'u_a')), '23514'),
  ('token · propósito sin rama, a 1 segundo: también', pg_temp.correr(format(
     'INSERT INTO app.token_recuperacion (tenant_id,usuario_id,proposito,token_hash,expira_en)
      VALUES (%L,%L,''SIN_RAMA_A_PROPOSITO'',''x1s'', now() + interval ''1 second'')',
     :'t_a', :'u_a')), '23514');

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
          '% de % casos de D-65 a D-68 no dieron lo esperado. La tabla de arriba '
          'dice cuáles.', v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-65 a D-68 verificados: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
