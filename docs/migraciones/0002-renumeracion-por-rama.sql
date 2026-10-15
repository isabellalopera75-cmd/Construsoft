-- =============================================================================
--  Migración 0002 · D-79 · La renumeración, solo cuando cambia la estructura y
--  solo donde cambia.
--
--  Medido el 14 de octubre de 2026 en un proyecto de 60 capítulos y 1.500
--  actividades: editar UNA cantidad costaba 32 ms, y casi todo era renumerar el
--  proyecto entero. Dos motivos:
--
--    1. Los disparadores de UPDATE renumeraban ante cualquier cambio de la
--       fila. Editar una cantidad recalcula el total del capítulo
--       (wbs_nodo.monto_acumulado), y ese UPDATE del capítulo disparaba la
--       renumeración completa sin que la estructura hubiera cambiado. Igual al
--       renombrar un capítulo o al repuntar precios. Desde aquí, un UPDATE
--       renumera solo si cambió el padre o el orden de alguna fila.
--
--    2. Agregar o borrar una actividad renumeraba todo el árbol. Pero una
--       actividad no cambia nada fuera de su capítulo: los capítulos van
--       primero (D-75) y su ancho de cifras depende solo de cuántos capítulos
--       hay, nunca de las actividades. Así que cuando una sentencia solo toca
--       actividades, se renumeran solo las actividades de los capítulos
--       afectados (fn_renumerar_rama), con la misma regla que la completa:
--       lugar = subcapítulos del padre + posición por (orden, id), y código =
--       código del padre + «.» + lugar.
--
--  Lo que toca capítulos —crear, borrar, mover, cambiar de padre— sigue
--  renumerando el proyecto entero: es lo que puede cambiar el ancho de un nivel.
--
--  El invariante que lo vigila: después de cualquier operación, la
--  renumeración completa no encuentra nada que corregir (prueba-d79.sql).
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(2, 'renumeracion-por-rama');

CREATE OR REPLACE FUNCTION app.fn_renumerar_rama(p_presupuesto_id uuid, p_padres uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_estado text; v_n integer;
BEGIN
    SELECT tenant_id, estado INTO v_tenant, v_estado
      FROM app.presupuesto WHERE id = p_presupuesto_id FOR NO KEY UPDATE;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');
    IF v_estado <> 'ABIERTO' THEN
        RAISE EXCEPTION
          'El presupuesto está en estado %: su estructura es la línea base y no '
          'se renumera (RN-04, RF-PRE-32).', v_estado;
    END IF;

    SET CONSTRAINTS app.presupuesto_item_presupuesto_id_codigo_item_key,
                    app.presupuesto_item_wbs_nodo_id_orden_key DEFERRED;
    PERFORM set_config('app.renumerando', p_presupuesto_id::text, true);

    -- La misma regla que fn_renumerar_wbs, para las actividades de esos padres:
    -- detrás de los subcapítulos (D-75), por (orden, id), sin ceros (D-75).
    WITH padres AS (
        SELECT n.id, n.codigo_wbs,
               (SELECT count(*) FROM app.wbs_nodo h WHERE h.padre_id = n.id) AS nodos
          FROM app.wbs_nodo n
         WHERE n.id = ANY (p_padres) AND n.presupuesto_id = p_presupuesto_id
    ), nuevo AS (
        SELECT i.id,
               (p.nodos + row_number() OVER (PARTITION BY i.wbs_nodo_id
                                              ORDER BY i.orden, i.id))::integer AS lugar,
               p.codigo_wbs
          FROM app.presupuesto_item i JOIN padres p ON p.id = i.wbs_nodo_id
    )
    UPDATE app.presupuesto_item i
       SET orden = n.lugar, codigo_item = n.codigo_wbs || '.' || n.lugar
      FROM nuevo n
     WHERE i.id = n.id
       AND (i.orden, i.codigo_item) IS DISTINCT FROM (n.lugar, n.codigo_wbs || '.' || n.lugar);
    GET DIAGNOSTICS v_n = ROW_COUNT;

    PERFORM set_config('app.renumerando', '', true);
    RETURN v_n;
END $$;
COMMENT ON FUNCTION app.fn_renumerar_rama(uuid, uuid[]) IS
  'D-79. Renumera solo las actividades de unos capítulos. Da lo mismo que '
  'fn_renumerar_wbs cuando la sentencia no tocó capítulos.';

-- Capítulos: igual que antes, pero un UPDATE que no movió nada no renumera.
CREATE OR REPLACE FUNCTION app.fn_disparar_renumeracion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    IF app.fn_bandera_interna('app.renumerando')
       OR app.fn_bandera_interna('app.purga_tenant') THEN
        RETURN NULL;
    END IF;
    -- D-79 · Renombrar, reclasificar o recalcular el total de un capítulo no
    -- cambia la estructura: no hay nada que renumerar.
    -- (Dos IF y no uno con AND: PL/pgSQL evalúa la condición entera como una
    -- sola consulta, y en un INSERT la tabla «antes» no existe.)
    IF TG_OP = 'UPDATE' THEN
        IF NOT EXISTS (SELECT 1 FROM afectados d JOIN antes a ON a.id = d.id
                        WHERE (d.padre_id, d.orden) IS DISTINCT FROM (a.padre_id, a.orden)) THEN
            RETURN NULL;
        END IF;
    END IF;
    FOR r IN
        SELECT DISTINCT p.id
          FROM app.presupuesto p
         WHERE p.estado = 'ABIERTO'
           AND p.id IN (SELECT presupuesto_id FROM afectados)
    LOOP
        PERFORM app.fn_renumerar_wbs(r.id);
    END LOOP;
    RETURN NULL;
END $$;

-- Actividades: solo sus capítulos, y solo si cambió algo de la estructura.
CREATE OR REPLACE FUNCTION app.fn_disparar_renumeracion_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    IF app.fn_bandera_interna('app.renumerando')
       OR app.fn_bandera_interna('app.purga_tenant') THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- Editar la cantidad, el precio o la descripción no mueve nada.
        IF NOT EXISTS (SELECT 1 FROM afectados d JOIN antes a ON a.id = d.id
                        WHERE (d.wbs_nodo_id, d.orden) IS DISTINCT FROM (a.wbs_nodo_id, a.orden)) THEN
            RETURN NULL;
        END IF;
        FOR r IN
            SELECT x.presupuesto_id, array_agg(DISTINCT x.padre) AS padres
              FROM (SELECT presupuesto_id, wbs_nodo_id AS padre FROM afectados
                    UNION SELECT presupuesto_id, wbs_nodo_id FROM antes) x
              JOIN app.presupuesto p ON p.id = x.presupuesto_id AND p.estado = 'ABIERTO'
             GROUP BY x.presupuesto_id
        LOOP
            PERFORM app.fn_renumerar_rama(r.presupuesto_id, r.padres);
        END LOOP;
        RETURN NULL;
    END IF;
    FOR r IN
        SELECT x.presupuesto_id, array_agg(DISTINCT x.wbs_nodo_id) AS padres
          FROM afectados x
          JOIN app.presupuesto p ON p.id = x.presupuesto_id AND p.estado = 'ABIERTO'
         GROUP BY x.presupuesto_id
    LOOP
        PERFORM app.fn_renumerar_rama(r.presupuesto_id, r.padres);
    END LOOP;
    RETURN NULL;
END $$;

-- Los UPDATE necesitan ver el antes y el después.
DROP TRIGGER tg_renumerar_wbs_upd ON app.wbs_nodo;
CREATE TRIGGER tg_renumerar_wbs_upd AFTER UPDATE ON app.wbs_nodo
    REFERENCING OLD TABLE AS antes NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();

DROP TRIGGER tg_renumerar_item_ins ON app.presupuesto_item;
DROP TRIGGER tg_renumerar_item_upd ON app.presupuesto_item;
DROP TRIGGER tg_renumerar_item_del ON app.presupuesto_item;
CREATE TRIGGER tg_renumerar_item_ins AFTER INSERT ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion_item();
CREATE TRIGGER tg_renumerar_item_upd AFTER UPDATE ON app.presupuesto_item
    REFERENCING OLD TABLE AS antes NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion_item();
CREATE TRIGGER tg_renumerar_item_del AFTER DELETE ON app.presupuesto_item
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion_item();

ALTER FUNCTION app.fn_renumerar_rama(uuid, uuid[]) OWNER TO construsoft_owner;
REVOKE ALL ON FUNCTION app.fn_renumerar_rama(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_renumerar_rama(uuid, uuid[]) TO construsoft_app;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
