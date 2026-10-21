-- =============================================================================
--  Migración 0007 · D-94 · Lo que vio el cálculo anterior.
--
--  Completa la D-93. El aviso de que el presupuesto cambió compara el cálculo
--  de ahora con el anterior, y de ese anterior la base guardaba fechas y
--  duraciones, pero no dos datos que el aviso necesita (lo encontró la API el
--  20 de octubre de 2026; el defecto es del diseño de la 0006):
--
--    · El valor total del presupuesto cuando se hizo el cálculo anterior
--      (valorTotalAntes). Ninguna tabla lo conservaba.
--    · Si cada actividad estaba en el presupuesto en ese cálculo. Una actividad
--      cuyo ítem se borró hace un mes y una cuyo ítem se borró hoy se veían
--      iguales, y la franja habría listado las viejas como «salieron».
--
--  Las dos las escribe el recálculo, junto con lo que ya escribe. No son
--  entradas: no pasan por el guardián de la RN-34.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(7, 'lo-que-vio-el-calculo');

ALTER TABLE app.cronograma
    ADD COLUMN calculado_valor_total app.dinero,
    ADD CONSTRAINT ck_cronograma_valor_calculado
        CHECK (calculado_valor_total IS NULL OR calculado_version IS NOT NULL);
COMMENT ON COLUMN app.cronograma.calculado_valor_total IS
  'D-94 · presupuesto.valor_total cuando se hizo el último cálculo. Con él, el '
  'aviso dice cuánto cambió el valor total (D-93).';

-- Los resultados que ya existen se calcularon con el ítem que la actividad
-- tiene hoy: si lo tiene, estaba en el presupuesto.
ALTER TABLE app.actividad_calculo ADD COLUMN en_presupuesto boolean;
UPDATE app.actividad_calculo k
   SET en_presupuesto = (a.presupuesto_item_id IS NOT NULL)
  FROM app.actividad_programada a
 WHERE a.id = k.actividad_id;
ALTER TABLE app.actividad_calculo ALTER COLUMN en_presupuesto SET NOT NULL;
COMMENT ON COLUMN app.actividad_calculo.en_presupuesto IS
  'D-94 · Si la actividad tenía su ítem en el presupuesto cuando se calculó. '
  'Sin valor por defecto: el recálculo lo escribe siempre.';

GRANT UPDATE (calculado_valor_total) ON app.cronograma TO construsoft_app;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
