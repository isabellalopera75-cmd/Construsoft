-- ============================================================================
--  PRUEBA DE LA MIGRACIÓN 0005 · El cronograma
--  D-82 uno por presupuesto · D-86 calendarios de la obra y corrido · D-87
--  restricciones (RN-30) · D-89 resultados aparte y curvas · D-91 versión ·
--  RN-33 ítems que salen · RN-34 solo lectura en Cerrado · RF-PRG-09 líneas base
--
--      psql -U postgres -d construsoft -f "docs/prueba-d81-d92.sql"
--
--  Necesita la migración 0005. Se juzga sola y termina con ROLLBACK. El motor
--  no está aquí (es de la API): sus resultados se simulan con una tabla de
--  minutos por actividad y día.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d81-d92 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;
CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT ALL ON resultado TO PUBLIC;

-- Un caso que tiene que fallar: corre las sentencias (separadas por §), fuerza
-- las comprobaciones diferidas y devuelve 'rechazado' o 'aceptado'. Todo lo que
-- hizo se deshace.
CREATE FUNCTION pg_temp.rechaza(sql text, rol text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
    BEGIN
        IF rol IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', rol); END IF;
        FOREACH s IN ARRAY string_to_array(sql, '§') LOOP
            EXECUTE s;
        END LOOP;
        EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
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
-- Igual, pero devuelve el texto del rechazo (o su detalle), para comprobar
-- que dice lo que tiene que decir.
CREATE FUNCTION pg_temp.mensaje(sql text, que text DEFAULT 'mensaje') RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text; v_det text; v_col text;
BEGIN
    BEGIN
        FOREACH s IN ARRAY string_to_array(sql, '§') LOOP
            EXECUTE s;
        END LOOP;
        EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
        RAISE EXCEPTION 'paso_sin_error';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL, v_col = COLUMN_NAME;
        IF SQLERRM = 'paso_sin_error' THEN RETURN 'aceptado'; END IF;
        RETURN CASE que WHEN 'detalle' THEN v_det WHEN 'columna' THEN v_col ELSE SQLERRM END;
    END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.rechaza(text, text) TO PUBLIC;

SELECT id_tenant AS t, id_usuario AS u FROM app.fn_alta_tenant(
  'Cronogramas SAS','901.810.001-1','EMPRESARIAL','Ana','ana@d81.co','h') \gset
SELECT id_tenant AS t2, id_usuario AS u2 FROM app.fn_alta_tenant(
  'Vecina SAS','901.810.002-1','EMPRESARIAL','Beto','beto@d81.co','h') \gset
UPDATE app.usuario SET estado = 'ACTIVO' WHERE id IN (:'u', :'u2');
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_

-- Un presupuesto con dos capítulos (directo e indirecto), AIU e IVA.
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t' LIMIT 1 \gset
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t','R','R','MATERIAL', :'um', 1000, 0, 1000, 'BASE') RETURNING id AS rec \gset
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id)
VALUES (:'t','APU-0001','Muro', :'um') RETURNING id AS apu \gset
SELECT app.fn_nueva_version_apu(:'apu', jsonb_build_array(
  jsonb_build_object('recurso_id', :'rec','cantidad',1,'rendimiento',1)), NULL, NULL, 'Versión inicial',
  5, true) AS ver1 \gset
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura,
                             aiu_administracion, aiu_imprevistos, aiu_utilidad)
VALUES (:'t','P81','Obra','M','COP','WBS', 10, 5, 5) RETURNING id AS p \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL, 'Obra', 'DIRECTO') RETURNING id AS c1 \gset
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'p', NULL, 'Indirectos', 'INDIRECTO') RETURNING id AS c2 \gset
CREATE TEMP TABLE item_nuevo (cap uuid, cantidad numeric, id uuid);
CREATE FUNCTION pg_temp.item(p uuid, cap uuid, cant numeric) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO app.presupuesto_item (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
        codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
    SELECT pr.tenant_id, p, cap, v.apu_id, v.id, 'APU-0001', 'Muro', v.unidad_simbolo, v.costo_directo, cant
      FROM app.apu_version v, app.presupuesto pr
     WHERE v.apu_id = (SELECT id FROM app.apu WHERE codigo = 'APU-0001' AND tenant_id = pr.tenant_id)
       AND pr.id = p
    RETURNING id;
$$;
SELECT pg_temp.item(:'p', :'c1', 10) AS i1 \gset
SELECT pg_temp.item(:'p', :'c1', 5)  AS i2 \gset
SELECT pg_temp.item(:'p', :'c2', 2)  AS i3 \gset

-- ============================================================================
--  RF-PRG-01 · Crear el cronograma
-- ============================================================================
SELECT app.fn_crear_cronograma(:'p', '2026-11-02') AS k \gset
INSERT INTO resultado SELECT '01 nace con una actividad por ítem, ADM y dos hitos',
  string_agg(tipo || ':' || codigo, ' ' ORDER BY tipo, codigo), 'ADMINISTRACION:ADM HITO_FIN:H-002 HITO_INICIO:H-001 ITEM:1.1 ITEM:1.2 ITEM:2.1'
  FROM app.actividad_programada WHERE cronograma_id = :'k';
INSERT INTO resultado SELECT '02 la actividad de ítem lleva el nombre del ítem',
  nombre, 'Muro' FROM app.actividad_programada WHERE presupuesto_item_id = :'i1';
INSERT INTO resultado SELECT '03 se lleva una copia del calendario de por defecto (10 tramos)',
  count(*)::text, '10'
  FROM app.calendario_tramo t JOIN app.calendario k ON k.id = t.calendario_id
 WHERE k.cronograma_id = :'k' AND k.tipo = 'OBRA';
INSERT INTO resultado SELECT '04 y el corrido: 7 tramos de 24 h, 1 día = 24 h',
  count(*)::text || '/' || min(k.horas_por_dia)::text || '/' || min(t.inicio)::text || '-' || max(t.fin)::text,
  '7/24.00/00:00:00-24:00:00'
  FROM app.calendario_tramo t JOIN app.calendario k ON k.id = t.calendario_id
 WHERE k.cronograma_id = :'k' AND k.tipo = 'CORRIDO';
INSERT INTO resultado SELECT '05 nace en versión 1 y sin calcular',
  version || '/' || COALESCE(calculado_version::text, 'nulo'), '1/nulo' FROM app.cronograma WHERE id = :'k';
INSERT INTO resultado SELECT '06 deja el evento CRONOGRAMA_CREADO',
  count(*)::text, '1' FROM app.evento_auditoria WHERE presupuesto_id = :'p' AND tipo_evento = 'CRONOGRAMA_CREADO';
INSERT INTO resultado SELECT '07 un segundo cronograma para el mismo presupuesto se rechaza',
  pg_temp.rechaza(format('SELECT app.fn_crear_cronograma(%L, %L)', :'p', '2026-11-02')), 'rechazado';
INSERT INTO resultado SELECT '08 la aplicación no crea cronogramas a mano',
  pg_temp.rechaza(format('INSERT INTO app.cronograma (tenant_id, presupuesto_id, fecha_inicio) VALUES (%L, %L, %L)',
                         :'t', :'p', '2026-11-02'), 'construsoft_app'), 'rechazado';
RESET ROLE;
SELECT id AS cal_t2 FROM app.calendario WHERE tenant_id = :'t2' AND por_defecto \gset
INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura)
VALUES (:'t','P81B','Otra','M','COP','WBS') RETURNING id AS pb \gset
INSERT INTO resultado SELECT '09 con el calendario de otra empresa se rechaza',
  pg_temp.rechaza(format('SELECT app.fn_crear_cronograma(%L, %L, %L)', :'pb', '2026-11-02', :'cal_t2')), 'rechazado';
INSERT INTO resultado SELECT '10 sin fecha de inicio se rechaza, y dice el campo',
  pg_temp.mensaje(format('SELECT app.fn_crear_cronograma(%L, NULL)', :'pb'), 'columna'), 'fechaInicio';

-- ============================================================================
--  D-86 · Los calendarios de la obra y el corrido
-- ============================================================================
SELECT id AS obra FROM app.calendario WHERE cronograma_id = :'k' AND tipo = 'OBRA' \gset
SELECT id AS corrido FROM app.calendario WHERE cronograma_id = :'k' AND tipo = 'CORRIDO' \gset
SELECT id AS cal_emp FROM app.calendario WHERE tenant_id = :'t' AND por_defecto \gset
INSERT INTO resultado SELECT '11 el nombre se repite entre la empresa y la copia',
  count(*)::text, '2' FROM app.calendario WHERE tenant_id = :'t' AND nombre = 'Lunes a viernes';
INSERT INTO resultado SELECT '12 el calendario de la obra se edita',
  pg_temp.rechaza(format('INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 6, %L, %L)',
                         :'t', :'obra', '07:00', '12:00'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
VALUES (:'t', :'obra', 6, '07:00', '12:00');
INSERT INTO resultado SELECT '13 y editarlo no mueve el de la empresa',
  count(*)::text, '10' FROM app.calendario_tramo WHERE calendario_id = :'cal_emp';
INSERT INTO resultado SELECT '13b corrige la 0004: un tramo puesto y quitado en la misma transacción no se juzga',
  pg_temp.rechaza(format('INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 7, %L, %L) § '
                         'DELETE FROM app.calendario_tramo WHERE calendario_id = %L AND dia_semana = 7 § '
                         'INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 7, %L, %L)',
                         :'t', :'cal_emp', '07:00', '12:00', :'cal_emp', :'t', :'cal_emp', '08:00', '13:00'), 'construsoft_app')
  || '/' ||
  pg_temp.rechaza(format('INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 7, %L, %L) § '
                         'INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 7, %L, %L)',
                         :'t', :'cal_emp', '07:00', '12:00', :'t', :'cal_emp', '08:00', '13:00'), 'construsoft_app'),
  'aceptado/rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '14 el corrido no gana tramos',
  pg_temp.rechaza(format('INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L, %L, 1, %L, %L)',
                         :'t', :'corrido', '07:00', '08:00'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '15 ni los pierde',
  pg_temp.rechaza(format('DELETE FROM app.calendario_tramo WHERE calendario_id = %L', :'corrido'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '16 ni se renombra',
  pg_temp.rechaza(format('UPDATE app.calendario SET nombre = %L WHERE id = %L', 'Otro', :'corrido'), 'construsoft_app'), 'rechazado';
RESET ROLE;
SELECT id AS lista_co FROM plataforma.lista_festivos WHERE pais = 'CO' \gset
INSERT INTO resultado SELECT '17 ni recibe festivos',
  pg_temp.rechaza(format('SELECT app.fn_copiar_festivos(%L, %L)', :'corrido', :'lista_co'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '18 el de la obra sí recibe festivos',
  (app.fn_copiar_festivos(:'obra', :'lista_co') > 0)::text, 'true';
INSERT INTO resultado SELECT '19 el calendario de la obra no se elimina',
  pg_temp.rechaza(format('DELETE FROM app.calendario WHERE id = %L', :'obra'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '20 una copia no puede ser el calendario de por defecto',
  pg_temp.rechaza(format('SELECT app.fn_calendario_por_defecto(%L)', :'obra')), 'rechazado';
INSERT INTO resultado SELECT '21 la aplicación no escribe el tipo ni el cronograma de un calendario',
  pg_temp.rechaza(format('INSERT INTO app.calendario (tenant_id, nombre, tipo, cronograma_id) VALUES (%L, %L, %L, %L)',
                         :'t', 'Falso', 'OBRA', :'k'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '22 la aplicación sigue creando calendarios de la empresa',
  pg_temp.rechaza(format('INSERT INTO app.calendario (tenant_id, nombre, horas_por_dia) VALUES (%L, %L, 9)',
                         :'t', 'Lunes a sábado'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO app.calendario (tenant_id, nombre, horas_por_dia) VALUES (:'t', 'Lunes a sábado', 9) RETURNING id AS cal_ls \gset
INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
SELECT :'t', :'cal_ls', d, '07:00', '16:30' FROM generate_series(1, 6) d;
SELECT app.fn_cambiar_calendario_cronograma(:'k', :'cal_ls');
INSERT INTO resultado SELECT '23 reemplazar el calendario: mismo id, horario y nombre del elegido',
  k.nombre || '/' || k.horas_por_dia || '/' || (SELECT count(*) FROM app.calendario_tramo WHERE calendario_id = k.id)
  || '/' || (SELECT count(*) FROM app.calendario_excepcion WHERE calendario_id = k.id),
  'Lunes a sábado/9.00/6/0'
  FROM app.calendario k WHERE k.id = :'obra';
INSERT INTO resultado SELECT '24 deja el evento CRONOGRAMA_CALENDARIO',
  descripcion, 'Calendario del cronograma: «Lunes a viernes» reemplazado por «Lunes a sábado»'
  FROM app.evento_auditoria WHERE presupuesto_id = :'p' AND tipo_evento = 'CRONOGRAMA_CALENDARIO';
INSERT INTO resultado SELECT '25 no se reemplaza por una copia de otro cronograma',
  pg_temp.rechaza(format('SELECT app.fn_cambiar_calendario_cronograma(%L, %L)', :'k', :'corrido')), 'rechazado';

-- ============================================================================
--  Las actividades: códigos, amarre al ítem, columnas por tipo
-- ============================================================================
SELECT id AS a1 FROM app.actividad_programada WHERE presupuesto_item_id = :'i1' \gset
SELECT id AS a2 FROM app.actividad_programada WHERE presupuesto_item_id = :'i2' \gset
SELECT id AS a3 FROM app.actividad_programada WHERE presupuesto_item_id = :'i3' \gset
SELECT id AS adm FROM app.actividad_programada WHERE cronograma_id = :'k' AND tipo = 'ADMINISTRACION' \gset
SELECT id AS h1 FROM app.actividad_programada WHERE cronograma_id = :'k' AND codigo = 'H-001' \gset
SELECT id AS h2 FROM app.actividad_programada WHERE cronograma_id = :'k' AND codigo = 'H-002' \gset

INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre)
VALUES (:'t', :'k', 'HITO_FIN', 'Entrega') RETURNING id AS h3 \gset
INSERT INTO resultado SELECT '26 un hito sin código recibe el siguiente H',
  codigo, 'H-003' FROM app.actividad_programada WHERE id = :'h3';
INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre, duracion_manual_horas)
VALUES (:'t', :'k', 'SIN_COSTO', E'Curado\tde placa', 168) RETURNING id AS tr1 \gset
INSERT INTO resultado SELECT '27 un trámite sin código recibe T-001, y el tabulador se limpia',
  codigo || '/' || nombre, 'T-001/Curado de placa' FROM app.actividad_programada WHERE id = :'tr1';
INSERT INTO resultado SELECT '28 un código con forma de número de ítem se rechaza, con su campo',
  pg_temp.mensaje(format('UPDATE app.actividad_programada SET codigo = %L WHERE id = %L', '1.5', :'h3'), 'columna'), 'codigo';
INSERT INTO resultado SELECT '29 un código repetido se rechaza',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET codigo = %L WHERE id = %L', 'H-001', :'h3')), 'rechazado';
INSERT INTO resultado SELECT '30 el código de un hito se cambia',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET codigo = %L WHERE id = %L', 'ENTREGA', :'h3'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '31 el nombre de una actividad del presupuesto no se escribe a mano',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET nombre = %L WHERE id = %L', 'Otro', :'a1'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '32 ni su código',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET codigo = %L WHERE id = %L', '1.9', :'a1'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, clasificacion)
VALUES (:'t', :'pb', NULL, 'Cap', 'DIRECTO') RETURNING id AS cb \gset
SELECT pg_temp.item(:'pb', :'cb', 1) AS ib \gset
INSERT INTO resultado SELECT '33 una actividad con el ítem de otro presupuesto se rechaza',
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id) VALUES (%L, %L, %L, %L)',
                         :'t', :'k', 'ITEM', :'ib'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '34 dos actividades para el mismo ítem se rechazan',
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id) VALUES (%L, %L, %L, %L)',
                         :'t', :'k', 'ITEM', :'i1')), 'rechazado';
INSERT INTO resultado SELECT '35 una actividad de ítem sin ítem se rechaza',
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre, codigo) VALUES (%L, %L, %L, %L, %L)',
                         :'t', :'k', 'ITEM', 'X', 'X-9')), 'rechazado';
INSERT INTO resultado SELECT '36 la aplicación no crea otra administración',
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre) VALUES (%L, %L, %L, %L)',
                         :'t', :'k', 'ADMINISTRACION', 'Otra'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '37 la actividad de un ítem que sigue en el presupuesto no se elimina',
  pg_temp.rechaza(format('DELETE FROM app.actividad_programada WHERE id = %L', :'a1'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '38 la administración no se elimina',
  pg_temp.rechaza(format('DELETE FROM app.actividad_programada WHERE id = %L', :'adm'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '39 los hitos del proyecto se eliminan como cualquier hito',
  pg_temp.rechaza(format('DELETE FROM app.actividad_programada WHERE id = %L', :'h2'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '40 el corrido no es para una actividad del presupuesto',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET usa_corrido = true WHERE id = %L', :'a1')), 'rechazado';
INSERT INTO resultado SELECT '41 sí para una espera',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET usa_corrido = true WHERE id = %L', :'tr1'), 'construsoft_app'), 'aceptado';
RESET ROLE;
UPDATE app.actividad_programada SET usa_corrido = true WHERE id = :'tr1';
INSERT INTO resultado SELECT '42 cuadrillas: 3 en un ítem sí, en un hito no, 0 nunca',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET cuadrillas = 3 WHERE id = %L', :'a1')) || '/' ||
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET cuadrillas = 3 WHERE id = %L', :'h1')) || '/' ||
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET cuadrillas = 0 WHERE id = %L', :'a1')),
  'aceptado/rechazado/rechazado';
INSERT INTO resultado SELECT '43 duración manual: en un ítem sí, en un hito no, negativa nunca',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET duracion_manual_horas = 12.8 WHERE id = %L', :'a1')) || '/' ||
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET duracion_manual_horas = 8 WHERE id = %L', :'h1')) || '/' ||
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET duracion_manual_horas = -1 WHERE id = %L', :'a1')),
  'aceptado/rechazado/rechazado';

-- ============================================================================
--  D-87 / RN-30 · Parejas de restricciones
-- ============================================================================
CREATE FUNCTION pg_temp.r(a uuid, p text, pf date, s text, sf date) RETURNS text LANGUAGE sql AS $$
    SELECT pg_temp.rechaza(format(
      'UPDATE app.actividad_programada SET restriccion_tipo = %L, restriccion_fecha = %L, '
      'restriccion2_tipo = %L, restriccion2_fecha = %L WHERE id = %L', p, pf, s, sf, a));
$$;
INSERT INTO resultado SELECT '44 sin principal no hay secundaria',
  pg_temp.r(:'a1', NULL, NULL, 'INICIO_ANTES', '2026-12-01'), 'rechazado';
INSERT INTO resultado SELECT '45 inicio el, fin el y las obligatorias no admiten secundaria',
  pg_temp.r(:'a1', 'INICIO_EL', '2026-11-10', 'FIN_ANTES', '2026-12-01') || '/' ||
  pg_temp.r(:'a1', 'FIN_EL', '2026-11-10', 'INICIO_DESPUES', '2026-11-01') || '/' ||
  pg_temp.r(:'a1', 'INICIO_OBLIGATORIO', '2026-11-10', 'FIN_ANTES', '2026-12-01') || '/' ||
  pg_temp.r(:'a1', 'FIN_OBLIGATORIO', '2026-11-10', 'INICIO_DESPUES', '2026-11-01'),
  'rechazado/rechazado/rechazado/rechazado';
INSERT INTO resultado SELECT '46 solas sí se aceptan',
  pg_temp.r(:'a1', 'INICIO_EL', '2026-11-10', NULL, NULL) || '/' ||
  pg_temp.r(:'a1', 'FIN_OBLIGATORIO', '2026-11-10', NULL, NULL),
  'aceptado/aceptado';
INSERT INTO resultado SELECT '47 la secundaria no repite la principal',
  pg_temp.r(:'a1', 'INICIO_ANTES', '2026-11-10', 'INICIO_ANTES', '2026-11-20'), 'rechazado';
INSERT INTO resultado SELECT '48 inicio en o después de con fin en o antes de se acepta',
  pg_temp.r(:'a1', 'INICIO_DESPUES', '2026-11-10', 'FIN_ANTES', '2026-12-01'), 'aceptado';
INSERT INTO resultado SELECT '49 lo más tarde posible: sin fecha y con cualquiera de ventana',
  pg_temp.r(:'a1', 'LO_MAS_TARDE', NULL, 'FIN_DESPUES', '2026-12-01') || '/' ||
  pg_temp.r(:'a1', 'LO_MAS_TARDE', '2026-11-10', NULL, NULL),
  'aceptado/rechazado';
INSERT INTO resultado SELECT '50 una principal sin fecha se rechaza, con su campo',
  pg_temp.mensaje(format('UPDATE app.actividad_programada SET restriccion_tipo = %L WHERE id = %L', 'INICIO_EL', :'a1'), 'columna'),
  'restriccionFecha';
INSERT INTO resultado SELECT '51 mismo tipo de fecha: «antes de» anterior a «después de» se rechaza; igual se acepta',
  pg_temp.r(:'a1', 'INICIO_DESPUES', '2026-11-20', 'INICIO_ANTES', '2026-11-10') || '/' ||
  pg_temp.r(:'a1', 'FIN_ANTES', '2026-11-20', 'FIN_DESPUES', '2026-11-20'),
  'rechazado/aceptado';
INSERT INTO resultado SELECT '52 la secundaria es de ventana: fin el no puede ser secundaria',
  pg_temp.r(:'a1', 'INICIO_DESPUES', '2026-11-10', 'FIN_EL', '2026-12-01'), 'rechazado';
INSERT INTO resultado SELECT '53 un hito de fin no admite restricciones de inicio, ni de secundaria',
  pg_temp.r(:'h3', 'INICIO_EL', '2026-11-10', NULL, NULL) || '/' ||
  pg_temp.r(:'h3', 'FIN_ANTES', '2026-12-10', 'INICIO_DESPUES', '2026-11-10') || '/' ||
  pg_temp.r(:'h3', 'FIN_ANTES', '2026-12-10', NULL, NULL),
  'rechazado/rechazado/aceptado';
INSERT INTO resultado SELECT '54 un hito de inicio no admite restricciones de fin',
  pg_temp.r(:'h1', 'FIN_EL', '2026-11-10', NULL, NULL) || '/' ||
  pg_temp.r(:'h1', 'INICIO_DESPUES', '2026-11-10', NULL, NULL),
  'rechazado/aceptado';
INSERT INTO resultado SELECT '55 la administración no lleva restricciones',
  pg_temp.r(:'adm', 'INICIO_DESPUES', '2026-11-10', NULL, NULL), 'rechazado';
INSERT INTO resultado SELECT '56 un tipo que no existe se rechaza',
  pg_temp.r(:'a1', 'COMIENZO_YA', '2026-11-10', NULL, NULL), 'rechazado';

-- ============================================================================
--  RF-PRG-04 / RF-PRG-05 · Dependencias y círculos
-- ============================================================================
INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id, tipo)
VALUES (:'t', :'k', :'a1', :'a2', 'FC'), (:'t', :'k', :'a2', :'a3', 'CC');
INSERT INTO resultado SELECT '57 las dependencias entre actividades se guardan',
  count(*)::text, '2' FROM app.dependencia WHERE cronograma_id = :'k';
INSERT INTO resultado SELECT '58 una actividad no depende de sí misma',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', :'a1', :'a1')), 'rechazado';
INSERT INTO resultado SELECT '59 dos relaciones entre las mismas actividades se rechazan',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id, tipo) VALUES (%L,%L,%L,%L,%L)',
                         :'t', :'k', :'a1', :'a2', 'CC')), 'rechazado';
INSERT INTO resultado SELECT '60 la administración no lleva relaciones',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', :'adm', :'a1')), 'rechazado';
INSERT INTO resultado SELECT '61 un círculo se rechaza y dice qué actividades lo forman',
  pg_temp.mensaje(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', :'a3', :'a1')),
  'Esta relación cerraría un círculo entre 1.1, 1.2, 2.1: una actividad no puede depender de sí misma, ni directa ni indirectamente (RF-PRG-05).';
INSERT INTO resultado SELECT '62 el detalle trae los identificadores del círculo',
  (SELECT count(*) FROM jsonb_array_elements_text(
     (pg_temp.mensaje(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L)',
                             :'t', :'k', :'a3', :'a1'), 'detalle'))::jsonb->'ciclo') x
    WHERE x::uuid IN (:'a1', :'a2', :'a3'))::text, '3';
INSERT INTO resultado SELECT '63 un círculo armado en una sola sentencia también se rechaza',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L), (%L,%L,%L,%L)',
                         :'t', :'k', :'h1', :'h3', :'t', :'k', :'h3', :'h1')), 'rechazado';
INSERT INTO resultado SELECT '63b un círculo largo nombra diez y cuenta el resto',
  (pg_temp.mensaje(format(
    'INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre) SELECT %L, %L, %L, %L || g FROM generate_series(1, 12) g § '
    'INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) '
    'SELECT %L, %L, a.id, b.id FROM app.actividad_programada a, app.actividad_programada b '
    'WHERE a.cronograma_id = %L AND b.cronograma_id = %L AND a.tipo = %L AND b.tipo = %L '
    'AND b.codigo = %L || lpad((substr(a.codigo, 3)::int %% 13 + 1)::text, 3, %L)',
    :'t', :'k', 'SIN_COSTO', 'Espera ', :'t', :'k', :'k', :'k', 'SIN_COSTO', 'SIN_COSTO', 'T-', '0')) LIKE '%T-001, T-002, %, T-010 y 3 más: una actividad%')::text,
  'true';
INSERT INTO resultado SELECT '64 una relación sin círculo, aunque toque el mismo grupo, pasa',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', :'a1', :'a3')), 'aceptado';
INSERT INTO resultado SELECT '65 las puntas de una relación no se cambian: se borra y se crea',
  pg_temp.rechaza(format('UPDATE app.dependencia SET sucesora_id = %L WHERE predecesora_id = %L AND sucesora_id = %L',
                         :'h3', :'a1', :'a2'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '66 el tipo y el desfase sí',
  pg_temp.rechaza(format('UPDATE app.dependencia SET tipo = %L, desfase_horas = -4 WHERE predecesora_id = %L AND sucesora_id = %L',
                         'CC', :'a1', :'a2'), 'construsoft_app'), 'aceptado';
RESET ROLE;

-- ============================================================================
--  Subgrupos de «Hitos y trámites»
-- ============================================================================
INSERT INTO app.grupo_tramite (tenant_id, cronograma_id, nombre) VALUES (:'t', :'k', 'Licencias') RETURNING id AS g1 \gset
UPDATE app.actividad_programada SET grupo_id = :'g1' WHERE id = :'tr1';
INSERT INTO resultado SELECT '67 una actividad del presupuesto no va en un subgrupo',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET grupo_id = %L WHERE id = %L', :'g1', :'a1')), 'rechazado';
INSERT INTO resultado SELECT '68 un subgrupo con actividades no se elimina',
  pg_temp.rechaza(format('DELETE FROM app.grupo_tramite WHERE id = %L', :'g1'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '69 vacío, sí',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET grupo_id = NULL WHERE id = %L § DELETE FROM app.grupo_tramite WHERE id = %L',
                         :'tr1', :'g1'), 'construsoft_app'), 'aceptado';
RESET ROLE;

-- ============================================================================
--  RN-33 · Un ítem que sale del presupuesto
-- ============================================================================
-- El 1.3, que pasará a 1.2.
SELECT pg_temp.item(:'p', :'c1', 4) AS i4 \gset
SELECT (SELECT revision FROM app.presupuesto WHERE id = :'p') AS rev_antes \gset
DELETE FROM app.presupuesto_item WHERE id = :'i2';
INSERT INTO resultado SELECT '70 su actividad queda, sin ítem y con el código X-',
  COALESCE(presupuesto_item_id::text, 'sin ítem') || '/' || codigo, 'sin ítem/X-1.2'
  FROM app.actividad_programada WHERE id = :'a2';
INSERT INTO resultado SELECT '71 con sus relaciones, para que se vea qué cadena se rompe',
  count(*)::text, '2' FROM app.dependencia WHERE :'a2' IN (predecesora_id, sucesora_id);
INSERT INTO resultado SELECT '72 el presupuesto sube su revisión: el cronograma queda desactualizado',
  ((SELECT revision FROM app.presupuesto WHERE id = :'p') > :rev_antes)::text, 'true';
INSERT INTO resultado SELECT '73 el ítem que tomó el 1.2 entra sin chocar',
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', 'ITEM', :'i4'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id)
VALUES (:'t', :'k', 'ITEM', :'i4') RETURNING id AS a4 \gset
INSERT INTO resultado SELECT '74 y toma número y nombre de su ítem',
  codigo || '/' || nombre, '1.2/Muro' FROM app.actividad_programada WHERE id = :'a4';
DELETE FROM app.presupuesto_item WHERE id = :'i4';
INSERT INTO resultado SELECT '75 si vuelve a salir un 1.2, es X-1.2-2',
  codigo, 'X-1.2-2' FROM app.actividad_programada WHERE id = :'a4';
INSERT INTO resultado SELECT '76 la que ya no está la borra el usuario',
  pg_temp.rechaza(format('DELETE FROM app.actividad_programada WHERE id = %L', :'a4'), 'construsoft_app'), 'aceptado';
RESET ROLE;
DELETE FROM app.actividad_programada WHERE id = :'a4';

-- ============================================================================
--  D-91 · La fecha de inicio, el historial y la versión
-- ============================================================================
UPDATE app.cronograma SET fecha_inicio = '2026-11-03' WHERE id = :'k';
INSERT INTO resultado SELECT '77 cambiar la fecha de inicio deja su evento',
  descripcion, 'Fecha de inicio del cronograma: del 02/11/2026 al 03/11/2026'
  FROM app.evento_auditoria WHERE presupuesto_id = :'p' AND tipo_evento = 'CRONOGRAMA_FECHA_INICIO';
UPDATE app.cronograma SET fecha_inicio = '2026-11-02' WHERE id = :'k';
INSERT INTO resultado SELECT '78 la versión no baja',
  pg_temp.rechaza(format('UPDATE app.cronograma SET version = 0 WHERE id = %L', :'k')), 'rechazado';
INSERT INTO resultado SELECT '79 la aplicación no cambia de presupuesto un cronograma',
  pg_temp.rechaza(format('UPDATE app.cronograma SET presupuesto_id = %L WHERE id = %L', :'pb', :'k'), 'construsoft_app'), 'rechazado';
RESET ROLE;

-- ============================================================================
--  D-89 · El motor simulado: minutos por actividad y día
--
--  1.1 (10.000): dos días de 480 min. 2.1 (2.000, indirecto): un día. X-1.2
--  (sin ítem, sin costo): un día. T-001: siete días corridos. ADM: tres días.
--  Los hitos: cero minutos, el día en que caen.
-- ============================================================================
CREATE TEMP TABLE motor (a uuid, f date, m integer);
INSERT INTO motor VALUES
  (:'a1', '2026-11-02', 480), (:'a1', '2026-11-03', 480),
  (:'a3', '2026-11-04', 480),
  (:'a2', '2026-11-02', 480),
  (:'adm', '2026-11-02', 480), (:'adm', '2026-11-03', 480), (:'adm', '2026-11-04', 480),
  (:'h1', '2026-11-02', 0), (:'h3', '2026-11-04', 0);
INSERT INTO motor SELECT :'tr1', d::date, 1440 FROM generate_series('2026-11-02'::date, '2026-11-08', '1 day') d;
-- Escribe los resultados como lo haría el recálculo, en una sola sentencia.
CREATE FUNCTION pg_temp.calcular(k uuid) RETURNS void LANGUAGE sql AS $$
    INSERT INTO app.actividad_calculo
        (actividad_id, tenant_id, inicio_temprano, fin_temprano, inicio_tardio, fin_tardio,
         duracion_minutos, holgura_total_minutos, holgura_libre_minutos)
    SELECT a.id, a.tenant_id,
           COALESCE(min(m.f), '2026-11-02') + time '07:00', COALESCE(max(m.f), '2026-11-02') + time '16:00',
           CASE WHEN a.tipo = 'ADMINISTRACION' THEN NULL ELSE COALESCE(min(m.f), '2026-11-02') + time '07:00' END,
           CASE WHEN a.tipo = 'ADMINISTRACION' THEN NULL ELSE COALESCE(max(m.f), '2026-11-02') + time '16:00' END,
           COALESCE(sum(m.m), 0),
           CASE WHEN a.tipo = 'ADMINISTRACION' THEN NULL ELSE 0 END,
           CASE WHEN a.tipo = 'ADMINISTRACION' THEN NULL ELSE 0 END
      FROM app.actividad_programada a LEFT JOIN motor m ON m.a = a.id
     WHERE a.cronograma_id = k
     GROUP BY a.id, a.tenant_id, a.tipo
    ON CONFLICT (actividad_id) DO UPDATE
       SET inicio_temprano = EXCLUDED.inicio_temprano, fin_temprano = EXCLUDED.fin_temprano,
           duracion_minutos = EXCLUDED.duracion_minutos;
    UPDATE app.cronograma c SET calculado_version = c.version,
           calculado_revision = (SELECT revision FROM app.presupuesto WHERE id = c.presupuesto_id)
     WHERE c.id = k;
$$;
SELECT pg_temp.calcular(:'k');
INSERT INTO resultado SELECT '80 la administración no es crítica ni tiene holgura; las demás, con holgura 0, sí',
  string_agg(a.codigo || ':' || k.critica, ' ' ORDER BY a.codigo), '1.1:true 2.1:true ADM:false H-001:true H-002:true H-003:true T-001:true X-1.2:true'
  FROM app.actividad_calculo k JOIN app.actividad_programada a ON a.id = k.actividad_id
 WHERE a.cronograma_id = :'k';

-- Las curvas
SELECT total_costo_directo AS cd, total_costo_indirecto AS ci, total_administracion AS adm_total,
       valor_total AS vt FROM app.presupuesto WHERE id = :'p' \gset
CREATE FUNCTION pg_temp.curva(p uuid, g text) RETURNS TABLE (periodo date, facturacion app.dinero, costo app.dinero)
LANGUAGE sql AS $$
    SELECT * FROM app.fn_curvas(p, (SELECT array_agg(a ORDER BY a, f) FROM motor),
                                (SELECT array_agg(f ORDER BY a, f) FROM motor),
                                (SELECT array_agg(m ORDER BY a, f) FROM motor), g);
$$;
INSERT INTO resultado SELECT '81 por día, la facturación suma el valor total y el costo, CD + CI + administración',
  (sum(facturacion) = :vt)::text || '/' || (sum(costo) = :cd + :ci + :adm_total)::text, 'true/true'
  FROM pg_temp.curva(:'p', 'DIA');
INSERT INTO resultado SELECT '82 por semana y por mes, lo mismo',
  (SELECT (sum(facturacion) = :vt AND sum(costo) = :cd + :ci + :adm_total)::text FROM pg_temp.curva(:'p', 'SEMANA'))
  || '/' ||
  (SELECT (sum(facturacion) = :vt AND sum(costo) = :cd + :ci + :adm_total)::text FROM pg_temp.curva(:'p', 'MES')),
  'true/true';
INSERT INTO resultado SELECT '83 costo por día: línea recta, y el residuo de la administración en su último día',
  string_agg(costo::text, ' ' ORDER BY periodo), '5333.333333 5333.333333 2333.333334'
  FROM pg_temp.curva(:'p', 'DIA') WHERE periodo <= '2026-11-04';
INSERT INTO resultado SELECT '84 A, I, U e IVA van con el costo directo: nada el día del indirecto solo',
  string_agg(round(facturacion, 2)::text, ' ' ORDER BY periodo),
  (SELECT string_agg(x, ' ') FROM (VALUES
     (round(5000 + (:vt - :cd - :ci) / 2.0, 2)::text),
     (round(5000 + (:vt - :cd - :ci) / 2.0, 2)::text),
     ('2000.00')) v(x))
  FROM pg_temp.curva(:'p', 'DIA') WHERE periodo <= '2026-11-04';
UPDATE app.configuracion_empresa SET inicio_semana = 7 WHERE tenant_id = :'t';
INSERT INTO resultado SELECT '85 la semana empieza el día de la empresa (domingo: el lunes 2 cae en la del 1)',
  min(periodo)::text, '2026-11-01' FROM pg_temp.curva(:'p', 'SEMANA');
UPDATE app.configuracion_empresa SET inicio_semana = 1 WHERE tenant_id = :'t';
INSERT INTO resultado SELECT '88 falta una actividad con costo: se niega',
  pg_temp.rechaza(format('SELECT * FROM app.fn_curvas(%L, ARRAY[%L]::uuid[], ARRAY[%L]::date[], ARRAY[480])',
                         :'p', :'a1', '2026-11-02')), 'rechazado';
INSERT INTO resultado SELECT '89 la misma actividad dos veces el mismo día: se niega',
  pg_temp.rechaza(format('SELECT * FROM app.fn_curvas(%L, ARRAY[%L,%L,%L,%L]::uuid[], ARRAY[%L,%L,%L,%L]::date[], ARRAY[480,480,480,480])',
                         :'p', :'a1', :'a1', :'a3', :'adm', '2026-11-02', '2026-11-02', '2026-11-03', '2026-11-03')), 'rechazado';
INSERT INTO resultado SELECT '90 una actividad de otro cronograma: se niega',
  pg_temp.rechaza(format('SELECT * FROM app.fn_curvas(%L, ARRAY[%L,%L,%L]::uuid[], ARRAY[%L,%L,%L]::date[], ARRAY[480,480,0])',
                         :'p', :'a1', :'a3', :'adm', '2026-11-02', '2026-11-03', '2026-11-03')) || '/' ||
  pg_temp.rechaza(format('SELECT * FROM app.fn_curvas(%L, ARRAY[%L,%L,%L,%L]::uuid[], ARRAY[%L,%L,%L,%L]::date[], ARRAY[480,480,480,0])',
                         :'p', :'a1', :'a3', :'adm', gen_random_uuid(), '2026-11-02', '2026-11-03', '2026-11-03', '2026-11-03')),
  'aceptado/rechazado';
INSERT INTO resultado SELECT '91 una actividad de cero minutos lleva todo su costo a su día',
  (SELECT costo::numeric(24,2)::text FROM app.fn_curvas(:'p',
      ARRAY[:'a1', :'a3', :'adm']::uuid[], ARRAY['2026-11-09', '2026-11-09', '2026-11-09']::date[],
      ARRAY[0, 0, 0]) WHERE periodo = '2026-11-09'),
  ((:cd + :ci + :adm_total)::numeric(24,2))::text;
INSERT INTO resultado SELECT '92 sin minutos y en dos días: se niega',
  pg_temp.rechaza(format('SELECT * FROM app.fn_curvas(%L, ARRAY[%L,%L,%L,%L]::uuid[], ARRAY[%L,%L,%L,%L]::date[], ARRAY[0,0,480,480])',
                         :'p', :'a1', :'a1', :'a3', :'adm', '2026-11-02', '2026-11-03', '2026-11-03', '2026-11-03')), 'rechazado';

-- ============================================================================
--  RF-PRG-09 · Líneas base
-- ============================================================================
CREATE FUNCTION pg_temp.guardar(k uuid, nombre text, reemplaza uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
    SELECT app.fn_guardar_linea_base(k, nombre, (SELECT array_agg(a ORDER BY a, f) FROM motor),
                                     (SELECT array_agg(f ORDER BY a, f) FROM motor),
                                     (SELECT array_agg(m ORDER BY a, f) FROM motor), reemplaza);
$$;
INSERT INTO resultado SELECT '93 con el presupuesto Abierto no se guarda',
  pg_temp.rechaza(format('SELECT pg_temp.guardar(%L, %L)', :'k', 'LB1')), 'rechazado';
SELECT version AS v_antes FROM app.cronograma WHERE id = :'k' \gset
SELECT app.fn_activar_presupuesto(:'p');
INSERT INTO resultado SELECT '94 activar el presupuesto sube la versión del cronograma',
  ((SELECT version FROM app.cronograma WHERE id = :'k') = :v_antes + 1)::text, 'true';
INSERT INTO resultado SELECT '95 calculado con la versión de antes: no se guarda',
  pg_temp.rechaza(format('SELECT pg_temp.guardar(%L, %L)', :'k', 'LB1')), 'rechazado';
SELECT pg_temp.calcular(:'k');
INSERT INTO resultado SELECT '96 con el presupuesto Activo el cronograma se edita (excepción a la D-5)',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET cuadrillas = 2 WHERE id = %L', :'a1'), 'construsoft_app'), 'aceptado';
RESET ROLE;
SELECT pg_temp.guardar(:'k', 'LB1') AS lb1 \gset
INSERT INTO resultado SELECT '97 la foto: todas las actividades, y las curvas por día que suman el total',
  (SELECT count(*) FROM app.linea_base_actividad WHERE linea_base_id = :'lb1')::text || '/' ||
  (SELECT (sum(facturacion) = :vt AND sum(costo) = :cd + :ci + :adm_total)::text
     FROM app.linea_base_periodo WHERE linea_base_id = :'lb1'),
  (SELECT count(*) FROM app.actividad_programada WHERE cronograma_id = :'k')::text || '/true';
INSERT INTO resultado SELECT '98 deja LINEA_BASE_GUARDADA',
  count(*)::text, '1' FROM app.evento_auditoria WHERE presupuesto_id = :'p' AND tipo_evento = 'LINEA_BASE_GUARDADA';
INSERT INTO resultado SELECT '99 el mismo nombre no sobrescribe en silencio',
  pg_temp.rechaza(format('SELECT pg_temp.guardar(%L, %L)', :'k', 'lb1 ')), 'rechazado';
SELECT pg_temp.guardar(:'k', NULL, :'lb1') AS lb1_bis \gset
INSERT INTO resultado SELECT '100 reemplazar es otra llamada, conserva la línea base y deja su evento',
  (:'lb1_bis' = :'lb1')::text || '/' ||
  (SELECT count(*) FROM app.evento_auditoria WHERE presupuesto_id = :'p' AND tipo_evento = 'LINEA_BASE_REEMPLAZADA')::text
  || '/' || (SELECT nombre FROM app.linea_base WHERE id = :'lb1'),
  'true/1/LB1';
INSERT INTO resultado SELECT '101 minutos que no suman la duración: se niega',
  pg_temp.rechaza(format('UPDATE motor SET m = 100 WHERE a = %L AND f = %L § SELECT pg_temp.guardar(%L, %L)',
                         :'a1', '2026-11-02', :'k', 'LB2')), 'rechazado';
INSERT INTO resultado SELECT '102 la aplicación no escribe líneas base a mano',
  pg_temp.rechaza(format('INSERT INTO app.linea_base (tenant_id, cronograma_id, nombre) VALUES (%L,%L,%L)',
                         :'t', :'k', 'LB3'), 'construsoft_app'), 'rechazado';
RESET ROLE;
SELECT pg_temp.guardar(:'k', 'LB2') AS lb2 \gset
INSERT INTO resultado SELECT '103 con el presupuesto Activo una línea base se elimina, y deja su evento',
  pg_temp.rechaza(format('DELETE FROM app.linea_base WHERE id = %L', :'lb2'), 'construsoft_app') || '/' ||
  pg_temp.mensaje(format('DELETE FROM app.linea_base WHERE id = %L § SELECT 1/(CASE WHEN (SELECT count(*) FROM app.evento_auditoria WHERE tipo_evento = %L AND presupuesto_id = %L) = 1 THEN 1 ELSE 0 END)',
                         :'lb2', 'LINEA_BASE_ELIMINADA', :'p')),
  'aceptado/aceptado';
RESET ROLE;

-- ============================================================================
--  RN-34 · Con el presupuesto Cerrado, solo lectura
-- ============================================================================
SELECT app.fn_cerrar_presupuesto(:'p');
INSERT INTO resultado SELECT '104 Cerrado: no se cambian cuadrillas ni restricciones',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET cuadrillas = 4 WHERE id = %L', :'a1'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '105 ni relaciones',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', :'h1', :'a1'), 'construsoft_app') || '/' ||
  pg_temp.rechaza(format('DELETE FROM app.dependencia WHERE cronograma_id = %L', :'k'), 'construsoft_app'),
  'rechazado/rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '106 ni la fecha de inicio',
  pg_temp.rechaza(format('UPDATE app.cronograma SET fecha_inicio = %L WHERE id = %L', '2026-12-01', :'k'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '107 ni el calendario de la obra',
  pg_temp.rechaza(format('INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin) VALUES (%L,%L,7,%L,%L)',
                         :'t', :'obra', '07:00', '12:00'), 'construsoft_app') || '/' ||
  pg_temp.rechaza(format('SELECT app.fn_cambiar_calendario_cronograma(%L, %L)', :'k', :'cal_emp')),
  'rechazado/rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '108 ni se borra lo que ya no está, ni se agregan hitos o subgrupos',
  pg_temp.rechaza(format('DELETE FROM app.actividad_programada WHERE id = %L', :'a2'), 'construsoft_app') || '/' ||
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre) VALUES (%L,%L,%L,%L)',
                         :'t', :'k', 'HITO_FIN', 'Otro'), 'construsoft_app') || '/' ||
  pg_temp.rechaza(format('INSERT INTO app.grupo_tramite (tenant_id, cronograma_id, nombre) VALUES (%L,%L,%L)',
                         :'t', :'k', 'Otro'), 'construsoft_app'),
  'rechazado/rechazado/rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '109 pero el recálculo sí escribe sus resultados y sus marcas',
  pg_temp.rechaza(format('UPDATE app.actividad_calculo SET duracion_minutos = duracion_minutos WHERE actividad_id = %L § UPDATE app.cronograma SET calculado_version = version WHERE id = %L',
                         :'a1', :'k'), 'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '110 y ponerse al día con el presupuesto (número y nombre del ítem) no es editar',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET codigo = codigo, nombre = nombre, orden = 7 WHERE id = %L', :'a1'),
                  'construsoft_app'), 'aceptado';
RESET ROLE;
INSERT INTO resultado SELECT '110b pero lo que ya no está en el presupuesto no se reordena',
  pg_temp.rechaza(format('UPDATE app.actividad_programada SET orden = 7 WHERE id = %L', :'a2'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '111 Cerrado: las líneas base ni se guardan ni se eliminan',
  pg_temp.rechaza(format('SELECT pg_temp.guardar(%L, %L)', :'k', 'LB9')) || '/' ||
  pg_temp.rechaza(format('DELETE FROM app.linea_base WHERE id = %L', :'lb1'), 'construsoft_app'),
  'rechazado/rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '112 Cerrado: no se crea un cronograma',
  pg_temp.mensaje(format('DELETE FROM app.cronograma WHERE id = %L § SELECT app.fn_crear_cronograma(%L, %L)',
                         :'k', :'p', '2026-11-02')),
  'El presupuesto está Cerrado: se programa con el presupuesto Abierto o Activo (RN-34).';

-- Un cronograma que quedó desactualizado al cerrar: el ítem que entró sin
-- recalcular puede recibir su actividad con el presupuesto ya Cerrado.
SELECT pg_temp.item(:'pb', :'cb', 3) AS ibb \gset
SELECT app.fn_crear_cronograma(:'pb', '2026-11-02') AS kb \gset
SELECT pg_temp.item(:'pb', :'cb', 2) AS ib_tarde \gset
SELECT app.fn_activar_presupuesto(:'pb');
SELECT app.fn_cerrar_presupuesto(:'pb');
INSERT INTO resultado SELECT '113 Cerrado y desactualizado: el recálculo crea la actividad del ítem que faltaba',
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id) VALUES (%L,%L,%L,%L)',
                         :'t', :'kb', 'ITEM', :'ib_tarde'), 'construsoft_app') || '/' ||
  pg_temp.rechaza(format('INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id, cuadrillas) VALUES (%L,%L,%L,%L,2)',
                         :'t', :'kb', 'ITEM', :'ib_tarde'), 'construsoft_app'),
  'aceptado/rechazado';
RESET ROLE;

-- ============================================================================
--  RF-PRE-27 · Duplicar se lleva el cronograma
-- ============================================================================
SELECT app.fn_duplicar_presupuesto(:'p', 'P81C', 'Copia', false) AS pc \gset
SELECT id AS kc FROM app.cronograma WHERE presupuesto_id = :'pc' \gset
INSERT INTO resultado SELECT '114 la copia trae las mismas actividades, también la que ya no está',
  (SELECT string_agg(tipo || ':' || codigo || ':' || cuadrillas, ' ' ORDER BY codigo) FROM app.actividad_programada WHERE cronograma_id = :'kc'),
  (SELECT string_agg(tipo || ':' || codigo || ':' || cuadrillas, ' ' ORDER BY codigo) FROM app.actividad_programada WHERE cronograma_id = :'k');
INSERT INTO resultado SELECT '115 sus actividades cuelgan de los ítems de la copia',
  count(*)::text, '0'
  FROM app.actividad_programada a JOIN app.presupuesto_item i ON i.id = a.presupuesto_item_id
 WHERE a.cronograma_id = :'kc' AND i.presupuesto_id <> :'pc';
INSERT INTO resultado SELECT '116 las mismas relaciones, entre las actividades de la copia',
  (SELECT string_agg(pa.codigo || '>' || sa.codigo || ':' || d.tipo || ':' || d.desfase_horas, ' ' ORDER BY pa.codigo, sa.codigo)
     FROM app.dependencia d JOIN app.actividad_programada pa ON pa.id = d.predecesora_id
     JOIN app.actividad_programada sa ON sa.id = d.sucesora_id WHERE d.cronograma_id = :'kc'),
  (SELECT string_agg(pa.codigo || '>' || sa.codigo || ':' || d.tipo || ':' || d.desfase_horas, ' ' ORDER BY pa.codigo, sa.codigo)
     FROM app.dependencia d JOIN app.actividad_programada pa ON pa.id = d.predecesora_id
     JOIN app.actividad_programada sa ON sa.id = d.sucesora_id WHERE d.cronograma_id = :'k');
INSERT INTO resultado SELECT '117 el calendario de la obra copiado, y su propio corrido',
  (SELECT k.nombre || '/' || count(t.*) FROM app.calendario k JOIN app.calendario_tramo t ON t.calendario_id = k.id
    WHERE k.cronograma_id = :'kc' AND k.tipo = 'OBRA' GROUP BY k.nombre) || '/' ||
  (SELECT count(*) FROM app.calendario WHERE cronograma_id = :'kc' AND tipo = 'CORRIDO'),
  'Lunes a sábado/6/1';
INSERT INTO resultado SELECT '118 nace sin calcular, sin resultados y sin líneas base',
  (SELECT COALESCE(calculado_version::text, 'nulo') || '/' || version FROM app.cronograma WHERE id = :'kc') || '/' ||
  (SELECT count(*) FROM app.actividad_calculo k JOIN app.actividad_programada a ON a.id = k.actividad_id WHERE a.cronograma_id = :'kc') || '/' ||
  (SELECT count(*) FROM app.linea_base WHERE cronograma_id = :'kc'),
  'nulo/1/0/0';
INSERT INTO resultado SELECT '119 y sin eventos de cronograma: el hecho es «duplicó»',
  count(*)::text, '0' FROM app.evento_auditoria WHERE presupuesto_id = :'pc' AND tipo_evento LIKE 'CRONOGRAMA%';
INSERT INTO resultado SELECT '120 la copia sí detecta círculos nuevos',
  pg_temp.rechaza(format('INSERT INTO app.dependencia (tenant_id, cronograma_id, predecesora_id, sucesora_id) SELECT %L, %L, s.id, p.id FROM app.actividad_programada p, app.actividad_programada s WHERE p.cronograma_id = %L AND s.cronograma_id = %L AND p.codigo = %L AND s.codigo = %L',
                         :'t', :'kc', :'kc', :'kc', '1.1', '2.1')), 'rechazado';

-- ============================================================================
--  Borrados en cascada y aislamiento
-- ============================================================================
INSERT INTO resultado SELECT '121 eliminar un presupuesto nunca activado se lleva su cronograma entero',
  pg_temp.rechaza(format('SELECT app.fn_eliminar_presupuesto(%L, %L) § SELECT 1/(CASE WHEN (SELECT count(*) FROM app.calendario WHERE cronograma_id = %L) = 0 THEN 1 ELSE 0 END)',
                         :'pc', 'prueba', :'kc')), 'aceptado';
SELECT set_config('app.tenant_id', :'t2', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u2', true) AS _ \gset x_
SET LOCAL ROLE construsoft_app;
INSERT INTO resultado SELECT '122 otra empresa no ve cronogramas, actividades ni calendarios de obra ajenos',
  (SELECT count(*) FROM app.cronograma) || '/' || (SELECT count(*) FROM app.actividad_programada)
  || '/' || (SELECT count(*) FROM app.calendario WHERE tipo <> 'EMPRESA'), '0/0/0';
INSERT INTO resultado SELECT '123 ni crea el cronograma de un presupuesto ajeno',
  pg_temp.mensaje(format('SELECT app.fn_crear_cronograma(%L, %L)', :'pb', '2026-11-02')),
  'El presupuesto no existe en esta empresa.';
INSERT INTO resultado SELECT '124 ni pide sus curvas',
  pg_temp.mensaje(format('SELECT * FROM app.fn_curvas(%L, ARRAY[]::uuid[], ARRAY[]::date[], ARRAY[]::int[])', :'p')),
  'El presupuesto no existe en esta empresa.';
RESET ROLE;
SELECT set_config('app.tenant_id', :'t', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u', true) AS _ \gset x_

INSERT INTO resultado SELECT '125 la aplicación no ejecuta las funciones internas del cronograma',
  pg_temp.rechaza(format('SELECT app.fn_crear_calendario_corrido(%L)', :'k'), 'construsoft_app'), 'rechazado';
RESET ROLE;
INSERT INTO resultado SELECT '126 verificadores de aislamiento y de funciones en cero',
  (SELECT count(*) FROM app.fn_verificar_rls()) || '/' || (SELECT count(*) FROM app.fn_verificar_funciones()), '0/0';

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
          '% de % casos de D-81 a D-92 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-81 a D-92 (migración 0005) verificados: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
