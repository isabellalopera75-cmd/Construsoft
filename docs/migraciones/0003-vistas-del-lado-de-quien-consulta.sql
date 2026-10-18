-- =============================================================================
--  Migración 0003 · D-80 · Toda vista consulta con los permisos de quien la lee.
--
--  El 05 endurece las vistas al final del archivo: les pone dueño y
--  security_invoker = true, para que una vista aplique la RLS de QUIEN consulta
--  y no la de su dueño. Ese bloque corre una vez, al cargar el 05, así que no
--  alcanza a las vistas que nacen después en una migración.
--
--  Le pasó a la primera: plataforma.v_parametros (migración 0001, D-78) quedó
--  sin security_invoker. Lo encontró la revisión de la documentación del 16 de
--  octubre de 2026, al contar las vistas de la base para el LEEME. No expuso
--  nada: la vista lee plazos de la plataforma, que no son de ninguna empresa,
--  y solo el panel tiene SELECT sobre ella. Pero la regla del 05 dice que la
--  primera vista sin ese ajuste es la que filtra inquilinos, y la verificación
--  de las migraciones no la vigilaba.
--
--  Dos cosas:
--    1. v_parametros pasa a security_invoker. El panel ya tenía SELECT sobre
--       las dos tablas que lee, así que sigue viendo lo mismo.
--    2. fn_migracion_verificar se niega a terminar una migración que deje una
--       vista de app o plataforma sin security_invoker. Así la próxima no
--       depende de que alguien se acuerde.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(3, 'vistas-del-lado-de-quien-consulta');

ALTER VIEW plataforma.v_parametros SET (security_invoker = true);

CREATE OR REPLACE FUNCTION plataforma.fn_migracion_verificar()
RETURNS void LANGUAGE plpgsql
SET search_path = plataforma, app, pg_temp AS $$
DECLARE v_rls text; v_def text; v_vis text;
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
    -- D-80 · Una vista sin security_invoker aplica la RLS de su dueño, no la de
    -- quien consulta.
    SELECT string_agg(n.nspname || '.' || c.relname, E'\n  ' ORDER BY 1)
      INTO v_vis
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'v' AND n.nspname IN ('app', 'plataforma')
       AND NOT coalesce('security_invoker=true' = ANY (c.reloptions)
                        OR 'security_invoker=on' = ANY (c.reloptions), false);
    IF v_vis IS NOT NULL THEN
        RAISE EXCEPTION E'La migración deja vistas sin security_invoker (D-80):\n  %', v_vis;
    END IF;
END $$;
REVOKE ALL ON FUNCTION plataforma.fn_migracion_verificar() FROM PUBLIC;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
