-- ============================================================================
--  PRUEBA DEL INVARIANTE DE LA EDT (D-69)
--
--      psql -U postgres -d construsoft -f "docs/prueba-edt.sql"
--
--  Comprueba, después de quince operaciones de estructura, dos cosas sobre todo
--  el presupuesto: que los «orden» de los hermanos de un mismo padre son
--  exactamente 1..n sin repetir, y que ningún código se repite entre wbs_nodo y
--  presupuesto_item. Lo segundo no lo puede garantizar ninguna restricción,
--  porque las dos claves de unicidad del código son por tabla.
--
--  Se juzga sola: levanta una excepción y sale con código 3 si algún caso
--  discrepa. Contra el esquema anterior a D-69 fallan los casos 14 y 15.
--
--  Los doce primeros casos pasan TAMBIÉN con el esquema roto: los movimientos
--  previos deshacen la configuración que dispara el defecto. Por eso el 13 al
--  15 se arman en un subárbol propio y sin nada que los haya movido. Un
--  invariante que no se puede poner en rojo no prueba nada.
--
--  No deja nada: termina con ROLLBACK. Necesita una base recién cargada.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO: inserta en app.*'
\echo '  con «orden» explícito, que la conexión de la aplicación no puede.'
\echo ''
\echo '      psql -U postgres -d construsoft -f "docs/prueba-edt.sql"'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION
      'prueba-edt se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off
BEGIN;
CREATE TEMP TABLE r (caso text, obtenido text, esperado text);

-- Comprueba, para TODO el presupuesto: los orden de los hermanos de cada padre
-- son 1..n sin repetir, y ningún código se repite entre las dos tablas.
CREATE FUNCTION pg_temp.mirar(p uuid) RETURNS text LANGUAGE sql AS $$
    WITH h AS (
        SELECT padre_id AS padre, orden, codigo_wbs AS codigo FROM app.wbs_nodo
         WHERE presupuesto_id = p
        UNION ALL
        SELECT wbs_nodo_id, orden, codigo_item FROM app.presupuesto_item
         WHERE presupuesto_id = p
    ), por_padre AS (
        SELECT padre, count(*) AS n, count(DISTINCT orden) AS d,
               min(orden) AS mn, max(orden) AS mx
          FROM h GROUP BY padre
    )
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM por_padre WHERE n <> d OR mn <> 1 OR mx <> n)
            THEN 'ORDEN ROTO'
        WHEN (SELECT count(*) FROM h) <> (SELECT count(DISTINCT codigo) FROM h)
            THEN 'CODIGO REPETIDO'
        ELSE 'OK' END;
$$;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'A SAS','900.1-1','EMPRESARIAL','Ana','ana@a.co','h') \gset
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda)
VALUES (:'t','P','P','M','COP') RETURNING id AS p \gset
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t' LIMIT 1 \gset
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id,
                         precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t','R','R','MATERIAL', :'um',1000,0,1000,'BASE') RETURNING id AS rec \gset

-- Un APU reutilizable y una función corta para colgar actividades.
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id)
VALUES (:'t','A1','Act', :'um') RETURNING id AS apu \gset
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1))) AS ver \gset
SELECT unidad_simbolo AS sim FROM app.apu_version WHERE id = :'ver' \gset

CREATE FUNCTION pg_temp.act(pt uuid, pp uuid, pn uuid, pa uuid, pv uuid,
                            ps text, nom text, ord integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
    IF ord IS NULL THEN
        INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id,
            apu_id, apu_version_id, codigo_apu, descripcion, unidad_simbolo,
            precio_unitario, cantidad)
        VALUES (pt, pp, pn, pa, pv, 'A1', nom, ps, 1000, 1) RETURNING id INTO v;
    ELSE
        INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id,
            apu_id, apu_version_id, codigo_apu, descripcion, unidad_simbolo,
            precio_unitario, cantidad, orden)
        VALUES (pt, pp, pn, pa, pv, 'A1', nom, ps, 1000, 1, ord) RETURNING id INTO v;
    END IF;
    RETURN v;
END $$;

-- Un árbol de dos niveles con nodos y actividades mezclados.
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL,'CAP 1','DIRECTO') RETURNING id AS c1 \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre)
VALUES (:'t', :'p', :'c1','S1') RETURNING id AS s1 \gset
SELECT pg_temp.act(:'t', :'p', :'c1', :'apu', :'ver', :'sim','X1') AS x1 \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre)
VALUES (:'t', :'p', :'c1','S2') RETURNING id AS s2 \gset
SELECT pg_temp.act(:'t', :'p', :'s1', :'apu', :'ver', :'sim','Y1') AS y1 \gset
SELECT pg_temp.act(:'t', :'p', :'s1', :'apu', :'ver', :'sim','Y2') AS y2 \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL,'CAP 2','INDIRECTO') RETURNING id AS c2 \gset
INSERT INTO r VALUES ('1 · árbol recién armado', pg_temp.mirar(:'p'), 'OK');

-- agregar al final
SELECT pg_temp.act(:'t', :'p', :'c1', :'apu', :'ver', :'sim','X2') AS x2 \gset
INSERT INTO r VALUES ('2 · agregar una actividad al final', pg_temp.mirar(:'p'), 'OK');

-- Insertar una actividad con un orden repetido NO es alcanzable: la clave
-- unica (wbs_nodo_id, orden) de presupuesto_item es inmediata y lo frena. Lo
-- que si es alcanzable, y es la precondicion del bug, es el choque ENTRE
-- tablas: un nodo y una actividad con el mismo orden bajo el mismo padre, que
-- ninguna de las dos claves puede ver porque son por tabla.
SELECT orden AS o_x1 FROM app.presupuesto_item WHERE id = :'x1' \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, orden)
VALUES (:'t', :'p', :'c1','S-choque', :'o_x1') RETURNING id AS sch \gset
INSERT INTO r VALUES ('3 · un nodo con el mismo orden que una actividad', pg_temp.mirar(:'p'), 'OK');

-- insertar con un orden que deja hueco
SELECT pg_temp.act(:'t', :'p', :'c1', :'apu', :'ver', :'sim','X4', 40) AS x4 \gset
INSERT INTO r VALUES ('4 · insertar con orden que deja hueco', pg_temp.mirar(:'p'), 'OK');

-- un subcapítulo nuevo al final
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre)
VALUES (:'t', :'p', :'c1','S3') RETURNING id AS s3 \gset
INSERT INTO r VALUES ('5 · agregar un subcapítulo al final', pg_temp.mirar(:'p'), 'OK');

-- mover
SELECT app.fn_mover_en_edt(:'x1', 1) AS _ \gset y_
INSERT INTO r VALUES ('6 · mover una actividad al lugar 1', pg_temp.mirar(:'p'), 'OK');
SELECT app.fn_mover_en_edt(:'s2', 2) AS _ \gset y_
INSERT INTO r VALUES ('7 · mover un subcapítulo al lugar 2', pg_temp.mirar(:'p'), 'OK');

-- borrar una actividad del medio
DELETE FROM app.presupuesto_item WHERE id = :'x2';
INSERT INTO r VALUES ('8 · borrar una actividad del medio', pg_temp.mirar(:'p'), 'OK');

-- EL CASO DEL BUG: borrar un subcapítulo que tiene una actividad como hermana
DELETE FROM app.wbs_nodo WHERE id = :'s1';
INSERT INTO r VALUES ('9 · borrar un subcapítulo hermano de una actividad', pg_temp.mirar(:'p'), 'OK');
DELETE FROM app.wbs_nodo WHERE id = :'sch';
INSERT INTO r VALUES ('10 · borrar el nodo que había chocado de orden', pg_temp.mirar(:'p'), 'OK');
DELETE FROM app.wbs_nodo WHERE id = :'s3';
INSERT INTO r VALUES ('11 · y otra vez, con el árbol ya movido', pg_temp.mirar(:'p'), 'OK');

-- borrar un capítulo entero
DELETE FROM app.wbs_nodo WHERE id = :'c2';
INSERT INTO r VALUES ('12 · borrar un capítulo de primer nivel', pg_temp.mirar(:'p'), 'OK');

-- -------------------------------------------------------------------------
--  EL CASO CON DIENTES, en un subárbol propio y sin nada que lo haya movido.
--
--  Los doce casos de arriba pasan TAMBIÉN con el esquema sin arreglar: los
--  movimientos previos deshacen la configuración que dispara el defecto. Un
--  invariante que no se puede poner en rojo no prueba nada, así que este caso
--  se arma limpio y aparte.
--
--  La precondición exacta: tres hermanos [nodo, actividad, nodo] y se borra el
--  PRIMERO. Entonces el nodo de atrás baja al orden que todavía tiene la
--  actividad, y una renumeración en dos pasadas los deja con el mismo código.
-- -------------------------------------------------------------------------
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL,'CAP 3','DIRECTO') RETURNING id AS c3 \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre)
VALUES (:'t', :'p', :'c3','A') RETURNING id AS na \gset
SELECT pg_temp.act(:'t', :'p', :'c3', :'apu', :'ver', :'sim','B') AS nb \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre)
VALUES (:'t', :'p', :'c3','C') RETURNING id AS nc \gset
INSERT INTO r VALUES ('13 · [nodo, actividad, nodo] recién armados', pg_temp.mirar(:'p'), 'OK');

DELETE FROM app.wbs_nodo WHERE id = :'na';
INSERT INTO r VALUES ('14 · borrar el PRIMERO de [nodo, actividad, nodo]', pg_temp.mirar(:'p'), 'OK');

-- Y que el orden que la persona había armado se conserve: la actividad B venía
-- antes del nodo C, y tiene que seguir antes.
-- Se compara el orden y no los códigos literales: los códigos dependen de lo
-- que pasó antes en este mismo guion —CAP 3 queda como «2.0» porque el caso 12
-- borró CAP 2— y una expectativa escrita a mano se rompe al agregar un caso.
-- Lo que importa es la relación, no el número.
INSERT INTO r
SELECT '15 · B sigue antes que C, que es el orden que la persona armó',
       CASE WHEN (SELECT orden FROM app.presupuesto_item WHERE id = :'nb')
                 < (SELECT orden FROM app.wbs_nodo WHERE id = :'nc')
            THEN 'B antes de C'
            ELSE 'ORDEN INVERTIDO: '
                 || (SELECT codigo_item FROM app.presupuesto_item WHERE id = :'nb')
                 || ' y ' || (SELECT codigo_wbs FROM app.wbs_nodo WHERE id = :'nc')
       END,
       'B antes de C';

\echo ''
\echo '=== Casos que no dieron OK (lo correcto es ninguno) ==='
SELECT caso, obtenido FROM r WHERE obtenido <> esperado ORDER BY caso;

\echo ''
\echo '=== Como quedó el árbol ==='
SELECT * FROM (
  SELECT codigo_wbs AS codigo, nivel, orden, nombre, 'nodo' AS tipo
    FROM app.wbs_nodo WHERE presupuesto_id = :'p'
  UNION ALL
  SELECT codigo_item, NULL, orden, descripcion, 'actividad'
    FROM app.presupuesto_item WHERE presupuesto_id = :'p'
) t ORDER BY string_to_array(codigo, '.')::int[];

DO $$
DECLARE v_mal integer; v_total integer;
BEGIN
    SELECT count(*) FILTER (WHERE obtenido <> esperado), count(*)
      INTO v_mal, v_total FROM r;
    IF v_mal > 0 THEN
        RAISE EXCEPTION '% de % casos del invariante fallaron.', v_mal, v_total;
    END IF;
    RAISE NOTICE 'Invariante de la EDT: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
