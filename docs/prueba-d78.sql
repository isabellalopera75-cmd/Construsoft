-- ============================================================================
--  PRUEBA DE D-77 Y D-78 · Las migraciones en orden, y los plazos del ciclo de
--  suscripción como parámetros con vigencia.
--
--      psql -U postgres -d construsoft -f "docs/prueba-d78.sql"
--
--  Necesita una base con el esquema y la migración 0001 aplicada. Se juzga sola:
--  al final LEVANTA UNA EXCEPCIÓN si algún caso discrepa, y termina con
--  ROLLBACK. Las fechas se calculan desde hoy: sirve cualquier día.
--
--  Para simular la historia —un plazo que cambió hace veinte días— los valores
--  con fecha pasada se insertan directo, como superusuario. Por el panel eso no
--  se puede (caso «fijar · hacia atrás»), y es justo lo que prueba la regla: un
--  plazo cuenta con el valor vigente el día desde el que se cuenta.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d78 se ejecuta como superusuario, y esta conexion no lo es.';
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

-- ============================================================================
--  D-77 · Las migraciones
-- ============================================================================
-- Sirve con cualquier número de migraciones aplicadas: la siguiente se calcula.
SELECT max(numero) AS ult, max(numero) + 1 AS sig, max(numero) + 2 AS salto FROM plataforma.migracion \gset
INSERT INTO resultado
SELECT 'migraciones · la base nació del esquema y lleva la 0001, en orden y sin huecos',
       (min(numero) = 0 AND count(*) = max(numero) + 1
        AND bool_or(numero = 0 AND nombre = 'esquema-inicial')
        AND bool_or(numero = 1 AND nombre = 'parametros-del-ciclo'))::text, 'true'
  FROM plataforma.migracion;
INSERT INTO resultado VALUES
  ('migraciones · la 0001 no se aplica dos veces',
   pg_temp.correr($$SELECT plataforma.fn_migracion_iniciar(1, 'parametros-del-ciclo')$$), 'P0001'),
  ('migraciones · no se salta un número',
   pg_temp.correr(format('SELECT plataforma.fn_migracion_iniciar(%s, %L)', :salto, 'salto')), 'P0001'),
  ('migraciones · el nombre va en minúsculas y guiones',
   pg_temp.correr(format('SELECT plataforma.fn_migracion_iniciar(%s, %L)', :sig, 'Con Espacios')), '23514'),
  ('migraciones · el esquema inicial no se revierte',
   pg_temp.correr($$SELECT plataforma.fn_migracion_revertir(0)$$), 'P0001');
INSERT INTO resultado VALUES
  ('migraciones · la siguiente en orden sí',
   pg_temp.correr(format('SELECT plataforma.fn_migracion_iniciar(%s, %L)', :sig, 'siguiente')), 'OK'),
  ('migraciones · solo se revierte la última',
   pg_temp.correr(format('SELECT plataforma.fn_migracion_revertir(%s)', :ult)), 'P0001'),
  ('migraciones · la última se revierte',
   pg_temp.correr(format('SELECT plataforma.fn_migracion_revertir(%s)', :sig)), 'OK');
INSERT INTO resultado
SELECT 'migraciones · revertida, queda como antes', (max(numero) = :ult)::text, 'true' FROM plataforma.migracion;
SET ROLE construsoft_app;
INSERT INTO resultado VALUES
  ('migraciones · la aplicación no puede aplicarlas',
   pg_temp.correr(format('SELECT plataforma.fn_migracion_iniciar(%s, %L)', :sig, 'intruso')), '42501'),
  ('migraciones · ni verlas',
   pg_temp.correr($$SELECT 1 FROM plataforma.migracion$$), '42501');
RESET ROLE;
SET ROLE construsoft_superadmin;
INSERT INTO resultado VALUES
  ('migraciones · el panel las ve, no las aplica',
   pg_temp.correr($$SELECT 1 FROM plataforma.migracion$$) || '/' ||
   pg_temp.correr(format('SELECT plataforma.fn_migracion_iniciar(%s, %L)', :sig, 'intruso')), 'OK/42501');
RESET ROLE;
INSERT INTO resultado
SELECT 'migraciones · el verificador no encuentra nada', pg_temp.correr($$SELECT plataforma.fn_migracion_verificar()$$), 'OK';

-- ============================================================================
--  D-78 · Los valores iniciales y la tabla de solo agregar
-- ============================================================================
INSERT INTO resultado
SELECT 'parámetros · valores iniciales, iguales a D-74 y D-76',
       string_agg(clave || '=' || plataforma.fn_parametro(clave, current_date), ' ' ORDER BY clave),
       'GRACIA_PAGO=2 PLAZO_TRAS_RECHAZO=2 PRUEBA_SOLO_LECTURA=10 REACTIVACION=10 SUSPENSION=60'
  FROM plataforma.parametro;
INSERT INTO resultado VALUES
  ('parámetros · uno que no existe',
   pg_temp.correr($$SELECT plataforma.fn_parametro('NO_EXISTE', current_date)$$), 'P0001'),
  ('parámetros · un valor que ya rigió no se cambia',
   pg_temp.correr($$UPDATE plataforma.parametro_valor SET valor = 61 WHERE clave = 'SUSPENSION'$$), 'P0001'),
  ('parámetros · ni se borra',
   pg_temp.correr($$DELETE FROM plataforma.parametro_valor WHERE clave = 'SUSPENSION'$$), 'P0001'),
  ('parámetros · los límites valen también para la carga directa',
   pg_temp.correr($$INSERT INTO plataforma.parametro_valor (clave, valor, vigente_desde, motivo)
                    VALUES ('SUSPENSION', 10, current_date + 1, 'x')$$), 'P0001'),
  ('parámetros · sin motivo no hay valor',
   pg_temp.correr($$INSERT INTO plataforma.parametro_valor (clave, valor, vigente_desde, motivo)
                    VALUES ('SUSPENSION', 90, current_date + 1, '  ')$$), '23514');

-- ============================================================================
--  D-78 · La historia: cada plazo con el valor vigente el día desde el que se
--  cuenta. Los cambios «de hace días» van directo a la tabla.
-- ============================================================================
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash)
VALUES ('Soporte', 'soporte@d78.co', '$argon2id$v=19$m=19456,t=2,p=1$x$y') RETURNING id AS sp \gset

INSERT INTO plataforma.parametro_valor (clave, valor, vigente_desde, motivo) VALUES
  ('GRACIA_PAGO',          5, current_date - 30, 'Prueba'),
  ('SUSPENSION',          30, current_date - 20, 'Prueba'),
  ('PRUEBA_SOLO_LECTURA', 20, current_date - 8,  'Prueba'),
  ('REACTIVACION',        30, current_date - 6,  'Prueba'),
  ('PLAZO_TRAS_RECHAZO',   4, current_date - 7,  'Prueba');

-- Cuatro empresas que pagaron: P, A, B y C. Dos en prueba: T1 y T2. Dos
-- canceladas: R1 y R2. Y H, la del rechazo.
CREATE FUNCTION pg_temp.empresa(p_nombre text, p_nit text, p_paga boolean, p_vence date, p_sp uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t uuid; s uuid;
BEGIN
    SELECT id_tenant INTO t FROM app.fn_alta_tenant(p_nombre, p_nit, 'EMPRESARIAL', 'Admin',
                                                    (lower(replace(p_nombre, ' ', '')) || '@d78.co')::citext, 'h');
    SELECT id INTO s FROM plataforma.suscripcion WHERE tenant_id = t;
    IF p_paga THEN
        PERFORM plataforma.fn_registrar_pago(s, current_date, 'Plan', 100, 'TRANSFERENCIA',
                                             p_nombre, 1::smallint, p_sp);
    END IF;
    UPDATE plataforma.suscripcion SET fecha_inicio = p_vence - 200, fecha_vencimiento = p_vence WHERE id = s;
    RETURN t;
END $$;

SELECT pg_temp.empresa('Vieja P',  '901.778.001-1', true,  current_date - 100, :'sp') AS t_p  \gset
SELECT pg_temp.empresa('Antes A',  '901.778.002-2', true,  current_date - 60,  :'sp') AS t_a  \gset
SELECT pg_temp.empresa('Despues B','901.778.003-3', true,  current_date - 15,  :'sp') AS t_b  \gset
SELECT pg_temp.empresa('Gracia C', '901.778.004-4', true,  current_date - 25,  :'sp') AS t_c  \gset
SELECT pg_temp.empresa('Prueba T1','901.778.005-5', false, current_date - 12,  :'sp') AS t_t1 \gset
SELECT pg_temp.empresa('Prueba T2','901.778.006-6', false, current_date - 5,   :'sp') AS t_t2 \gset
SELECT pg_temp.empresa('Cancela R1','901.778.007-7', true, current_date - 10,  :'sp') AS t_r1 \gset
SELECT pg_temp.empresa('Cancela R2','901.778.008-8', true, current_date - 3,   :'sp') AS t_r2 \gset
SELECT pg_temp.empresa('Rechazo H', '901.778.009-9', true, current_date - 10,  :'sp') AS t_h  \gset
UPDATE plataforma.suscripcion SET estado = 'CANCELADA', cancelada_en = now() - interval '12 days',
       cancelada_motivo = 'Prueba' WHERE tenant_id IN (:'t_r1', :'t_r2');

-- A: venció antes de que cambiara la gracia (5 desde hace 30 días) y su
-- suspensión empezó antes de que la suspensión bajara a 30: 2 hábiles y 60 días.
INSERT INTO resultado
SELECT 'historia · A, todo empezó antes: gracia 2 y suspensión 60',
       (pagar_a_mas_tardar = plataforma.fn_sumar_dias_habiles(current_date - 60, 2)
        AND se_elimina_el = suspendida_desde + 60)::text, 'true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_a');
-- B: su suspensión empezó después del cambio: 30 días. Y su gracia, con 5.
INSERT INTO resultado
SELECT 'historia · B, la suspensión empezó después: 30 días',
       (pagar_a_mas_tardar = plataforma.fn_sumar_dias_habiles(current_date - 15, 5)
        AND suspendida_desde = pagar_a_mas_tardar + 1
        AND se_elimina_el = suspendida_desde + 30)::text, 'true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_b');
-- C: venció después del cambio de gracia, y su suspensión empezó después del
-- de suspensión.
INSERT INTO resultado
SELECT 'historia · C, gracia de 5 hábiles desde su vencimiento',
       (pagar_a_mas_tardar = plataforma.fn_sumar_dias_habiles(current_date - 25, 5))::text
       || '/' || estado || '/' || (se_elimina_el = suspendida_desde + 30)::text,
       'true/SUSPENDIDA/true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_c');
-- T1: la prueba terminó antes del cambio a 20: sus 10 días ya pasaron.
INSERT INTO resultado
SELECT 'historia · T1, la prueba terminó antes del cambio: 10 días y cancelada',
       estado || '/' || cancelada_por || '/' || (pagar_a_mas_tardar = current_date - 2)::text,
       'CANCELADA/PRUEBA/true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_t1');
-- T2: terminó después del cambio: 20 días, sigue en solo lectura.
INSERT INTO resultado
SELECT 'historia · T2, terminó después del cambio: 20 días de solo lectura',
       estado || '/' || acceso || '/' || (pagar_a_mas_tardar = current_date + 15)::text,
       'VENCIDA/SOLO_LECTURA/true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_t2');
-- R1: dejó de funcionar antes del cambio a 30: diez días, hasta hoy.
-- R2: después: treinta.
-- R1 dejó de funcionar hace 10 días, antes del cambio a 30: cuenta 10, hasta
-- hoy. R2, hace 3, después del cambio: cuenta 30.
INSERT INTO resultado
SELECT 'historia · R1 y R2, reactivar con 10 y con 30',
       (r1.reactivable_hasta = current_date AND r2.reactivable_hasta = current_date + 27)::text, 'true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_r1') r1, plataforma.fn_ciclo_suscripcion(:'t_r2') r2;

-- H: reportó a tiempo y se lo rechazaron hace 5 días, después del cambio a
-- 4 hábiles: cuenta 4 desde el rechazo.
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id', :'t_h', true) AS _ \gset x_
SELECT set_config('app.usuario_id', (SELECT id::text FROM app.usuario WHERE tenant_id = :'t_h'), true) AS _ \gset x_
SELECT plataforma.fn_subir_comprobante_empresa(encode(sha256('h1'::bytea), 'hex'), 'application/pdf', '\x25504446'::bytea) AS sop_h \gset
SELECT plataforma.fn_reportar_pago(current_date, 100, 'PSE', 'H-1', 1::smallint, :'sop_h') AS pago_h \gset
RESET ROLE;
UPDATE plataforma.pago SET registrado_en = (current_date - 10)::timestamptz + interval '10 hours' WHERE id = :'pago_h';
SELECT plataforma.fn_rechazar_pago(:'pago_h', :'sp', 'No coincide');
UPDATE plataforma.pago SET verificado_en = (current_date - 5)::timestamptz + interval '10 hours' WHERE id = :'pago_h';
INSERT INTO resultado
SELECT 'historia · H, tras el rechazo cuenta los 4 hábiles vigentes ese día',
       (pagar_a_mas_tardar = greatest(plataforma.fn_sumar_dias_habiles(current_date - 10, 5),
                                      plataforma.fn_sumar_dias_habiles(current_date - 5, 4)))::text, 'true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_h');

-- P: suspendida hace mucho, con 60 días: se purga, y el motivo dice fechas,
-- no «60 días».
INSERT INTO resultado
SELECT 'purga · P se elimina con los 60 días con que empezó',
       (SELECT (se_elimina_el = suspendida_desde + 60 AND se_elimina_el <= current_date)::text
          FROM plataforma.fn_ciclo_suscripcion(:'t_p')), 'true';
CREATE TEMP TABLE purgadas AS SELECT * FROM plataforma.fn_purgar_empresas();
INSERT INTO resultado
SELECT 'purga · el motivo dice la fecha en que venció la suspensión',
       (motivo LIKE '%el plazo de suspensión venció el%' AND motivo NOT LIKE '%60 días%')::text, 'true'
  FROM purgadas WHERE tenant_id = :'t_p';
INSERT INTO resultado
SELECT 'purga · solo P y T1 estaban vencidas', string_agg(razon_social, ',' ORDER BY razon_social), 'Prueba T1,Vieja P'
  FROM purgadas;

-- ============================================================================
--  D-78 · Cambiar un plazo desde el panel
-- ============================================================================
SET ROLE construsoft_superadmin;
INSERT INTO resultado VALUES
  ('fijar · hacia atrás, no',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 90, current_date - 1, 'x', %L)$$, :'sp')), 'P0001'),
  ('fijar · sin motivo, no',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 90, current_date + 1, '  ', %L)$$, :'sp')), 'P0001'),
  ('fijar · quien no es superadministrador, no',
   pg_temp.correr($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 90, current_date + 1, 'x', gen_random_uuid())$$), 'P0001'),
  ('fijar · fuera de sus límites, no',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 20, current_date + 1, 'x', %L)$$, :'sp')), 'P0001'),
  ('fijar · el mismo valor que ya rige, no',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 30, current_date + 1, 'x', %L)$$, :'sp')), 'P0001'),
  ('fijar · un plazo que no existe, no',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('NADA', 3, current_date + 1, 'x', %L)$$, :'sp')), 'P0001'),
  ('fijar · programado para dentro de cinco días',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 90, current_date + 5, 'Más tiempo para pagar', %L)$$, :'sp')), 'OK'),
  ('fijar · otro antes del programado, no',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 45, current_date + 3, 'x', %L)$$, :'sp')), 'P0001');
INSERT INTO resultado
SELECT 'fijar · el panel ve hoy y lo programado',
       valor_hoy || '/' || valor_programado || '/' || (programado_desde = current_date + 5)::text,
       '30/90/true'
  FROM plataforma.v_parametros WHERE clave = 'SUSPENSION';
INSERT INTO resultado
SELECT 'fijar · queda en la bitácora del panel, firmado',
       tipo || '/' || (usuario_plataforma_id = :'sp')::text || '/' || justificacion,
       'PARAMETRO_CAMBIADO/true/Más tiempo para pagar'
  FROM plataforma.evento_plataforma WHERE tipo = 'PARAMETRO_CAMBIADO';
INSERT INTO resultado VALUES
  ('anular · lo que ya rige, no',
   pg_temp.correr(format($$SELECT plataforma.fn_anular_parametro('SUSPENSION', current_date - 20, 'x', %L)$$, :'sp')), 'P0001'),
  ('anular · sin motivo, no',
   pg_temp.correr(format($$SELECT plataforma.fn_anular_parametro('SUSPENSION', current_date + 5, '', %L)$$, :'sp')), 'P0001'),
  ('anular · lo programado, sí',
   pg_temp.correr(format($$SELECT plataforma.fn_anular_parametro('SUSPENSION', current_date + 5, 'Me equivoqué', %L)$$, :'sp')), 'OK');
INSERT INTO resultado
SELECT 'anular · ya no hay nada programado', COALESCE(valor_programado::text, 'nada'), 'nada'
  FROM plataforma.v_parametros WHERE clave = 'SUSPENSION';
INSERT INTO resultado
SELECT 'anular · y queda en la bitácora', count(*)::text, '1'
  FROM plataforma.evento_plataforma WHERE tipo = 'PARAMETRO_ANULADO';
INSERT INTO resultado VALUES
  ('fijar · desde hoy, sí',
   pg_temp.correr(format($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 45, current_date, 'Desde hoy', %L)$$, :'sp')), 'OK');
INSERT INTO resultado
SELECT 'fijar · rige hoy', valor_hoy::text, '45' FROM plataforma.v_parametros WHERE clave = 'SUSPENSION';
INSERT INTO resultado VALUES
  ('panel · no escribe la tabla a mano',
   pg_temp.correr($$INSERT INTO plataforma.parametro_valor (clave, valor, vigente_desde, motivo)
                    VALUES ('SUSPENSION', 50, current_date + 9, 'x')$$), '42501');
RESET ROLE;
-- B no cambia: su suspensión empezó antes de hoy, con 30.
INSERT INTO resultado
SELECT 'fijar · lo de hoy no alcanza a B, que empezó antes',
       (se_elimina_el = suspendida_desde + 30)::text, 'true'
  FROM plataforma.fn_ciclo_suscripcion(:'t_b');

SET ROLE construsoft_app;
INSERT INTO resultado VALUES
  ('aplicación · lee el valor de un plazo',
   pg_temp.correr($$SELECT plataforma.fn_parametro('SUSPENSION', current_date)$$), 'OK'),
  ('aplicación · no cambia plazos',
   pg_temp.correr($$SELECT plataforma.fn_fijar_parametro('SUSPENSION', 90, current_date + 1, 'x', gen_random_uuid())$$), '42501'),
  ('aplicación · no lee la tabla de valores',
   pg_temp.correr($$SELECT 1 FROM plataforma.parametro_valor$$), '42501');
RESET ROLE;

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
          '% de % casos de D-77 y D-78 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-77 y D-78 verificados: % casos, todos conformes.', v_total;
END $$;
ROLLBACK;
