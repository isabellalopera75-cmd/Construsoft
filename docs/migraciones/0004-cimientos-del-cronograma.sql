-- =============================================================================
--  Migración 0004 · Cimientos del cronograma (módulo 1, documento 07 §6).
--
--  Lo que el cronograma necesita y que no es el cronograma: entra antes, sola,
--  porque toca tablas del MVP y conviene probarla aparte.
--
--    D-84  Horas por jornal en la empresa (8 por defecto, de 1 a 24), copiadas
--          en cada presupuesto al crearlo, y ya no cambian. Un duplicado se
--          lleva las de su original. Más el día en que empieza la semana
--          (RF-CFG-33).
--    D-85  El rendimiento de la actividad vive en la VERSIÓN del APU, no en el
--          APU (D-22): cambiarlo crea una versión nueva, por la misma puerta de
--          siempre, fn_nueva_version_apu. Quien la llama sin decir nada del
--          rendimiento lo hereda de la versión vigente: así la API de hoy, que
--          no lo conoce, no lo borra al editar un APU.
--    D-86  Los calendarios de la empresa (RF-CFG-29): tramos por día de la
--          semana, varios por día, en bloques de 30 minutos, y excepciones por
--          fecha con la misma forma. Cada empresa —nueva o existente— nace con
--          uno de lunes a viernes, 7:00–12:00 y 13:00–16:00, marcado por
--          defecto y sin festivos. Las copias de cada proyecto y el calendario
--          corrido llegan con el cronograma (migración 0005).
--    D-90  Festivos (RF-CFG-32): listas de la plataforma por país —por ahora
--          Colombia, generada con fn_festivos_colombia— que todas las empresas
--          leen y copian, y listas propias de cada empresa, privadas. Copiar
--          una lista deja sus fechas como excepciones no laborables, que se
--          editan una por una, y anota en el calendario hasta qué año llegan.
--    D-91  presupuesto.revision: un contador que suben los dos sitios que hoy
--          mueven fecha_modificacion, en el mismo UPDATE que ya hacen. El
--          cronograma está desactualizado si su calculado_revision (0005) no
--          coincide. Cero sentencias nuevas en la edición de una cantidad.
--
--  Permisos: horas por jornal, inicio de semana, calendarios y festivos son
--  preferencias de la empresa, y las edita quien tiene CONFIG.PREFERENCIAS.
--  La base guarda los datos y defiende sus reglas; el permiso lo exige la API
--  con fn_exigir_permiso, como en el resto de Configuración.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(4, 'cimientos-del-cronograma');

-- -----------------------------------------------------------------------------
--  D-84 · Horas por jornal e inicio de semana
-- -----------------------------------------------------------------------------
ALTER TABLE app.configuracion_empresa
    ADD COLUMN horas_por_jornal numeric(4,2) NOT NULL DEFAULT 8
        CONSTRAINT ck_conf_horas_por_jornal CHECK (horas_por_jornal BETWEEN 1 AND 24),
    ADD COLUMN inicio_semana smallint NOT NULL DEFAULT 1
        CONSTRAINT ck_conf_inicio_semana CHECK (inicio_semana BETWEEN 1 AND 7);
COMMENT ON COLUMN app.configuracion_empresa.horas_por_jornal IS
  'D-84 · Lo que significa un jornal en los rendimientos de los APU de la '
  'empresa. Se copia en cada presupuesto al crearlo.';
COMMENT ON COLUMN app.configuracion_empresa.inicio_semana IS
  'RF-CFG-33 · Día en que empieza la semana, ISO (1 = lunes). Lo usan la curva '
  'semanal y el Gantt.';

-- El DEFAULT 8 de la columna nueva ES el valor que tienen hoy todas las
-- empresas (la columna de la empresa acaba de nacer en 8), así que los
-- presupuestos existentes quedan bien sin un UPDATE que despierte los
-- disparadores de la cabecera.
ALTER TABLE app.presupuesto
    ADD COLUMN horas_por_jornal numeric(4,2) NOT NULL DEFAULT 8
        CONSTRAINT ck_pres_horas_por_jornal CHECK (horas_por_jornal BETWEEN 1 AND 24),
    ADD COLUMN revision bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN app.presupuesto.horas_por_jornal IS
  'D-84 · Copia de las horas por jornal de la empresa al crear el presupuesto '
  '(o de su original, si es un duplicado). No cambia nunca: define qué '
  'significan los rendimientos con los que se armó la oferta.';
COMMENT ON COLUMN app.presupuesto.revision IS
  'D-91 · Sube con cada cambio de contenido, junto con fecha_modificacion. El '
  'cronograma está desactualizado si su calculado_revision no coincide.';

CREATE OR REPLACE FUNCTION app.fn_horas_por_jornal_presupuesto() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.duplicado_de_id IS NOT NULL THEN
            SELECT horas_por_jornal INTO NEW.horas_por_jornal
              FROM app.presupuesto WHERE id = NEW.duplicado_de_id;
        ELSE
            SELECT horas_por_jornal INTO NEW.horas_por_jornal
              FROM app.configuracion_empresa WHERE tenant_id = NEW.tenant_id;
        END IF;
        NEW.horas_por_jornal := COALESCE(NEW.horas_por_jornal, 8);
        NEW.revision := 0;
        RETURN NEW;
    END IF;
    IF NEW.horas_por_jornal IS DISTINCT FROM OLD.horas_por_jornal THEN
        RAISE EXCEPTION
          'Las horas por jornal de «%» se fijaron al crearlo y no cambian: definen '
          'qué significan los rendimientos con los que se armó (D-84).', OLD.codigo
          USING COLUMN = 'horasPorJornal';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_horas_por_jornal_ins BEFORE INSERT ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_horas_por_jornal_presupuesto();
CREATE TRIGGER tg_horas_por_jornal_upd BEFORE UPDATE OF horas_por_jornal ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_horas_por_jornal_presupuesto();

-- -----------------------------------------------------------------------------
--  D-91 · La revisión sube donde ya sube la fecha de modificación (D-58).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_marcar_modificacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
    -- Duplicar y purgar no son ediciones de nadie.
    IF app.fn_bandera_interna('app.purga_tenant')
       OR app.fn_bandera_interna('app.duplicando') THEN
        RETURN NULL;
    END IF;
    UPDATE app.presupuesto SET fecha_modificacion = now(), revision = revision + 1
     WHERE id IN (SELECT presupuesto_id FROM afectados);
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.fn_marcar_modificacion_cabecera() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.fecha_modificacion := now();
    NEW.revision := OLD.revision + 1;
    RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
--  D-85 · El rendimiento de la actividad, en la versión del APU
-- -----------------------------------------------------------------------------
ALTER TABLE app.apu_version
    ADD COLUMN rendimiento_actividad numeric(12,4)
        CONSTRAINT ck_avr_rendimiento_actividad CHECK (rendimiento_actividad > 0);
COMMENT ON COLUMN app.apu_version.rendimiento_actividad IS
  'D-85, RF-APU-25 · Cuántas unidades de la actividad hace la cuadrilla completa '
  'en un jornal. Opcional: sin él, la duración se escribe a mano.';

DROP FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text);
CREATE FUNCTION app.fn_nueva_version_apu(
    p_apu_id uuid, p_lineas jsonb, p_nombre text DEFAULT NULL,
    p_unidad_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL,
    p_rendimiento_actividad numeric DEFAULT NULL,
    p_cambia_rendimiento boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_apu app.apu; v_tenant uuid; v_ver uuid; v_cd app.dinero;
        v_nombre text; v_unidad uuid; v_simbolo text; v_num integer;
        v_lineas integer; v_resueltas integer; v_rend numeric;
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

    -- D-85 · Quien no dice nada del rendimiento lo hereda de la versión
    -- vigente; quien lo cambia lo fija, o lo quita con NULL.
    IF p_cambia_rendimiento THEN
        IF p_rendimiento_actividad IS NOT NULL AND p_rendimiento_actividad <= 0 THEN
            RAISE EXCEPTION
              'El rendimiento de la actividad tiene que ser mayor que cero: son las '
              'unidades que hace la cuadrilla en un jornal (D-85).'
              USING COLUMN = 'rendimientoActividad';
        END IF;
        v_rend := p_rendimiento_actividad;
    ELSE
        SELECT rendimiento_actividad INTO v_rend
          FROM app.apu_version WHERE id = v_apu.version_vigente_id;
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
         motivo, creada_por, rendimiento_actividad)
    VALUES (v_tenant, p_apu_id, v_num, v_nombre, v_simbolo, v_cd,
            p_motivo, app.fn_usuario_actual(), v_rend)
    RETURNING id INTO v_ver;

    INSERT INTO app.apu_version_recurso
        (tenant_id, apu_version_id, orden, recurso_id, recurso_codigo,
         recurso_nombre, recurso_tipo, unidad_simbolo, precio_unitario,
         cantidad, rendimiento, desperdicio_pct, subtotal)
    SELECT v_tenant, v_ver, row_number() OVER (ORDER BY l.orden),
           r.id, r.codigo, r.nombre, r.tipo, um.simbolo, r.precio_total,
           -- RF-APU-19: cantidad y rendimiento valen 1 si no vienen.
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
            jsonb_build_object('version', v_ver, 'costo_directo', v_cd::text,
                               'rendimiento_actividad', v_rend::text),
            app.fn_usuario_actual());

    RETURN v_ver;
END $$;
COMMENT ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text, numeric, boolean) IS
  'Única puerta para versionar un APU (D-21, D-22). La base calcula los '
  'subtotales y el costo directo con el precio vigente del recurso (D-1, D-2). '
  'D-85: con p_cambia_rendimiento = false el rendimiento de la actividad se '
  'hereda de la versión vigente.';
ALTER FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text, numeric, boolean)
    OWNER TO construsoft_owner;
REVOKE ALL ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text, numeric, boolean)
    TO construsoft_app, construsoft_owner;

-- -----------------------------------------------------------------------------
--  D-90 · Las listas de festivos de la plataforma
-- -----------------------------------------------------------------------------
CREATE TABLE plataforma.lista_festivos (
    id            uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    pais          char(2)     NOT NULL UNIQUE CHECK (pais ~ '^[A-Z]{2}$'),
    nombre        text        NOT NULL CHECK (btrim(nombre) <> ''),
    anio_desde    smallint    NOT NULL,
    anio_hasta    smallint    NOT NULL,
    actualizada_en timestamptz NOT NULL DEFAULT now(),
    CHECK (anio_hasta >= anio_desde)
);
CREATE TABLE plataforma.lista_festivos_fecha (
    lista_id  uuid NOT NULL REFERENCES plataforma.lista_festivos(id) ON DELETE CASCADE,
    fecha     date NOT NULL,
    nombre    text,
    PRIMARY KEY (lista_id, fecha)
);
COMMENT ON TABLE plataforma.lista_festivos IS
  'D-90 · Listas oficiales de festivos por país, compartidas: todas las empresas '
  'las leen y las copian a sus calendarios, ninguna las modifica.';

INSERT INTO plataforma.lista_festivos (pais, nombre, anio_desde, anio_hasta)
VALUES ('CO', 'Festivos de Colombia', 2026, 2030);
INSERT INTO plataforma.lista_festivos_fecha (lista_id, fecha)
SELECT l.id, f
  FROM plataforma.lista_festivos l,
       generate_series(2026, 2030) AS a,
       LATERAL plataforma.fn_festivos_colombia(a) AS f
 WHERE l.pais = 'CO';

-- El superadministrador agrega la siguiente ventana de cinco años.
CREATE OR REPLACE FUNCTION plataforma.fn_extender_festivos(p_pais char(2), p_superadmin uuid)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, pg_temp AS $$
DECLARE l record; v_hasta smallint; v_n integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM plataforma.usuario_plataforma
                    WHERE id = p_superadmin AND activo) THEN
        RAISE EXCEPTION 'Quien extiende los festivos no es un superadministrador activo (D-90).';
    END IF;
    SELECT * INTO l FROM plataforma.lista_festivos WHERE pais = p_pais FOR UPDATE;
    IF l.id IS NULL THEN
        RAISE EXCEPTION 'No hay lista de festivos de «%» (D-90).', p_pais;
    END IF;
    IF p_pais <> 'CO' THEN
        RAISE EXCEPTION 'Solo hay generador de festivos para Colombia (D-90).';
    END IF;
    v_hasta := l.anio_hasta + 5;
    INSERT INTO plataforma.lista_festivos_fecha (lista_id, fecha)
    SELECT l.id, f
      FROM generate_series(l.anio_hasta + 1, v_hasta) AS a,
           LATERAL plataforma.fn_festivos_colombia(a) AS f
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE plataforma.lista_festivos SET anio_hasta = v_hasta, actualizada_en = now()
     WHERE id = l.id;
    PERFORM plataforma.fn_evento_plataforma(NULL, 'FESTIVOS_EXTENDIDOS',
        format('%s: de %s a %s (%s fechas nuevas)', l.nombre, l.anio_hasta, v_hasta, v_n),
        NULL, jsonb_build_object('pais', p_pais, 'hasta', v_hasta, 'fechas', v_n),
        p_superadmin);
    RETURN v_hasta;
END $$;

ALTER TABLE plataforma.evento_plataforma DROP CONSTRAINT evento_plataforma_tipo_check;
ALTER TABLE plataforma.evento_plataforma ADD CONSTRAINT evento_plataforma_tipo_check CHECK (tipo IN
    ('TENANT_CREADO','TENANT_SUSPENDIDO','TENANT_REACTIVADO',
     'TENANT_ELIMINADO','PLAN_CAMBIADO','SUSCRIPCION_CANCELADA',
     'PAGO_REGISTRADO','ADMIN_DESIGNADO',
     'PAGO_REPORTADO','PAGO_RECHAZADO',
     'SUSCRIPCION_REANUDADA','SUSCRIPCION_REACTIVADA',
     'PARAMETRO_CAMBIADO','PARAMETRO_ANULADO',
     'FESTIVOS_EXTENDIDOS'));                                            -- D-90

-- -----------------------------------------------------------------------------
--  D-90 · Las listas propias de cada empresa (privadas)
-- -----------------------------------------------------------------------------
CREATE TABLE app.lista_festivos_propia (
    id         uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id  uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    nombre     text        NOT NULL CHECK (btrim(nombre) <> ''),
    creada_en  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX ux_lista_festivos_propia_nombre
    ON app.lista_festivos_propia (tenant_id, lower(btrim(nombre)));
CREATE TABLE app.lista_festivos_propia_fecha (
    tenant_id  uuid NOT NULL,
    lista_id   uuid NOT NULL,
    fecha      date NOT NULL,
    nombre     text,
    PRIMARY KEY (lista_id, fecha),
    FOREIGN KEY (tenant_id, lista_id)
        REFERENCES app.lista_festivos_propia(tenant_id, id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
--  D-86 · Los calendarios de la empresa
-- -----------------------------------------------------------------------------
CREATE TABLE app.calendario (
    id                 uuid         PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id          uuid         NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    nombre             text         NOT NULL CHECK (btrim(nombre) <> ''),
    -- RF-CFG-29 · «1 día = X h»: solo convierte lo que se muestra.
    horas_por_dia      numeric(4,2) NOT NULL DEFAULT 8
                                    CHECK (horas_por_dia > 0 AND horas_por_dia <= 24),
    por_defecto        boolean      NOT NULL DEFAULT false,
    -- D-90 · De qué lista salieron los festivos y hasta qué año llegan.
    festivos_lista_id  uuid         REFERENCES plataforma.lista_festivos(id) ON DELETE SET NULL,
    festivos_propia_id uuid,
    festivos_hasta     smallint,
    creado_en          timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, festivos_propia_id)
        REFERENCES app.lista_festivos_propia(tenant_id, id)
        ON DELETE SET NULL (festivos_propia_id),
    CONSTRAINT ck_calendario_una_lista
        CHECK (festivos_lista_id IS NULL OR festivos_propia_id IS NULL)
);
CREATE UNIQUE INDEX ux_calendario_nombre ON app.calendario (tenant_id, lower(btrim(nombre)));
CREATE UNIQUE INDEX ux_calendario_por_defecto ON app.calendario (tenant_id) WHERE por_defecto;

CREATE TABLE app.calendario_tramo (
    id             uuid     PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id      uuid     NOT NULL,
    calendario_id  uuid     NOT NULL,
    dia_semana     smallint NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),   -- ISO
    inicio         time     NOT NULL,
    fin            time     NOT NULL,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, calendario_id)
        REFERENCES app.calendario(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_tramo_orden CHECK (inicio < fin),
    CONSTRAINT ck_tramo_media_hora CHECK (
        extract(second FROM inicio) = 0 AND extract(second FROM fin) = 0
        AND extract(minute FROM inicio) IN (0, 30) AND extract(minute FROM fin) IN (0, 30))
);
CREATE INDEX ix_tramo_calendario ON app.calendario_tramo (calendario_id, dia_semana);

CREATE TABLE app.calendario_excepcion (
    id             uuid  PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id      uuid  NOT NULL,
    calendario_id  uuid  NOT NULL,
    fecha          date  NOT NULL,
    motivo         text,
    UNIQUE (tenant_id, id),
    UNIQUE (calendario_id, fecha),
    FOREIGN KEY (tenant_id, calendario_id)
        REFERENCES app.calendario(tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE app.calendario_excepcion IS
  'D-86 · Una fecha con horario propio. Sin tramos es no laborable (festivo, un '
  'día perdido por clima); con tramos, ese día se trabaja en esos tramos.';

CREATE TABLE app.calendario_excepcion_tramo (
    id             uuid  PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id      uuid  NOT NULL,
    excepcion_id   uuid  NOT NULL,
    inicio         time  NOT NULL,
    fin            time  NOT NULL,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, excepcion_id)
        REFERENCES app.calendario_excepcion(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_tramo_ex_orden CHECK (inicio < fin),
    CONSTRAINT ck_tramo_ex_media_hora CHECK (
        extract(second FROM inicio) = 0 AND extract(second FROM fin) = 0
        AND extract(minute FROM inicio) IN (0, 30) AND extract(minute FROM fin) IN (0, 30))
);
CREATE INDEX ix_tramo_ex_excepcion ON app.calendario_excepcion_tramo (excepcion_id);

-- Un tramo que termina a medianoche se escribe 24:00 (el tipo time lo admite y
-- es mayor que cualquier otra hora), así que inicio < fin basta para todo el
-- día. Esta función pasa la hora a minutos para comparar tramos.
CREATE OR REPLACE FUNCTION app.fn_minuto_del_dia(t time) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN t = '24:00'::time THEN 1440
                ELSE (extract(hour FROM t) * 60 + extract(minute FROM t))::integer END;
$$;

-- Los tramos de un mismo día no se cruzan. Se comprueba al confirmar, para que
-- la pantalla pueda reemplazar todos los tramos de un día en una transacción
-- sin pasar por un estado intermedio inválido.
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
CREATE CONSTRAINT TRIGGER tg_tramo_sin_cruce
    AFTER INSERT OR UPDATE ON app.calendario_tramo
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_tramos_sin_cruce();
CREATE CONSTRAINT TRIGGER tg_tramo_ex_sin_cruce
    AFTER INSERT OR UPDATE ON app.calendario_excepcion_tramo
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_tramos_sin_cruce();

-- Una empresa tiene siempre exactamente un calendario por defecto: es el que
-- toman sus cronogramas nuevos. Se comprueba al confirmar, para poder cambiar
-- cuál es en dos sentencias.
CREATE OR REPLACE FUNCTION app.fn_un_calendario_por_defecto() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
        v_def integer;
BEGIN
    -- Una empresa que se elimina se lleva sus calendarios en cascada.
    IF app.fn_bandera_interna('app.purga_tenant')
       OR NOT EXISTS (SELECT 1 FROM plataforma.tenant WHERE id = v_tenant) THEN
        RETURN NULL;
    END IF;
    SELECT count(*) FILTER (WHERE por_defecto)
      INTO v_def FROM app.calendario WHERE tenant_id = v_tenant;
    IF v_def <> 1 THEN
        RAISE EXCEPTION
          'La empresa tiene que tener un calendario por defecto, y solo uno: es el '
          'que toman los cronogramas nuevos (D-86). Marque otro antes de quitarle '
          'la marca a este o de eliminarlo.';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_un_calendario_por_defecto
    AFTER INSERT OR UPDATE OF por_defecto OR DELETE ON app.calendario
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_un_calendario_por_defecto();

-- El calendario con que nace toda empresa: lunes a viernes, 7:00–12:00 y
-- 13:00–16:00, 40 horas, 1 día = 8 h (igual al jornal), por defecto y sin
-- festivos (decisión del dueño, 19 de octubre de 2026).
CREATE OR REPLACE FUNCTION app.fn_crear_calendario_inicial(p_tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_cal uuid;
BEGIN
    INSERT INTO app.calendario (tenant_id, nombre, horas_por_dia, por_defecto)
    VALUES (p_tenant_id, 'Lunes a viernes', 8, true)
    RETURNING id INTO v_cal;
    INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
    SELECT p_tenant_id, v_cal, d, t.inicio, t.fin
      FROM generate_series(1, 5) AS d,
           (VALUES ('07:00'::time, '12:00'::time), ('13:00', '16:00')) AS t(inicio, fin);
    RETURN v_cal;
END $$;

CREATE OR REPLACE FUNCTION app.fn_calendario_al_nacer() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    PERFORM app.fn_crear_calendario_inicial(NEW.tenant_id);
    RETURN NULL;
END $$;
CREATE TRIGGER tg_calendario_al_nacer AFTER INSERT ON app.configuracion_empresa
    FOR EACH ROW EXECUTE FUNCTION app.fn_calendario_al_nacer();

-- Las empresas que ya existen.
SELECT app.fn_crear_calendario_inicial(c.tenant_id)
  FROM app.configuracion_empresa c
 WHERE NOT EXISTS (SELECT 1 FROM app.calendario k WHERE k.tenant_id = c.tenant_id);

-- Marcar otro calendario como el de por defecto, en un solo paso.
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

-- D-90 · Copiar una lista a un calendario. Las fechas que el calendario ya
-- tiene como excepción no se tocan: si la empresa marcó un festivo como
-- laborable, volver a copiar la lista no se lo deshace.
CREATE OR REPLACE FUNCTION app.fn_copiar_festivos(
    p_calendario_id uuid, p_lista_id uuid, p_propia boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_cal app.calendario; v_n integer; v_hasta smallint;
BEGIN
    SELECT * INTO v_cal FROM app.calendario WHERE id = p_calendario_id;
    IF v_cal.id IS NULL THEN
        RAISE EXCEPTION 'El calendario no existe en esta empresa.';
    END IF;
    IF p_propia THEN
        IF NOT EXISTS (SELECT 1 FROM app.lista_festivos_propia WHERE id = p_lista_id) THEN
            RAISE EXCEPTION 'La lista de festivos no existe en esta empresa.';
        END IF;
        INSERT INTO app.calendario_excepcion (tenant_id, calendario_id, fecha, motivo)
        SELECT v_cal.tenant_id, v_cal.id, f.fecha, COALESCE(f.nombre, 'Festivo')
          FROM app.lista_festivos_propia_fecha f WHERE f.lista_id = p_lista_id
        ON CONFLICT (calendario_id, fecha) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        SELECT extract(year FROM max(fecha))::smallint INTO v_hasta
          FROM app.lista_festivos_propia_fecha WHERE lista_id = p_lista_id;
        UPDATE app.calendario
           SET festivos_propia_id = p_lista_id, festivos_lista_id = NULL, festivos_hasta = v_hasta
         WHERE id = v_cal.id;
    ELSE
        SELECT anio_hasta INTO v_hasta FROM plataforma.lista_festivos WHERE id = p_lista_id;
        IF v_hasta IS NULL THEN
            RAISE EXCEPTION 'La lista de festivos no existe.';
        END IF;
        INSERT INTO app.calendario_excepcion (tenant_id, calendario_id, fecha, motivo)
        SELECT v_cal.tenant_id, v_cal.id, f.fecha, COALESCE(f.nombre, 'Festivo')
          FROM plataforma.lista_festivos_fecha f WHERE f.lista_id = p_lista_id
        ON CONFLICT (calendario_id, fecha) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        UPDATE app.calendario
           SET festivos_lista_id = p_lista_id, festivos_propia_id = NULL, festivos_hasta = v_hasta
         WHERE id = v_cal.id;
    END IF;
    RETURN v_n;
END $$;
COMMENT ON FUNCTION app.fn_copiar_festivos(uuid, uuid, boolean) IS
  'D-90, RF-CFG-32 · Copia una lista de festivos a un calendario como excepciones '
  'no laborables. No toca las fechas que el calendario ya tiene.';

-- -----------------------------------------------------------------------------
--  Dueños, aislamiento y permisos
-- -----------------------------------------------------------------------------
ALTER TABLE plataforma.lista_festivos            OWNER TO construsoft_owner;
ALTER TABLE plataforma.lista_festivos_fecha      OWNER TO construsoft_owner;
ALTER TABLE app.lista_festivos_propia            OWNER TO construsoft_owner;
ALTER TABLE app.lista_festivos_propia_fecha      OWNER TO construsoft_owner;
ALTER TABLE app.calendario                       OWNER TO construsoft_owner;
ALTER TABLE app.calendario_tramo                 OWNER TO construsoft_owner;
ALTER TABLE app.calendario_excepcion             OWNER TO construsoft_owner;
ALTER TABLE app.calendario_excepcion_tramo       OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_horas_por_jornal_presupuesto()       OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_minuto_del_dia(time)                 OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_tramos_sin_cruce()                   OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_un_calendario_por_defecto()          OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_crear_calendario_inicial(uuid)       OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_calendario_al_nacer()                OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_calendario_por_defecto(uuid)         OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_copiar_festivos(uuid, uuid, boolean) OWNER TO construsoft_owner;
ALTER FUNCTION plataforma.fn_extender_festivos(char, uuid) OWNER TO construsoft_super;

SELECT app.fn_aplicar_rls();

GRANT SELECT ON plataforma.lista_festivos, plataforma.lista_festivos_fecha
    TO construsoft_app, construsoft_superadmin;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.lista_festivos_propia, app.lista_festivos_propia_fecha,
    app.calendario, app.calendario_tramo,
    app.calendario_excepcion, app.calendario_excepcion_tramo
    TO construsoft_app;
GRANT SELECT ON
    app.lista_festivos_propia, app.lista_festivos_propia_fecha,
    app.calendario, app.calendario_tramo,
    app.calendario_excepcion, app.calendario_excepcion_tramo
    TO construsoft_superadmin;

REVOKE ALL ON FUNCTION app.fn_crear_calendario_inicial(uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fn_calendario_por_defecto(uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fn_copiar_festivos(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION plataforma.fn_extender_festivos(char, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_crear_calendario_inicial(uuid)       TO construsoft_owner, construsoft_app;
GRANT EXECUTE ON FUNCTION app.fn_calendario_por_defecto(uuid)         TO construsoft_app;
GRANT EXECUTE ON FUNCTION app.fn_copiar_festivos(uuid, uuid, boolean) TO construsoft_app;
GRANT EXECUTE ON FUNCTION plataforma.fn_extender_festivos(char, uuid) TO construsoft_superadmin;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
