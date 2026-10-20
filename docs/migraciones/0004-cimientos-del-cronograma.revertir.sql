-- =============================================================================
--  Revierte la migración 0004 · Cimientos del cronograma. Deja las horas por
--  jornal, la revisión, el rendimiento de la actividad, los calendarios y los
--  festivos como si nunca hubieran existido. La restricción de tipos de evento
--  del panel conserva FESTIVOS_EXTENDIDOS, como la 0001 conserva los suyos: un
--  evento ya escrito no se borra para poder revertir.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_revertir(4);

DROP TRIGGER tg_calendario_al_nacer ON app.configuracion_empresa;
DROP TRIGGER tg_horas_por_jornal_ins ON app.presupuesto;
DROP TRIGGER tg_horas_por_jornal_upd ON app.presupuesto;

DROP FUNCTION app.fn_copiar_festivos(uuid, uuid, boolean);
DROP FUNCTION app.fn_calendario_por_defecto(uuid);
DROP FUNCTION app.fn_calendario_al_nacer();
DROP FUNCTION app.fn_crear_calendario_inicial(uuid);
DROP FUNCTION plataforma.fn_extender_festivos(char, uuid);

DROP TABLE app.calendario_excepcion_tramo;
DROP TABLE app.calendario_excepcion;
DROP TABLE app.calendario_tramo;
DROP TABLE app.calendario;
DROP TABLE app.lista_festivos_propia_fecha;
DROP TABLE app.lista_festivos_propia;
DROP TABLE plataforma.lista_festivos_fecha;
DROP TABLE plataforma.lista_festivos;

DROP FUNCTION app.fn_un_calendario_por_defecto();
DROP FUNCTION app.fn_tramos_sin_cruce();
DROP FUNCTION app.fn_minuto_del_dia(time);
DROP FUNCTION app.fn_horas_por_jornal_presupuesto();

-- La revisión deja de subir.
CREATE OR REPLACE FUNCTION app.fn_marcar_modificacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
    -- Duplicar y purgar no son ediciones de nadie.
    IF app.fn_bandera_interna('app.purga_tenant')
       OR app.fn_bandera_interna('app.duplicando') THEN
        RETURN NULL;
    END IF;
    UPDATE app.presupuesto SET fecha_modificacion = now()
     WHERE id IN (SELECT presupuesto_id FROM afectados);
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.fn_marcar_modificacion_cabecera() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.fecha_modificacion := now();
    RETURN NEW;
END $$;

-- fn_nueva_version_apu vuelve a su firma de cinco argumentos.
DROP FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text, numeric, boolean);
CREATE FUNCTION app.fn_nueva_version_apu(
    p_apu_id uuid, p_lineas jsonb, p_nombre text DEFAULT NULL,
    p_unidad_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_apu app.apu; v_tenant uuid; v_ver uuid; v_cd app.dinero;
        v_nombre text; v_unidad uuid; v_simbolo text; v_num integer;
        v_lineas integer; v_resueltas integer;
BEGIN
    SELECT * INTO v_apu FROM app.apu WHERE id = p_apu_id;
    IF v_apu.id IS NULL THEN
        RAISE EXCEPTION 'El APU no existe en esta empresa.';
    END IF;
    v_tenant := v_apu.tenant_id;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El APU');

    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array'
       OR jsonb_array_length(p_lineas) = 0 THEN
        RAISE EXCEPTION
          'Un APU no se puede guardar sin recursos: la composición llegó vacía '
          '(D-21, RF-APU-22).';
    END IF;

    SELECT count(*) INTO v_lineas FROM jsonb_array_elements(p_lineas);
    SELECT count(*) INTO v_resueltas
      FROM jsonb_array_elements(p_lineas) l
      JOIN app.recurso r ON r.id = (l->>'recurso_id')::uuid;
    IF v_lineas <> v_resueltas THEN
        RAISE EXCEPTION
          'Alguna línea apunta a un recurso que no existe en esta empresa.';
    END IF;

    v_nombre := COALESCE(p_nombre, v_apu.nombre);
    v_unidad := COALESCE(p_unidad_id, v_apu.unidad_id);
    SELECT simbolo INTO v_simbolo FROM app.unidad_medida WHERE id = v_unidad;
    IF v_simbolo IS NULL THEN
        RAISE EXCEPTION 'La unidad de medida no existe en esta empresa.';
    END IF;

    -- D-1 · subtotal = cantidad × rendimiento × (1 + desperdicio/100) × precio
    SELECT COALESCE(sum(round(
             (l->>'cantidad')::numeric * (l->>'rendimiento')::numeric
             * (1 + COALESCE((l->>'desperdicio_pct')::numeric, 0) / 100)
             * r.precio_total, 6)), 0)
      INTO v_cd
      FROM jsonb_array_elements(p_lineas) l
      JOIN app.recurso r ON r.id = (l->>'recurso_id')::uuid;

    SELECT COALESCE(max(numero), 0) + 1 INTO v_num
      FROM app.apu_version WHERE apu_id = p_apu_id;

    INSERT INTO app.apu_version
        (tenant_id, apu_id, numero, nombre, unidad_simbolo, costo_directo,
         motivo, creada_por)
    VALUES (v_tenant, p_apu_id, v_num, v_nombre, v_simbolo, v_cd,
            p_motivo, app.fn_usuario_actual())
    RETURNING id INTO v_ver;

    INSERT INTO app.apu_version_recurso
        (tenant_id, apu_version_id, orden, recurso_id, recurso_codigo,
         recurso_nombre, recurso_tipo, unidad_simbolo, precio_unitario,
         cantidad, rendimiento, desperdicio_pct, subtotal)
    SELECT v_tenant, v_ver, row_number() OVER (ORDER BY l.orden),
           r.id, r.codigo, r.nombre, r.tipo, um.simbolo, r.precio_total,
           -- RF-APU-19: cantidad y rendimiento valen 1 si no vienen. Sin el
           -- COALESCE, una línea sin ellos moría con «null value in column
           -- cantidad» en vez de aplicar el valor por defecto que el requisito
           -- promete. Menor de la auditoría del 24 de septiembre de 2026.
           COALESCE((l.linea->>'cantidad')::numeric, 1),
           COALESCE((l.linea->>'rendimiento')::numeric, 1),
           COALESCE((l.linea->>'desperdicio_pct')::numeric, 0),
           round(COALESCE((l.linea->>'cantidad')::numeric, 1)
                 * COALESCE((l.linea->>'rendimiento')::numeric, 1)
                 * (1 + COALESCE((l.linea->>'desperdicio_pct')::numeric, 0) / 100)
                 * r.precio_total, 6)
      FROM jsonb_array_elements(p_lineas) WITH ORDINALITY l(linea, orden)
      JOIN app.recurso r        ON r.id  = (l.linea->>'recurso_id')::uuid
      JOIN app.unidad_medida um ON um.id = r.unidad_id;

    UPDATE app.apu
       SET nombre = v_nombre, unidad_id = v_unidad, version_vigente_id = v_ver
     WHERE id = p_apu_id;

    INSERT INTO app.evento_auditoria
        (tenant_id, entidad, entidad_id, tipo_evento, descripcion,
         valor_anterior, valor_nuevo, usuario_id)
    VALUES (v_tenant, 'APU', p_apu_id, 'APU_VERSIONADO',
            format('Versión %s de «%s»', v_num, v_nombre),
            jsonb_build_object('version_anterior', v_apu.version_vigente_id),
            jsonb_build_object('version', v_ver, 'costo_directo', v_cd::text),
            app.fn_usuario_actual());

    RETURN v_ver;
END $$;

COMMENT ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text) IS
  'Única puerta para versionar un APU (D-21, D-22). La base calcula los '
  'subtotales y el costo directo con el precio vigente del recurso (D-1, D-2).';
ALTER FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text) OWNER TO construsoft_owner;
REVOKE ALL ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text)
    TO construsoft_app, construsoft_owner;

ALTER TABLE app.apu_version DROP COLUMN rendimiento_actividad;
ALTER TABLE app.presupuesto DROP COLUMN horas_por_jornal, DROP COLUMN revision;
ALTER TABLE app.configuracion_empresa DROP COLUMN horas_por_jornal, DROP COLUMN inicio_semana;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
