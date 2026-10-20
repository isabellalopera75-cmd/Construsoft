-- =============================================================================
--  Revierte la migración 0005 · El cronograma. Borra los cronogramas, sus
--  actividades, dependencias, resultados y líneas base, y los calendarios de
--  obra y corridos; devuelve el calendario a la forma de la 0004, y
--  fn_tramos_sin_cruce, fn_calendario_por_defecto y fn_duplicar_presupuesto a
--  como estaban. Los tipos de evento del cronograma se quedan en el catálogo,
--  como la 0004 deja FESTIVOS_EXTENDIDOS: un evento ya escrito no se borra para
--  poder revertir.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(5);

DROP TRIGGER tg_cronograma_por_estado ON app.presupuesto;
DROP TRIGGER tg_cronograma_editable ON app.calendario;
DROP TRIGGER tg_cronograma_editable ON app.calendario_tramo;
DROP TRIGGER tg_cronograma_editable ON app.calendario_excepcion;
DROP TRIGGER tg_cronograma_editable ON app.calendario_excepcion_tramo;

DROP TABLE app.linea_base_periodo;
DROP TABLE app.linea_base_actividad;
DROP TABLE app.linea_base;
DROP TABLE app.dependencia;
DROP TABLE app.actividad_calculo;
DROP TABLE app.actividad_programada;
DROP TABLE app.grupo_tramite;

-- Los calendarios de obra y corridos se van con sus cronogramas. Las reglas
-- diferidas se disparan aquí: con eventos pendientes no se puede alterar la
-- tabla.
DELETE FROM app.calendario WHERE cronograma_id IS NOT NULL;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE app.calendario DROP CONSTRAINT fk_calendario_cronograma;
DROP INDEX app.ux_calendario_nombre;
ALTER TABLE app.calendario DROP COLUMN cronograma_id, DROP COLUMN tipo;
CREATE UNIQUE INDEX ux_calendario_nombre ON app.calendario (tenant_id, lower(btrim(nombre)));
DROP TABLE app.cronograma;

DROP FUNCTION app.fn_guardar_linea_base(uuid, text, uuid[], date[], integer[], uuid);
DROP FUNCTION app.fn_curvas(uuid, uuid[], date[], integer[], text);
DROP FUNCTION app.fn_cambiar_calendario_cronograma(uuid, uuid);
DROP FUNCTION app.fn_crear_cronograma(uuid, date, uuid);
DROP FUNCTION app.fn_crear_calendario_corrido(uuid);
DROP FUNCTION app.fn_copiar_calendario_a_cronograma(uuid, uuid);
DROP FUNCTION app.fn_copiar_horario(uuid, uuid);
DROP FUNCTION app.fn_linea_base_editable_cronograma();
DROP FUNCTION app.fn_historia_linea_base();
DROP FUNCTION app.fn_dependencia_sin_ciclo();
DROP FUNCTION app.fn_dependencia_entrada();
DROP FUNCTION app.fn_grupo_borrable();
DROP FUNCTION app.fn_actividad_borrable();
DROP FUNCTION app.fn_actividad_entrada();
DROP FUNCTION app.fn_nombre_restriccion(text);
DROP FUNCTION app.fn_texto_limpio(text);
DROP FUNCTION app.fn_codigo_de_huerfana(uuid, text);
DROP FUNCTION app.fn_siguiente_codigo_actividad(uuid, text);
DROP FUNCTION app.fn_cronograma_por_estado();
DROP FUNCTION app.fn_historia_cronograma();
DROP FUNCTION app.fn_cronograma_cabecera();
DROP FUNCTION app.fn_cronograma_editable();

-- La aplicación vuelve a escribir el calendario por tabla, como en la 0004.
REVOKE INSERT, UPDATE ON app.calendario FROM construsoft_app;
GRANT INSERT, UPDATE ON app.calendario TO construsoft_app;

-- Las tres funciones, como las dejaron la 0004 y el 05.
CREATE OR REPLACE FUNCTION app.fn_tramos_sin_cruce() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_cruce boolean;
BEGIN
    IF TG_TABLE_NAME = 'calendario_tramo' THEN
        SELECT EXISTS (
            SELECT 1 FROM app.calendario_tramo t
             WHERE t.calendario_id = NEW.calendario_id AND t.dia_semana = NEW.dia_semana
               AND t.id <> NEW.id
               AND app.fn_minuto_del_dia(t.inicio) < app.fn_minuto_del_dia(NEW.fin)
               AND app.fn_minuto_del_dia(NEW.inicio) < app.fn_minuto_del_dia(t.fin))
          INTO v_cruce;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM app.calendario_excepcion_tramo t
             WHERE t.excepcion_id = NEW.excepcion_id AND t.id <> NEW.id
               AND app.fn_minuto_del_dia(t.inicio) < app.fn_minuto_del_dia(NEW.fin)
               AND app.fn_minuto_del_dia(NEW.inicio) < app.fn_minuto_del_dia(t.fin))
          INTO v_cruce;
    END IF;
    IF v_cruce THEN
        RAISE EXCEPTION
          'Dos tramos del mismo día se cruzan (de % a %): un día no puede tener la '
          'misma hora dos veces (D-86).', NEW.inicio, NEW.fin;
    END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.fn_calendario_por_defecto(p_calendario_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM app.calendario WHERE id = p_calendario_id;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'El calendario no existe en esta empresa.';
    END IF;
    UPDATE app.calendario SET por_defecto = false
     WHERE tenant_id = v_tenant AND por_defecto AND id <> p_calendario_id;
    UPDATE app.calendario SET por_defecto = true WHERE id = p_calendario_id;
END $$;

CREATE OR REPLACE FUNCTION app.fn_duplicar_presupuesto(
    p_presupuesto_id uuid, p_codigo text, p_nombre text DEFAULT NULL,
    p_actualizar_apu boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_origen app.presupuesto; v_nuevo uuid;
        v_map jsonb; v_nivel smallint; v_max smallint;
BEGIN
    SELECT * INTO v_origen FROM app.presupuesto WHERE id = p_presupuesto_id;
    IF v_origen.id IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    v_tenant := v_origen.tenant_id;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');
    IF btrim(COALESCE(p_codigo, '')) = '' THEN
        RAISE EXCEPTION 'La copia necesita su propio código de presupuesto (RF-PRE-27).';
    END IF;
    -- Silencia los eventos de edición mientras dura la copia (D-45): el hecho
    -- que ocurrió es «duplicó el presupuesto», no doscientas actividades
    -- agregadas una por una. La bandera solo la obedece fn_bandera_interna
    -- cuando la pone una función interna, y esta lo es.
    PERFORM set_config('app.duplicando', 'si', true);

    INSERT INTO app.presupuesto
        (tenant_id, codigo, nombre, ubicacion, moneda, tipo_proyecto,
         aiu_administracion, aiu_imprevistos, aiu_utilidad, iva_utilidad_pct,
         modo_estructura, duplicado_de_id, creado_por)
    VALUES (v_tenant, p_codigo, COALESCE(p_nombre, v_origen.nombre || ' (copia)'),
            v_origen.ubicacion, v_origen.moneda, v_origen.tipo_proyecto,
            v_origen.aiu_administracion, v_origen.aiu_imprevistos,
            v_origen.aiu_utilidad, v_origen.iva_utilidad_pct,
            v_origen.modo_estructura, v_origen.id, app.fn_usuario_actual())
    RETURNING id INTO v_nuevo;

    -- Identificadores nuevos calculados de una vez: el mapa viejo → nuevo es lo
    -- que permite reconstruir el árbol y colgar cada actividad de su capítulo.
    SELECT jsonb_object_agg(n.id::text, app.uuid_v7()::text)
      INTO v_map
      FROM app.wbs_nodo n WHERE n.presupuesto_id = p_presupuesto_id;

    IF v_map IS NOT NULL THEN
        SELECT max(nivel) INTO v_max FROM app.wbs_nodo
         WHERE presupuesto_id = p_presupuesto_id;
        -- Nivel por nivel, para que el padre exista cuando entra el hijo.
        FOR v_nivel IN 1..v_max LOOP
            INSERT INTO app.wbs_nodo
                (id, tenant_id, presupuesto_id, padre_id, orden, nivel,
                 codigo_wbs, nombre, clasificacion)
            SELECT (v_map->>n.id::text)::uuid, v_tenant, v_nuevo,
                   (v_map->>n.padre_id::text)::uuid, n.orden, n.nivel,
                   n.codigo_wbs, n.nombre, n.clasificacion
              FROM app.wbs_nodo n
             WHERE n.presupuesto_id = p_presupuesto_id AND n.nivel = v_nivel;
        END LOOP;

        -- Una sola sentencia: el recálculo se dispara por sentencia, no por fila.
        INSERT INTO app.presupuesto_item
            (tenant_id, presupuesto_id, wbs_nodo_id, orden, codigo_item,
             apu_id, apu_version_id,
             codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
        SELECT v_tenant, v_nuevo, (v_map->>i.wbs_nodo_id::text)::uuid, i.orden,
               i.codigo_item,
               i.apu_id,
               CASE WHEN p_actualizar_apu THEN COALESCE(a.version_vigente_id, i.apu_version_id)
                    ELSE i.apu_version_id END,
               i.codigo_apu,
               CASE WHEN p_actualizar_apu THEN COALESCE(vv.nombre, i.descripcion)
                    ELSE i.descripcion END,
               CASE WHEN p_actualizar_apu THEN COALESCE(vv.unidad_simbolo, i.unidad_simbolo)
                    ELSE i.unidad_simbolo END,
               CASE WHEN p_actualizar_apu THEN COALESCE(vv.costo_directo, i.precio_unitario)
                    ELSE i.precio_unitario END,
               i.cantidad
          FROM app.presupuesto_item i
          JOIN app.apu a           ON a.id  = i.apu_id
          LEFT JOIN app.apu_version vv ON vv.id = a.version_vigente_id
         WHERE i.presupuesto_id = p_presupuesto_id;
    END IF;

    INSERT INTO app.evento_auditoria
        (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
         descripcion, valor_nuevo, usuario_id)
    VALUES (v_tenant, v_nuevo, 'PRESUPUESTO', v_nuevo, 'PRESUPUESTO_DUPLICADO',
            format('Duplicado de «%s»%s', v_origen.codigo,
                   CASE WHEN p_actualizar_apu
                        THEN ', con los APU actualizados a su versión vigente'
                        ELSE '' END),
            jsonb_build_object('duplicado_de', v_origen.codigo),
            app.fn_usuario_actual());

    PERFORM set_config('app.duplicando', '', true);
    RETURN v_nuevo;
END $$;
COMMENT ON FUNCTION app.fn_duplicar_presupuesto(uuid, text, text, boolean) IS
  'Clona la EDT completa en estado ABIERTO (RF-PRE-27, D-19). '
  'p_actualizar_apu reapunta las actividades a la versión vigente.';

SELECT plataforma.fn_migracion_verificar();
COMMIT;
