-- ============================================================================
--  PRUEBA DE D-79 · La renumeración solo cuando cambia la estructura, y solo
--  donde cambia.
--
--      psql -U postgres -d construsoft -f "docs/prueba-d79.sql"
--
--  Necesita la migración 0002. Dos partes:
--    1. Qué dispara qué, contado con las estadísticas de la transacción: editar
--       una cantidad o renombrar un capítulo no renumera nada; agregar o borrar
--       una actividad renumera su rama; tocar capítulos renumera el proyecto.
--    2. El invariante: 300 operaciones al azar sobre una EDT de tres
--       niveles, y después de CADA
--       una la renumeración completa no encuentra nada que corregir. (Los ids
--       salen del reloj, así que el recorrido cambia un poco entre corridas;
--       el invariante tiene que valer en todas.) Si la
--       renumeración por rama se equivocara una sola vez, aquí aparece.
--  Se juzga sola y termina con ROLLBACK.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d79 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off
SET track_functions = 'all';

BEGIN;
CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Ramas SAS','901.779.001-1','EMPRESARIAL','Ana','ana@d79.co','h') \gset
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t' LIMIT 1 \gset
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t','R','R','MATERIAL', :'um', 1000, 0, 1000, 'BASE') RETURNING id AS rec \gset
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id)
VALUES (:'t','APU-0001','Muro', :'um') RETURNING id AS apu \gset
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1))) AS ver \gset
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura)
VALUES (:'t','P79','P','M','COP','WBS') RETURNING id AS p \gset

-- Agrega una actividad al final de un capítulo.
CREATE FUNCTION pg_temp.act(pc uuid) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id, apu_id,
        apu_version_id, codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
    SELECT n.tenant_id, n.presupuesto_id, pc, v.apu_id, v.id, 'APU-0001', 'Muro',
           v.unidad_simbolo, v.costo_directo, 1
      FROM app.wbs_nodo n, app.apu_version v
     WHERE n.id = pc AND v.id = (SELECT version_vigente_id FROM app.apu WHERE codigo = 'APU-0001'
                                    AND tenant_id = n.tenant_id)
    RETURNING id;
$$;
CREATE FUNCTION pg_temp.cap(pp uuid, padre uuid, nom text) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
    SELECT tenant_id, id, padre, nom, CASE WHEN padre IS NULL THEN 'DIRECTO' END
      FROM app.presupuesto WHERE id = pp RETURNING id;
$$;
-- Llamadas a una función en esta transacción.
CREATE FUNCTION pg_temp.llamadas(f text) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(pg_stat_get_xact_function_calls(f::regprocedure), 0);
$$;

-- Una EDT de tres niveles: 3 capítulos, 2 subcapítulos en cada uno, y
-- actividades en todos los niveles.
SELECT pg_temp.cap(:'p', NULL, 'C1') AS c1 \gset
SELECT pg_temp.cap(:'p', NULL, 'C2') AS c2 \gset
SELECT pg_temp.cap(:'p', NULL, 'C3') AS c3 \gset
SELECT pg_temp.cap(:'p', :'c1', 'S11') AS s11 \gset
SELECT pg_temp.cap(:'p', :'c1', 'S12') AS s12 \gset
SELECT pg_temp.cap(:'p', :'c2', 'S21') AS s21 \gset
SELECT pg_temp.cap(:'p', :'s11', 'T111') AS t111 \gset
SELECT pg_temp.act(:'c1') AS i1 \gset
SELECT pg_temp.act(:'c1') AS i2 \gset
SELECT pg_temp.act(:'s11') AS i3 \gset
SELECT pg_temp.act(:'t111') AS i4 \gset
SELECT pg_temp.act(:'c3') AS i5 \gset

-- ============================================================================
--  1 · Qué dispara qué
-- ============================================================================
SELECT pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') AS w0,
       pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') AS r0 \gset
UPDATE app.presupuesto_item SET cantidad = 7 WHERE id = :'i3';
INSERT INTO resultado
SELECT 'editar cantidad · no renumera nada (ni el total del capítulo que se recalcula)',
       (pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') - :w0) || '/' ||
       (pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') - :r0), '0/0';

SELECT pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') AS w0,
       pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') AS r0 \gset
UPDATE app.wbs_nodo SET nombre = 'Cimentación' WHERE id = :'c2';
INSERT INTO resultado
SELECT 'renombrar capítulo · no renumera nada',
       (pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') - :w0) || '/' ||
       (pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') - :r0), '0/0';

SELECT pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') AS w0,
       pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') AS r0 \gset
SELECT pg_temp.act(:'s12') AS i6 \gset
INSERT INTO resultado
SELECT 'agregar actividad · renumera solo su rama',
       (pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') - :w0) || '/' ||
       (pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') - :r0), '0/1';
INSERT INTO resultado
SELECT 'agregar actividad · queda después de los subcapítulos de su padre',
       codigo_item, '1.2.1' FROM app.presupuesto_item WHERE id = :'i6';

SELECT pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') AS w0,
       pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') AS r0 \gset
DELETE FROM app.presupuesto_item WHERE id = :'i1';
INSERT INTO resultado
SELECT 'borrar actividad · renumera solo su rama, y la hermana sube',
       (pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') - :w0) || '/' ||
       (pg_temp.llamadas('app.fn_renumerar_rama(uuid,uuid[])') - :r0) || '/' ||
       (SELECT codigo_item FROM app.presupuesto_item WHERE id = :'i2'), '0/1/1.3';

SELECT pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') AS w0 \gset
SELECT pg_temp.cap(:'p', :'c3', 'S31') AS s31 \gset
INSERT INTO resultado
SELECT 'agregar subcapítulo · renumera el proyecto, y la actividad del capítulo cede su lugar',
       (pg_temp.llamadas('app.fn_renumerar_wbs(uuid)') - :w0)::text || '/' ||
       (SELECT codigo_item FROM app.presupuesto_item WHERE id = :'i5'), '1/3.2';

-- Una sola sentencia que agrega en tres capítulos a la vez.
INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id, apu_id,
    apu_version_id, codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
SELECT x.tenant_id, x.presupuesto_id, n.id, x.apu_id, x.apu_version_id, x.codigo_apu,
       'Lote', x.unidad_simbolo, x.precio_unitario, 2
  FROM app.wbs_nodo n, (SELECT * FROM app.presupuesto_item WHERE id = :'i2') x
 WHERE n.id IN (:'c1', :'s21', :'t111');
INSERT INTO resultado
SELECT 'lote en tres capítulos · la completa no encuentra nada que corregir',
       app.fn_renumerar_wbs(:'p')::text, '0';

-- ============================================================================
--  2 · El invariante, con 300 operaciones al azar
-- ============================================================================
SELECT setseed(0.79);
CREATE TEMP TABLE fallas (paso int, op text, filas int);
DO $$
DECLARE
    p uuid := (SELECT id FROM app.presupuesto WHERE codigo = 'P79');
    k int; op text; nodo uuid; it uuid; n int; pos int; nodos int; z int; nom int := 0;
BEGIN
    FOR k IN 1..300 LOOP
        op := (ARRAY['agregar','agregar','agregar','lote','borrar','mover','mover','cantidad',
                     'subcapitulo','subcapitulo','renombrar','borrar_sub'])[1 + floor(random() * 12)::int];
        SELECT id INTO nodo FROM app.wbs_nodo WHERE presupuesto_id = p ORDER BY random() LIMIT 1;
        SELECT id INTO it   FROM app.presupuesto_item WHERE presupuesto_id = p ORDER BY random() LIMIT 1;
        BEGIN
            IF op = 'agregar' THEN
                PERFORM pg_temp.act(nodo);
            ELSIF op = 'borrar' AND it IS NOT NULL
                  AND (SELECT count(*) FROM app.presupuesto_item WHERE presupuesto_id = p) > 40 THEN
                DELETE FROM app.presupuesto_item WHERE id = it;
            ELSIF op = 'mover' AND it IS NOT NULL THEN
                SELECT wbs_nodo_id INTO nodo FROM app.presupuesto_item WHERE id = it;
                SELECT count(*) INTO nodos FROM app.wbs_nodo WHERE padre_id = nodo;
                SELECT count(*) INTO n FROM app.presupuesto_item WHERE wbs_nodo_id = nodo;
                pos := nodos + 1 + floor(random() * n)::int;
                PERFORM app.fn_mover_en_edt(it, pos);
            ELSIF op = 'cantidad' AND it IS NOT NULL THEN
                UPDATE app.presupuesto_item SET cantidad = 1 + floor(random() * 50) WHERE id = it;
            ELSIF op = 'subcapitulo' THEN
                IF (SELECT nivel FROM app.wbs_nodo WHERE id = nodo) < 3 THEN
                    nom := nom + 1;
                    PERFORM pg_temp.cap(p, nodo, 'N' || nom);
                END IF;
            ELSIF op = 'renombrar' THEN
                UPDATE app.wbs_nodo SET nombre = 'R' || k WHERE id = nodo;
            ELSIF op = 'lote' THEN
                INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id, apu_id,
                    apu_version_id, codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
                SELECT x.tenant_id, x.presupuesto_id, w.id, x.apu_id, x.apu_version_id, x.codigo_apu,
                       'Lote', x.unidad_simbolo, x.precio_unitario, 1
                  FROM (SELECT id FROM app.wbs_nodo WHERE presupuesto_id = p ORDER BY random() LIMIT 3) w,
                       (SELECT * FROM app.presupuesto_item WHERE presupuesto_id = p LIMIT 1) x;
            ELSIF op = 'borrar_sub' AND (SELECT count(*) FROM app.wbs_nodo WHERE presupuesto_id = p) > 12 THEN
                -- Un subcapítulo sin hijos: con él se van sus actividades.
                DELETE FROM app.wbs_nodo
                 WHERE id = (SELECT w.id FROM app.wbs_nodo w
                              WHERE w.presupuesto_id = p AND w.padre_id IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM app.wbs_nodo h WHERE h.padre_id = w.id)
                              ORDER BY random() LIMIT 1);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Una operación que la base rechaza por sus reglas no es una falla
            -- de la numeración; se anota para saber cuántas corrieron de verdad.
            INSERT INTO fallas VALUES (k, op || ' rechazada: ' || SQLERRM, -1);
            CONTINUE;
        END;
        z := app.fn_renumerar_wbs(p);
        IF z <> 0 THEN
            INSERT INTO fallas VALUES (k, op, z);
        END IF;
    END LOOP;
END $$;

INSERT INTO resultado
SELECT 'invariante · después de cada operación, nada que corregir',
       count(*) FILTER (WHERE filas > 0)::text, '0' FROM fallas;
INSERT INTO resultado
SELECT 'invariante · casi todas las operaciones corrieron de verdad',
       (count(*) FILTER (WHERE filas = -1) < 30)::text, 'true' FROM fallas;
INSERT INTO resultado
SELECT 'invariante · el árbol quedó con sustancia (más de 60 actividades y 10 capítulos)',
       ((SELECT count(*) FROM app.presupuesto_item WHERE presupuesto_id = :'p') > 60
        AND (SELECT count(*) FROM app.wbs_nodo WHERE presupuesto_id = :'p') > 10)::text
       || ' (' || (SELECT count(*) FROM app.presupuesto_item WHERE presupuesto_id = :'p')
       || ' actividades, ' || (SELECT count(*) FROM app.wbs_nodo WHERE presupuesto_id = :'p') || ' capítulos)',
       NULL;
UPDATE resultado SET esperado = obtenido WHERE caso LIKE 'invariante · el árbol quedó con sustancia%' AND obtenido LIKE 'true%';
UPDATE resultado SET esperado = 'true' WHERE caso LIKE 'invariante · el árbol quedó con sustancia%' AND esperado IS NULL;
INSERT INTO resultado
SELECT 'invariante · los hermanos van de 1 a n sin repetir',
       count(*)::text, '0'
  FROM (SELECT padre, array_agg(orden ORDER BY orden) AS o, count(*) AS c FROM (
          SELECT padre_id AS padre, orden FROM app.wbs_nodo WHERE presupuesto_id = :'p'
          UNION ALL SELECT wbs_nodo_id, orden FROM app.presupuesto_item WHERE presupuesto_id = :'p') h
        GROUP BY padre) g
 WHERE o <> (SELECT array_agg(x ORDER BY x) FROM generate_series(1, c::int) x);

\echo ''
\echo '=== Operaciones rechazadas por las reglas de la base, por motivo'
SELECT split_part(op, ':', 1) AS operacion, count(*) FROM fallas WHERE filas = -1 GROUP BY 1 ORDER BY 2 DESC;
SELECT min(op) FROM fallas WHERE filas = -1;
SELECT count(*) AS actividades FROM app.presupuesto_item WHERE presupuesto_id = :'p';
SELECT count(*) AS capitulos FROM app.wbs_nodo WHERE presupuesto_id = :'p';
\echo ''
\echo '=== Operaciones donde la renumeración por rama se equivocó (lo correcto es ninguna)'
SELECT * FROM fallas WHERE filas > 0 ORDER BY paso LIMIT 20;

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
          '% de % casos de D-79 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-79 verificado: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
