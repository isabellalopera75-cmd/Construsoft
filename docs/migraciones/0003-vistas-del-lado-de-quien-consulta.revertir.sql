-- =============================================================================
--  Revierte la migración 0003 · D-80. La verificación vuelve a mirar solo
--  tablas y funciones, y v_parametros vuelve a consultar como su dueño.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(3);

CREATE OR REPLACE FUNCTION plataforma.fn_migracion_verificar()
RETURNS void LANGUAGE plpgsql
SET search_path = plataforma, app, pg_temp AS $$
DECLARE v_rls text; v_def text;
BEGIN
    SELECT string_agg(x::text, E'\n  ') INTO v_rls FROM app.fn_verificar_rls() x;
    IF v_rls IS NOT NULL THEN
        RAISE EXCEPTION E'La migración deja tablas de empresa sin aislar (D-77):\n  %', v_rls;
    END IF;
    SELECT string_agg(funcion || ' (' || problema || ')', E'\n  ')
      INTO v_def FROM app.fn_verificar_funciones();
    IF v_def IS NOT NULL THEN
        RAISE EXCEPTION E'La migración deja funciones SECURITY DEFINER mal aseguradas (D-77):\n  %', v_def;
    END IF;
END $$;
REVOKE ALL ON FUNCTION plataforma.fn_migracion_verificar() FROM PUBLIC;

ALTER VIEW plataforma.v_parametros RESET (security_invoker);

SELECT plataforma.fn_migracion_verificar();
COMMIT;
