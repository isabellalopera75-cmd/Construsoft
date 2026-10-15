-- =============================================================================
--  Revierte la migración 0001 · D-78. Deja el ciclo con los plazos escritos en
--  la función, como en el esquema inicial. Los valores cambiados desde el panel
--  se pierden: si alguno rige hoy, revertir cambia los plazos de las empresas.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(1);

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
            v_limite := s.fecha_vencimiento + 10;
            FOR r IN SELECT p.registrado_en::date AS reportado, p.verificado_en::date AS rechazado
                       FROM plataforma.pago p
                      WHERE p.suscripcion_id = s.id
                        AND p.origen = 'REPORTADO' AND p.estado = 'RECHAZADO'
                      ORDER BY p.verificado_en LOOP
                IF r.reportado <= v_limite THEN
                    v_limite := greatest(v_limite,
                                         plataforma.fn_sumar_dias_habiles(r.rechazado, 2));
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
            v_limite := plataforma.fn_sumar_dias_habiles(s.fecha_vencimiento, 2);
            FOR r IN SELECT p.registrado_en::date AS reportado, p.verificado_en::date AS rechazado
                       FROM plataforma.pago p
                      WHERE p.suscripcion_id = s.id
                        AND p.origen = 'REPORTADO' AND p.estado = 'RECHAZADO'
                      ORDER BY p.verificado_en LOOP
                IF r.reportado <= v_limite THEN
                    v_limite := greatest(v_limite,
                                         plataforma.fn_sumar_dias_habiles(r.rechazado, 2));
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
                se_elimina_el    := CASE WHEN v_pendiente THEN NULL ELSE v_limite + 61 END;
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
                             ELSE s.fecha_vencimiento END + 10;
            FOR r IN SELECT p.registrado_en::date AS reportado, p.verificado_en::date AS rechazado
                       FROM plataforma.pago p
                      WHERE p.suscripcion_id = s.id
                        AND p.origen = 'REPORTADO' AND p.estado = 'RECHAZADO'
                        AND p.registrado_en >= s.cancelada_en
                      ORDER BY p.verificado_en LOOP
                IF r.reportado <= v_limite THEN
                    v_limite := greatest(v_limite,
                                         plataforma.fn_sumar_dias_habiles(r.rechazado, 2));
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
  'D-74. El único sitio que calcula estado, acceso y plazos de una empresa: dos '
  'días hábiles de gracia, 60 días suspendida, 10 días para reactivar una '
  'cancelada, dos días hábiles más tras un rechazo. Todo derivado de fechas.';

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
                'desde el %s y pasaron 60 días.', r.suspendida_desde)
            WHEN 'CANCELADA' THEN CASE WHEN r.cancelada_por = 'PRUEBA' THEN format(
                'Eliminación automática (D-76): la prueba terminó sin pago; '
                'sus 10 días de solo lectura vencieron el %s.', r.pagar_a_mas_tardar)
              ELSE format(
                'Eliminación automática (D-74): cancelada, y el plazo para '
                'reactivarla venció el %s.', r.reactivable_hasta) END END;
        PERFORM app.fn_eliminar_tenant(r.id, motivo, NULL);
        RETURN NEXT;
    END LOOP;
END $$;

-- Los tipos de evento PARAMETRO_CAMBIADO y PARAMETRO_ANULADO se quedan
-- admitidos: la bitácora del panel es historia y no se borra para revertir.

DROP VIEW plataforma.v_parametros;
DROP FUNCTION plataforma.fn_anular_parametro(text, date, text, uuid);
DROP FUNCTION plataforma.fn_fijar_parametro(text, integer, date, text, uuid);
DROP FUNCTION plataforma.fn_parametro(text, date);
DROP TABLE plataforma.parametro_valor;
DROP TABLE plataforma.parametro;
DROP FUNCTION plataforma.fn_guardar_parametro_valor();

SELECT plataforma.fn_migracion_verificar();
COMMIT;
