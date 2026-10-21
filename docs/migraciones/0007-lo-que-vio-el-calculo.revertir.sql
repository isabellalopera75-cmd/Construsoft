-- =============================================================================
--  Revierte la migración 0007 · D-94 · Lo que vio el cálculo anterior.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(7);

REVOKE UPDATE (calculado_valor_total) ON app.cronograma FROM construsoft_app;
ALTER TABLE app.actividad_calculo DROP COLUMN en_presupuesto;
ALTER TABLE app.cronograma DROP CONSTRAINT ck_cronograma_valor_calculado,
                           DROP COLUMN calculado_valor_total;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
