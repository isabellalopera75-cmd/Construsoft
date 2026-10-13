-- ============================================================================
--  PRUEBA DE D-74 · El ciclo de vida de la suscripción: días hábiles con los
--  festivos de Colombia, gracia de dos días hábiles, suspensión por falta de
--  pago, plazo tras un rechazo, cancelación y reactivación, y la purga.
--
--      psql -U postgres -d construsoft -f "docs/prueba-d74.sql"
--
--  Se juzga sola: al final LEVANTA UNA EXCEPCIÓN si algún caso discrepa. No
--  deja nada: termina con ROLLBACK. Necesita una base RECIÉN CARGADA.
--  Las fechas se calculan desde hoy, así que sirve cualquier día que se corra.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d74 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT INSERT, SELECT ON resultado TO construsoft_app, construsoft_superadmin;

CREATE FUNCTION pg_temp.correr(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.correr(text) TO construsoft_app, construsoft_superadmin;

-- estado/acceso de un inquilino, para comparar en una línea.
CREATE FUNCTION pg_temp.ea(p_t uuid) RETURNS text LANGUAGE sql AS $$
    SELECT estado || '/' || acceso FROM plataforma.fn_estado_suscripcion(p_t);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ea(uuid) TO construsoft_app, construsoft_superadmin;

-- ============================================================================
--  Festivos y días hábiles
-- ============================================================================
INSERT INTO resultado
SELECT 'festivos · Pascua 2025, 2026 y 2027',
       plataforma.fn_pascua(2025) || ' ' || plataforma.fn_pascua(2026) || ' ' || plataforma.fn_pascua(2027),
       '2025-04-20 2026-04-05 2027-03-28';
INSERT INTO resultado
SELECT 'festivos · 2026 tiene 18',
       count(*)::text, '18' FROM plataforma.fn_festivos_colombia(2026);
INSERT INTO resultado
SELECT 'festivos · 2026, los que se mueven y los de Pascua',
       string_agg(f::text, ' ' ORDER BY f), '2026-01-12 2026-03-23 2026-04-02 2026-04-03 2026-05-18 2026-06-08 2026-06-15 2026-06-29 2026-08-17 2026-10-12 2026-11-02 2026-11-16'
  FROM plataforma.fn_festivos_colombia(2026) f
 WHERE f NOT IN ('2026-01-01','2026-05-01','2026-07-20','2026-08-07','2026-12-08','2026-12-25');
INSERT INTO resultado VALUES
  ('hábiles · viernes antes del puente de la Raza',
   plataforma.fn_sumar_dias_habiles('2026-10-09', 2)::text, '2026-10-14'),
  ('hábiles · miércoles antes de Semana Santa',
   plataforma.fn_sumar_dias_habiles('2026-04-01', 2)::text, '2026-04-07'),
  ('hábiles · un martes cualquiera',
   plataforma.fn_sumar_dias_habiles('2026-09-08', 2)::text, '2026-09-10'),
  ('hábiles · fin de año',
   plataforma.fn_sumar_dias_habiles('2026-12-24', 2)::text, '2026-12-29');

-- ============================================================================
--  Escenario: tres empresas
--    A · paga, y deja de pagar.
--    B · paga, cancela, reanuda, vuelve a cancelar y reactiva.
--    C · en prueba: lo de siempre.
-- ============================================================================
SELECT id_tenant AS t_a, id_usuario AS u_a FROM app.fn_alta_tenant(
  'Paga A SAS','901.774.001-1','EMPRESARIAL','Ana Admin','ana@d74.co','hash_A') \gset
SELECT id_tenant AS t_b, id_usuario AS u_b FROM app.fn_alta_tenant(
  'Cancela B SAS','901.774.002-2','EMPRESARIAL','Beto Admin','beto@d74.co','hash_B') \gset
SELECT id_tenant AS t_c, id_usuario AS u_c FROM app.fn_alta_tenant(
  'Prueba C SAS','901.774.003-3','EMPRESARIAL','Ceci Admin','ceci@d74.co','hash_C') \gset
SELECT id AS s_a FROM plataforma.suscripcion WHERE tenant_id = :'t_a' \gset
SELECT id AS s_b FROM plataforma.suscripcion WHERE tenant_id = :'t_b' \gset
SELECT id AS s_c FROM plataforma.suscripcion WHERE tenant_id = :'t_c' \gset
SELECT id AS r_asis FROM app.rol WHERE tenant_id = :'t_b' AND tipo = 'ASISTENTE' \gset
INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
VALUES (:'t_b', :'r_asis', 'Sara Asistente', 'sara@d74.co', 'hash_S', 'ACTIVO')
RETURNING id AS u_asis \gset
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash)
VALUES ('Soporte', 'soporte@d74.co', '$argon2id$v=19$m=19456,t=2,p=1$x$y') RETURNING id AS sp \gset

-- A y B pagan un mes (el panel registra).
SELECT plataforma.fn_registrar_pago(:'s_a', current_date, 'Plan', 100, 'TRANSFERENCIA', 'A-1', 1::smallint, :'sp') \gset x_
SELECT plataforma.fn_registrar_pago(:'s_b', current_date, 'Plan', 100, 'TRANSFERENCIA', 'B-1', 1::smallint, :'sp') \gset x_

-- Cada comprobante sirve una vez: cinco para A, tres para B.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('a1'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop_a1 \gset
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('a2'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop_a2 \gset
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('a3'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop_a3 \gset
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('b1'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop_b1 \gset
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('b2'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop_b2 \gset
RESET ROLE;

-- ============================================================================
--  A · Al día, en gracia, suspendida
-- ============================================================================
INSERT INTO resultado
SELECT 'al día · ACTIVA y completo, con su fecha límite',
       pg_temp.ea(:'t_a') || '/' || (pagar_a_mas_tardar = plataforma.fn_sumar_dias_habiles(vence_el, 2)),
       'ACTIVA/COMPLETO/true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');

-- Venció ayer: está en sus dos días hábiles y trabaja completa.
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 40,
       fecha_vencimiento = current_date - 1 WHERE id = :'s_a';
INSERT INTO resultado SELECT 'gracia · venció ayer: POR_PAGAR y completa', pg_temp.ea(:'t_a'), 'POR_PAGAR/COMPLETO';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('gracia · puede crear', pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.CREAR')$$), 'OK');
RESET ROLE;

-- Venció hace 10 días: pasaron los dos hábiles (a lo sumo seis calendario).
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 10 WHERE id = :'s_a';
SELECT plataforma.fn_sumar_dias_habiles(current_date - 10, 2) AS lim_a \gset
INSERT INTO resultado
SELECT 'suspendida · por falta de pago, solo pago',
       pg_temp.ea(:'t_a') || '/' || suspension, 'SUSPENDIDA/SOLO_PAGO/FALTA_DE_PAGO'
  FROM plataforma.fn_estado_suscripcion(:'t_a');
INSERT INTO resultado
SELECT 'suspendida · desde el día siguiente al límite, se elimina al día 61',
       (suspendida_desde = :'lim_a'::date + 1 AND se_elimina_el = :'lim_a'::date + 61)::text, 'true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');
INSERT INTO resultado
SELECT 'suspendida · el panel la ve igual y sabe cuándo se elimina',
       plataforma.fn_estado_comercial(:'t_a') || '/' ||
       (plataforma.fn_eliminable_desde(:'t_a') = :'lim_a'::date + 61), 'SUSPENDIDA/true';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('suspendida · no consulta presupuestos',
   pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.VER')$$), 'CS006'),
  ('suspendida · sí exporta (D-76: los datos son suyos)',
   pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.EXPORTAR')$$), 'OK'),
  ('suspendida · sí entra a la suscripción',
   pg_temp.correr($$SELECT app.fn_exigir_permiso('CONFIG.SUSCRIPCION')$$), 'OK'),
  ('suspendida · puede reportar su pago',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 100, %L, %L, 1::smallint, %L)',
                         'PSE', 'A-tarde', :'sop_a1')), 'OK');
RESET ROLE;
SELECT id AS pago_tarde FROM plataforma.pago WHERE suscripcion_id = :'s_a' AND estado = 'PENDIENTE' \gset
INSERT INTO resultado
SELECT 'suspendida · reportar tarde no devuelve el acceso, pero frena la eliminación',
       pg_temp.ea(:'t_a') || '/' || (se_elimina_el IS NULL)::text || '/' || pago_en_verificacion,
       'SUSPENDIDA/SOLO_PAGO/true/true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');
SELECT plataforma.fn_rechazar_pago(:'pago_tarde', :'sp', 'No aparece');
INSERT INTO resultado
SELECT 'suspendida · rechazado un reporte tardío, no da plazo nuevo',
       (pg_temp.ea(:'t_a') = 'SUSPENDIDA/SOLO_PAGO' AND se_elimina_el = :'lim_a'::date + 61)::text, 'true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');

-- ============================================================================
--  A · Reportar a tiempo protege; un rechazo da dos días hábiles más
-- ============================================================================
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'A-tiempo', 1::smallint, :'sop_a2') AS pago_tiempo \gset
RESET ROLE;
-- Como si lo hubiera reportado el día que venció.
UPDATE plataforma.pago SET registrado_en = (current_date - 10)::timestamptz + interval '10 hours'
 WHERE id = :'pago_tiempo';
INSERT INTO resultado
SELECT 'a tiempo · el reporte pendiente la mantiene completa', pg_temp.ea(:'t_a'), 'POR_PAGAR/COMPLETO';

SELECT plataforma.fn_rechazar_pago(:'pago_tiempo', :'sp', 'El valor no coincide');
INSERT INTO resultado
SELECT 'rechazo · dos días hábiles desde hoy para reenviar',
       pg_temp.ea(:'t_a') || '/' || (pagar_a_mas_tardar = plataforma.fn_sumar_dias_habiles(current_date, 2)),
       'POR_PAGAR/COMPLETO/true'
  FROM plataforma.fn_estado_suscripcion(:'t_a');

-- Si el rechazo fue hace diez días y no reenvió, se suspende.
UPDATE plataforma.pago SET verificado_en = (current_date - 9)::timestamptz + interval '10 hours'
 WHERE id = :'pago_tiempo';
INSERT INTO resultado
SELECT 'rechazo · sin reenviar en su plazo, suspendida', pg_temp.ea(:'t_a'), 'SUSPENDIDA/SOLO_PAGO';

-- Y si reenvía y el panel confirma, vuelve.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'A-bueno', 1::smallint, :'sop_a3') AS pago_bueno \gset
RESET ROLE;
SELECT plataforma.fn_confirmar_pago(:'pago_bueno', :'sp') \gset x_
INSERT INTO resultado
SELECT 'confirmado · vuelve a ACTIVA y completa', pg_temp.ea(:'t_a'), 'ACTIVA/COMPLETO';

-- ============================================================================
--  A · La suspensión manual del panel tapa el acceso, no el estado comercial
-- ============================================================================
SELECT set_config('plataforma.usuario_id', :'sp', true), set_config('plataforma.motivo', 'Prueba', true) \gset x_
UPDATE plataforma.tenant SET estado = 'SUSPENDIDO' WHERE id = :'t_a';
INSERT INTO resultado
SELECT 'manual · SUSPENDIDA por la plataforma, solo pago',
       pg_temp.ea(:'t_a') || '/' || suspension || '/' || plataforma.fn_estado_comercial(:'t_a'),
       'SUSPENDIDA/SOLO_PAGO/PLATAFORMA/ACTIVA'
  FROM plataforma.fn_estado_suscripcion(:'t_a');
UPDATE plataforma.tenant SET estado = 'ACTIVO' WHERE id = :'t_a';

-- ============================================================================
--  B · Cancelar desde la empresa y reanudar
-- ============================================================================
SELECT fecha_vencimiento AS vence_b FROM plataforma.suscripcion WHERE id = :'s_b' \gset
SELECT COALESCE(max(id), 0) AS ultimo_evento FROM plataforma.evento_plataforma \gset
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_asis', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('cancelar · el asistente no puede',
   pg_temp.correr($$SELECT plataforma.fn_cancelar_suscripcion_empresa('no')$$), 'CS004');
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO resultado
SELECT 'cancelar · el administrador sí; funciona hasta lo pagado',
       (plataforma.fn_cancelar_suscripcion_empresa('Cerramos la oficina') = :'vence_b'::date)::text, 'true';
INSERT INTO resultado
SELECT 'cancelar · CANCELADA pero completa, por la empresa, reanudable',
       estado || '/' || acceso || '/' || cancelada_por || '/' || puede_reanudar || '/' || puede_reactivar,
       'CANCELADA/COMPLETO/EMPRESA/true/false'
  FROM plataforma.fn_estado_suscripcion(:'t_b');
INSERT INTO resultado
SELECT 'cancelar · diez días para reactivar y se elimina al siguiente',
       (reactivable_hasta = :'vence_b'::date + 10 AND se_elimina_el = :'vence_b'::date + 11)::text, 'true'
  FROM plataforma.fn_estado_suscripcion(:'t_b');
INSERT INTO resultado VALUES
  ('cancelar · dos veces no',
   pg_temp.correr($$SELECT plataforma.fn_cancelar_suscripcion_empresa(NULL)$$), 'P0001'),
  ('cancelar · antes de la fecha no se reporta pago: se reanuda',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 100, %L, NULL, 1::smallint, %L)',
                         'PSE', :'sop_b1')), 'P0001');
RESET ROLE;
INSERT INTO resultado
SELECT 'cancelar · evento sin superadministrador, con el nombre de quien canceló',
       string_agg(tipo || ':' || (usuario_plataforma_id IS NULL)::text || ':' || (datos->>'cancelada_por'), ','),
       'SUSCRIPCION_CANCELADA:true:Beto Admin'
  FROM plataforma.evento_plataforma WHERE tenant_id = :'t_b' AND id > :ultimo_evento;

SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('reanudar · antes de la fecha, sin pagar',
   pg_temp.correr('SELECT plataforma.fn_reanudar_suscripcion()'), 'OK');
RESET ROLE;
INSERT INTO resultado
SELECT 'reanudar · vuelve ACTIVA, con su misma fecha',
       pg_temp.ea(:'t_b') || '/' || (vence_el = :'vence_b'::date), 'ACTIVA/COMPLETO/true'
  FROM plataforma.fn_estado_suscripcion(:'t_b');

-- ============================================================================
--  B · Cancelada y vencida: solo el administrador la reactiva, pagando
-- ============================================================================
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT plataforma.fn_cancelar_suscripcion_empresa('Definitivo') \gset x_
RESET ROLE;
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 40,
       fecha_vencimiento = current_date - 3, cancelada_en = now() - interval '5 days'
 WHERE id = :'s_b';
INSERT INTO resultado
SELECT 'vencida la cancelada · solo pago, reactivable hasta lo pagado + 10',
       pg_temp.ea(:'t_b') || '/' || puede_reactivar || '/' || (reactivable_hasta = current_date + 7),
       'CANCELADA/SOLO_PAGO/true/true'
  FROM plataforma.fn_estado_suscripcion(:'t_b');
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('vencida la cancelada · no consulta',
   pg_temp.correr($$SELECT app.fn_exigir_permiso('APU.VER')$$), 'CS006'),
  ('vencida la cancelada · ya no se reanuda sin pagar',
   pg_temp.correr('SELECT plataforma.fn_reanudar_suscripcion()'), 'P0001');
SELECT set_config('app.usuario_id', :'u_asis', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('reactivar · el asistente no reporta',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 100, %L, NULL, 1::smallint, %L)',
                         'PSE', :'sop_b1')), 'CS004');
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'B-react', 1::smallint, :'sop_b1') AS pago_rech \gset
RESET ROLE;

-- Un rechazo dentro del plazo de reactivar da dos hábiles más, si eso es más.
SELECT plataforma.fn_rechazar_pago(:'pago_rech', :'sp', 'Ilegible');
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 9,
       cancelada_en = now() - interval '12 days' WHERE id = :'s_b';
UPDATE plataforma.pago SET registrado_en = now() - interval '1 hour' WHERE id = :'pago_rech';
INSERT INTO resultado
SELECT 'reactivar · el rechazo corre el plazo a dos hábiles desde hoy',
       (reactivable_hasta = plataforma.fn_sumar_dias_habiles(current_date, 2))::text, 'true'
  FROM plataforma.fn_estado_suscripcion(:'t_b');

SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'B-bueno', 1::smallint, :'sop_b2') AS pago_react \gset
RESET ROLE;
SELECT COALESCE(max(id), 0) AS ultimo_evento FROM plataforma.evento_plataforma \gset
SET ROLE construsoft_superadmin;
INSERT INTO resultado VALUES
  ('reactivar · el panel confirma',
   pg_temp.correr(format('SELECT plataforma.fn_confirmar_pago(%L, %L)', :'pago_react', :'sp')), 'OK');
RESET ROLE;
INSERT INTO resultado
SELECT 'reactivar · ACTIVA desde hoy por el período pagado, sin rastro de cancelación',
       s.estado || '/' || (s.fecha_vencimiento = (current_date + interval '1 month')::date)
         || '/' || (s.cancelada_en IS NULL AND s.cancelada_por_usuario IS NULL),
       'ACTIVA/true/true'
  FROM plataforma.suscripcion s WHERE s.id = :'s_b';
INSERT INTO resultado
SELECT 'reactivar · eventos', string_agg(tipo, ',' ORDER BY id), 'SUSCRIPCION_REACTIVADA,PAGO_REGISTRADO'
  FROM plataforma.evento_plataforma WHERE tenant_id = :'t_b' AND id > :ultimo_evento;

-- El panel cancela: queda a nombre de la plataforma, y el panel no la revive
-- registrando un pago.
UPDATE plataforma.suscripcion SET estado = 'CANCELADA', cancelada_en = now(),
       cancelada_motivo = 'Decisión comercial' WHERE id = :'s_b';
INSERT INTO resultado
SELECT 'panel · cancelada por la plataforma', cancelada_por, 'PLATAFORMA'
  FROM plataforma.fn_estado_suscripcion(:'t_b');
INSERT INTO resultado VALUES
  ('panel · no registra pagos sobre una cancelada',
   pg_temp.correr(format($$SELECT plataforma.fn_registrar_pago(%L, current_date, 'x', 1, 'PSE', NULL, 1::smallint, %L)$$,
                         :'s_b', :'sp')), 'P0001');

-- ============================================================================
--  C · La prueba (D-76 cambió sus plazos: ver prueba-d76.sql)
-- ============================================================================
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 40,
       fecha_vencimiento = current_date - 3 WHERE id = :'s_c';
INSERT INTO resultado
SELECT 'prueba · vencida es solo lectura; sin pago, se elimina al día 11 (D-76)',
       pg_temp.ea(:'t_c') || '/' || (se_elimina_el = current_date + 8), 'VENCIDA/SOLO_LECTURA/true'
  FROM plataforma.fn_estado_suscripcion(:'t_c');
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_c', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_c', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('prueba · consulta',  pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.VER')$$),   'OK'),
  ('prueba · no crea',   pg_temp.correr($$SELECT app.fn_exigir_permiso('PRESUPUESTOS.CREAR')$$), 'CS005');
RESET ROLE;

-- ============================================================================
--  La purga diaria
-- ============================================================================
-- A: suspendida hace más de 60 días. B: cancelada fuera de plazo. C: prueba
-- vencida hace un mes, que desde D-76 la purga también toma.
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 200,
       fecha_vencimiento = current_date - 100 WHERE id = :'s_a';
UPDATE plataforma.suscripcion SET fecha_inicio = current_date - 200,
       fecha_vencimiento = current_date - 30, cancelada_en = now() - interval '40 days' WHERE id = :'s_b';
UPDATE plataforma.suscripcion SET fecha_vencimiento = current_date - 30 WHERE id = :'s_c';
INSERT INTO resultado
SELECT 'purga · la cancelada fuera de plazo ya no entra', pg_temp.ea(:'t_b'), 'CANCELADA/NINGUNO';
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO resultado VALUES
  ('purga · fuera de plazo no reactiva',
   pg_temp.correr(format('SELECT plataforma.fn_reportar_pago(current_date, 100, %L, NULL, 1::smallint, %L)',
                         'PSE', :'sop_b2')), 'P0001');
INSERT INTO resultado VALUES
  ('purga · la empresa no la puede correr', pg_temp.correr('SELECT * FROM plataforma.fn_purgar_empresas()'), '42501');
RESET ROLE;
SET ROLE construsoft_superadmin;
INSERT INTO resultado
SELECT 'purga · elimina A, B y la prueba C (D-76)', string_agg(razon_social, ',' ORDER BY razon_social), 'Cancela B SAS,Paga A SAS,Prueba C SAS'
  FROM plataforma.fn_purgar_empresas();
RESET ROLE;
INSERT INTO resultado
SELECT 'purga · C ya no está', count(*)::text, '0' FROM plataforma.tenant WHERE id = :'t_c';
INSERT INTO resultado
SELECT 'purga · el rastro queda, sin superadministrador',
       string_agg(datos->>'razon_social' || ':' || (usuario_plataforma_id IS NULL)::text, ',' ORDER BY datos->>'razon_social'),
       'Cancela B SAS:true,Paga A SAS:true,Prueba C SAS:true'
  FROM plataforma.evento_plataforma WHERE tipo = 'TENANT_ELIMINADO';

-- ============================================================================
--  El veredicto
-- ============================================================================
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
          '% de % casos de D-74 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-74 verificado: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
