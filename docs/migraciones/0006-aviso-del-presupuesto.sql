-- =============================================================================
--  Migración 0006 · D-93 · El aviso de que el presupuesto cambió.
--
--  Decisión del dueño, 20 de octubre de 2026. Un cambio del presupuesto deja
--  el cronograma desactualizado, y la API lo recalcula la próxima vez que
--  alguien lo abre (D-91). Quien lo abre primero lo recalcula, y para los
--  demás ya no queda nada «desde el último cálculo». Por eso el aviso se
--  guarda: queda a la vista de todos los que abren el cronograma hasta que
--  alguien con permiso de editar lo cierra o guarda un cambio en el
--  cronograma.
--
--  Guarda QUÉ cambió, no solo que cambió: actividades que entraron o salieron,
--  duraciones que se movieron y el fin del proyecto antes y después. Eso no se
--  puede reconstruir después, porque la base no guarda las duraciones de
--  ayer. Lo arma la API en el recálculo que provoca un cambio del presupuesto
--  y lo va acumulando si hay varios antes de que alguien lo cierre. Su forma la
--  fija el CONTRATO §19; la base solo exige que sea un objeto.
--
--  No es una entrada del cronograma: lo escribe el recálculo, que corre en
--  cualquier estado del presupuesto (D-89), y el guardián de la RN-34 no lo
--  mira.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(6, 'aviso-del-presupuesto');

ALTER TABLE app.cronograma
    ADD COLUMN aviso_presupuesto jsonb
        CONSTRAINT ck_cronograma_aviso
        CHECK (aviso_presupuesto IS NULL OR jsonb_typeof(aviso_presupuesto) = 'object');
COMMENT ON COLUMN app.cronograma.aviso_presupuesto IS
  'D-93 · Lo que cambió en el presupuesto desde que alguien cerró el aviso o '
  'guardó un cambio en el cronograma. Nulo: no hay aviso. Lo escribe la API al '
  'recalcular por un cambio del presupuesto; lo anula al cerrarlo o al guardar.';

GRANT UPDATE (aviso_presupuesto) ON app.cronograma TO construsoft_app;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
