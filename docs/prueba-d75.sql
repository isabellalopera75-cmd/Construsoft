-- ============================================================================
--  PRUEBA DE D-75 · La numeración de la EDT: subcapítulos antes que
--  actividades, ceros a la izquierda por nivel y capítulo sin «.0».
--
--      psql -U postgres -d construsoft -f "docs/prueba-d75.sql"
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
    RAISE EXCEPTION 'prueba-d75 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off
BEGIN;
CREATE TEMP TABLE r (caso text, obtenido text, esperado text);

CREATE FUNCTION pg_temp.correr(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Numera SAS','900.775.001-1','EMPRESARIAL','Ana','ana@d75.co','h') \gset
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda)
VALUES (:'t','P75','P','M','COP') RETURNING id AS p \gset
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t' LIMIT 1 \gset
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id,
                         precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t','R','R','MATERIAL', :'um',1000,0,1000,'BASE') RETURNING id AS rec \gset
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id)
VALUES (:'t','APU-0005','Excavación', :'um') RETURNING id AS apu \gset
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1))) AS ver \gset
SELECT unidad_simbolo AS sim FROM app.apu_version WHERE id = :'ver' \gset

CREATE FUNCTION pg_temp.act(pt uuid, pp uuid, pn uuid, pa uuid, pv uuid, ps text, nom text)
RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id,
        apu_id, apu_version_id, codigo_apu, descripcion, unidad_simbolo,
        precio_unitario, cantidad)
    VALUES (pt, pp, pn, pa, pv, 'APU-0005', nom, ps, 1000, 1) RETURNING id;
$$;
CREATE FUNCTION pg_temp.cap(pt uuid, pp uuid, padre uuid, nom text)
RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
    VALUES (pt, pp, padre, nom, CASE WHEN padre IS NULL THEN 'DIRECTO' END) RETURNING id;
$$;
CREATE FUNCTION pg_temp.cod(p_id uuid) RETURNS text LANGUAGE sql AS $$
    SELECT COALESCE((SELECT codigo_wbs FROM app.wbs_nodo WHERE id = p_id),
                    (SELECT codigo_item FROM app.presupuesto_item WHERE id = p_id));
$$;

-- ============================================================================
--  Capítulo sin «.0», y la actividad que llegó primero queda después del
--  subcapítulo que llegó después.
-- ============================================================================
SELECT pg_temp.cap(:'t', :'p', NULL, 'ESTRUCTURA') AS c1 \gset
SELECT pg_temp.act(:'t', :'p', :'c1', :'apu', :'ver', :'sim', 'Acero directo') AS x1 \gset
SELECT pg_temp.cap(:'t', :'p', :'c1', 'Cimentación') AS s1 \gset
SELECT pg_temp.act(:'t', :'p', :'s1', :'apu', :'ver', :'sim', 'Excavación') AS y1 \gset
SELECT pg_temp.cap(:'t', :'p', :'c1', 'Columnas') AS s2 \gset
INSERT INTO r VALUES
  ('capítulo · sin «.0»', pg_temp.cod(:'c1'), '1'),
  ('orden · los subcapítulos primero', pg_temp.cod(:'s1') || ' ' || pg_temp.cod(:'s2'), '1.1 1.2'),
  ('orden · la actividad directa al final, aunque llegó primero', pg_temp.cod(:'x1'), '1.3'),
  ('orden · la actividad del subcapítulo cuelga de él', pg_temp.cod(:'y1'), '1.1.1');

-- Un subcapítulo nuevo se mete delante de las actividades.
SELECT pg_temp.cap(:'t', :'p', :'c1', 'Placas') AS s3 \gset
INSERT INTO r VALUES
  ('orden · un subcapítulo nuevo va antes de las actividades',
   pg_temp.cod(:'s3') || ' ' || pg_temp.cod(:'x1'), '1.3 1.4');

-- ============================================================================
--  Ceros a la izquierda
-- ============================================================================
-- Diez subcapítulos en ESTRUCTURA: el nivel 2 pasa a dos cifras.
SELECT count(*) AS n FROM (SELECT pg_temp.cap(:'t', :'p', :'c1', 'S' || g) FROM generate_series(4, 10) g) z \gset x_
INSERT INTO r VALUES
  ('ceros · con 10 subcapítulos, dos cifras', pg_temp.cod(:'s1') || ' ' || pg_temp.cod(:'s3'), '1.01 1.03'),
  ('ceros · la actividad del subcapítulo hereda el código con ceros', pg_temp.cod(:'y1'), '1.01.1'),
  ('ceros · la actividad directa no lleva ceros', pg_temp.cod(:'x1'), '1.11');

-- Un segundo capítulo con un solo subcapítulo: el nivel entero va a dos cifras.
SELECT pg_temp.cap(:'t', :'p', NULL, 'ACABADOS') AS c2 \gset
SELECT pg_temp.cap(:'t', :'p', :'c2', 'Pintura') AS t1 \gset
INSERT INTO r VALUES
  ('ceros · el ancho es del nivel, no del padre', pg_temp.cod(:'t1'), '2.01');

-- Doce capítulos: el nivel 1 pasa a dos cifras, y arrastra a todos sus hijos.
SELECT count(*) AS n FROM (SELECT pg_temp.cap(:'t', :'p', NULL, 'CAP ' || g) FROM generate_series(3, 12) g) z \gset x_
INSERT INTO r VALUES
  ('ceros · con 12 capítulos, dos cifras', pg_temp.cod(:'c1') || ' ' || pg_temp.cod(:'c2'), '01 02'),
  ('ceros · los hijos heredan el prefijo', pg_temp.cod(:'s1') || ' ' || pg_temp.cod(:'y1') || ' ' || pg_temp.cod(:'t1'), '01.01 01.01.1 02.01');

-- Cien capítulos: tres cifras.
SELECT count(*) AS n FROM (SELECT pg_temp.cap(:'t', :'p', NULL, 'CAP ' || g) FROM generate_series(13, 100) g) z \gset x_
INSERT INTO r VALUES
  ('ceros · con 100 capítulos, tres cifras',
   pg_temp.cod(:'c1') || ' ' || (SELECT codigo_wbs FROM app.wbs_nodo WHERE presupuesto_id = :'p' AND nombre = 'CAP 100'),
   '001 100');

-- Y vuelven a bajar: se borran capítulos hasta quedar nueve.
DELETE FROM app.wbs_nodo WHERE presupuesto_id = :'p' AND padre_id IS NULL AND nombre LIKE 'CAP %'
   AND substring(nombre FROM 5)::int > 9;
INSERT INTO r VALUES
  ('ceros · con 9 capítulos, una cifra otra vez', pg_temp.cod(:'c1') || ' ' || pg_temp.cod(:'s1'), '1 1.01');

-- ============================================================================
--  Mover: cada uno dentro de su grupo
-- ============================================================================
SELECT count(*) AS n_sub FROM app.wbs_nodo WHERE padre_id = :'c1' \gset
SELECT pg_temp.act(:'t', :'p', :'c1', :'apu', :'ver', :'sim', 'Segunda directa') AS x2 \gset
INSERT INTO r VALUES
  ('mover · un subcapítulo no baja a las actividades',
   pg_temp.correr(format('SELECT app.fn_mover_en_edt(%L, %s)', :'s1', :n_sub + 1)), 'P0001'),
  ('mover · una actividad no sube a los subcapítulos',
   pg_temp.correr(format('SELECT app.fn_mover_en_edt(%L, %s)', :'x2', :n_sub)), 'P0001'),
  ('mover · un subcapítulo al último lugar de los suyos',
   pg_temp.correr(format('SELECT app.fn_mover_en_edt(%L, %s)', :'s1', :n_sub)), 'OK'),
  ('mover · una actividad al primer lugar de las suyas',
   pg_temp.correr(format('SELECT app.fn_mover_en_edt(%L, %s)', :'x2', :n_sub + 1)), 'OK');
INSERT INTO r VALUES
  ('mover · quedaron donde se pidió',
   pg_temp.cod(:'s1') || ' ' || pg_temp.cod(:'x2') || ' ' || pg_temp.cod(:'x1'), '1.10 1.11 1.12');

-- ============================================================================
--  Lo de siempre sigue: hermanos 1..n sin repetir, códigos sin chocar entre
--  las dos tablas (el invariante de prueba-edt).
-- ============================================================================
INSERT INTO r
SELECT 'invariante · orden 1..n y códigos únicos',
       CASE WHEN EXISTS (
                SELECT 1 FROM (
                    SELECT padre_id AS padre, orden FROM app.wbs_nodo WHERE presupuesto_id = :'p'
                    UNION ALL
                    SELECT wbs_nodo_id, orden FROM app.presupuesto_item WHERE presupuesto_id = :'p') h
                 GROUP BY padre HAVING count(*) <> count(DISTINCT orden) OR min(orden) <> 1 OR max(orden) <> count(*))
            THEN 'ORDEN ROTO'
            WHEN (SELECT count(*) FROM (SELECT codigo_wbs FROM app.wbs_nodo WHERE presupuesto_id = :'p'
                                         UNION ALL SELECT codigo_item FROM app.presupuesto_item WHERE presupuesto_id = :'p') c)
               <> (SELECT count(DISTINCT c) FROM (SELECT codigo_wbs AS c FROM app.wbs_nodo WHERE presupuesto_id = :'p'
                                                   UNION ALL SELECT codigo_item FROM app.presupuesto_item WHERE presupuesto_id = :'p') d)
            THEN 'CODIGO REPETIDO'
            ELSE 'OK' END,
       'OK';

\echo ''
\echo '=== Casos que NO dieron lo esperado (lo correcto es ninguno)'
SELECT caso, obtenido, esperado FROM r WHERE obtenido IS DISTINCT FROM esperado ORDER BY caso;

DO $$
DECLARE v_mal integer; v_total integer;
BEGIN
    SELECT count(*) FILTER (WHERE obtenido IS DISTINCT FROM esperado), count(*)
      INTO v_mal, v_total FROM r;
    IF v_mal > 0 THEN
        RAISE EXCEPTION '% de % casos de D-75 no dieron lo esperado. La tabla de arriba dice cuáles.', v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-75 verificado: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
