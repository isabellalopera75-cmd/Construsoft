-- ============================================================================
--  PRUEBA DE D-80 · Toda vista consulta con los permisos de quien la lee.
--
--      psql -U postgres -d construsoft -f "docs/prueba-d80.sql"
--
--  Necesita la migración 0003. Comprueba que v_parametros quedó con
--  security_invoker y sigue sirviéndole al panel y no a la aplicación, y que la
--  verificación de las migraciones rechaza una vista nueva sin ese ajuste.
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
    RAISE EXCEPTION 'prueba-d80 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;
CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT ALL ON resultado TO PUBLIC;

-- 1. La vista quedó del lado de quien consulta.
INSERT INTO resultado
SELECT '01 v_parametros con security_invoker',
       coalesce('security_invoker=true' = ANY (c.reloptions), false)::text, 'true'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'plataforma' AND c.relname = 'v_parametros';

-- 2. Ninguna vista de app o plataforma sin el ajuste.
INSERT INTO resultado
SELECT '02 vistas sin security_invoker', count(*)::text, '0'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'v' AND n.nspname IN ('app', 'plataforma')
   AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false);

-- 3. El panel la sigue leyendo entera.
SET LOCAL ROLE construsoft_superadmin;
INSERT INTO resultado SELECT '03 el panel ve los cinco plazos', count(*)::text, '5' FROM plataforma.v_parametros;
RESET ROLE;

-- 4. La aplicación no la lee.
SET LOCAL ROLE construsoft_app;
DO $$
BEGIN
    PERFORM 1 FROM plataforma.v_parametros;
    INSERT INTO resultado VALUES ('04 la aplicación no lee la vista', 'la leyó', 'rechazado');
EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO resultado VALUES ('04 la aplicación no lee la vista', 'rechazado', 'rechazado');
END $$;
RESET ROLE;

-- 5. La verificación rechaza una vista nueva sin el ajuste.
DO $$
BEGIN
    CREATE VIEW plataforma.v_prueba_d80 AS SELECT clave FROM plataforma.parametro;
    BEGIN
        PERFORM plataforma.fn_migracion_verificar();
        INSERT INTO resultado VALUES ('05 vista sin security_invoker', 'aceptada', 'rechazada');
    EXCEPTION WHEN raise_exception THEN
        INSERT INTO resultado VALUES ('05 vista sin security_invoker',
            CASE WHEN SQLERRM LIKE '%v_prueba_d80%' THEN 'rechazada' ELSE SQLERRM END, 'rechazada');
    END;
    -- 6. Con el ajuste, la misma vista pasa.
    ALTER VIEW plataforma.v_prueba_d80 SET (security_invoker = true);
    BEGIN
        PERFORM plataforma.fn_migracion_verificar();
        INSERT INTO resultado VALUES ('06 la misma vista con el ajuste', 'aceptada', 'aceptada');
    EXCEPTION WHEN raise_exception THEN
        INSERT INTO resultado VALUES ('06 la misma vista con el ajuste', SQLERRM, 'aceptada');
    END;
    DROP VIEW plataforma.v_prueba_d80;
END $$;

-- 7. La base de hoy pasa la verificación.
DO $$
BEGIN
    PERFORM plataforma.fn_migracion_verificar();
    INSERT INTO resultado VALUES ('07 la base de hoy pasa la verificación', 'pasa', 'pasa');
EXCEPTION WHEN raise_exception THEN
    INSERT INTO resultado VALUES ('07 la base de hoy pasa la verificación', SQLERRM, 'pasa');
END $$;

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
          '% de % casos de D-80 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-80 verificado: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
