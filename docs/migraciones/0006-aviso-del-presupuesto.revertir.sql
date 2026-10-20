-- =============================================================================
--  Revierte la migración 0006 · D-93 · El aviso de que el presupuesto cambió.
--  Los avisos abiertos se pierden: el cronograma sigue igual.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(6);

REVOKE UPDATE (aviso_presupuesto) ON app.cronograma FROM construsoft_app;
ALTER TABLE app.cronograma DROP COLUMN aviso_presupuesto;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
