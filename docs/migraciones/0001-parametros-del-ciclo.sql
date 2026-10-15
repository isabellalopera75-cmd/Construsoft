-- =============================================================================
--  Migración 0001 · D-78 · Los plazos del ciclo de suscripción, como parámetros
--  con vigencia.
--
--  Decisión del dueño, 14 de octubre de 2026. Los cinco plazos que D-74 y D-76
--  escribieron dentro de fn_ciclo_suscripcion —dos días hábiles de gracia, dos
--  más tras un rechazo, 60 días suspendida, 10 de solo lectura al terminar la
--  prueba y 10 para reactivar una cancelada— pasan a una tabla. El
--  superadministrador los cambia desde el panel, con un motivo escrito.
--
--  La regla que lo hace seguro: CADA PLAZO SE CUENTA CON EL VALOR VIGENTE EL DÍA
--  DESDE EL QUE SE CUENTA. La suspensión, desde el día en que empezó; la
--  gracia, desde el vencimiento; el plazo tras un rechazo, desde el rechazo.
--  Un plazo que ya empezó a correr conserva el valor con que empezó. Así,
--  acortar la suspensión de 60 a 30 días no deja a nadie listo para borrarse
--  de un día para otro: solo alcanza a las suspensiones que empiecen desde el
--  cambio. Por la misma razón un valor nunca rige hacia atrás —vigente_desde no
--  puede ser anterior a hoy— y la tabla de valores es de solo agregar: la
--  historia de qué valía cada plazo cada día se puede reconstruir siempre.
--
--  Los días de prueba no entran: ya son de cada plan (plan.dias_prueba) y se
--  aplican al dar de alta la empresa, que es justo cuando empiezan a correr.
--
--  Con los valores iniciales nada cambia: las baterías de D-74 y D-76 tienen
--  que seguir en verde sin tocarlas.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(1, 'parametros-del-ciclo');

CREATE TABLE plataforma.parametro (
    clave                text     PRIMARY KEY CHECK (clave ~ '^[A-Z][A-Z0-9_]*$'),
    nombre               text     NOT NULL,
    descripcion          text     NOT NULL,
    unidad               text     NOT NULL CHECK (unidad IN ('DIAS','DIAS_HABILES')),
    minimo               integer  NOT NULL CHECK (minimo >= 0),
    maximo               integer  NOT NULL,
    -- El plazo está escrito en los términos o en la política de datos: cambiarlo
    -- sin publicar una versión nueva de esos textos deja una promesa falsa.
    aparece_en_terminos  boolean  NOT NULL DEFAULT false,
    CHECK (maximo >= minimo)
);
COMMENT ON TABLE plataforma.parametro IS
  'D-78. El catálogo de plazos configurables, con sus límites.';

CREATE TABLE plataforma.parametro_valor (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clave           text        NOT NULL REFERENCES plataforma.parametro(clave),
    valor           integer     NOT NULL,
    vigente_desde   date        NOT NULL,
    motivo          text        NOT NULL CHECK (btrim(motivo) <> ''),
    registrado_por  uuid        REFERENCES plataforma.usuario_plataforma(id),
    registrado_en   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (clave, vigente_desde)
);
COMMENT ON TABLE plataforma.parametro_valor IS
  'D-78. Qué valía cada plazo desde cada día. Solo agregar: se anula únicamente '
  'un valor programado que todavía no ha regido.';

-- Los límites del catálogo valen para toda fila, también la carga inicial.
-- Y la tabla es de solo agregar: lo que ya rigió es historia.
CREATE OR REPLACE FUNCTION plataforma.fn_guardar_parametro_valor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, pg_temp AS $$
DECLARE c record;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO c FROM plataforma.parametro WHERE clave = NEW.clave;
        IF NEW.valor < c.minimo OR NEW.valor > c.maximo THEN
            RAISE EXCEPTION '«%» admite de % a %; % queda fuera (D-78).',
                c.nombre, c.minimo, c.maximo, NEW.valor;
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' AND OLD.vigente_desde > current_date THEN
        RETURN OLD;   -- un valor programado que no alcanzó a regir
    END IF;
    RAISE EXCEPTION 'Un valor de un plazo que ya rigió no se cambia ni se borra: es '
                    'la historia de qué valía cada día. Para cambiarlo, registre uno '
                    'nuevo desde hoy (D-78).';
END $$;
CREATE TRIGGER tg_guardar_parametro_valor
    BEFORE INSERT OR UPDATE OR DELETE ON plataforma.parametro_valor
    FOR EACH ROW EXECUTE FUNCTION plataforma.fn_guardar_parametro_valor();

INSERT INTO plataforma.parametro (clave, nombre, descripcion, unidad, minimo, maximo, aparece_en_terminos) VALUES
  ('GRACIA_PAGO', 'Gracia para pagar',
   'Días hábiles después del vencimiento en que la cuenta sigue completa esperando el pago (D-74).',
   'DIAS_HABILES', 0, 15, false),
  ('PLAZO_TRAS_RECHAZO', 'Plazo tras un pago rechazado',
   'Días hábiles para reenviar el comprobante cuando se rechaza uno reportado a tiempo (D-74).',
   'DIAS_HABILES', 1, 15, false),
  ('SUSPENSION', 'Suspensión antes de eliminar',
   'Días que una cuenta suspendida por falta de pago conserva sus datos antes de eliminarse (D-74).',
   'DIAS', 30, 365, false),
  ('PRUEBA_SOLO_LECTURA', 'Solo lectura al terminar la prueba',
   'Días de solo lectura, con la suscripción a la mano para pagar, después de la prueba gratuita (D-76).',
   'DIAS', 1, 60, false),
  ('REACTIVACION', 'Plazo para reactivar una cancelada',
   'Días para reactivar una suscripción cancelada, contados desde que deja de funcionar (D-74).',
   'DIAS', 5, 90, true);

INSERT INTO plataforma.parametro_valor (clave, valor, vigente_desde, motivo) VALUES
  ('GRACIA_PAGO',          2, '-infinity', 'Valor inicial (D-74).'),
  ('PLAZO_TRAS_RECHAZO',   2, '-infinity', 'Valor inicial (D-74).'),
  ('SUSPENSION',          60, '-infinity', 'Valor inicial (D-74).'),
  ('PRUEBA_SOLO_LECTURA', 10, '-infinity', 'Valor inicial (D-76).'),
  ('REACTIVACION',        10, '-infinity', 'Valor inicial (D-74).');

-- El valor de un plazo en una fecha. La usa fn_ciclo_suscripcion en cada
-- petición: una búsqueda por la llave (clave, vigente_desde).
CREATE OR REPLACE FUNCTION plataforma.fn_parametro(p_clave text, p_fecha date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plataforma, pg_temp AS $$
DECLARE v integer;
BEGIN
    SELECT pv.valor INTO v FROM plataforma.parametro_valor pv
     WHERE pv.clave = p_clave AND pv.vigente_desde <= p_fecha
     ORDER BY pv.vigente_desde DESC LIMIT 1;
    IF v IS NULL THEN
        RAISE EXCEPTION 'El plazo «%» no existe (D-78).', p_clave;
    END IF;
    RETURN v;
END $$;
COMMENT ON FUNCTION plataforma.fn_parametro(text, date) IS
  'D-78. El valor de un plazo vigente en una fecha.';

-- Cambiar un plazo, desde el panel. Firmado, con motivo, y nunca hacia atrás.
CREATE OR REPLACE FUNCTION plataforma.fn_fijar_parametro(
    p_clave text, p_valor integer, p_vigente_desde date, p_motivo text,
    p_superadmin uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, pg_temp AS $$
DECLARE c record; v_ultima date; v_actual integer; v_id bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM plataforma.usuario_plataforma
                    WHERE id = p_superadmin AND activo) THEN
        RAISE EXCEPTION 'Quien cambia el plazo no es un superadministrador activo (D-78).';
    END IF;
    SELECT * INTO c FROM plataforma.parametro WHERE clave = p_clave;
    IF c.clave IS NULL THEN
        RAISE EXCEPTION 'El plazo «%» no existe (D-78).', p_clave;
    END IF;
    IF btrim(COALESCE(p_motivo, '')) = '' THEN
        RAISE EXCEPTION 'Escriba por qué cambia «%»: queda en la bitácora del panel.', c.nombre
            USING COLUMN = 'motivo';
    END IF;
    IF p_vigente_desde IS NULL OR p_vigente_desde < current_date THEN
        RAISE EXCEPTION 'Un plazo no se cambia hacia atrás: la fecha desde la que rige '
                        'tiene que ser hoy o una posterior (D-78).'
            USING COLUMN = 'vigenteDesde';
    END IF;
    SELECT max(vigente_desde) INTO v_ultima FROM plataforma.parametro_valor WHERE clave = p_clave;
    IF p_vigente_desde <= v_ultima THEN
        RAISE EXCEPTION 'Ya hay un valor de «%» que rige desde el %. El nuevo tiene que '
                        'regir después; si el programado está mal, anúlelo primero (D-78).',
                        c.nombre, v_ultima
            USING COLUMN = 'vigenteDesde';
    END IF;
    v_actual := plataforma.fn_parametro(p_clave, p_vigente_desde);
    IF p_valor = v_actual THEN
        RAISE EXCEPTION '«%» ya vale % en esa fecha: no hay nada que cambiar.', c.nombre, p_valor
            USING COLUMN = 'valor';
    END IF;
    IF p_valor < c.minimo OR p_valor > c.maximo THEN
        RAISE EXCEPTION '«%» admite de % a %.', c.nombre, c.minimo, c.maximo
            USING COLUMN = 'valor';
    END IF;
    INSERT INTO plataforma.parametro_valor (clave, valor, vigente_desde, motivo, registrado_por)
    VALUES (p_clave, p_valor, p_vigente_desde, btrim(p_motivo), p_superadmin)
    RETURNING id INTO v_id;
    PERFORM plataforma.fn_evento_plataforma(NULL, 'PARAMETRO_CAMBIADO',
        format('%s: de %s a %s, desde el %s', c.nombre, v_actual, p_valor, p_vigente_desde),
        btrim(p_motivo),
        jsonb_build_object('clave', p_clave, 'antes', v_actual, 'despues', p_valor,
                           'vigente_desde', p_vigente_desde),
        p_superadmin);
    RETURN v_id;
END $$;

-- Anular un valor programado que todavía no rige.
CREATE OR REPLACE FUNCTION plataforma.fn_anular_parametro(
    p_clave text, p_vigente_desde date, p_motivo text, p_superadmin uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, pg_temp AS $$
DECLARE v record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM plataforma.usuario_plataforma
                    WHERE id = p_superadmin AND activo) THEN
        RAISE EXCEPTION 'Quien anula no es un superadministrador activo (D-78).';
    END IF;
    IF btrim(COALESCE(p_motivo, '')) = '' THEN
        RAISE EXCEPTION 'Escriba por qué anula el cambio programado.' USING COLUMN = 'motivo';
    END IF;
    SELECT pv.*, pa.nombre INTO v FROM plataforma.parametro_valor pv
      JOIN plataforma.parametro pa ON pa.clave = pv.clave
     WHERE pv.clave = p_clave AND pv.vigente_desde = p_vigente_desde;
    IF v.id IS NULL THEN
        RAISE EXCEPTION 'No hay un cambio de ese plazo programado para esa fecha.';
    END IF;
    IF v.vigente_desde <= current_date THEN
        RAISE EXCEPTION 'Ese valor ya rige: no se anula. Para cambiarlo, registre uno nuevo (D-78).';
    END IF;
    DELETE FROM plataforma.parametro_valor WHERE id = v.id;
    PERFORM plataforma.fn_evento_plataforma(NULL, 'PARAMETRO_ANULADO',
        format('%s: se anula el cambio a %s programado para el %s', v.nombre, v.valor, v.vigente_desde),
        btrim(p_motivo), jsonb_build_object('clave', p_clave, 'valor', v.valor,
                                            'vigente_desde', v.vigente_desde),
        p_superadmin);
END $$;

-- Lo que el panel muestra: cada plazo con su valor de hoy y lo programado.
CREATE OR REPLACE VIEW plataforma.v_parametros AS
SELECT pa.clave, pa.nombre, pa.descripcion, pa.unidad, pa.minimo, pa.maximo,
       pa.aparece_en_terminos,
       hoy.valor AS valor_hoy, hoy.vigente_desde AS vigente_desde,
       prox.valor AS valor_programado, prox.vigente_desde AS programado_desde
  FROM plataforma.parametro pa
  CROSS JOIN LATERAL (SELECT pv.valor, pv.vigente_desde FROM plataforma.parametro_valor pv
                       WHERE pv.clave = pa.clave AND pv.vigente_desde <= current_date
                       ORDER BY pv.vigente_desde DESC LIMIT 1) hoy
  LEFT JOIN LATERAL (SELECT pv.valor, pv.vigente_desde FROM plataforma.parametro_valor pv
                      WHERE pv.clave = pa.clave AND pv.vigente_desde > current_date
                      ORDER BY pv.vigente_desde LIMIT 1) prox ON true;

-- Los dos eventos nuevos de la bitácora del panel.
ALTER TABLE plataforma.evento_plataforma DROP CONSTRAINT evento_plataforma_tipo_check;
ALTER TABLE plataforma.evento_plataforma ADD CONSTRAINT evento_plataforma_tipo_check CHECK (tipo IN
    ('TENANT_CREADO','TENANT_SUSPENDIDO','TENANT_REACTIVADO',
     'TENANT_ELIMINADO','PLAN_CAMBIADO','SUSCRIPCION_CANCELADA',
     'PAGO_REGISTRADO','ADMIN_DESIGNADO',
     'PAGO_REPORTADO','PAGO_RECHAZADO',
     'SUSCRIPCION_REANUDADA','SUSCRIPCION_REACTIVADA',
     'PARAMETRO_CAMBIADO','PARAMETRO_ANULADO'));                          -- D-78

-- El ciclo, leyendo los plazos de la tabla.
CREATE OR REPLACE FUNCTION plataforma.fn_ciclo_suscripcion(
    p_tenant_id uuid, p_con_suspension boolean DEFAULT true)
RETURNS TABLE (estado text, acceso text, suspension text, vence_el date,
               dias_restantes integer, plan_codigo text,
               pagar_a_mas_tardar date, suspendida_desde date,
               reactivable_hasta date, se_elimina_el date, cancelada_por text,
               pago_en_verificacion boolean, puede_reanudar boolean,
               puede_reactivar boolean)
LANGUAGE plpgsql STABLE
SET search_path = plataforma, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
    v_hoy        date := current_date;
    v_tenant     text;
    s            record;
    r            record;
    v_limite     date;
    v_pendiente  boolean;
    v_a_tiempo   boolean;
BEGIN
    SELECT t.estado INTO v_tenant FROM plataforma.tenant t WHERE t.id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT sx.*, pl.codigo AS plan INTO s
      FROM plataforma.suscripcion sx JOIN plataforma.plan pl ON pl.id = sx.plan_id
     WHERE sx.tenant_id = p_tenant_id
     ORDER BY (sx.estado IN ('EN_PRUEBA','ACTIVA')) DESC,
              sx.fecha_vencimiento DESC, sx.creado_en DESC, sx.id DESC
     LIMIT 1;

    pago_en_verificacion := false;
    puede_reanudar       := false;
    puede_reactivar      := false;

    IF s.id IS NULL THEN
        estado := 'SIN_SUSCRIPCION';
        acceso := 'SOLO_LECTURA';
    ELSE
        vence_el       := s.fecha_vencimiento;
        dias_restantes := s.fecha_vencimiento - v_hoy;
        plan_codigo    := s.plan;
        v_pendiente := EXISTS (SELECT 1 FROM plataforma.pago p
                                WHERE p.suscripcion_id = s.id
                                  AND p.origen = 'REPORTADO' AND p.estado = 'PENDIENTE');
        pago_en_verificacion := v_pendiente;

        IF s.estado = 'EN_PRUEBA' THEN
            -- D-76 · Quince días con todo, diez de solo lectura para decidir
            -- y, sin pago, cancelada y eliminada al día siguiente. Un rechazo
            -- de un pago reportado a tiempo da dos días hábiles, como en D-74.
            -- D-78 · Cada plazo con el valor vigente el día desde el que se
            -- cuenta: aquí, el fin de la prueba.
            v_limite := s.fecha_vencimiento
                        + plataforma.fn_parametro('PRUEBA_SOLO_LECTURA', s.fecha_vencimiento);
            FOR r IN SELECT p.registrado_en::date AS reportado, p.verificado_en::date AS rechazado
                       FROM plataforma.pago p
                      WHERE p.suscripcion_id = s.id
                        AND p.origen = 'REPORTADO' AND p.estado = 'RECHAZADO'
                      ORDER BY p.verificado_en LOOP
                IF r.reportado <= v_limite THEN
                    v_limite := greatest(v_limite,
                                         plataforma.fn_sumar_dias_habiles(r.rechazado,
                                             plataforma.fn_parametro('PLAZO_TRAS_RECHAZO', r.rechazado)));
                END IF;
            END LOOP;
            v_a_tiempo := EXISTS (SELECT 1 FROM plataforma.pago p
                                   WHERE p.suscripcion_id = s.id
                                     AND p.origen = 'REPORTADO' AND p.estado = 'PENDIENTE'
                                     AND p.registrado_en::date <= v_limite);
            pagar_a_mas_tardar := v_limite;
            IF v_hoy <= s.fecha_vencimiento THEN
                estado := 'EN_PRUEBA'; acceso := 'COMPLETO';
            ELSIF v_hoy <= v_limite OR v_a_tiempo THEN
                estado := 'VENCIDA';   acceso := 'SOLO_LECTURA';
            ELSE
                estado := 'CANCELADA'; acceso := 'NINGUNO';
                cancelada_por := 'PRUEBA';
            END IF;
            se_elimina_el := CASE WHEN v_pendiente THEN NULL ELSE v_limite + 1 END;

        ELSIF s.estado = 'ACTIVA' THEN
            v_limite := plataforma.fn_sumar_dias_habiles(s.fecha_vencimiento,
                            plataforma.fn_parametro('GRACIA_PAGO', s.fecha_vencimiento));
            FOR r IN SELECT p.registrado_en::date AS reportado, p.verificado_en::date AS rechazado
                       FROM plataforma.pago p
                      WHERE p.suscripcion_id = s.id
                        AND p.origen = 'REPORTADO' AND p.estado = 'RECHAZADO'
                      ORDER BY p.verificado_en LOOP
                IF r.reportado <= v_limite THEN
                    v_limite := greatest(v_limite,
                                         plataforma.fn_sumar_dias_habiles(r.rechazado,
                                             plataforma.fn_parametro('PLAZO_TRAS_RECHAZO', r.rechazado)));
                END IF;
            END LOOP;
            v_a_tiempo := EXISTS (SELECT 1 FROM plataforma.pago p
                                   WHERE p.suscripcion_id = s.id
                                     AND p.origen = 'REPORTADO' AND p.estado = 'PENDIENTE'
                                     AND p.registrado_en::date <= v_limite);
            pagar_a_mas_tardar := v_limite;
            IF v_hoy <= s.fecha_vencimiento THEN
                estado := 'ACTIVA';    acceso := 'COMPLETO';
            ELSIF v_hoy <= v_limite OR v_a_tiempo THEN
                estado := 'POR_PAGAR'; acceso := 'COMPLETO';
            ELSE
                estado := 'SUSPENDIDA'; acceso := 'SOLO_PAGO';
                suspension       := 'FALTA_DE_PAGO';
                suspendida_desde := v_limite + 1;
                se_elimina_el    := CASE WHEN v_pendiente THEN NULL
                                         ELSE suspendida_desde
                                              + plataforma.fn_parametro('SUSPENSION', suspendida_desde) END;
            END IF;

        ELSE  -- CANCELADA
            estado := 'CANCELADA';
            cancelada_por := CASE WHEN s.cancelada_por_usuario IS NULL
                                  THEN 'PLATAFORMA' ELSE 'EMPRESA' END;
            -- Diez días desde que deja de funcionar: lo pagado, o el día de la
            -- cancelación si ya estaba vencida.
            -- D-76 · Una prueba que se cancela no estira su plazo: los diez
            -- días cuentan desde el fin de la prueba, no desde el día en que
            -- se canceló. Quien ya pagó alguna vez sí los cuenta desde ahí.
            v_limite := CASE WHEN EXISTS (SELECT 1 FROM plataforma.pago p
                                           WHERE p.suscripcion_id = s.id AND p.estado = 'EXITOSO')
                             THEN greatest(s.fecha_vencimiento, s.cancelada_en::date)
                             ELSE s.fecha_vencimiento END;
            v_limite := v_limite + plataforma.fn_parametro('REACTIVACION', v_limite);
            FOR r IN SELECT p.registrado_en::date AS reportado, p.verificado_en::date AS rechazado
                       FROM plataforma.pago p
                      WHERE p.suscripcion_id = s.id
                        AND p.origen = 'REPORTADO' AND p.estado = 'RECHAZADO'
                        AND p.registrado_en >= s.cancelada_en
                      ORDER BY p.verificado_en LOOP
                IF r.reportado <= v_limite THEN
                    v_limite := greatest(v_limite,
                                         plataforma.fn_sumar_dias_habiles(r.rechazado,
                                             plataforma.fn_parametro('PLAZO_TRAS_RECHAZO', r.rechazado)));
                END IF;
            END LOOP;
            reactivable_hasta := v_limite;
            IF v_hoy <= s.fecha_vencimiento THEN
                acceso := 'COMPLETO';
                puede_reanudar := true;
            ELSIF v_hoy <= v_limite OR v_pendiente THEN
                acceso := 'SOLO_PAGO';
                puede_reactivar := NOT v_pendiente AND v_hoy <= v_limite;
            ELSE
                acceso := 'NINGUNO';
            END IF;
            se_elimina_el := CASE WHEN v_pendiente THEN NULL ELSE v_limite + 1 END;
        END IF;
    END IF;

    -- La suspensión del superadministrador tapa el estado y el acceso, no los
    -- plazos: esos siguen corriendo por su cuenta.
    IF p_con_suspension AND v_tenant = 'SUSPENDIDO' THEN
        estado     := 'SUSPENDIDA';
        suspension := 'PLATAFORMA';
        IF acceso <> 'NINGUNO' THEN acceso := 'SOLO_PAGO'; END IF;
    END IF;
    RETURN NEXT;
END $$;

COMMENT ON FUNCTION plataforma.fn_ciclo_suscripcion(uuid, boolean) IS
  'D-74, D-78. El único sitio que calcula estado, acceso y plazos de una empresa. '
  'Los plazos salen de plataforma.parametro_valor con el valor vigente el día '
  'desde el que se cuenta cada uno. Todo derivado de fechas.';

-- La purga ya no dice «60 días» ni «10 días»: dice las fechas.
CREATE OR REPLACE FUNCTION plataforma.fn_purgar_empresas()
RETURNS TABLE (tenant_id uuid, razon_social text, motivo text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, app, pg_temp AS $$
#variable_conflict use_column
DECLARE r record;
BEGIN
    FOR r IN SELECT t.id, t.razon_social, c.estado, c.suspendida_desde,
                    c.reactivable_hasta, c.se_elimina_el, c.cancelada_por, c.pagar_a_mas_tardar
               FROM plataforma.tenant t
              CROSS JOIN LATERAL plataforma.fn_ciclo_suscripcion(t.id, false) c
              WHERE c.se_elimina_el <= current_date
                AND c.estado IN ('SUSPENDIDA','CANCELADA')
              ORDER BY c.se_elimina_el, t.id LOOP
        tenant_id    := r.id;
        razon_social := r.razon_social;
        motivo := CASE r.estado
            WHEN 'SUSPENDIDA' THEN format(
                'Eliminación automática (D-74): suspendida por falta de pago '
                'desde el %s; el plazo de suspensión venció el %s.',
                r.suspendida_desde, r.se_elimina_el - 1)
            WHEN 'CANCELADA' THEN CASE WHEN r.cancelada_por = 'PRUEBA' THEN format(
                'Eliminación automática (D-76): la prueba terminó sin pago; '
                'su plazo de solo lectura venció el %s.', r.pagar_a_mas_tardar)
              ELSE format(
                'Eliminación automática (D-74): cancelada, y el plazo para '
                'reactivarla venció el %s.', r.reactivable_hasta) END END;
        PERFORM app.fn_eliminar_tenant(r.id, motivo, NULL);
        RETURN NEXT;
    END LOOP;
END $$;

-- Dueños y permisos, explícitos: una migración no hereda los del esquema.
ALTER TABLE plataforma.parametro       OWNER TO construsoft_owner;
ALTER TABLE plataforma.parametro_valor OWNER TO construsoft_owner;
ALTER VIEW  plataforma.v_parametros    OWNER TO construsoft_owner;
ALTER FUNCTION plataforma.fn_guardar_parametro_valor()                        OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_parametro(text, date)                            OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_fijar_parametro(text, integer, date, text, uuid) OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_anular_parametro(text, date, text, uuid)         OWNER TO construsoft_super;
REVOKE ALL ON FUNCTION plataforma.fn_parametro(text, date)                            FROM PUBLIC;
REVOKE ALL ON FUNCTION plataforma.fn_fijar_parametro(text, integer, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION plataforma.fn_anular_parametro(text, date, text, uuid)         FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.fn_parametro(text, date) TO construsoft_app, construsoft_superadmin;
GRANT EXECUTE ON FUNCTION plataforma.fn_fijar_parametro(text, integer, date, text, uuid) TO construsoft_superadmin;
GRANT EXECUTE ON FUNCTION plataforma.fn_anular_parametro(text, date, text, uuid)         TO construsoft_superadmin;
GRANT SELECT ON plataforma.parametro, plataforma.parametro_valor, plataforma.v_parametros
      TO construsoft_superadmin;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
