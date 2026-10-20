-- ============================================================================
--  PRUEBA DE LA MIGRACIÓN 0004 · Cimientos del cronograma
--  D-84 horas por jornal · D-85 rendimiento de la actividad · D-86 calendarios
--  de la empresa · D-90 festivos · D-91 revisión del presupuesto
--
--      psql -U postgres -d construsoft -f "docs/prueba-d84-d91.sql"
--
--  Necesita la migración 0004. Se juzga sola y termina con ROLLBACK. Las
--  reglas que se comprueban al confirmar (tramos sin cruce, un calendario por
--  defecto) se fuerzan con SET CONSTRAINTS … IMMEDIATE dentro de cada caso.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d84-d91 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;
CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT ALL ON resultado TO PUBLIC;

-- Un caso que tiene que fallar: corre la sentencia, fuerza las comprobaciones
-- diferidas y devuelve 'rechazado' o el texto de lo que pasó.
CREATE FUNCTION pg_temp.rechaza(sql text, rol text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
    BEGIN
        IF rol IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', rol); END IF;
        FOREACH s IN ARRAY string_to_array(sql, '§') LOOP
            EXECUTE s;
        END LOOP;
        EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
        EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
        RAISE EXCEPTION 'paso_sin_error';
    EXCEPTION
        WHEN raise_exception THEN
            IF SQLERRM = 'paso_sin_error' THEN RETURN 'aceptado'; END IF;
            RETURN 'rechazado';
        WHEN check_violation OR insufficient_privilege OR unique_violation
             OR foreign_key_violation OR not_null_violation THEN
            RETURN 'rechazado';
    END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.rechaza(text, text) TO PUBLIC;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Calendarios SAS','901.784.001-1','EMPRESARIAL','Ana','ana@d84.co','h') \gset
SELECT id_tenant AS t2, id_usuario AS u2 FROM app.fn_alta_tenant(
  'Otra SAS','901.784.002-1','EMPRESARIAL','Beto','beto@d84.co','h') \gset
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_

-- ============================================================================
--  D-84 · Horas por jornal
-- ============================================================================
INSERT INTO resultado
SELECT '01 la empresa nace con 8 h por jornal y la semana en lunes',
       horas_por_jornal::text || '/' || inicio_semana, '8.00/1'
  FROM app.configuracion_empresa WHERE tenant_id = :'t';
INSERT INTO resultado SELECT '02 horas por jornal en 0 se rechaza',
  pg_temp.rechaza(format('UPDATE app.configuracion_empresa SET horas_por_jornal = 0 WHERE tenant_id = %L', :'t')), 'rechazado';
INSERT INTO resultado SELECT '03 horas por jornal en 25 se rechaza',
  pg_temp.rechaza(format('UPDATE app.configuracion_empresa SET horas_por_jornal = 25 WHERE tenant_id = %L', :'t')), 'rechazado';

UPDATE app.configuracion_empresa SET horas_por_jornal = 9 WHERE tenant_id = :'t';
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t' LIMIT 1 \gset
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura, horas_por_jornal)
VALUES (:'t','P84','P','M','COP','WBS', 3) RETURNING id AS p \gset
INSERT INTO resultado SELECT '04 el presupuesto copia las de la empresa (no las que manda quien inserta)',
  horas_por_jornal::text, '9.00' FROM app.presupuesto WHERE id = :'p';

UPDATE app.configuracion_empresa SET horas_por_jornal = 7 WHERE tenant_id = :'t';
INSERT INTO resultado SELECT '05 cambiar la empresa no mueve el presupuesto',
  horas_por_jornal::text, '9.00' FROM app.presupuesto WHERE id = :'p';
INSERT INTO resultado SELECT '06 la aplicación no puede cambiarlas',
  pg_temp.rechaza(format('UPDATE app.presupuesto SET horas_por_jornal = 5 WHERE id = %L', :'p'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '07 ni siquiera el dueño de las tablas',
  pg_temp.rechaza(format('UPDATE app.presupuesto SET horas_por_jornal = 5 WHERE id = %L', :'p')), 'rechazado';

-- Un APU y una actividad para lo que sigue.
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t','R','R','MATERIAL', :'um', 1000, 0, 1000, 'BASE') RETURNING id AS rec \gset
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id)
VALUES (:'t','APU-0001','Muro', :'um') RETURNING id AS apu \gset
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1)), NULL, NULL, 'Versión inicial') AS ver1 \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL, 'C1', 'DIRECTO') RETURNING id AS c1 \gset
INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
    codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
SELECT :'t', :'p', :'c1', :'apu', v.id, 'APU-0001', 'Muro', v.unidad_simbolo, v.costo_directo, 1
  FROM app.apu_version v WHERE v.id = :'ver1' RETURNING id AS i1 \gset

SELECT app.fn_duplicar_presupuesto(:'p', 'P84B', 'Copia', false) AS pd \gset
INSERT INTO resultado SELECT '08 el duplicado se lleva las de su original, no las de hoy de la empresa',
  horas_por_jornal::text, '9.00' FROM app.presupuesto WHERE id = :'pd';
INSERT INTO resultado SELECT '09 el duplicado nace en revisión 0',
  revision::text, '0' FROM app.presupuesto WHERE id = :'pd';

-- ============================================================================
--  D-91 · La revisión
-- ============================================================================
SELECT revision AS r0 FROM app.presupuesto WHERE id = :'p' \gset
UPDATE app.presupuesto_item SET cantidad = 5 WHERE id = :'i1';
SELECT revision AS r1 FROM app.presupuesto WHERE id = :'p' \gset
INSERT INTO resultado SELECT '10 editar una cantidad sube la revisión',
  (:r1 > :r0)::text, 'true';
UPDATE app.presupuesto SET aiu_utilidad = 5 WHERE id = :'p';
SELECT revision AS r2 FROM app.presupuesto WHERE id = :'p' \gset
INSERT INTO resultado SELECT '11 editar la cabecera sube la revisión', (:r2 > :r1)::text, 'true';
UPDATE app.presupuesto SET archivado_en = now() WHERE id = :'p';
SELECT revision AS r3 FROM app.presupuesto WHERE id = :'p' \gset
INSERT INTO resultado SELECT '12 archivar no la sube (D-58)', (:r3 = :r2)::text, 'true';
UPDATE app.presupuesto SET archivado_en = NULL WHERE id = :'p';
INSERT INTO resultado SELECT '13 la aplicación no puede escribirla',
  pg_temp.rechaza(format('UPDATE app.presupuesto SET revision = 0 WHERE id = %L', :'p'), 'construsoft_app'), 'rechazado';
RESET ROLE;

-- ============================================================================
--  D-85 · El rendimiento de la actividad
-- ============================================================================
INSERT INTO resultado SELECT '14 la versión inicial nace sin rendimiento',
  COALESCE(rendimiento_actividad::text, 'nulo'), 'nulo' FROM app.apu_version WHERE id = :'ver1';
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1)), NULL, NULL, 'Con rendimiento', 5, true) AS ver2 \gset
INSERT INTO resultado SELECT '15 fijarlo crea una versión nueva con él',
  rendimiento_actividad::text || '/' || numero, '5.0000/2' FROM app.apu_version WHERE id = :'ver2';
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',2,'rendimiento',1)), NULL, NULL, 'Edición del APU') AS ver3 \gset
INSERT INTO resultado SELECT '16 una edición que no lo menciona lo hereda (la API de hoy)',
  rendimiento_actividad::text, '5.0000' FROM app.apu_version WHERE id = :'ver3';
INSERT INTO resultado SELECT '17 la versión anterior no cambia (es inmutable)',
  COALESCE(rendimiento_actividad::text, 'nulo'), 'nulo' FROM app.apu_version WHERE id = :'ver1';
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',2,'rendimiento',1)), NULL, NULL, 'Sin rendimiento', NULL, true) AS ver4 \gset
INSERT INTO resultado SELECT '18 quitarlo a propósito lo deja nulo',
  COALESCE(rendimiento_actividad::text, 'nulo'), 'nulo' FROM app.apu_version WHERE id = :'ver4';
INSERT INTO resultado SELECT '19 un rendimiento de cero se rechaza',
  pg_temp.rechaza(format($q$SELECT app.fn_nueva_version_apu(%L, jsonb_build_array(jsonb_build_object('recurso_id', %L,'cantidad',1,'rendimiento',1)), NULL, NULL, 'x', 0, true)$q$, :'apu', :'rec')), 'rechazado';
INSERT INTO resultado SELECT '20 la aplicación puede llamarla con la firma vieja (5 argumentos)',
  pg_temp.rechaza(format($q$SELECT app.fn_nueva_version_apu(%L, jsonb_build_array(jsonb_build_object('recurso_id', %L,'cantidad',1,'rendimiento',1)), NULL, NULL, 'x')$q$, :'apu', :'rec'), 'construsoft_app'), 'aceptado';
RESET ROLE;

-- ============================================================================
--  D-86 · Calendarios de la empresa
-- ============================================================================
SELECT id AS cal FROM app.calendario WHERE tenant_id = :'t' AND por_defecto \gset
INSERT INTO resultado
SELECT '21 la empresa nace con un calendario por defecto: 10 tramos, 40 h, 1 día = 8 h',
       count(*) || '/' || sum(app.fn_minuto_del_dia(fin) - app.fn_minuto_del_dia(inicio)) / 60 || '/' ||
       (SELECT horas_por_dia::text FROM app.calendario WHERE id = :'cal'),
       '10/40/8.00'
  FROM app.calendario_tramo WHERE calendario_id = :'cal';
INSERT INTO resultado
SELECT '22 lunes 7:00-12:00 y 13:00-16:00, sin sábado ni domingo',
       string_agg(dia_semana || ' ' || to_char(inicio, 'HH24:MI') || '-' || to_char(fin, 'HH24:MI'), ', ' ORDER BY dia_semana, inicio)
         FILTER (WHERE dia_semana IN (1, 6, 7)),
       '1 07:00-12:00, 1 13:00-16:00'
  FROM app.calendario_tramo WHERE calendario_id = :'cal';
INSERT INTO resultado SELECT '23 nace sin festivos', count(*)::text, '0'
  FROM app.calendario_excepcion WHERE calendario_id = :'cal';
INSERT INTO resultado SELECT '24 toda empresa que ya existía también tiene el suyo',
  count(*)::text, '0'
  FROM app.configuracion_empresa c
 WHERE NOT EXISTS (SELECT 1 FROM app.calendario k WHERE k.tenant_id = c.tenant_id AND k.por_defecto);

INSERT INTO resultado SELECT '25 dos tramos del mismo día que se cruzan se rechazan',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 1, '11:00', '14:00')$q$, :'t', :'cal')), 'rechazado';
INSERT INTO resultado SELECT '26 un tramo pegado al otro sí entra (12:00-13:00)',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 1, '12:00', '13:00')$q$, :'t', :'cal')), 'aceptado';
INSERT INTO resultado SELECT '27 un tramo que no cae en media hora se rechaza',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 6, '07:15', '12:00')$q$, :'t', :'cal')), 'rechazado';
INSERT INTO resultado SELECT '28 un tramo al revés se rechaza',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 6, '12:00', '07:00')$q$, :'t', :'cal')), 'rechazado';
INSERT INTO resultado SELECT '29 un turno que termina a medianoche se escribe 24:00',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 6, '20:00', '24:00')$q$, :'t', :'cal')), 'aceptado';
INSERT INTO resultado SELECT '30 una semana de 7 días de 24 h son 168 h y entra',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario (tenant_id, nombre) VALUES (%1$L, 'Corrido de prueba') RETURNING id§
     INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
     SELECT %1$L, (SELECT id FROM app.calendario WHERE nombre = 'Corrido de prueba' AND tenant_id = %1$L), d, '00:00', '24:00' FROM generate_series(1,7) d$q$, :'t')), 'aceptado';

INSERT INTO resultado SELECT '31 un segundo calendario por defecto se rechaza',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario (tenant_id, nombre, por_defecto) VALUES (%L, 'Otro', true)$q$, :'t')), 'rechazado';
INSERT INTO resultado SELECT '32 quitarle la marca al único por defecto se rechaza',
  pg_temp.rechaza(format('UPDATE app.calendario SET por_defecto = false WHERE id = %L', :'cal')), 'rechazado';
INSERT INTO resultado SELECT '33 eliminar el calendario por defecto se rechaza',
  pg_temp.rechaza(format('DELETE FROM app.calendario WHERE id = %L', :'cal')), 'rechazado';
INSERT INTO app.calendario (tenant_id, nombre) VALUES (:'t', 'Lunes a sábado') RETURNING id AS cal2 \gset
INSERT INTO resultado SELECT '34 el nombre no se repite (sin distinguir mayúsculas)',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario (tenant_id, nombre) VALUES (%L, 'LUNES A SÁBADO ')$q$, :'t')), 'rechazado';
SELECT app.fn_calendario_por_defecto(:'cal2');
SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
INSERT INTO resultado SELECT '35 cambiar cuál es el de por defecto es un solo paso',
  (SELECT id::text FROM app.calendario WHERE tenant_id = :'t' AND por_defecto), :'cal2';
SELECT app.fn_calendario_por_defecto(:'cal');

INSERT INTO resultado SELECT '36 una excepción con horario propio entra',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_excepcion (tenant_id, calendario_id, fecha, motivo) VALUES (%1$L, %2$L, '2026-12-05', 'Sábado completo')§
     INSERT INTO app.calendario_excepcion_tramo (tenant_id, excepcion_id, inicio, fin)
     SELECT %1$L, id, '07:00', '15:00' FROM app.calendario_excepcion WHERE calendario_id = %2$L AND fecha = '2026-12-05'$q$, :'t', :'cal')), 'aceptado';

-- ============================================================================
--  D-90 · Festivos
-- ============================================================================
SELECT id AS co, anio_hasta AS co_hasta FROM plataforma.lista_festivos WHERE pais = 'CO' \gset
INSERT INTO resultado
SELECT '37 la lista de Colombia trae 2026-2030, las mismas fechas que fn_festivos_colombia',
       (SELECT count(*) FROM plataforma.lista_festivos_fecha WHERE lista_id = :'co')::text,
       (SELECT count(*) FROM generate_series(2026, 2030) a, plataforma.fn_festivos_colombia(a))::text;
INSERT INTO resultado SELECT '38 trae el 1 de enero y el Viernes Santo de 2027',
  (SELECT count(*) FROM plataforma.lista_festivos_fecha WHERE lista_id = :'co' AND fecha IN ('2027-01-01','2027-03-26'))::text, '2';
INSERT INTO resultado SELECT '39 la aplicación la lee',
  pg_temp.rechaza('SELECT 1 FROM plataforma.lista_festivos', 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '40 pero no la modifica',
  pg_temp.rechaza(format($q$DELETE FROM plataforma.lista_festivos_fecha WHERE lista_id = %L$q$, :'co'), 'construsoft_app'), 'rechazado';
RESET ROLE;

-- La empresa trabaja el 8 de diciembre de 2026 antes de copiar la lista.
INSERT INTO app.calendario_excepcion (tenant_id, calendario_id, fecha, motivo)
VALUES (:'t', :'cal', '2026-12-08', 'Se trabaja') RETURNING id AS ex8 \gset
INSERT INTO app.calendario_excepcion_tramo (tenant_id, excepcion_id, inicio, fin)
VALUES (:'t', :'ex8', '07:00', '12:00');
SELECT app.fn_copiar_festivos(:'cal', :'co') AS copiadas \gset
INSERT INTO resultado SELECT '41 copiar la lista deja todas sus fechas menos la que ya estaba',
  :'copiadas', ((SELECT count(*) FROM plataforma.lista_festivos_fecha WHERE lista_id = :'co') - 1)::text;
INSERT INTO resultado SELECT '42 el 8 de diciembre sigue laborable, con su tramo',
  (SELECT count(*) FROM app.calendario_excepcion_tramo WHERE excepcion_id = :'ex8')::text, '1';
INSERT INTO resultado SELECT '43 el calendario anota de qué lista y hasta qué año',
  (festivos_lista_id = :'co')::text || '/' || festivos_hasta, 'true/2030' FROM app.calendario WHERE id = :'cal';
INSERT INTO resultado SELECT '44 copiarla otra vez no duplica nada',
  app.fn_copiar_festivos(:'cal', :'co')::text, '0';

-- Una lista propia es privada.
INSERT INTO app.lista_festivos_propia (tenant_id, nombre) VALUES (:'t', 'Feria local') RETURNING id AS lp \gset
INSERT INTO app.lista_festivos_propia_fecha (tenant_id, lista_id, fecha, nombre)
VALUES (:'t', :'lp', '2026-08-10', 'Feria'), (:'t', :'lp', '2027-08-09', 'Feria');
INSERT INTO resultado SELECT '45 copiar una lista propia', app.fn_copiar_festivos(:'cal2', :'lp', true)::text, '2';
INSERT INTO resultado SELECT '46 y anota hasta 2027',
  (festivos_propia_id = :'lp')::text || '/' || festivos_hasta, 'true/2027' FROM app.calendario WHERE id = :'cal2';
SET LOCAL ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t2', true) AS _ \gset x_
INSERT INTO resultado SELECT '47 otra empresa no ve la lista propia', count(*)::text, '0' FROM app.lista_festivos_propia WHERE id = :'lp';
INSERT INTO resultado SELECT '48 otra empresa no ve los calendarios', count(*)::text, '0' FROM app.calendario WHERE tenant_id = :'t';
INSERT INTO resultado SELECT '49 otra empresa no puede colgarle un tramo a un calendario ajeno',
  pg_temp.rechaza(format($q$INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 6, '07:00', '08:00')$q$, :'t2', :'cal')), 'rechazado';
INSERT INTO resultado SELECT '50 ni copiarle festivos',
  pg_temp.rechaza(format('SELECT app.fn_copiar_festivos(%L, %L)', :'cal', :'co')), 'rechazado';
RESET ROLE;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_

-- El superadministrador agrega la siguiente ventana.
INSERT INTO plataforma.usuario_plataforma (email, nombre, password_hash)
VALUES ('sa@d84.co', 'SA', 'h') RETURNING id AS sa \gset
INSERT INTO resultado SELECT '51 extender agrega cinco años', plataforma.fn_extender_festivos('CO', :'sa')::text, '2035';
INSERT INTO resultado SELECT '52 y queda en la bitácora del panel', count(*)::text, '1'
  FROM plataforma.evento_plataforma WHERE tipo = 'FESTIVOS_EXTENDIDOS';
INSERT INTO resultado SELECT '53 sin superadministrador activo se rechaza',
  pg_temp.rechaza($q$SELECT plataforma.fn_extender_festivos('CO', '00000000-0000-0000-0000-000000000000')$q$), 'rechazado';
INSERT INTO resultado SELECT '54 la aplicación no puede extenderla',
  pg_temp.rechaza(format($q$SELECT plataforma.fn_extender_festivos('CO', %L)$q$, :'sa'), 'construsoft_app'), 'rechazado';
RESET ROLE;

-- ============================================================================
--  Verificaciones del esquema
-- ============================================================================
INSERT INTO resultado SELECT '55 ninguna tabla de empresa sin aislar', count(*)::text, '0' FROM app.fn_verificar_rls();
INSERT INTO resultado SELECT '56 ninguna función privilegiada mal asegurada', count(*)::text, '0' FROM app.fn_verificar_funciones();

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
          '% de % casos de la 0004 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-84, D-85, D-86, D-90 y D-91 verificados: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
