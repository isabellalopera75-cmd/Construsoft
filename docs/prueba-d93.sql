-- ============================================================================
--  PRUEBA DE D-93 · El aviso de que el presupuesto cambió (migración 0006).
--
--      psql -U postgres -d construsoft -f "docs/prueba-d93.sql"
--
--  Necesita las migraciones 0005 y 0006. Se juzga sola y termina con ROLLBACK.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d93 se ejecuta como superusuario, y esta conexion no lo es.';
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
        WHEN check_violation OR insufficient_privilege THEN
            RETURN 'rechazado';
    END;
END $$;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Aviso SAS','901.930.001-1','EMPRESARIAL','Ana','ana@d93.co','h') \gset
UPDATE app.usuario SET estado = 'ACTIVO' WHERE id = :'u';
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura)
VALUES (:'t','P93','Obra','M','COP','WBS') RETURNING id AS p \gset
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

INSERT INTO resultado SELECT '01 el cronograma nace sin aviso',
  COALESCE(aviso_presupuesto::text, 'nulo'), 'nulo' FROM app.cronograma WHERE id = :'k';
INSERT INTO resultado SELECT '02 la aplicación escribe el aviso',
  pg_temp.rechaza(format('UPDATE app.cronograma SET aviso_presupuesto = %L WHERE id = %L',
                         '{"desde": "2026-10-20T10:00", "nuevas": 2}', :'k'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '03 y lo cierra',
  pg_temp.rechaza(format('UPDATE app.cronograma SET aviso_presupuesto = NULL WHERE id = %L', :'k'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '04 un aviso que no es un objeto se rechaza',
  pg_temp.rechaza(format('UPDATE app.cronograma SET aviso_presupuesto = %L WHERE id = %L', '[1, 2]', :'k')) || '/' ||
  pg_temp.rechaza(format('UPDATE app.cronograma SET aviso_presupuesto = %L WHERE id = %L', '"texto"', :'k')),
  'rechazado/rechazado';

UPDATE app.cronograma SET aviso_presupuesto = '{"nuevas": 1}' WHERE id = :'k';
SELECT app.fn_activar_presupuesto(:'p');
INSERT INTO resultado SELECT '05 un cambio de estado sube la versión y no toca el aviso',
  version || '/' || aviso_presupuesto::text, '2/{"nuevas": 1}' FROM app.cronograma WHERE id = :'k';
SELECT app.fn_cerrar_presupuesto(:'p');
INSERT INTO resultado SELECT '06 con el presupuesto Cerrado el aviso se escribe y se cierra (no es una entrada)',
  pg_temp.rechaza(format('UPDATE app.cronograma SET aviso_presupuesto = %L WHERE id = %L § UPDATE app.cronograma SET aviso_presupuesto = NULL WHERE id = %L',
                         '{"nuevas": 3}', :'k', :'k'), 'construsoft_app'), 'aceptado';
RESET ROLE;
SELECT app.fn_duplicar_presupuesto(:'p', 'P93B', 'Copia', false) AS pc \gset
INSERT INTO resultado SELECT '07 la copia nace sin aviso',
  COALESCE(aviso_presupuesto::text, 'nulo'), 'nulo' FROM app.cronograma WHERE presupuesto_id = :'pc';
INSERT INTO resultado SELECT '08 verificadores de aislamiento y de funciones en cero',
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
          '% de % casos de D-93 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-93 verificado: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
