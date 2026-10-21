-- ============================================================================
--  PRUEBA DE D-94 · Lo que vio el cálculo anterior (migración 0007).
--
--      psql -U postgres -d construsoft -f "docs/prueba-d94.sql"
--
--  Necesita las migraciones 0005 a 0007. Se juzga sola y termina con ROLLBACK.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d94 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;
CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT ALL ON resultado TO PUBLIC;

CREATE FUNCTION pg_temp.rechaza(sql text, rol text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
    BEGIN
        IF rol IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', rol); END IF;
        FOREACH s IN ARRAY string_to_array(sql, '§') LOOP
            EXECUTE s;
        END LOOP;
        EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
        RAISE EXCEPTION 'paso_sin_error';
    EXCEPTION
        WHEN raise_exception THEN
            IF SQLERRM = 'paso_sin_error' THEN RETURN 'aceptado'; END IF;
            RETURN 'rechazado';
        WHEN check_violation OR insufficient_privilege OR not_null_violation THEN
            RETURN 'rechazado';
    END;
END $$;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Calculo SAS','901.940.001-1','EMPRESARIAL','Ana','ana@d94.co','h') \gset
UPDATE app.usuario SET estado = 'ACTIVO' WHERE id = :'u';
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura)
VALUES (:'t','P94','Obra','M','COP','WBS') RETURNING id AS p \gset
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t' LIMIT 1 \gset
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t','R','R','MATERIAL', :'um', 1000, 0, 1000, 'BASE') RETURNING id AS rec \gset
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id) VALUES (:'t','APU-0001','Muro', :'um') RETURNING id AS apu \gset
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1)), NULL, NULL, 'v') AS ver \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL, 'Obra', 'DIRECTO') RETURNING id AS c1 \gset
INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
    codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
SELECT :'t', :'p', :'c1', :'apu', v.id, 'APU-0001', 'Muro', v.unidad_simbolo, v.costo_directo, 3
  FROM app.apu_version v WHERE v.id = :'ver';
SELECT app.fn_crear_cronograma(:'p', '2026-11-02') AS k \gset

SELECT id AS a FROM app.actividad_programada WHERE cronograma_id = :'k' AND tipo = 'ITEM' LIMIT 1 \gset
INSERT INTO resultado SELECT '01 el cronograma nace sin valor calculado',
  COALESCE(calculado_valor_total::text, 'nulo'), 'nulo' FROM app.cronograma WHERE id = :'k';
INSERT INTO resultado SELECT '02 un resultado sin en_presupuesto se rechaza (no hay valor por defecto)',
  pg_temp.rechaza(format('INSERT INTO app.actividad_calculo (actividad_id, tenant_id, inicio_temprano, fin_temprano, duracion_minutos) VALUES (%L, %L, %L, %L, 0)',
                         :'a', :'t', '2026-11-02 07:00', '2026-11-02 07:00'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '03 la aplicación escribe el resultado con en_presupuesto y el valor calculado',
  pg_temp.rechaza(format('INSERT INTO app.actividad_calculo (actividad_id, tenant_id, inicio_temprano, fin_temprano, duracion_minutos, en_presupuesto) VALUES (%L, %L, %L, %L, 0, true) § '
                         'UPDATE app.cronograma SET calculado_version = version, calculado_revision = 0, calculado_valor_total = %L WHERE id = %L',
                         :'a', :'t', '2026-11-02 07:00', '2026-11-02 07:00', '3000.000000', :'k'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '04 un valor calculado sin cálculo se rechaza',
  pg_temp.rechaza(format('UPDATE app.cronograma SET calculado_valor_total = %L WHERE id = %L', '1', :'k')), 'rechazado';
INSERT INTO app.actividad_calculo (actividad_id, tenant_id, inicio_temprano, fin_temprano, duracion_minutos, en_presupuesto)
VALUES (:'a', :'t', '2026-11-02 07:00', '2026-11-02 07:00', 0, true);
SELECT app.fn_activar_presupuesto(:'p');
SELECT app.fn_cerrar_presupuesto(:'p');
INSERT INTO resultado SELECT '05 con el presupuesto Cerrado el recálculo escribe los dos datos',
  pg_temp.rechaza(format('UPDATE app.actividad_calculo SET en_presupuesto = false WHERE actividad_id = %L § '
                         'UPDATE app.cronograma SET calculado_version = version, calculado_revision = 0, calculado_valor_total = %L WHERE id = %L',
                         :'a', '3000.000000', :'k'), 'construsoft_app'), 'aceptado';
RESET ROLE;
SELECT app.fn_duplicar_presupuesto(:'p', 'P94B', 'Copia', false) AS pc \gset
INSERT INTO resultado SELECT '06 la copia nace sin valor calculado',
  COALESCE(calculado_valor_total::text, 'nulo'), 'nulo' FROM app.cronograma WHERE presupuesto_id = :'pc';
INSERT INTO resultado SELECT '07 verificadores de aislamiento y de funciones en cero',
  (SELECT count(*) FROM app.fn_verificar_rls()) || '/' || (SELECT count(*) FROM app.fn_verificar_funciones()), '0/0';

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
          '% de % casos de D-94 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-94 verificado: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
