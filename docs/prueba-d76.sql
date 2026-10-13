-- ============================================================================
--  PRUEBA DE D-76 · La prueba gratuita: 15 días con todo, 10 de solo lectura
--  para decidir y, sin pago, cancelada y eliminada.
--
--      psql -U postgres -d construsoft -f "docs/prueba-d76.sql"
--
--  Se juzga sola y termina con ROLLBACK. Necesita una base RECIÉN CARGADA.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d76 se ejecuta como superusuario, y esta conexion no lo es.';
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
CREATE FUNCTION pg_temp.ea(p_t uuid) RETURNS text LANGUAGE sql AS $$
    SELECT estado || '/' || acceso FROM plataforma.fn_estado_suscripcion(p_t);
$$;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Prueba D SAS','901.776.001-1','EMPRESARIAL','Dora Admin','dora@d76.co','hash_D') \gset
SELECT id AS s FROM plataforma.suscripcion WHERE tenant_id = :'t' \gset
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda)
VALUES (:'t','P-76','Bodega','Rionegro','COP');
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash)
VALUES ('Soporte', 'soporte@d76.co', '$argon2id$v=19$m=19456,t=2,p=1$x$y') RETURNING id AS sp \gset
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('d1'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop1 \gset
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('d2'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop2 \gset
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('d3'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop3 \gset
RESET ROLE;

-- Los 15 días: todo.
INSERT INTO resultado SELECT 'prueba · en sus 15 días, completa', pg_temp.ea(:'t'), 'EN_PRUEBA/COMPLETO';

-- Venció ayer: solo lectura, con 10 días para decidir.
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 40,
       fecha_vencimiento = current_date - 1 WHERE id = :'s';
INSERT INTO resultado
SELECT 'decidir · solo lectura, paga hasta el día 10, se borra el 11',
       pg_temp.ea(:'t') || '/' || (pagar_a_mas_tardar = current_date + 9) || '/' || (se_elimina_el = current_date + 10),
       'VENCIDA/SOLO_LECTURA/true/true'
  FROM plataforma.fn_estado_suscripcion(:'t');
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('decidir · consulta',          pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.VER')$$),   'OK'),
  ('decidir · no escribe',        pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.CREAR')$$), 'CS005'),
  ('decidir · entra a la suscripción', pg_temp.correr($$SELECT app.fn_exigir_permiso('CONFIG.SUSCRIPCION')$$), 'OK');
RESET ROLE;

-- El día 10 todavía decide; el 11 está cancelada.
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 10 WHERE id = :'s';
INSERT INTO resultado SELECT 'decidir · el día 10 todavía es solo lectura', pg_temp.ea(:'t'), 'VENCIDA/SOLO_LECTURA';
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 11 WHERE id = :'s';
INSERT INTO resultado
SELECT 'cancelada · el día 11, sin acceso, por la prueba, y se borra hoy',
       pg_temp.ea(:'t') || '/' || cancelada_por || '/' || (se_elimina_el = current_date),
       'CANCELADA/NINGUNO/PRUEBA/true'
  FROM plataforma.fn_estado_suscripcion(:'t');
INSERT INTO resultado SELECT 'cancelada · el panel la ve cancelada', plataforma.fn_estado_comercial(:'t'), 'CANCELADA';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('cancelada · no consulta', pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.VER')$$), 'CS006'),
  ('cancelada · pero exporta, hasta que se elimine', pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.EXPORTAR')$$), 'OK'),
  ('cancelada · y ve la lista de lo que puede exportar',
   (SELECT string_agg(codigo || ':' || archivado, ',') FROM app.fn_presupuestos_exportables()), 'P-76:false'),
  ('cancelada · ya no admite pagos',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 100, %L, NULL, 1::smallint, %L)', 'PSE', :'sop3')), 'P0001');
RESET ROLE;

-- ============================================================================
--  Lo que la API encontró el 13 de octubre: la prueba muerta sigue guardada
--  EN_PRUEBA, y nada que mire solo lo guardado puede revivirla.
-- ============================================================================
SELECT id AS plan_personal FROM plataforma.plan WHERE codigo = 'PERSONAL' \gset
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('muerta · la empresa no la cancela otra vez',
   pg_temp.correr($$SELECT plataforma.fn_cancelar_suscripcion_empresa('otra vez')$$), 'P0001');
RESET ROLE;
SET ROLE construsoft_superadmin;
SELECT set_config('plataforma.usuario_id', :'sp', true), set_config('plataforma.motivo', 'Prueba', true) \gset x_
INSERT INTO resultado VALUES
  ('muerta · el panel no la cancela',
   pg_temp.correr(format($$UPDATE plataforma.suscripcion SET estado = 'CANCELADA', cancelada_en = now(), cancelada_motivo = 'x' WHERE id = %L$$, :'s')), 'P0001'),
  ('muerta · el panel no le corre el vencimiento',
   pg_temp.correr(format($$UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date + 30 WHERE id = %L$$, :'s')), 'P0001'),
  ('muerta · el panel no le cambia el plan',
   pg_temp.correr(format($$UPDATE plataforma.suscripcion SET plan_id = %s WHERE id = %L$$, :plan_personal, :'s')), 'P0001'),
  ('muerta · el panel no le registra un pago',
   pg_temp.correr(format($$SELECT plataforma.fn_registrar_pago(%L, current_date, 'x', 1, 'PSE', NULL, 1::smallint, %L)$$, :'s', :'sp')), 'P0001');
RESET ROLE;
INSERT INTO resultado
SELECT 'muerta · sigue igual de muerta', pg_temp.ea(:'t') || '/' || cancelada_por, 'CANCELADA/NINGUNO/PRUEBA'
  FROM plataforma.fn_estado_suscripcion(:'t');

-- Y el candado no sobra: con una prueba viva el panel sí corre el vencimiento,
-- y cancelar una prueba en sus diez días no le estira el plazo.
SELECT id_tenant AS t3, id_usuario AS u3 FROM app.fn_alta_tenant(
  'Prueba F SAS','901.776.003-3','EMPRESARIAL','Fabio Admin','fabio@d76.co','hash_F') \gset
SELECT id AS s3 FROM plataforma.suscripcion WHERE tenant_id = :'t3' \gset
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 30 WHERE id = :'s3';
SET ROLE construsoft_superadmin;
SELECT set_config('plataforma.usuario_id', :'sp', true), set_config('plataforma.motivo', 'Prueba', true) \gset x_
INSERT INTO resultado VALUES
  ('viva · el panel sí le corre el vencimiento',
   pg_temp.correr(format($$UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 5 WHERE id = %L$$, :'s3')), 'OK');
RESET ROLE;
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t3', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u3', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('decidiendo · la empresa sí puede cancelar su prueba',
   pg_temp.correr($$SELECT plataforma.fn_cancelar_suscripcion_empresa('No la necesitamos')$$), 'OK');
RESET ROLE;
INSERT INTO resultado
SELECT 'decidiendo · cancelada, sus diez días cuentan desde el fin de la prueba',
       estado || '/' || (reactivable_hasta = current_date + 5) || '/' || (se_elimina_el = current_date + 6),
       'CANCELADA/true/true'
  FROM plataforma.fn_estado_suscripcion(:'t3');

-- Un pago reportado a tiempo la protege mientras se verifica.
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 5 WHERE id = :'s';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'D-1', 1::smallint, :'sop1') AS pago1 \gset
RESET ROLE;
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 20 WHERE id = :'s';
UPDATE plataforma.pago SET registrado_en = now() - interval '12 days' WHERE id = :'pago1';
INSERT INTO resultado
SELECT 'a tiempo · el pago pendiente la deja en solo lectura y frena la eliminación',
       pg_temp.ea(:'t') || '/' || (se_elimina_el IS NULL), 'VENCIDA/SOLO_LECTURA/true'
  FROM plataforma.fn_estado_suscripcion(:'t');

-- Rechazado hoy: dos días hábiles para reenviar.
SELECT plataforma.fn_rechazar_pago(:'pago1', :'sp', 'No aparece');
INSERT INTO resultado
SELECT 'rechazo · dos días hábiles desde hoy',
       pg_temp.ea(:'t') || '/' || (pagar_a_mas_tardar = plataforma.fn_sumar_dias_habiles(current_date, 2)),
       'VENCIDA/SOLO_LECTURA/true'
  FROM plataforma.fn_estado_suscripcion(:'t');

-- Reenvía y el panel confirma: queda activa.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'D-2', 1::smallint, :'sop2') AS pago2 \gset
RESET ROLE;
SELECT plataforma.fn_confirmar_pago(:'pago2', :'sp') \gset x_
INSERT INTO resultado SELECT 'confirmado · pasa a ACTIVA', pg_temp.ea(:'t'), 'ACTIVA/COMPLETO';

-- Otra prueba que nadie pagó: la purga la borra el día 11.
SELECT id_tenant AS t2 FROM app.fn_alta_tenant(
  'Prueba E SAS','901.776.002-2','EMPRESARIAL','Eva Admin','eva@d76.co','hash_E') \gset
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 30,
       fecha_vencimiento = current_date - 11 WHERE tenant_id = :'t2';
SET ROLE construsoft_superadmin;
INSERT INTO resultado
SELECT 'purga · borra la prueba cancelada, y no la que pagó',
       string_agg(razon_social || ':' || (motivo LIKE '%D-76%')::text, ','), 'Prueba E SAS:true'
  FROM plataforma.fn_purgar_empresas();
RESET ROLE;
INSERT INTO resultado
SELECT 'purga · la que pagó sigue', count(*)::text, '1' FROM plataforma.tenant WHERE id = :'t';

\echo ''
\echo '=== Casos que NO dieron lo esperado (lo correcto es ninguno)'
SELECT caso, obtenido, esperado FROM resultado WHERE obtenido IS DISTINCT FROM esperado ORDER BY caso;

DO $$
DECLARE v_mal integer; v_total integer;
BEGIN
    SELECT count(*) FILTER (WHERE obtenido IS DISTINCT FROM esperado), count(*)
      INTO v_mal, v_total FROM resultado;
    IF v_mal > 0 THEN
        RAISE EXCEPTION '% de % casos de D-76 no dieron lo esperado. La tabla de arriba dice cuáles.', v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-76 verificado: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
