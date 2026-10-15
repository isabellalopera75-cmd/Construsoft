-- =============================================================================
--  Revierte la migración 0002 · D-79. Vuelve a renumerar el proyecto entero
--  ante cualquier cambio, como el esquema inicial.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(2);

DROP TRIGGER tg_renumerar_wbs_upd  ON app.wbs_nodo;
DROP TRIGGER tg_renumerar_item_ins ON app.presupuesto_item;
DROP TRIGGER tg_renumerar_item_upd ON app.presupuesto_item;
DROP TRIGGER tg_renumerar_item_del ON app.presupuesto_item;
DROP TRIGGER tg_renumerar_wbs_ins  ON app.wbs_nodo;
DROP TRIGGER tg_renumerar_wbs_del  ON app.wbs_nodo;

CREATE OR REPLACE FUNCTION app.fn_disparar_renumeracion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    IF app.fn_bandera_interna('app.renumerando')
       OR app.fn_bandera_interna('app.purga_tenant') THEN
        RETURN NULL;
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

CREATE TRIGGER tg_renumerar_wbs_ins AFTER INSERT ON app.wbs_nodo
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_wbs_upd AFTER UPDATE ON app.wbs_nodo
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_wbs_del AFTER DELETE ON app.wbs_nodo
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_item_ins AFTER INSERT ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_item_upd AFTER UPDATE ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_item_del AFTER DELETE ON app.presupuesto_item
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();

DROP FUNCTION app.fn_disparar_renumeracion_item();
DROP FUNCTION app.fn_renumerar_rama(uuid, uuid[]);

SELECT plataforma.fn_migracion_verificar();
COMMIT;
