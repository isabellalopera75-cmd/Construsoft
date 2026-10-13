-- ============================================================================
--  PRUEBA DE D-73 · La empresa reporta su pago; el superadministrador lo
--  verifica. Y el estado comercial y la fecha de eliminación para el panel.
--
--      psql -U postgres -d construsoft -f "docs/prueba-d73.sql"
--
--  Se juzga sola: al final LEVANTA UNA EXCEPCIÓN si algún caso discrepa. No
--  deja nada: termina con ROLLBACK. Necesita una base RECIÉN CARGADA.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d73 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT INSERT, SELECT ON resultado TO construsoft_app, construsoft_superadmin;

CREATE FUNCTION pg_temp.correr(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.correr(text) TO construsoft_app, construsoft_superadmin;

-- Dos empresas: A está en prueba y reporta; B es la vecina.
SELECT id_tenant AS t_a, id_usuario AS u_a FROM app.fn_alta_tenant(
  'Reporta A SAS','901.773.001-1','EMPRESARIAL','Ana Admin','ana@d73.co','hash_A') \gset
SELECT id_tenant AS t_b, id_usuario AS u_b FROM app.fn_alta_tenant(
  'Vecina B SAS','901.773.002-2','EMPRESARIAL','Beto Admin','beto@d73.co','hash_B') \gset
SELECT id AS s_a FROM plataforma.suscripcion WHERE tenant_id = :'t_a' \gset
SELECT id AS r_asis FROM app.rol WHERE tenant_id = :'t_a' AND tipo = 'ASISTENTE' \gset
INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
VALUES (:'t_a', :'r_asis', 'Sara Asistente', 'sara@d73.co', 'hash_S', 'ACTIVO')
RETURNING id AS u_asis \gset
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash)
VALUES ('Soporte', 'soporte@d73.co', '$argon2id$v=19$m=19456,t=2,p=1$x$y') RETURNING id AS sp \gset

-- A vencida hace tres días: tiene que poder reportar igual (D-65 la deja en
-- solo lectura, y es justo cuando paga).
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 20,
       fecha_vencimiento = current_date - 3 WHERE id = :'s_a';
SELECT fecha_vencimiento AS vence_antes FROM plataforma.suscripcion WHERE id = :'s_a' \gset

-- Un comprobante de B, para intentar usarlo desde A.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT plataforma.fn_subir_comprobante_empresa(repeat('b', 64), 'application/pdf', '\x255044462d'::bytea) AS sop_b \gset

-- ============================================================================
--  La empresa reporta
-- ============================================================================
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_asis', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('reportar · un asistente sin el permiso de la suscripción no puede',
   pg_temp.correr($q$SELECT plataforma.fn_subir_comprobante_empresa(repeat('c', 64), 'image/png', '\x89504e47'::bytea)$q$), 'CS004');

SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
SELECT plataforma.fn_subir_comprobante_empresa(repeat('a', 64), 'image/png', '\x89504e470d0a1a0a'::bytea) AS sop_a \gset

INSERT INTO resultado VALUES
  ('reportar · sin comprobante se rechaza',
   pg_temp.correr($q$SELECT plataforma.fn_reportar_pago(current_date, 380000, 'TRANSFERENCIA', 'TR-1', 1::smallint, NULL)$q$), 'P0001'),
  ('reportar · con el comprobante de otra empresa se rechaza',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 380000, %L, %L, 1::smallint, %L)', 'TRANSFERENCIA', 'TR-1', :'sop_b')), 'P0001'),
  ('reportar · con fecha futura se rechaza',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date + 1, 380000, %L, %L, 1::smallint, %L)', 'TRANSFERENCIA', 'TR-1', :'sop_a')), 'P0001'),
  ('reportar · vencida y con su comprobante, entra',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 380000, %L, %L, 3::smallint, %L)', 'TRANSFERENCIA', 'TR-1', :'sop_a')), 'OK');

SELECT id AS pago_a FROM plataforma.pago WHERE suscripcion_id = :'s_a' AND origen = 'REPORTADO' \gset
INSERT INTO resultado
SELECT 'reportar · queda pendiente', estado, 'PENDIENTE' FROM plataforma.pago WHERE id = :'pago_a';
INSERT INTO resultado
SELECT 'reportar · no mueve el vencimiento ni un día',
       (fecha_vencimiento = :'vence_antes'::date AND estado = 'EN_PRUEBA')::text, 'true'
  FROM plataforma.suscripcion WHERE id = :'s_a';

SELECT plataforma.fn_subir_comprobante_empresa(repeat('d', 64), 'image/png', '\x89504e470d0a1a0a'::bytea) AS sop_a2 \gset
INSERT INTO resultado VALUES
  ('reportar · un segundo mientras el primero espera se rechaza',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 380000, %L, %L, 1::smallint, %L)', 'PSE', 'PSE-2', :'sop_a2')), 'P0001'),
  ('reportar · la empresa no se lo confirma a sí misma',
   pg_temp.correr(format('SELECT plataforma.fn_confirmar_pago(%L, %L)', :'pago_a', :'sp')), '42501');
RESET ROLE;

-- ============================================================================
--  El panel verifica
-- ============================================================================
SET ROLE construsoft_superadmin;
SELECT COALESCE(max(id), 0) AS ultimo_evento FROM plataforma.evento_plataforma \gset
SELECT plataforma.fn_proponer_cubre_hasta(:'s_a', 3::smallint) AS propuesta \gset
INSERT INTO resultado VALUES
  ('confirmar · sin firma aparte, con quien verifica',
   pg_temp.correr(format('SELECT plataforma.fn_confirmar_pago(%L, %L)', :'pago_a', :'sp')), 'OK');
INSERT INTO resultado
SELECT 'confirmar · el pago queda exitoso y firmado',
       (estado = 'EXITOSO' AND registrado_por = :'sp' AND verificado_en IS NOT NULL
        AND cubre_hasta = :'propuesta'::date)::text, 'true'
  FROM plataforma.pago WHERE id = :'pago_a';
INSERT INTO resultado
SELECT 'confirmar · la suscripción queda activa hasta la fecha propuesta',
       (estado = 'ACTIVA' AND fecha_vencimiento = :'propuesta'::date)::text, 'true'
  FROM plataforma.suscripcion WHERE id = :'s_a';
INSERT INTO resultado
SELECT 'confirmar · un solo evento, firmado',
       string_agg(tipo || ':' || (usuario_plataforma_id = :'sp')::text, ',' ORDER BY id), 'PAGO_REGISTRADO:true'
  FROM plataforma.evento_plataforma WHERE tenant_id = :'t_a' AND id > :ultimo_evento;
INSERT INTO resultado VALUES
  ('confirmar · dos veces el mismo pago se rechaza',
   pg_temp.correr(format('SELECT plataforma.fn_confirmar_pago(%L, %L)', :'pago_a', :'sp')), 'P0001');
RESET ROLE;

-- Un segundo reporte, ahora que el primero se resolvió, y el panel lo rechaza.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('reportar · resuelto el primero, el segundo entra',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 100, %L, %L, 1::smallint, %L)', 'PSE', 'PSE-2', :'sop_a2')), 'OK');
RESET ROLE;
SELECT id AS pago_a2 FROM plataforma.pago WHERE suscripcion_id = :'s_a' AND estado = 'PENDIENTE' \gset
SELECT fecha_vencimiento AS vence_confirmado FROM plataforma.suscripcion WHERE id = :'s_a' \gset

SET ROLE construsoft_superadmin;
INSERT INTO resultado VALUES
  ('rechazar · sin motivo no se puede',
   pg_temp.correr(format('SELECT plataforma.fn_rechazar_pago(%L, %L, %L)', :'pago_a2', :'sp', '  ')), 'P0001'),
  ('rechazar · con motivo',
   pg_temp.correr(format('SELECT plataforma.fn_rechazar_pago(%L, %L, %L)', :'pago_a2', :'sp', 'El comprobante no aparece en el extracto')), 'OK');
INSERT INTO resultado
SELECT 'rechazar · el pago lleva el motivo que lee la empresa',
       (estado = 'RECHAZADO' AND rechazo_motivo = 'El comprobante no aparece en el extracto')::text, 'true'
  FROM plataforma.pago WHERE id = :'pago_a2';
INSERT INTO resultado
SELECT 'rechazar · el vencimiento no cambia',
       (fecha_vencimiento = :'vence_confirmado'::date)::text, 'true'
  FROM plataforma.suscripcion WHERE id = :'s_a';
RESET ROLE;

-- ============================================================================
--  Estado comercial y fecha de eliminación
-- ============================================================================
-- B: prueba vencida hace 15 días, con un pago reportado y RECHAZADO (un
-- comprobante falso no compra la conservación de los datos).
SELECT id AS s_b FROM plataforma.suscripcion WHERE tenant_id = :'t_b' \gset
-- D-76 · Reporta dentro de sus 10 días de solo lectura; después se corre el
-- vencimiento para que el plazo ya haya pasado.
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 30,
       fecha_vencimiento = current_date - 8 WHERE id = :'s_b';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 50, 'OTRO', NULL, 1::smallint, :'sop_b') AS pago_b \gset
RESET ROLE;
SET ROLE construsoft_superadmin;
SELECT plataforma.fn_rechazar_pago(:'pago_b', :'sp', 'Comprobante alterado');
RESET ROLE;
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 15 WHERE id = :'s_b';
UPDATE plataforma.pago SET registrado_en = now() - interval '12 days',
       verificado_en = now() - interval '12 days' WHERE id = :'pago_b';
SET ROLE construsoft_superadmin;
INSERT INTO resultado
SELECT 'eliminar · un pago rechazado no impide eliminar una prueba vencida',
       (plataforma.fn_eliminable_desde(:'t_b') <= current_date)::text, 'true';
INSERT INTO resultado
SELECT 'eliminar · quien pagó no se elimina nunca',
       (plataforma.fn_eliminable_desde(:'t_a') IS NULL)::text, 'true';
RESET ROLE;

-- La suspensión no tapa el estado comercial.
SELECT set_config('plataforma.usuario_id', :'sp', true), set_config('plataforma.motivo', 'Prueba', true) \gset x_
UPDATE plataforma.tenant SET estado = 'SUSPENDIDO' WHERE id = :'t_a';
INSERT INTO resultado
SELECT 'estado · suspendida, el estado comercial sigue siendo ACTIVA',
       plataforma.fn_estado_comercial(:'t_a') || '/' || (SELECT estado FROM plataforma.fn_estado_suscripcion(:'t_a')),
       'ACTIVA/SUSPENDIDA';

-- Y fn_eliminar_tenant obedece a la misma fecha.
INSERT INTO resultado VALUES
  ('eliminar · la empresa que pagó se niega',
   pg_temp.correr(format('SELECT app.fn_eliminar_tenant(%L, %L, %L)', :'t_a', 'Prueba', :'sp')), 'P0001'),
  ('eliminar · la prueba vencida con el pago rechazado se elimina',
   pg_temp.correr(format('SELECT app.fn_eliminar_tenant(%L, %L, %L)', :'t_b', 'Prueba vencida sin pago real', :'sp')), 'OK');
INSERT INTO resultado
SELECT 'eliminar · su comprobante se fue con ella', count(*)::text, '0'
  FROM plataforma.soporte_pago WHERE id = :'sop_b';

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
          '% de % casos de D-73 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-73 verificado: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
