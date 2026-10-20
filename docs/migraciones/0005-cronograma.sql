-- =============================================================================
--  Migración 0005 · El cronograma (módulo 1, documento 07 §6).
--
--  Sobre los cimientos de la 0004. La base guarda las entradas del cronograma y
--  defiende las reglas que se pueden escribir como restricción; el motor (CPM,
--  calendarios, restricciones, holguras) corre en la API y guarda aquí sus
--  resultados (D-89). El dinero de las curvas lo reparte la base (fn_curvas).
--
--    D-82  Un cronograma por presupuesto. Lee el presupuesto y no escribe en él.
--    D-86  Cada cronograma se lleva una COPIA de un calendario de la empresa (el
--          de la obra) y un calendario corrido fijo, 24 h todos los días,
--          1 día = 24 h, que solo usan las esperas. Los dos cuelgan del
--          cronograma: calendario.cronograma_id y calendario.tipo.
--    D-87  Restricciones de P6, principal y secundaria, con las parejas de la
--          RN-30 (definidas el 20 de octubre de 2026).
--    D-89  Los resultados del motor van en actividad_calculo, aparte de las
--          entradas: un recálculo los escribe en cualquier estado y con
--          cualquier rol que pueda leer, sin pasar por los guardianes.
--    D-91  cronograma.version cubre las entradas (la sube la API en cada
--          guardado y decide el 409); calculado_version y calculado_revision
--          dicen con qué entradas y con qué presupuesto.revision se calculó.
--
--  Decisiones del dueño del 20 de octubre de 2026 que entran aquí:
--    · La actividad de un ítem que se borra del presupuesto queda («ya no está
--      en el presupuesto», RN-33) con su código antepuesto de «X-» (X-1.3; si
--      ya existe, X-1.3-2), para que el ítem que tome su lugar no choque.
--    · Los subgrupos de «Hitos y trámites» son de un solo nivel.
--    · Los hitos de inicio y fin del proyecto son hitos como cualquier otro.
--    · Una línea base se borra solo con el presupuesto Activo, como se guarda.
--    · La tarea de administración nace con el código ADM, editable.
--    · Al duplicar, las actividades que ya no están en el presupuesto pasan a
--      la copia tal cual, con sus relaciones.
--
--  Permisos (RN-43): los del presupuesto. La API exige PRESUPUESTOS.EDITAR para
--  escribir y PRESUPUESTOS.VER para leer, como en el resto del módulo.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SELECT plataforma.fn_migracion_iniciar(5, 'cronograma');

-- -----------------------------------------------------------------------------
--  D-82 · El cronograma
-- -----------------------------------------------------------------------------
CREATE TABLE app.cronograma (
    id                  uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id           uuid        NOT NULL,
    presupuesto_id      uuid        NOT NULL,
    fecha_inicio        date        NOT NULL,
    -- D-91 · La sube la API en cada guardado de las entradas; un guardado que
    -- trae una versión vieja es el 409. Escribir resultados no la sube.
    version             bigint      NOT NULL DEFAULT 1 CHECK (version >= 1),
    calculado_version   bigint,
    calculado_revision  bigint,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    creado_por          uuid,
    UNIQUE (tenant_id, id),
    CONSTRAINT ux_cronograma_presupuesto UNIQUE (presupuesto_id),
    FOREIGN KEY (tenant_id, presupuesto_id)
        REFERENCES app.presupuesto(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, creado_por) REFERENCES app.usuario(tenant_id, id),
    CONSTRAINT ck_cronograma_calculado
        CHECK ((calculado_version IS NULL) = (calculado_revision IS NULL)
               AND (calculado_version IS NULL OR calculado_version <= version))
);
COMMENT ON TABLE app.cronograma IS
  'D-82 · Uno por presupuesto. Está al día si calculado_version = version y '
  'calculado_revision = presupuesto.revision (D-91). Sus dos calendarios cuelgan '
  'de él: app.calendario con cronograma_id y tipo OBRA o CORRIDO (D-86).';

-- -----------------------------------------------------------------------------
--  D-86 · El calendario de la obra y el corrido cuelgan del cronograma
-- -----------------------------------------------------------------------------
ALTER TABLE app.calendario
    ADD COLUMN tipo text NOT NULL DEFAULT 'EMPRESA'
        CONSTRAINT ck_calendario_tipo CHECK (tipo IN ('EMPRESA', 'OBRA', 'CORRIDO')),
    ADD COLUMN cronograma_id uuid,
    ADD CONSTRAINT ck_calendario_de_cronograma
        CHECK ((tipo = 'EMPRESA') = (cronograma_id IS NULL)),
    ADD CONSTRAINT ck_calendario_defecto_de_empresa
        CHECK (NOT por_defecto OR tipo = 'EMPRESA'),
    ADD CONSTRAINT ck_calendario_corrido_24
        CHECK (tipo <> 'CORRIDO' OR horas_por_dia = 24),
    ADD CONSTRAINT fk_calendario_cronograma FOREIGN KEY (tenant_id, cronograma_id)
        REFERENCES app.cronograma(tenant_id, id) ON DELETE CASCADE;
COMMENT ON COLUMN app.calendario.tipo IS
  'D-86 · EMPRESA: de la empresa, se copia a los cronogramas. OBRA: la copia de '
  'un cronograma, que se edita sin mover a nadie más. CORRIDO: 24 h todos los '
  'días, 1 día = 24 h, solo para esperas; es fijo.';
CREATE UNIQUE INDEX ux_calendario_cronograma_tipo
    ON app.calendario (cronograma_id, tipo) WHERE cronograma_id IS NOT NULL;
-- El nombre se repite libremente entre copias: es único solo entre los de la
-- empresa, que son los que se eligen por nombre.
DROP INDEX app.ux_calendario_nombre;
CREATE UNIQUE INDEX ux_calendario_nombre
    ON app.calendario (tenant_id, lower(btrim(nombre))) WHERE cronograma_id IS NULL;

-- -----------------------------------------------------------------------------
--  RF-PRG-03 · Subgrupos de «Hitos y trámites», de un solo nivel
-- -----------------------------------------------------------------------------
CREATE TABLE app.grupo_tramite (
    id             uuid     PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id      uuid     NOT NULL,
    cronograma_id  uuid     NOT NULL,
    nombre         text     NOT NULL,
    orden          integer  NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, id),
    UNIQUE (cronograma_id, id),
    FOREIGN KEY (tenant_id, cronograma_id)
        REFERENCES app.cronograma(tenant_id, id) ON DELETE CASCADE,
    -- El XER separa sus campos con tabuladores: un texto con caracteres de
    -- control rompería el archivo.
    CONSTRAINT ck_grupo_nombre
        CHECK (btrim(nombre) <> '' AND nombre !~ '[[:cntrl:]]')
);
CREATE UNIQUE INDEX ux_grupo_tramite_nombre
    ON app.grupo_tramite (cronograma_id, lower(btrim(nombre)));

-- -----------------------------------------------------------------------------
--  Las actividades: solo las entradas
-- -----------------------------------------------------------------------------
CREATE TABLE app.actividad_programada (
    id                     uuid          PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id              uuid          NOT NULL,
    cronograma_id          uuid          NOT NULL,
    tipo                   text          NOT NULL
        CONSTRAINT ck_actividad_tipo
        CHECK (tipo IN ('ITEM', 'HITO_INICIO', 'HITO_FIN', 'SIN_COSTO', 'ADMINISTRACION')),
    -- RN-33 · Nulo en hitos, trámites y administración. En una actividad de
    -- ítem, nulo significa «ya no está en el presupuesto»: el borrado del ítem
    -- anula SOLO esta columna (no el tenant_id de la llave compuesta).
    presupuesto_item_id    uuid,
    nombre                 text          NOT NULL,
    codigo                 text          NOT NULL,
    orden                  integer       NOT NULL DEFAULT 0,
    grupo_id               uuid,
    -- D-86 · Solo las esperas pueden ir en el calendario corrido.
    usa_corrido            boolean       NOT NULL DEFAULT false,
    cuadrillas             integer       NOT NULL DEFAULT 1 CHECK (cuadrillas >= 1),
    -- Se escribe en días del calendario de la actividad y se guarda en horas,
    -- como P6: si cambia el factor del calendario, se conservan las horas.
    duracion_manual_horas  numeric(12,4) CHECK (duracion_manual_horas >= 0),
    -- D-87 / RN-30 · Solo fecha: las de inicio toman el comienzo de la jornada
    -- y las de fin el cierre (el motor).
    restriccion_tipo       text,
    restriccion_fecha      date,
    restriccion2_tipo      text,
    restriccion2_fecha     date,
    UNIQUE (tenant_id, id),
    UNIQUE (cronograma_id, id),
    -- Diferible: el refresco de códigos tras renumerar la EDT intercambia
    -- códigos entre filas en una sola sentencia.
    CONSTRAINT ux_actividad_codigo UNIQUE (cronograma_id, codigo)
        DEFERRABLE INITIALLY IMMEDIATE,
    FOREIGN KEY (tenant_id, cronograma_id)
        REFERENCES app.cronograma(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_actividad_item FOREIGN KEY (tenant_id, presupuesto_item_id)
        REFERENCES app.presupuesto_item(tenant_id, id)
        ON DELETE SET NULL (presupuesto_item_id),
    CONSTRAINT fk_actividad_grupo FOREIGN KEY (cronograma_id, grupo_id)
        REFERENCES app.grupo_tramite(cronograma_id, id),
    CONSTRAINT ck_actividad_item_solo_en_item
        CHECK (tipo = 'ITEM' OR presupuesto_item_id IS NULL),
    -- RN-42 · El número del ítem es solo de cifras y puntos; todo lo demás
    -- (H-001, T-001, ADM, X-1.3) lleva letras. Así un código escrito a mano
    -- nunca choca con el de un ítem que llegue después.
    CONSTRAINT ck_actividad_codigo_forma
        CHECK ((presupuesto_item_id IS NOT NULL) = (codigo ~ '^[0-9]+(\.[0-9]+)*$')),
    CONSTRAINT ck_actividad_textos
        CHECK (btrim(nombre) <> '' AND nombre !~ '[[:cntrl:]]'
               AND codigo <> '' AND codigo = btrim(codigo) AND codigo !~ '[[:cntrl:]]'),
    CONSTRAINT ck_actividad_grupo_solo_tramites
        CHECK (grupo_id IS NULL OR tipo IN ('HITO_INICIO', 'HITO_FIN', 'SIN_COSTO')),
    CONSTRAINT ck_actividad_corrido_solo_esperas
        CHECK (NOT usa_corrido OR tipo = 'SIN_COSTO'),
    CONSTRAINT ck_actividad_cuadrillas_solo_item
        CHECK (cuadrillas = 1 OR tipo = 'ITEM'),
    CONSTRAINT ck_actividad_manual_con_duracion
        CHECK (duracion_manual_horas IS NULL OR tipo IN ('ITEM', 'SIN_COSTO')),
    CONSTRAINT ck_actividad_restriccion_tipos
        CHECK ((restriccion_tipo IS NULL OR restriccion_tipo IN
                  ('INICIO_EL', 'INICIO_ANTES', 'INICIO_DESPUES',
                   'FIN_EL', 'FIN_ANTES', 'FIN_DESPUES',
                   'LO_MAS_TARDE', 'INICIO_OBLIGATORIO', 'FIN_OBLIGATORIO'))
           AND (restriccion2_tipo IS NULL OR restriccion2_tipo IN
                  ('INICIO_ANTES', 'INICIO_DESPUES', 'FIN_ANTES', 'FIN_DESPUES')))
);
COMMENT ON TABLE app.actividad_programada IS
  'Las entradas de cada actividad (07 §6.7). Los resultados del motor van en '
  'app.actividad_calculo. Una actividad de ítem con presupuesto_item_id nulo '
  '«ya no está en el presupuesto» (RN-33).';
COMMENT ON COLUMN app.actividad_programada.restriccion_tipo IS
  'D-87 · INICIO_EL, INICIO_ANTES (en o antes de), INICIO_DESPUES (en o después '
  'de), FIN_EL, FIN_ANTES, FIN_DESPUES, LO_MAS_TARDE (sin fecha), '
  'INICIO_OBLIGATORIO, FIN_OBLIGATORIO. Las parejas, en app.fn_actividad_entrada.';
-- La busca el borrado de cada ítem (RN-33); también la hace única: un ítem es
-- de un solo presupuesto y tiene una sola actividad.
CREATE UNIQUE INDEX ux_actividad_item
    ON app.actividad_programada (presupuesto_item_id) WHERE presupuesto_item_id IS NOT NULL;
CREATE UNIQUE INDEX ux_actividad_administracion
    ON app.actividad_programada (cronograma_id) WHERE tipo = 'ADMINISTRACION';
CREATE INDEX ix_actividad_grupo ON app.actividad_programada (grupo_id) WHERE grupo_id IS NOT NULL;

-- -----------------------------------------------------------------------------
--  D-89 · Los resultados del motor, uno por actividad
-- -----------------------------------------------------------------------------
CREATE TABLE app.actividad_calculo (
    actividad_id                uuid       PRIMARY KEY,
    tenant_id                   uuid       NOT NULL,
    inicio_temprano             timestamp  NOT NULL,
    fin_temprano                timestamp  NOT NULL,
    -- Nulas en la administración, que no tiene holgura (decisión del 20 de
    -- octubre de 2026).
    inicio_tardio               timestamp,
    fin_tardio                  timestamp,
    -- La que sale del rendimiento, redondeada al minuto hacia arriba; nula si
    -- la versión del APU no tiene rendimiento. duracion_minutos es la que usa
    -- el motor: la manual si la hay.
    duracion_calculada_minutos  integer    CHECK (duracion_calculada_minutos >= 0),
    duracion_minutos            integer    NOT NULL CHECK (duracion_minutos >= 0),
    -- En minutos laborables del calendario de la actividad; negativas permitidas.
    holgura_total_minutos       integer,
    holgura_libre_minutos       integer,
    critica                     boolean    GENERATED ALWAYS AS
                                           (COALESCE(holgura_total_minutos <= 0, false)) STORED,
    UNIQUE (tenant_id, actividad_id),
    FOREIGN KEY (tenant_id, actividad_id)
        REFERENCES app.actividad_programada(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_calculo_fechas CHECK (fin_temprano >= inicio_temprano
        AND (inicio_tardio IS NULL) = (fin_tardio IS NULL)
        AND (fin_tardio IS NULL OR fin_tardio >= inicio_tardio))
);
COMMENT ON TABLE app.actividad_calculo IS
  'D-89 · Lo que escribe el motor. Sin guardianes de estado ni de historia: un '
  'recálculo la escribe con el presupuesto en cualquier estado.';

-- -----------------------------------------------------------------------------
--  RF-PRG-04 · Las dependencias
-- -----------------------------------------------------------------------------
CREATE TABLE app.dependencia (
    id              uuid          PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id       uuid          NOT NULL,
    cronograma_id   uuid          NOT NULL,
    predecesora_id  uuid          NOT NULL,
    sucesora_id     uuid          NOT NULL,
    tipo            text          NOT NULL DEFAULT 'FC'
                                  CONSTRAINT ck_dependencia_tipo
                                  CHECK (tipo IN ('FC', 'CC', 'FF', 'CF')),
    -- RN-29 · Se escribe en días con un decimal, en el calendario de la
    -- sucesora, y se guarda en horas.
    desfase_horas   numeric(12,4) NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, id),
    CONSTRAINT ux_dependencia_par UNIQUE (predecesora_id, sucesora_id),
    FOREIGN KEY (tenant_id, cronograma_id)
        REFERENCES app.cronograma(tenant_id, id) ON DELETE CASCADE,
    -- Las dos puntas son del mismo cronograma, por construcción.
    CONSTRAINT fk_dependencia_predecesora FOREIGN KEY (cronograma_id, predecesora_id)
        REFERENCES app.actividad_programada(cronograma_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dependencia_sucesora FOREIGN KEY (cronograma_id, sucesora_id)
        REFERENCES app.actividad_programada(cronograma_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_dependencia_no_a_si_misma CHECK (predecesora_id <> sucesora_id)
);
CREATE INDEX ix_dependencia_sucesora ON app.dependencia (sucesora_id);
COMMENT ON COLUMN app.dependencia.tipo IS
  'FC fin-comienzo, CC comienzo-comienzo, FF fin-fin, CF comienzo-fin.';

-- -----------------------------------------------------------------------------
--  RF-PRG-09 / RN-38 · Las líneas base, guardadas por día
-- -----------------------------------------------------------------------------
CREATE TABLE app.linea_base (
    id             uuid         PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id      uuid         NOT NULL,
    cronograma_id  uuid         NOT NULL,
    nombre         text         NOT NULL,
    creada_en      timestamptz  NOT NULL DEFAULT now(),
    guardada_en    timestamptz  NOT NULL DEFAULT now(),
    guardada_por   uuid,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, cronograma_id)
        REFERENCES app.cronograma(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, guardada_por) REFERENCES app.usuario(tenant_id, id),
    CONSTRAINT ck_linea_base_nombre CHECK (btrim(nombre) <> '' AND nombre !~ '[[:cntrl:]]')
);
-- «Nunca sobrescribe en silencio» (RF-PRG-09): guardar con un nombre que ya
-- existe choca aquí, y reemplazar es una llamada aparte que lo dice.
CREATE UNIQUE INDEX ux_linea_base_nombre
    ON app.linea_base (cronograma_id, lower(btrim(nombre)));

CREATE TABLE app.linea_base_actividad (
    tenant_id         uuid        NOT NULL,
    linea_base_id     uuid        NOT NULL,
    -- Sin llave: es una foto, y la actividad puede borrarse después. Se compara
    -- por este identificador, nunca por el código (RN-42).
    actividad_id      uuid        NOT NULL,
    tipo              text        NOT NULL,
    codigo            text        NOT NULL,
    nombre            text        NOT NULL,
    inicio            timestamp   NOT NULL,
    fin               timestamp   NOT NULL,
    duracion_minutos  integer     NOT NULL,
    costo             app.dinero  NOT NULL,
    PRIMARY KEY (linea_base_id, actividad_id),
    FOREIGN KEY (tenant_id, linea_base_id)
        REFERENCES app.linea_base(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE app.linea_base_periodo (
    tenant_id      uuid        NOT NULL,
    linea_base_id  uuid        NOT NULL,
    -- Por día: la semana y el mes se arman al leer, así un cambio del día de
    -- inicio de semana (RF-CFG-33) no la descuadra.
    fecha          date        NOT NULL,
    facturacion    app.dinero  NOT NULL,
    costo          app.dinero  NOT NULL,
    PRIMARY KEY (linea_base_id, fecha),
    FOREIGN KEY (tenant_id, linea_base_id)
        REFERENCES app.linea_base(tenant_id, id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
--  Tipos de evento (07 §6.9, historial). ON CONFLICT: el revertir los deja,
--  como la 0004 deja FESTIVOS_EXTENDIDOS, porque un evento escrito no se borra.
-- -----------------------------------------------------------------------------
INSERT INTO app.tipo_evento (codigo, descripcion, exige_justificacion) VALUES
  ('CRONOGRAMA_CREADO',       'Cronograma creado',                         false),
  ('CRONOGRAMA_FECHA_INICIO', 'Fecha de inicio del cronograma cambiada',   false),
  ('CRONOGRAMA_CALENDARIO',   'Calendario del cronograma reemplazado',     false),
  ('LINEA_BASE_GUARDADA',     'Línea base guardada',                       false),
  ('LINEA_BASE_REEMPLAZADA',  'Línea base reemplazada',                    false),
  ('LINEA_BASE_ELIMINADA',    'Línea base eliminada',                      false)
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
--  RN-34 · El guardián de las entradas
--
--  Con el presupuesto Cerrado, el cronograma es de solo lectura. Va sobre las
--  entradas (cronograma, calendarios de la obra, subgrupos, actividades y
--  dependencias), nunca sobre actividad_calculo (D-89).
--
--  El candado: cada escritura toma FOR SHARE sobre la fila del cronograma y
--  después lee el estado en otra sentencia. Un cambio de estado del
--  presupuesto sube cronograma.version (tg_cronograma_por_estado), así que los
--  dos se ordenan sobre esa fila: el guardado que llegó primero entra con el
--  estado de antes, y el que llega después ve el nuevo (en READ COMMITTED,
--  porque la segunda sentencia toma otra foto; en REPEATABLE READ, porque
--  FOR SHARE sobre una fila cambiada da 40001 y la API reintenta).
--
--  El calendario corrido es fijo: solo lo escriben las funciones que crean un
--  cronograma, con la bandera interna app.cronograma_interno.
--
--  Pasa siempre: la purga de una empresa, y el borrado en cascada (el
--  cronograma o el calendario ya no existen).
-- =============================================================================
CREATE OR REPLACE FUNCTION app.fn_cronograma_editable() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_fila jsonb := to_jsonb(COALESCE(NEW, OLD));
        v_crono uuid; v_cal uuid; v_tipo_cal text; v_estado text;
BEGIN
    IF app.fn_bandera_interna('app.purga_tenant', v_fila->>'tenant_id') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_ARGV[0] = 'directo' THEN
        IF TG_TABLE_NAME = 'actividad_programada' THEN
            -- Ponerse al día con el presupuesto no es editar el cronograma: el
            -- recálculo crea la actividad de un ítem nuevo y refresca número,
            -- nombre y orden desde el ítem (RN-33, RN-42) aunque el presupuesto
            -- ya esté Cerrado; si no, un cronograma que quedó desactualizado al
            -- cerrar no se podría servir nunca. fn_actividad_entrada exige que
            -- esos valores sean los del ítem. (El refresco por UPDATE, y la
            -- anulación del ítem que se borra, ni siquiera llegan aquí: los
            -- deja fuera el WHEN de tg_cronograma_editable_upd.)
            IF TG_OP = 'INSERT' AND v_fila->>'tipo' = 'ITEM'
               AND v_fila->>'presupuesto_item_id' IS NOT NULL
               AND (v_fila->>'cuadrillas')::integer = 1 AND v_fila->>'grupo_id' IS NULL
               AND v_fila->>'duracion_manual_horas' IS NULL AND v_fila->>'restriccion_tipo' IS NULL
               AND v_fila->>'restriccion2_tipo' IS NULL AND NOT (v_fila->>'usa_corrido')::boolean THEN
                RETURN NEW;
            END IF;
        END IF;
        v_crono := (v_fila->>'cronograma_id')::uuid;
    ELSE
        IF TG_ARGV[0] = 'calendario' THEN
            v_cal := (v_fila->>'id')::uuid;
        ELSIF TG_ARGV[0] IN ('tramo', 'excepcion') THEN
            v_cal := (v_fila->>'calendario_id')::uuid;
        ELSE  -- excepcion_tramo
            SELECT e.calendario_id INTO v_cal
              FROM app.calendario_excepcion e WHERE e.id = (v_fila->>'excepcion_id')::uuid;
        END IF;
        IF TG_ARGV[0] = 'calendario' THEN
            v_crono := (v_fila->>'cronograma_id')::uuid;
            v_tipo_cal := v_fila->>'tipo';
        ELSE
            SELECT k.cronograma_id, k.tipo INTO v_crono, v_tipo_cal
              FROM app.calendario k WHERE k.id = v_cal;
        END IF;
    END IF;

    -- Un calendario de la empresa, o algo cuyo padre ya se borró.
    IF v_crono IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    PERFORM 1 FROM app.cronograma c WHERE c.id = v_crono FOR SHARE;
    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);      -- el cronograma se está borrando
    END IF;

    IF v_tipo_cal IS NOT NULL THEN
        IF TG_ARGV[0] = 'calendario' AND TG_OP = 'DELETE' THEN
            RAISE EXCEPTION
              'El calendario de un cronograma no se elimina: se edita, o se reemplaza '
              'por otro de la empresa (D-86).';
        END IF;
        IF v_tipo_cal = 'CORRIDO' AND NOT app.fn_bandera_interna('app.cronograma_interno') THEN
            RAISE EXCEPTION
              'El calendario corrido es fijo: 24 horas todos los días, para las esperas '
              'que corren aunque no se trabaje (D-86).';
        END IF;
    END IF;

    SELECT p.estado INTO v_estado
      FROM app.cronograma c JOIN app.presupuesto p ON p.id = c.presupuesto_id
     WHERE c.id = v_crono;
    IF v_estado = 'CERRADO' THEN
        RAISE EXCEPTION
          'El presupuesto está Cerrado: su cronograma es de solo lectura (RN-34).';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR UPDATE OR DELETE ON app.grupo_tramite
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('directo');
CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR DELETE ON app.actividad_programada
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('directo');
-- En un UPDATE no dispara para lo que no es editar: anular el ítem que se borra
-- (RN-33; solo pasa con el presupuesto Abierto, que su guardián ya exige, y no
-- debe esperar el candado de un recálculo) ni refrescar número, nombre u orden
-- de una actividad cuyo ítem sigue en el presupuesto (ver arriba). Así el
-- refresco de 1.500 filas no paga 1.500 llamadas.
CREATE TRIGGER tg_cronograma_editable_upd BEFORE UPDATE ON app.actividad_programada
    FOR EACH ROW
    WHEN (OLD.presupuesto_item_id IS NULL
          OR (NEW.presupuesto_item_id IS NOT NULL
              AND (NEW.cuadrillas, NEW.grupo_id, NEW.usa_corrido, NEW.duracion_manual_horas,
                   NEW.restriccion_tipo, NEW.restriccion_fecha,
                   NEW.restriccion2_tipo, NEW.restriccion2_fecha)
                  IS DISTINCT FROM
                  (OLD.cuadrillas, OLD.grupo_id, OLD.usa_corrido, OLD.duracion_manual_horas,
                   OLD.restriccion_tipo, OLD.restriccion_fecha,
                   OLD.restriccion2_tipo, OLD.restriccion2_fecha)))
    EXECUTE FUNCTION app.fn_cronograma_editable('directo');
CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR UPDATE OR DELETE ON app.dependencia
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('directo');
CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR UPDATE OR DELETE ON app.calendario
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('calendario');
CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR UPDATE OR DELETE ON app.calendario_tramo
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('tramo');
CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR UPDATE OR DELETE ON app.calendario_excepcion
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('excepcion');
CREATE TRIGGER tg_cronograma_editable BEFORE INSERT OR UPDATE OR DELETE ON app.calendario_excepcion_tramo
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_editable('excepcion_tramo');

-- La cabecera: la fecha de inicio es una entrada; la versión y las marcas de
-- cálculo no (un recálculo las escribe en cualquier estado).
CREATE OR REPLACE FUNCTION app.fn_cronograma_cabecera() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_estado text;
BEGIN
    IF NEW.version < OLD.version THEN
        RAISE EXCEPTION 'La versión del cronograma no baja (D-91).';
    END IF;
    IF NEW.fecha_inicio IS DISTINCT FROM OLD.fecha_inicio THEN
        SELECT estado INTO v_estado FROM app.presupuesto WHERE id = NEW.presupuesto_id;
        IF v_estado = 'CERRADO' THEN
            RAISE EXCEPTION
              'El presupuesto está Cerrado: su cronograma es de solo lectura (RN-34).'
              USING COLUMN = 'fechaInicio';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_cronograma_cabecera BEFORE UPDATE ON app.cronograma
    FOR EACH ROW EXECUTE FUNCTION app.fn_cronograma_cabecera();

-- Historial: cambiar la fecha de inicio (07 §6.9).
CREATE OR REPLACE FUNCTION app.fn_historia_cronograma() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    IF app.fn_historia_silenciada() THEN
        RETURN NULL;
    END IF;
    PERFORM app.fn_evento_interno(
        NEW.tenant_id, NEW.presupuesto_id, 'CRONOGRAMA', NEW.id, 'CRONOGRAMA_FECHA_INICIO',
        format('Fecha de inicio del cronograma: del %s al %s',
               to_char(OLD.fecha_inicio, 'DD/MM/YYYY'), to_char(NEW.fecha_inicio, 'DD/MM/YYYY')),
        jsonb_build_object('fecha_inicio', OLD.fecha_inicio),
        jsonb_build_object('fecha_inicio', NEW.fecha_inicio));
    RETURN NULL;
END $$;
CREATE TRIGGER tg_historia_cronograma AFTER UPDATE OF fecha_inicio ON app.cronograma
    FOR EACH ROW WHEN (OLD.fecha_inicio IS DISTINCT FROM NEW.fecha_inicio)
    EXECUTE FUNCTION app.fn_historia_cronograma();

-- Un cambio de estado del presupuesto mueve la versión de su cronograma: el
-- guardado que traía la de antes recibe el 409 y ve lo que cambió, y el
-- guardián de arriba se ordena contra la transición (ver su comentario). Solo
-- dispara al cambiar el estado: la edición de una cantidad no pasa por aquí.
CREATE OR REPLACE FUNCTION app.fn_cronograma_por_estado() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    UPDATE app.cronograma SET version = version + 1 WHERE presupuesto_id = NEW.id;
    RETURN NULL;
END $$;
CREATE TRIGGER tg_cronograma_por_estado AFTER UPDATE OF estado ON app.presupuesto
    FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
    EXECUTE FUNCTION app.fn_cronograma_por_estado();

-- =============================================================================
--  Las actividades: códigos, amarre al ítem y parejas de restricciones
-- =============================================================================

-- RN-42 · Siguiente código automático de un grupo: H-001, T-001.
CREATE OR REPLACE FUNCTION app.fn_siguiente_codigo_actividad(p_cronograma_id uuid, p_prefijo text)
RETURNS text LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
    SELECT p_prefijo || '-' || lpad((COALESCE(max(substring(a.codigo FROM '^' || p_prefijo || '-([0-9]+)$')::integer), 0) + 1)::text, 3, '0')
      FROM app.actividad_programada a
     WHERE a.cronograma_id = p_cronograma_id;
$$;

-- RN-33 · El código de una actividad cuyo ítem se borró: X-1.3, o X-1.3-2 si ya
-- hay una X-1.3 (decisión del 20 de octubre de 2026).
CREATE OR REPLACE FUNCTION app.fn_codigo_de_huerfana(p_cronograma_id uuid, p_codigo text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = app, pg_temp AS $$
DECLARE v_codigo text := 'X-' || p_codigo; v_n integer := 1;
BEGIN
    WHILE EXISTS (SELECT 1 FROM app.actividad_programada
                   WHERE cronograma_id = p_cronograma_id AND codigo = v_codigo) LOOP
        v_n := v_n + 1;
        v_codigo := 'X-' || p_codigo || '-' || v_n;
    END LOOP;
    RETURN v_codigo;
END $$;

CREATE OR REPLACE FUNCTION app.fn_texto_limpio(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(btrim(regexp_replace(p_texto, '[[:cntrl:]]+', ' ', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION app.fn_actividad_entrada() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_presupuesto uuid; v_item_presupuesto uuid; v_item_codigo text; v_item_nombre text;
        v_p text := NEW.restriccion_tipo; v_s text := NEW.restriccion2_tipo;
        v_antes date; v_despues date;
        c_sin_secundaria constant text[] :=
            ARRAY['INICIO_EL', 'FIN_EL', 'INICIO_OBLIGATORIO', 'FIN_OBLIGATORIO'];
        c_inicio constant text[] :=
            ARRAY['INICIO_EL', 'INICIO_ANTES', 'INICIO_DESPUES', 'INICIO_OBLIGATORIO'];
        c_fin constant text[] :=
            ARRAY['FIN_EL', 'FIN_ANTES', 'FIN_DESPUES', 'FIN_OBLIGATORIO'];
BEGIN
    -- RN-33 · El ítem se borró: la llave anuló la columna y aquí el código
    -- pasa a X-, para que el ítem que tome su lugar no choque.
    IF TG_OP = 'UPDATE' AND OLD.presupuesto_item_id IS NOT NULL
       AND NEW.presupuesto_item_id IS NULL THEN
        NEW.codigo := app.fn_codigo_de_huerfana(NEW.cronograma_id, OLD.codigo);
        RETURN NEW;
    END IF;

    NEW.nombre := app.fn_texto_limpio(NEW.nombre);
    NEW.codigo := app.fn_texto_limpio(NEW.codigo);

    IF TG_OP = 'INSERT' THEN
        IF NEW.tipo = 'ADMINISTRACION' AND NOT app.fn_bandera_interna('app.cronograma_interno') THEN
            RAISE EXCEPTION
              'La tarea de administración la crea el sistema con el cronograma, y hay '
              'una sola (RN-37).';
        END IF;
        IF NEW.tipo = 'ITEM' AND NEW.presupuesto_item_id IS NULL
           AND NOT app.fn_bandera_interna('app.duplicando') THEN
            RAISE EXCEPTION
              'Una actividad del presupuesto nace amarrada a su ítem (RN-33).'
              USING COLUMN = 'presupuestoItemId';
        END IF;
        IF NEW.codigo IS NULL AND NEW.tipo <> 'ITEM' THEN
            NEW.codigo := CASE NEW.tipo
                WHEN 'ADMINISTRACION' THEN 'ADM'
                WHEN 'SIN_COSTO'      THEN app.fn_siguiente_codigo_actividad(NEW.cronograma_id, 'T')
                ELSE                       app.fn_siguiente_codigo_actividad(NEW.cronograma_id, 'H') END;
        END IF;
    END IF;

    -- Una actividad del presupuesto lleva el número y la descripción de su
    -- ítem (RN-42): se toman de él si no vienen, y si vienen tienen que ser
    -- esos. Se mira solo al crearla o si cambian, para no leer el ítem en cada
    -- cambio de cuadrillas.
    IF NEW.presupuesto_item_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.codigo IS DISTINCT FROM OLD.codigo
            OR NEW.nombre IS DISTINCT FROM OLD.nombre) THEN
        SELECT i.presupuesto_id, i.codigo_item, app.fn_texto_limpio(i.descripcion)
          INTO v_item_presupuesto, v_item_codigo, v_item_nombre
          FROM app.presupuesto_item i WHERE i.id = NEW.presupuesto_item_id;
        IF TG_OP = 'INSERT' THEN
            SELECT c.presupuesto_id INTO v_presupuesto
              FROM app.cronograma c WHERE c.id = NEW.cronograma_id;
            IF v_item_presupuesto IS DISTINCT FROM v_presupuesto THEN
                RAISE EXCEPTION 'El ítem no es del presupuesto de este cronograma.'
                  USING COLUMN = 'presupuestoItemId';
            END IF;
        END IF;
        NEW.codigo := COALESCE(NEW.codigo, v_item_codigo);
        NEW.nombre := COALESCE(NEW.nombre, v_item_nombre);
        IF NEW.codigo IS DISTINCT FROM v_item_codigo OR NEW.nombre IS DISTINCT FROM v_item_nombre THEN
            RAISE EXCEPTION
              'El código y el nombre de una actividad del presupuesto son los de su '
              'ítem (%, «%»); no se escriben a mano (RN-42).', v_item_codigo, v_item_nombre
              USING COLUMN = CASE WHEN NEW.codigo IS DISTINCT FROM v_item_codigo
                                  THEN 'codigo' ELSE 'nombre' END;
        END IF;
    END IF;

    IF NEW.nombre IS NULL THEN
        RAISE EXCEPTION 'La actividad necesita un nombre.' USING COLUMN = 'nombre';
    END IF;
    IF NEW.codigo IS NULL THEN
        RAISE EXCEPTION 'La actividad necesita un código (RN-42).' USING COLUMN = 'codigo';
    END IF;

    -- RN-42 · Los códigos escritos a mano: con letras, y sin repetirse. La
    -- unicidad la defiende ux_actividad_codigo; esto es para que el rechazo
    -- diga qué pasó. Las de ítem no se miran aquí: sus códigos se intercambian
    -- al renumerar y la restricción diferible los resuelve al final.
    IF NEW.presupuesto_item_id IS NULL THEN
        IF NEW.codigo ~ '^[0-9]+(\.[0-9]+)*$' THEN
            RAISE EXCEPTION
              'El código «%» tiene la forma de un número de ítem del presupuesto. Los '
              'hitos, los trámites y la administración llevan letras, como H-001 o '
              'T-001 (RN-42).', NEW.codigo
              USING COLUMN = 'codigo';
        END IF;
        IF EXISTS (SELECT 1 FROM app.actividad_programada a
                    WHERE a.cronograma_id = NEW.cronograma_id AND a.codigo = NEW.codigo
                      AND a.id <> NEW.id) THEN
            RAISE EXCEPTION 'Ya hay una actividad con el código «%» en este cronograma (RN-42).',
              NEW.codigo USING COLUMN = 'codigo';
        END IF;
    END IF;

    -- D-87 / RN-30 · Las parejas de restricciones.
    IF v_p IS NOT NULL AND NEW.tipo = 'ADMINISTRACION' THEN
        RAISE EXCEPTION
          'La tarea de administración no lleva restricciones: sus fechas salen del '
          'resto del cronograma (RN-37).' USING COLUMN = 'restriccionTipo';
    END IF;
    IF (v_p = 'LO_MAS_TARDE') <> (NEW.restriccion_fecha IS NULL) AND v_p IS NOT NULL THEN
        RAISE EXCEPTION '%', CASE WHEN v_p = 'LO_MAS_TARDE'
            THEN '«Lo más tarde posible» no lleva fecha (RN-30).'
            ELSE 'La restricción necesita su fecha (RN-30).' END
          USING COLUMN = 'restriccionFecha';
    END IF;
    IF v_p IS NULL AND NEW.restriccion_fecha IS NOT NULL THEN
        RAISE EXCEPTION 'Hay una fecha de restricción sin restricción (RN-30).'
          USING COLUMN = 'restriccionTipo';
    END IF;
    IF (v_s IS NULL) <> (NEW.restriccion2_fecha IS NULL) THEN
        RAISE EXCEPTION '%', CASE WHEN v_s IS NULL
            THEN 'Hay una fecha de restricción secundaria sin restricción (RN-30).'
            ELSE 'La restricción secundaria necesita su fecha (RN-30).' END
          USING COLUMN = CASE WHEN v_s IS NULL THEN 'restriccion2Tipo' ELSE 'restriccion2Fecha' END;
    END IF;
    IF v_s IS NOT NULL THEN
        IF v_p IS NULL THEN
            RAISE EXCEPTION 'Sin restricción principal no hay secundaria (RN-30).'
              USING COLUMN = 'restriccion2Tipo';
        END IF;
        IF v_p = ANY (c_sin_secundaria) THEN
            RAISE EXCEPTION 'Con la principal «%» no se admite secundaria (RN-30).',
              app.fn_nombre_restriccion(v_p) USING COLUMN = 'restriccion2Tipo';
        END IF;
        IF v_s = v_p THEN
            RAISE EXCEPTION 'La secundaria no puede ser la misma principal (RN-30).'
              USING COLUMN = 'restriccion2Tipo';
        END IF;
        -- Dos del mismo tipo de fecha: el límite «antes de» no puede quedar
        -- antes del límite «después de».
        IF (v_p = ANY (c_inicio) AND v_s = ANY (c_inicio))
           OR (v_p = ANY (c_fin) AND v_s = ANY (c_fin)) THEN
            v_antes   := CASE WHEN v_p LIKE '%_ANTES'   THEN NEW.restriccion_fecha ELSE NEW.restriccion2_fecha END;
            v_despues := CASE WHEN v_p LIKE '%_DESPUES' THEN NEW.restriccion_fecha ELSE NEW.restriccion2_fecha END;
            IF v_antes < v_despues THEN
                RAISE EXCEPTION
                  'El límite «en o antes de» (%) queda antes del límite «en o después de» '
                  '(%): ninguna fecha cumple las dos (RN-30).',
                  to_char(v_antes, 'DD/MM/YYYY'), to_char(v_despues, 'DD/MM/YYYY')
                  USING COLUMN = 'restriccion2Fecha';
            END IF;
        END IF;
    END IF;
    IF NEW.tipo = 'HITO_FIN' AND (v_p = ANY (c_inicio) OR v_s = ANY (c_inicio)) THEN
        RAISE EXCEPTION 'Un hito de fin no admite restricciones de inicio (RN-30).'
          USING COLUMN = CASE WHEN v_p = ANY (c_inicio) THEN 'restriccionTipo' ELSE 'restriccion2Tipo' END;
    END IF;
    IF NEW.tipo = 'HITO_INICIO' AND (v_p = ANY (c_fin) OR v_s = ANY (c_fin)) THEN
        RAISE EXCEPTION 'Un hito de inicio no admite restricciones de fin (RN-30).'
          USING COLUMN = CASE WHEN v_p = ANY (c_fin) THEN 'restriccionTipo' ELSE 'restriccion2Tipo' END;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.fn_nombre_restriccion(p_tipo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_tipo
        WHEN 'INICIO_EL'          THEN 'inicio el'
        WHEN 'INICIO_ANTES'       THEN 'inicio en o antes de'
        WHEN 'INICIO_DESPUES'     THEN 'inicio en o después de'
        WHEN 'FIN_EL'             THEN 'fin el'
        WHEN 'FIN_ANTES'          THEN 'fin en o antes de'
        WHEN 'FIN_DESPUES'        THEN 'fin en o después de'
        WHEN 'LO_MAS_TARDE'       THEN 'lo más tarde posible'
        WHEN 'INICIO_OBLIGATORIO' THEN 'inicio obligatorio'
        WHEN 'FIN_OBLIGATORIO'    THEN 'fin obligatorio'
        ELSE p_tipo END;
$$;

CREATE TRIGGER tg_entrada_actividad BEFORE INSERT ON app.actividad_programada
    FOR EACH ROW EXECUTE FUNCTION app.fn_actividad_entrada();
-- En un UPDATE, solo si cambia algo que esta función juzga: textos, el ítem
-- (su anulación al borrarse) o las restricciones. Cuadrillas, corrido,
-- duración y subgrupo los defienden las CHECK; el orden no se juzga.
CREATE TRIGGER tg_entrada_actividad_upd BEFORE UPDATE ON app.actividad_programada
    FOR EACH ROW
    WHEN ((NEW.nombre, NEW.codigo, NEW.presupuesto_item_id, NEW.restriccion_tipo,
           NEW.restriccion_fecha, NEW.restriccion2_tipo, NEW.restriccion2_fecha)
          IS DISTINCT FROM
          (OLD.nombre, OLD.codigo, OLD.presupuesto_item_id, OLD.restriccion_tipo,
           OLD.restriccion_fecha, OLD.restriccion2_tipo, OLD.restriccion2_fecha))
    EXECUTE FUNCTION app.fn_actividad_entrada();

-- RN-33 · Lo que no se borra a mano: la actividad de un ítem que sigue en el
-- presupuesto (volvería en el recálculo siguiente) y la administración.
CREATE OR REPLACE FUNCTION app.fn_actividad_borrable() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    IF app.fn_bandera_interna('app.purga_tenant', OLD.tenant_id::text)
       OR NOT EXISTS (SELECT 1 FROM app.cronograma WHERE id = OLD.cronograma_id) THEN
        RETURN OLD;
    END IF;
    IF OLD.tipo = 'ADMINISTRACION' THEN
        RAISE EXCEPTION
          'La tarea de administración no se elimina: sus fechas salen del resto del '
          'cronograma (RN-37).';
    END IF;
    IF OLD.presupuesto_item_id IS NOT NULL THEN
        RAISE EXCEPTION
          'La actividad «% %» sigue en el presupuesto: se elimina cuando su ítem sale '
          'del presupuesto (RN-33).', OLD.codigo, OLD.nombre;
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER tg_entrada_actividad_borrar BEFORE DELETE ON app.actividad_programada
    FOR EACH ROW EXECUTE FUNCTION app.fn_actividad_borrable();

-- Un subgrupo con actividades no se borra: se vacía antes.
CREATE OR REPLACE FUNCTION app.fn_grupo_borrable() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    IF app.fn_bandera_interna('app.purga_tenant', OLD.tenant_id::text)
       OR NOT EXISTS (SELECT 1 FROM app.cronograma WHERE id = OLD.cronograma_id) THEN
        RETURN OLD;
    END IF;
    IF EXISTS (SELECT 1 FROM app.actividad_programada WHERE grupo_id = OLD.id) THEN
        RAISE EXCEPTION
          'El subgrupo «%» tiene actividades: muévalas a otro o elimínelas antes '
          '(RF-PRG-03).', OLD.nombre;
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER tg_entrada_grupo_borrar BEFORE DELETE ON app.grupo_tramite
    FOR EACH ROW EXECUTE FUNCTION app.fn_grupo_borrable();

-- =============================================================================
--  RF-PRG-04 / RF-PRG-05 · Las dependencias
-- =============================================================================

-- Solo entre actividades e hitos: nunca con la administración, que no tiene
-- relaciones (RN-39). Con capítulos no se puede: no son actividades.
CREATE OR REPLACE FUNCTION app.fn_dependencia_entrada() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM app.actividad_programada
                WHERE id IN (NEW.predecesora_id, NEW.sucesora_id) AND tipo = 'ADMINISTRACION') THEN
        RAISE EXCEPTION
          'La tarea de administración no lleva relaciones: sus fechas salen del '
          'resto del cronograma (RN-37, RN-39).'
          USING COLUMN = 'predecesoraId';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_entrada_dependencia BEFORE INSERT ON app.dependencia
    FOR EACH ROW EXECUTE FUNCTION app.fn_dependencia_entrada();

-- RF-PRG-05 · Un círculo se rechaza al crearlo, como en Project: nunca queda
-- guardado (decisión del 20 de octubre de 2026). Se mira al final de cada
-- sentencia, para que una inserción de varias filas se juzgue completa. El
-- detalle del error lleva los identificadores de las actividades del
-- círculo, para que la pantalla las marque.
CREATE OR REPLACE FUNCTION app.fn_dependencia_sin_ciclo() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_ids uuid[]; v_codigos text;
BEGIN
    -- Copiar un cronograma que ya no tenía círculos no puede crear uno.
    IF app.fn_bandera_interna('app.duplicando') THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.dependencia WHERE id = NEW.id) THEN
        RETURN NULL;
    END IF;
    -- ¿La predecesora se alcanza desde la sucesora? UNION descarta lo ya
    -- visitado, así que cada actividad se recorre una sola vez.
    IF NOT EXISTS (
        WITH RECURSIVE desde(id) AS (
            SELECT NEW.sucesora_id
            UNION
            SELECT d.sucesora_id FROM app.dependencia d JOIN desde ON d.predecesora_id = desde.id
        )
        SELECT 1 FROM desde WHERE id = NEW.predecesora_id) THEN
        RETURN NULL;
    END IF;
    -- Hay círculo: lo forman las que se alcanzan desde la sucesora y a la vez
    -- llegan a la predecesora.
    WITH RECURSIVE desde(id) AS (
        SELECT NEW.sucesora_id
        UNION
        SELECT d.sucesora_id FROM app.dependencia d JOIN desde ON d.predecesora_id = desde.id
    ), hacia(id) AS (
        SELECT NEW.predecesora_id
        UNION
        SELECT d.predecesora_id FROM app.dependencia d JOIN hacia ON d.sucesora_id = hacia.id
    )
    SELECT array_agg(a.id ORDER BY a.tipo <> 'ITEM', a.orden, a.codigo),
           string_agg(a.codigo, ', ' ORDER BY a.tipo <> 'ITEM', a.orden, a.codigo)
             FILTER (WHERE a.n <= 10)
      INTO v_ids, v_codigos
      FROM (SELECT x.*, row_number() OVER (ORDER BY x.tipo <> 'ITEM', x.orden, x.codigo) AS n
              FROM app.actividad_programada x
             WHERE x.id IN (SELECT id FROM desde INTERSECT SELECT id FROM hacia)) a;
    IF cardinality(v_ids) > 10 THEN
        v_codigos := v_codigos || format(' y %s más', cardinality(v_ids) - 10);
    END IF;
    RAISE EXCEPTION
      'Esta relación cerraría un círculo entre %: una actividad no puede depender '
      'de sí misma, ni directa ni indirectamente (RF-PRG-05).', v_codigos
      USING COLUMN = 'predecesoraId',
            DETAIL = jsonb_build_object('ciclo', to_jsonb(v_ids))::text;
END $$;
CREATE CONSTRAINT TRIGGER tg_dependencia_sin_ciclo
    AFTER INSERT ON app.dependencia
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION app.fn_dependencia_sin_ciclo();

-- =============================================================================
--  Los calendarios de un cronograma
-- =============================================================================

-- Corrige la 0004: la comprobación de tramos sin cruce es diferida, y juzgaba
-- la fila tal como entró aunque en la misma transacción se hubiera borrado o
-- cambiado después. Reemplazar un horario que se acababa de copiar (crear un
-- cronograma y cambiarle el calendario en la misma transacción, o una pantalla
-- que inserta y luego reemplaza los tramos de un día) fallaba con un cruce
-- contra un tramo que ya no existía. Ahora juzga la fila como está al
-- confirmar, y la que ya no está no se juzga.
CREATE OR REPLACE FUNCTION app.fn_tramos_sin_cruce() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_cruce boolean; v_padre uuid; v_dia smallint; v_ini time; v_fin time;
BEGIN
    IF TG_TABLE_NAME = 'calendario_tramo' THEN
        SELECT t.calendario_id, t.dia_semana, t.inicio, t.fin INTO v_padre, v_dia, v_ini, v_fin
          FROM app.calendario_tramo t WHERE t.id = NEW.id;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM app.calendario_tramo t
             WHERE t.calendario_id = v_padre AND t.dia_semana = v_dia
               AND t.id <> NEW.id
               AND app.fn_minuto_del_dia(t.inicio) < app.fn_minuto_del_dia(v_fin)
               AND app.fn_minuto_del_dia(v_ini) < app.fn_minuto_del_dia(t.fin))
          INTO v_cruce;
    ELSE
        SELECT t.excepcion_id, t.inicio, t.fin INTO v_padre, v_ini, v_fin
          FROM app.calendario_excepcion_tramo t WHERE t.id = NEW.id;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM app.calendario_excepcion_tramo t
             WHERE t.excepcion_id = v_padre AND t.id <> NEW.id
               AND app.fn_minuto_del_dia(t.inicio) < app.fn_minuto_del_dia(v_fin)
               AND app.fn_minuto_del_dia(v_ini) < app.fn_minuto_del_dia(t.fin))
          INTO v_cruce;
    END IF;
    IF v_cruce THEN
        RAISE EXCEPTION
          'Dos tramos del mismo día se cruzan (de % a %): un día no puede tener la '
          'misma hora dos veces (D-86).', v_ini, v_fin;
    END IF;
    RETURN NULL;
END $$;

-- Copia los tramos y las excepciones de un calendario a otro, que está vacío.
CREATE OR REPLACE FUNCTION app.fn_copiar_horario(p_origen uuid, p_destino uuid)
RETURNS void LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM app.calendario WHERE id = p_destino;
    INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
    SELECT v_tenant, p_destino, t.dia_semana, t.inicio, t.fin
      FROM app.calendario_tramo t WHERE t.calendario_id = p_origen;
    INSERT INTO app.calendario_excepcion (tenant_id, calendario_id, fecha, motivo)
    SELECT v_tenant, p_destino, e.fecha, e.motivo
      FROM app.calendario_excepcion e WHERE e.calendario_id = p_origen;
    INSERT INTO app.calendario_excepcion_tramo (tenant_id, excepcion_id, inicio, fin)
    SELECT v_tenant, n.id, t.inicio, t.fin
      FROM app.calendario_excepcion e
      JOIN app.calendario_excepcion_tramo t ON t.excepcion_id = e.id
      JOIN app.calendario_excepcion n ON n.calendario_id = p_destino AND n.fecha = e.fecha
     WHERE e.calendario_id = p_origen;
END $$;

-- La copia de la obra: la cabecera y el horario de un calendario.
CREATE OR REPLACE FUNCTION app.fn_copiar_calendario_a_cronograma(
    p_origen uuid, p_cronograma_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_cal uuid;
BEGIN
    INSERT INTO app.calendario
        (tenant_id, nombre, horas_por_dia, festivos_lista_id, festivos_propia_id,
         festivos_hasta, tipo, cronograma_id)
    SELECT k.tenant_id, k.nombre, k.horas_por_dia, k.festivos_lista_id, k.festivos_propia_id,
           k.festivos_hasta, 'OBRA', p_cronograma_id
      FROM app.calendario k WHERE k.id = p_origen
    RETURNING id INTO v_cal;
    PERFORM app.fn_copiar_horario(p_origen, v_cal);
    RETURN v_cal;
END $$;

-- D-86 · El corrido: 24 horas los siete días, 1 día = 24 h, sin excepciones.
CREATE OR REPLACE FUNCTION app.fn_crear_calendario_corrido(p_cronograma_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_cal uuid; v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM app.cronograma WHERE id = p_cronograma_id;
    INSERT INTO app.calendario (tenant_id, nombre, horas_por_dia, tipo, cronograma_id)
    VALUES (v_tenant, 'Corrido (24 horas, todos los días)', 24, 'CORRIDO', p_cronograma_id)
    RETURNING id INTO v_cal;
    INSERT INTO app.calendario_tramo (tenant_id, calendario_id, dia_semana, inicio, fin)
    SELECT v_tenant, v_cal, d, '00:00', '24:00' FROM generate_series(1, 7) AS d;
    RETURN v_cal;
END $$;

-- Marcar el calendario por defecto: solo uno de la empresa.
CREATE OR REPLACE FUNCTION app.fn_calendario_por_defecto(p_calendario_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_tipo text;
BEGIN
    SELECT tenant_id, tipo INTO v_tenant, v_tipo FROM app.calendario WHERE id = p_calendario_id;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'El calendario no existe en esta empresa.';
    END IF;
    IF v_tipo <> 'EMPRESA' THEN
        RAISE EXCEPTION
          'Solo un calendario de la empresa puede ser el de por defecto: este es la '
          'copia de un cronograma (D-86).';
    END IF;
    UPDATE app.calendario SET por_defecto = false
     WHERE tenant_id = v_tenant AND por_defecto AND id <> p_calendario_id;
    UPDATE app.calendario SET por_defecto = true WHERE id = p_calendario_id;
END $$;

-- =============================================================================
--  RF-PRG-01 · Crear el cronograma
-- =============================================================================
CREATE OR REPLACE FUNCTION app.fn_crear_cronograma(
    p_presupuesto_id uuid, p_fecha_inicio date, p_calendario_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_p app.presupuesto; v_cal app.calendario; v_crono uuid;
BEGIN
    SELECT * INTO v_p FROM app.presupuesto WHERE id = p_presupuesto_id FOR SHARE;
    IF v_p.id IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_p.tenant_id, 'El presupuesto');
    IF v_p.estado = 'CERRADO' THEN
        RAISE EXCEPTION
          'El presupuesto está Cerrado: se programa con el presupuesto Abierto o '
          'Activo (RN-34).';
    END IF;
    IF p_fecha_inicio IS NULL THEN
        RAISE EXCEPTION 'El cronograma necesita su fecha de inicio (RF-PRG-01).'
          USING COLUMN = 'fechaInicio';
    END IF;
    IF EXISTS (SELECT 1 FROM app.cronograma WHERE presupuesto_id = v_p.id) THEN
        RAISE EXCEPTION 'Este presupuesto ya tiene su cronograma: hay uno por presupuesto (D-82).';
    END IF;

    IF p_calendario_id IS NULL THEN
        SELECT * INTO v_cal FROM app.calendario
         WHERE tenant_id = v_p.tenant_id AND por_defecto;
    ELSE
        SELECT * INTO v_cal FROM app.calendario
         WHERE id = p_calendario_id AND tenant_id = v_p.tenant_id AND tipo = 'EMPRESA';
    END IF;
    IF v_cal.id IS NULL THEN
        RAISE EXCEPTION 'El calendario no existe en esta empresa.'
          USING COLUMN = 'calendarioId';
    END IF;

    PERFORM set_config('app.cronograma_interno', 'si', true);

    INSERT INTO app.cronograma (tenant_id, presupuesto_id, fecha_inicio, creado_por)
    VALUES (v_p.tenant_id, v_p.id, p_fecha_inicio, app.fn_usuario_actual())
    RETURNING id INTO v_crono;

    PERFORM app.fn_copiar_calendario_a_cronograma(v_cal.id, v_crono);
    PERFORM app.fn_crear_calendario_corrido(v_crono);

    -- Una actividad por ítem, en el orden de la EDT, sin relaciones (RN-39).
    INSERT INTO app.actividad_programada
        (tenant_id, cronograma_id, tipo, presupuesto_item_id, nombre, codigo, orden)
    SELECT v_p.tenant_id, v_crono, 'ITEM', i.id, i.descripcion, i.codigo_item,
           row_number() OVER (ORDER BY string_to_array(i.codigo_item, '.')::int[], i.id)
      FROM app.presupuesto_item i
     WHERE i.presupuesto_id = v_p.id;

    INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, nombre, codigo, orden)
    VALUES (v_p.tenant_id, v_crono, 'ADMINISTRACION', 'Administración y supervisión de obra', 'ADM', 0),
           (v_p.tenant_id, v_crono, 'HITO_INICIO', 'Inicio del proyecto', 'H-001', 1),
           (v_p.tenant_id, v_crono, 'HITO_FIN',    'Fin del proyecto',    'H-002', 2);

    INSERT INTO app.evento_auditoria
        (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
         descripcion, valor_nuevo, usuario_id)
    VALUES (v_p.tenant_id, v_p.id, 'CRONOGRAMA', v_crono, 'CRONOGRAMA_CREADO',
            format('Cronograma creado: inicia el %s, con el calendario «%s»',
                   to_char(p_fecha_inicio, 'DD/MM/YYYY'), v_cal.nombre),
            jsonb_build_object('fecha_inicio', p_fecha_inicio, 'calendario', v_cal.nombre),
            app.fn_usuario_actual());

    PERFORM set_config('app.cronograma_interno', '', true);
    RETURN v_crono;
END $$;
COMMENT ON FUNCTION app.fn_crear_cronograma(uuid, date, uuid) IS
  'RF-PRG-01. Crea el cronograma de un presupuesto Abierto o Activo: copia el '
  'calendario elegido (o el de por defecto), crea el corrido, una actividad por '
  'ítem, la administración (ADM) y los hitos de inicio y fin del proyecto, sin '
  'relaciones. Deja el evento CRONOGRAMA_CREADO. Nace sin calcular.';

-- =============================================================================
--  Reemplazar el calendario de la obra por otro de la empresa (07 §6.9)
--
--  El calendario de la obra conserva su identificador: se reemplazan su
--  cabecera y su horario. La API sube la versión del cronograma y recalcula en
--  la misma transacción, como en cualquier guardado.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.fn_cambiar_calendario_cronograma(
    p_cronograma_id uuid, p_calendario_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_c app.cronograma; v_cal app.calendario; v_obra app.calendario;
BEGIN
    SELECT * INTO v_c FROM app.cronograma WHERE id = p_cronograma_id;
    IF v_c.id IS NULL THEN
        RAISE EXCEPTION 'El cronograma no existe en esta empresa.';
    END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_c.tenant_id, 'El cronograma');
    SELECT * INTO v_cal FROM app.calendario
     WHERE id = p_calendario_id AND tenant_id = v_c.tenant_id AND tipo = 'EMPRESA';
    IF v_cal.id IS NULL THEN
        RAISE EXCEPTION 'El calendario no existe en esta empresa.'
          USING COLUMN = 'calendarioId';
    END IF;
    SELECT * INTO v_obra FROM app.calendario
     WHERE cronograma_id = v_c.id AND tipo = 'OBRA';

    -- El guardián rechaza aquí si el presupuesto está Cerrado.
    UPDATE app.calendario
       SET nombre = v_cal.nombre, horas_por_dia = v_cal.horas_por_dia,
           festivos_lista_id = v_cal.festivos_lista_id,
           festivos_propia_id = v_cal.festivos_propia_id,
           festivos_hasta = v_cal.festivos_hasta
     WHERE id = v_obra.id;
    DELETE FROM app.calendario_excepcion WHERE calendario_id = v_obra.id;
    DELETE FROM app.calendario_tramo     WHERE calendario_id = v_obra.id;
    PERFORM app.fn_copiar_horario(v_cal.id, v_obra.id);

    INSERT INTO app.evento_auditoria
        (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
         descripcion, valor_anterior, valor_nuevo, usuario_id)
    VALUES (v_c.tenant_id, v_c.presupuesto_id, 'CRONOGRAMA', v_c.id, 'CRONOGRAMA_CALENDARIO',
            format('Calendario del cronograma: «%s» reemplazado por «%s»', v_obra.nombre, v_cal.nombre),
            jsonb_build_object('calendario', v_obra.nombre),
            jsonb_build_object('calendario', v_cal.nombre),
            app.fn_usuario_actual());
END $$;
COMMENT ON FUNCTION app.fn_cambiar_calendario_cronograma(uuid, uuid) IS
  '07 §6.9. Reemplaza la cabecera y el horario del calendario de la obra por los '
  'de un calendario de la empresa. Deja el evento CRONOGRAMA_CALENDARIO.';

-- =============================================================================
--  D-89 / RF-PRG-08 · Las dos curvas
--
--  El motor entrega los minutos laborables de cada actividad en cada día; aquí
--  se reparte el dinero, con la misma aritmética que calculó el total, para que
--  la suma sea exacta:
--
--    · Costo de cada actividad (RN-36): el de su ítem, en línea recta sobre sus
--      minutos. El residuo del redondeo queda en su último día. Una actividad
--      de cero minutos lleva todo su costo al día en que cae, y llega con una
--      sola entrada de cero minutos (decisión del 20 de octubre de 2026).
--    · La administración (RN-37) entra solo en la curva de costo, repartida
--      sobre los minutos de su tarea.
--    · Facturación (RN-40): las actividades más A, I, U e IVA, que se reparten
--      en proporción al costo directo de cada día, con el residuo en el último
--      día que tiene costo directo.
--    · Costo (RN-41): costo directo, costos indirectos y administración.
--
--  Así la facturación suma presupuesto.valor_total y el costo suma el costo
--  directo, el indirecto y la administración. Si el cronograma no tiene todas
--  las actividades con costo, se niega: una curva incompleta no cuadra.
--
--  La semana empieza el día de configuracion_empresa.inicio_semana (RF-CFG-33);
--  el periodo se nombra por su primer día.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.fn_curvas(
    p_presupuesto_id uuid, p_actividad_ids uuid[], p_fechas date[], p_minutos integer[],
    p_granularidad text DEFAULT 'DIA')
RETURNS TABLE (periodo date, facturacion app.dinero, costo app.dinero)
LANGUAGE plpgsql STABLE SET search_path = app, pg_temp AS $$
DECLARE v_p app.presupuesto; v_crono uuid; v_semana smallint; v_n integer;
        v_mal integer; v_cd numeric; v_ci numeric; v_extra numeric;
BEGIN
    IF p_granularidad IS NULL OR p_granularidad NOT IN ('DIA', 'SEMANA', 'MES') THEN
        RAISE EXCEPTION 'La granularidad es DIA, SEMANA o MES.' USING COLUMN = 'granularidad';
    END IF;
    SELECT * INTO v_p FROM app.presupuesto WHERE id = p_presupuesto_id;
    IF v_p.id IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    SELECT id INTO v_crono FROM app.cronograma WHERE presupuesto_id = v_p.id;
    IF v_crono IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no tiene cronograma.';
    END IF;
    SELECT inicio_semana INTO v_semana FROM app.configuracion_empresa WHERE tenant_id = v_p.tenant_id;

    p_actividad_ids := COALESCE(p_actividad_ids, '{}');
    p_fechas        := COALESCE(p_fechas, '{}');
    p_minutos       := COALESCE(p_minutos, '{}');
    v_n := COALESCE(cardinality(p_actividad_ids), 0);
    IF COALESCE(cardinality(p_fechas), 0) <> v_n OR COALESCE(cardinality(p_minutos), 0) <> v_n THEN
        RAISE EXCEPTION 'Las listas de actividades, fechas y minutos tienen largos distintos.';
    END IF;

    -- Entradas sanas: sin vacíos, sin negativos, sin días repetidos, y solo
    -- actividades de este cronograma.
    SELECT count(*) INTO v_mal
      FROM unnest(p_actividad_ids, p_fechas, p_minutos) AS e(a, f, m)
     WHERE e.a IS NULL OR e.f IS NULL OR e.m IS NULL OR e.m < 0;
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'Hay entradas vacías o con minutos negativos.';
    END IF;
    SELECT count(*) - count(DISTINCT (e.a, e.f)) INTO v_mal
      FROM unnest(p_actividad_ids, p_fechas) AS e(a, f);
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'Una actividad aparece dos veces en el mismo día.';
    END IF;
    SELECT count(*) INTO v_mal
      FROM (SELECT DISTINCT a FROM unnest(p_actividad_ids) AS e(a)) e
     WHERE NOT EXISTS (SELECT 1 FROM app.actividad_programada ap
                        WHERE ap.id = e.a AND ap.cronograma_id = v_crono);
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'Hay actividades que no son de este cronograma.';
    END IF;
    -- Cero minutos: un solo día.
    SELECT count(*) INTO v_mal FROM (
        SELECT e.a FROM unnest(p_actividad_ids, p_minutos) AS e(a, m)
         GROUP BY e.a HAVING sum(e.m) = 0 AND count(*) > 1) z;
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'Una actividad sin minutos va en un solo día, el día en que cae.';
    END IF;

    -- Todas las actividades con costo, presentes.
    SELECT count(*) INTO v_mal FROM (
        SELECT ap.id
          FROM app.actividad_programada ap
          LEFT JOIN app.presupuesto_item i ON i.id = ap.presupuesto_item_id
         WHERE ap.cronograma_id = v_crono
           AND ((i.id IS NOT NULL AND i.costo_total <> 0)
                OR (ap.tipo = 'ADMINISTRACION' AND v_p.total_administracion <> 0))
        EXCEPT
        SELECT x.a FROM unnest(p_actividad_ids) AS x(a)) faltan;
    IF v_mal > 0 THEN
        RAISE EXCEPTION
          'Faltan % actividades con costo en las curvas: el reparto no sumaría el total '
          '(RF-PRG-08).', v_mal;
    END IF;

    -- Y que el cronograma tenga todos los ítems del presupuesto con costo.
    SELECT COALESCE(sum(i.costo_total) FILTER (WHERE t.clasificacion = 'DIRECTO'), 0),
           COALESCE(sum(i.costo_total) FILTER (WHERE t.clasificacion = 'INDIRECTO'), 0)
      INTO v_cd, v_ci
      FROM app.actividad_programada ap
      JOIN app.presupuesto_item i ON i.id = ap.presupuesto_item_id
      JOIN app.fn_leer_edt(v_p.id) t ON t.id = i.wbs_nodo_id
     WHERE ap.cronograma_id = v_crono;
    IF v_cd <> v_p.total_costo_directo OR v_ci <> v_p.total_costo_indirecto THEN
        RAISE EXCEPTION
          'El cronograma no tiene todas las actividades del presupuesto: recalcúlelo '
          'antes de pedir las curvas (RN-33, RF-PRG-08).';
    END IF;
    v_extra := v_p.total_aiu + v_p.total_iva;
    IF v_cd = 0 AND v_extra <> 0 THEN
        RAISE EXCEPTION 'Hay AIU o IVA sin costo directo sobre el cual repartirlo.';
    END IF;

    RETURN QUERY
    WITH e AS (
        SELECT x.a, x.f, x.m FROM unnest(p_actividad_ids, p_fechas, p_minutos) AS x(a, f, m)
    ), act AS (
        SELECT ap.id,
               CASE WHEN ap.tipo = 'ADMINISTRACION' THEN 'ADM' ELSE t.clasificacion END AS clase,
               CASE WHEN ap.tipo = 'ADMINISTRACION' THEN v_p.total_administracion::numeric
                    ELSE i.costo_total::numeric END AS monto
          FROM app.actividad_programada ap
          LEFT JOIN app.presupuesto_item i ON i.id = ap.presupuesto_item_id
          LEFT JOIN app.fn_leer_edt(v_p.id) t ON t.id = i.wbs_nodo_id
         WHERE ap.cronograma_id = v_crono
           AND (ap.tipo = 'ADMINISTRACION' OR i.id IS NOT NULL)
    ), r1 AS (
        SELECT e.a, e.f, act.clase, act.monto,
               sum(e.m) OVER (PARTITION BY e.a) AS total,
               round(act.monto * e.m / NULLIF(sum(e.m) OVER (PARTITION BY e.a), 0), 6) AS parte,
               e.f = max(e.f) OVER (PARTITION BY e.a) AS ultimo
          FROM e JOIN act ON act.id = e.a
    ), r2 AS (
        SELECT r1.f, r1.clase,
               CASE WHEN r1.total = 0 THEN r1.monto
                    WHEN r1.ultimo THEN r1.monto - (sum(r1.parte) OVER (PARTITION BY r1.a) - r1.parte)
                    ELSE r1.parte END AS monto
          FROM r1
    ), dia AS (
        SELECT d.f,
               COALESCE(sum(d.monto) FILTER (WHERE d.clase IN ('DIRECTO', 'INDIRECTO')), 0) AS obra,
               COALESCE(sum(d.monto) FILTER (WHERE d.clase = 'DIRECTO'), 0) AS directo,
               COALESCE(sum(d.monto) FILTER (WHERE d.clase = 'ADM'), 0) AS adm
          FROM (SELECT f, clase, monto FROM r2
                UNION ALL SELECT f, NULL, 0 FROM e) d
         GROUP BY d.f
    ), x1 AS (
        SELECT dia.*,
               CASE WHEN v_cd = 0 THEN 0 ELSE round(v_extra * dia.directo / v_cd, 6) END AS parte,
               max(dia.f) FILTER (WHERE dia.directo > 0) OVER () AS ultimo_directo
          FROM dia
    ), x2 AS (
        SELECT x1.f, x1.obra, x1.adm,
               CASE WHEN x1.f = x1.ultimo_directo
                    THEN v_extra - (sum(x1.parte) OVER () - x1.parte)
                    ELSE x1.parte END AS extra
          FROM x1
    )
    SELECT CASE p_granularidad
             WHEN 'DIA'    THEN x2.f
             WHEN 'SEMANA' THEN x2.f - ((extract(isodow FROM x2.f)::integer - v_semana + 7) % 7)
             ELSE date_trunc('month', x2.f)::date END AS periodo,
           sum(x2.obra + x2.extra)::app.dinero AS facturacion,
           sum(x2.obra + x2.adm)::app.dinero   AS costo
      FROM x2
     GROUP BY 1
     ORDER BY 1;
END $$;
COMMENT ON FUNCTION app.fn_curvas(uuid, uuid[], date[], integer[], text) IS
  'D-89, RF-PRG-08, RN-36, RN-37, RN-40, RN-41. Reparte el dinero sobre los '
  'minutos laborables por actividad y día que entrega el motor. La facturación '
  'suma valor_total; el costo, costo directo + indirecto + administración.';

-- =============================================================================
--  RF-PRG-09 / RN-38 · Guardar o reemplazar una línea base
--
--  Solo con el presupuesto Activo y con el cronograma calculado sobre lo de
--  ahora (calculado_version = version y calculado_revision = revision). Los
--  minutos que se reciben tienen que sumar la duración de cada actividad.
--  Guardar con un nombre que ya existe choca en ux_linea_base_nombre: para
--  reemplazar, la llamada trae p_reemplaza_id, que es la confirmación.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.fn_guardar_linea_base(
    p_cronograma_id uuid, p_nombre text,
    p_actividad_ids uuid[], p_fechas date[], p_minutos integer[],
    p_reemplaza_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_c app.cronograma; v_p app.presupuesto; v_lb uuid; v_ant text;
        v_nombre text := app.fn_texto_limpio(p_nombre); v_mal integer;
BEGIN
    SELECT * INTO v_c FROM app.cronograma WHERE id = p_cronograma_id FOR UPDATE;
    IF v_c.id IS NULL THEN
        RAISE EXCEPTION 'El cronograma no existe en esta empresa.';
    END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_c.tenant_id, 'El cronograma');
    SELECT * INTO v_p FROM app.presupuesto WHERE id = v_c.presupuesto_id;
    IF v_p.estado <> 'ACTIVO' THEN
        RAISE EXCEPTION
          'Las líneas base se guardan solo con el presupuesto Activo, y este está % '
          '(RF-PRG-09).', initcap(v_p.estado);
    END IF;
    IF v_c.calculado_version IS DISTINCT FROM v_c.version
       OR v_c.calculado_revision IS DISTINCT FROM v_p.revision THEN
        RAISE EXCEPTION
          'El cronograma no está calculado con los datos de ahora: recalcúlelo antes '
          'de guardar la línea base (D-91).';
    END IF;
    SELECT count(*) INTO v_mal
      FROM app.actividad_programada a
      LEFT JOIN app.actividad_calculo k ON k.actividad_id = a.id
     WHERE a.cronograma_id = v_c.id AND k.actividad_id IS NULL;
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'Hay % actividades sin calcular: recalcule antes de guardar la línea base.', v_mal;
    END IF;
    SELECT count(*) INTO v_mal
      FROM (SELECT e.a, sum(e.m) AS s FROM unnest(p_actividad_ids, p_minutos) AS e(a, m)
             GROUP BY e.a) s
      JOIN app.actividad_calculo k ON k.actividad_id = s.a
     WHERE s.s <> k.duracion_minutos;
    IF v_mal > 0 THEN
        RAISE EXCEPTION
          'Los minutos por día de % actividades no suman su duración calculada.', v_mal;
    END IF;

    IF p_reemplaza_id IS NULL THEN
        IF v_nombre IS NULL THEN
            RAISE EXCEPTION 'La línea base necesita un nombre.' USING COLUMN = 'nombre';
        END IF;
        INSERT INTO app.linea_base (tenant_id, cronograma_id, nombre, guardada_por)
        VALUES (v_c.tenant_id, v_c.id, v_nombre, app.fn_usuario_actual())
        RETURNING id INTO v_lb;
        INSERT INTO app.evento_auditoria
            (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
             descripcion, valor_nuevo, usuario_id)
        VALUES (v_c.tenant_id, v_c.presupuesto_id, 'LINEA_BASE', v_lb, 'LINEA_BASE_GUARDADA',
                format('Línea base «%s» guardada', v_nombre),
                jsonb_build_object('nombre', v_nombre), app.fn_usuario_actual());
    ELSE
        SELECT nombre INTO v_ant FROM app.linea_base
         WHERE id = p_reemplaza_id AND cronograma_id = v_c.id;
        IF v_ant IS NULL THEN
            RAISE EXCEPTION 'La línea base no existe en este cronograma.';
        END IF;
        UPDATE app.linea_base
           SET nombre = COALESCE(v_nombre, nombre), guardada_en = now(),
               guardada_por = app.fn_usuario_actual()
         WHERE id = p_reemplaza_id;
        DELETE FROM app.linea_base_actividad WHERE linea_base_id = p_reemplaza_id;
        DELETE FROM app.linea_base_periodo   WHERE linea_base_id = p_reemplaza_id;
        v_lb := p_reemplaza_id;
        INSERT INTO app.evento_auditoria
            (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
             descripcion, valor_anterior, valor_nuevo, usuario_id)
        VALUES (v_c.tenant_id, v_c.presupuesto_id, 'LINEA_BASE', v_lb, 'LINEA_BASE_REEMPLAZADA',
                format('Línea base «%s» reemplazada', COALESCE(v_nombre, v_ant)),
                jsonb_build_object('nombre', v_ant),
                jsonb_build_object('nombre', COALESCE(v_nombre, v_ant)),
                app.fn_usuario_actual());
    END IF;

    INSERT INTO app.linea_base_actividad
        (tenant_id, linea_base_id, actividad_id, tipo, codigo, nombre, inicio, fin,
         duracion_minutos, costo)
    SELECT v_c.tenant_id, v_lb, a.id, a.tipo, a.codigo, a.nombre,
           k.inicio_temprano, k.fin_temprano, k.duracion_minutos,
           CASE WHEN a.tipo = 'ADMINISTRACION' THEN v_p.total_administracion
                ELSE COALESCE(i.costo_total, 0) END
      FROM app.actividad_programada a
      JOIN app.actividad_calculo k ON k.actividad_id = a.id
      LEFT JOIN app.presupuesto_item i ON i.id = a.presupuesto_item_id
     WHERE a.cronograma_id = v_c.id;

    INSERT INTO app.linea_base_periodo (tenant_id, linea_base_id, fecha, facturacion, costo)
    SELECT v_c.tenant_id, v_lb, c.periodo, c.facturacion, c.costo
      FROM app.fn_curvas(v_c.presupuesto_id, p_actividad_ids, p_fechas, p_minutos, 'DIA') c;

    RETURN v_lb;
END $$;
COMMENT ON FUNCTION app.fn_guardar_linea_base(uuid, text, uuid[], date[], integer[], uuid) IS
  'RF-PRG-09, RN-38. Guarda la foto (actividades y las dos curvas por día) con el '
  'presupuesto Activo y el cronograma al día. p_reemplaza_id reemplaza una '
  'existente: es la confirmación. Deja LINEA_BASE_GUARDADA o _REEMPLAZADA.';

-- Una línea base se escribe y se borra solo con el presupuesto Activo
-- (decisión del 20 de octubre de 2026). Borrarla deja su evento.
CREATE OR REPLACE FUNCTION app.fn_linea_base_editable_cronograma() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_fila app.linea_base := COALESCE(NEW, OLD); v_estado text;
BEGIN
    IF app.fn_bandera_interna('app.purga_tenant', v_fila.tenant_id::text) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    PERFORM 1 FROM app.cronograma WHERE id = v_fila.cronograma_id FOR SHARE;
    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    SELECT p.estado INTO v_estado
      FROM app.cronograma c JOIN app.presupuesto p ON p.id = c.presupuesto_id
     WHERE c.id = v_fila.cronograma_id;
    IF v_estado <> 'ACTIVO' THEN
        RAISE EXCEPTION
          'Las líneas base se guardan, se reemplazan y se eliminan solo con el '
          'presupuesto Activo (RF-PRG-09).';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tg_linea_base_editable BEFORE INSERT OR UPDATE OR DELETE ON app.linea_base
    FOR EACH ROW EXECUTE FUNCTION app.fn_linea_base_editable_cronograma();

CREATE OR REPLACE FUNCTION app.fn_historia_linea_base() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE v_presupuesto uuid;
BEGIN
    IF app.fn_historia_silenciada() THEN
        RETURN NULL;
    END IF;
    SELECT presupuesto_id INTO v_presupuesto FROM app.cronograma WHERE id = OLD.cronograma_id;
    IF v_presupuesto IS NULL THEN
        RETURN NULL;        -- se borra con su cronograma
    END IF;
    PERFORM app.fn_evento_interno(
        OLD.tenant_id, v_presupuesto, 'LINEA_BASE', OLD.id, 'LINEA_BASE_ELIMINADA',
        format('Línea base «%s» eliminada', OLD.nombre),
        jsonb_build_object('nombre', OLD.nombre, 'guardada_en', OLD.guardada_en), NULL);
    RETURN NULL;
END $$;
CREATE TRIGGER tg_historia_linea_base AFTER DELETE ON app.linea_base
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_linea_base();

-- =============================================================================
--  RF-PRE-27 · Duplicar se lleva el cronograma (07 §6.9)
--
--  La copia se lleva el calendario de la obra, el corrido, los subgrupos, las
--  actividades —también las que ya no están en el presupuesto— con sus
--  cuadrillas, duraciones manuales y restricciones, y las relaciones. No se
--  lleva los resultados ni las líneas base: nace sin calcular y Abierta.
--
--  Lo único que cambia en lo que ya hacía: los ítems de la copia reciben su
--  identificador nuevo de un mapa calculado de una vez, como los capítulos,
--  para colgar de él cada actividad.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.fn_duplicar_presupuesto(
    p_presupuesto_id uuid, p_codigo text, p_nombre text DEFAULT NULL,
    p_actualizar_apu boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_origen app.presupuesto; v_nuevo uuid;
        v_map jsonb; v_nivel smallint; v_max smallint;
        v_items jsonb; v_crono_o app.cronograma; v_crono uuid; v_obra_o uuid;
        v_grupos jsonb; v_acts jsonb;
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
    SELECT jsonb_object_agg(i.id::text, app.uuid_v7()::text)
      INTO v_items
      FROM app.presupuesto_item i WHERE i.presupuesto_id = p_presupuesto_id;

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
            (id, tenant_id, presupuesto_id, wbs_nodo_id, orden, codigo_item,
             apu_id, apu_version_id,
             codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
        SELECT (v_items->>i.id::text)::uuid,
               v_tenant, v_nuevo, (v_map->>i.wbs_nodo_id::text)::uuid, i.orden,
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

    -- El cronograma, si el original tiene uno.
    SELECT * INTO v_crono_o FROM app.cronograma WHERE presupuesto_id = p_presupuesto_id;
    IF v_crono_o.id IS NOT NULL THEN
        PERFORM set_config('app.cronograma_interno', 'si', true);

        INSERT INTO app.cronograma (tenant_id, presupuesto_id, fecha_inicio, creado_por)
        VALUES (v_tenant, v_nuevo, v_crono_o.fecha_inicio, app.fn_usuario_actual())
        RETURNING id INTO v_crono;

        SELECT id INTO v_obra_o FROM app.calendario
         WHERE cronograma_id = v_crono_o.id AND tipo = 'OBRA';
        PERFORM app.fn_copiar_calendario_a_cronograma(v_obra_o, v_crono);
        PERFORM app.fn_crear_calendario_corrido(v_crono);

        SELECT jsonb_object_agg(g.id::text, app.uuid_v7()::text)
          INTO v_grupos FROM app.grupo_tramite g WHERE g.cronograma_id = v_crono_o.id;
        INSERT INTO app.grupo_tramite (id, tenant_id, cronograma_id, nombre, orden)
        SELECT (v_grupos->>g.id::text)::uuid, v_tenant, v_crono, g.nombre, g.orden
          FROM app.grupo_tramite g WHERE g.cronograma_id = v_crono_o.id;

        SELECT jsonb_object_agg(a.id::text, app.uuid_v7()::text)
          INTO v_acts FROM app.actividad_programada a WHERE a.cronograma_id = v_crono_o.id;
        -- Las de ítem toman número y nombre del ítem de la copia, que es lo que
        -- son (RN-42), aunque el original no se hubiera recalculado.
        INSERT INTO app.actividad_programada
            (id, tenant_id, cronograma_id, tipo, presupuesto_item_id, nombre, codigo,
             orden, grupo_id, usa_corrido, cuadrillas, duracion_manual_horas,
             restriccion_tipo, restriccion_fecha, restriccion2_tipo, restriccion2_fecha)
        SELECT (v_acts->>a.id::text)::uuid, v_tenant, v_crono, a.tipo, ni.id,
               COALESCE(ni.descripcion, a.nombre), COALESCE(ni.codigo_item, a.codigo),
               a.orden, (v_grupos->>a.grupo_id::text)::uuid, a.usa_corrido, a.cuadrillas,
               a.duracion_manual_horas, a.restriccion_tipo, a.restriccion_fecha,
               a.restriccion2_tipo, a.restriccion2_fecha
          FROM app.actividad_programada a
          LEFT JOIN app.presupuesto_item ni ON ni.id = (v_items->>a.presupuesto_item_id::text)::uuid
         WHERE a.cronograma_id = v_crono_o.id;

        INSERT INTO app.dependencia
            (tenant_id, cronograma_id, predecesora_id, sucesora_id, tipo, desfase_horas)
        SELECT v_tenant, v_crono, (v_acts->>d.predecesora_id::text)::uuid,
               (v_acts->>d.sucesora_id::text)::uuid, d.tipo, d.desfase_horas
          FROM app.dependencia d WHERE d.cronograma_id = v_crono_o.id;

        PERFORM set_config('app.cronograma_interno', '', true);
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
  'Clona la EDT completa en estado ABIERTO (RF-PRE-27, D-19), y su cronograma sin '
  'resultados ni líneas base (07 §6.9). p_actualizar_apu reapunta las actividades '
  'a la versión vigente.';

-- -----------------------------------------------------------------------------
--  Dueños, aislamiento y permisos
-- -----------------------------------------------------------------------------
ALTER TABLE app.cronograma            OWNER TO construsoft_owner;
ALTER TABLE app.grupo_tramite         OWNER TO construsoft_owner;
ALTER TABLE app.actividad_programada  OWNER TO construsoft_owner;
ALTER TABLE app.actividad_calculo     OWNER TO construsoft_owner;
ALTER TABLE app.dependencia           OWNER TO construsoft_owner;
ALTER TABLE app.linea_base            OWNER TO construsoft_owner;
ALTER TABLE app.linea_base_actividad  OWNER TO construsoft_owner;
ALTER TABLE app.linea_base_periodo    OWNER TO construsoft_owner;

ALTER FUNCTION app.fn_cronograma_editable()                         OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_cronograma_cabecera()                         OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_historia_cronograma()                         OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_cronograma_por_estado()                       OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_siguiente_codigo_actividad(uuid, text)        OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_codigo_de_huerfana(uuid, text)                OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_texto_limpio(text)                            OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_actividad_entrada()                           OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_nombre_restriccion(text)                      OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_actividad_borrable()                          OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_grupo_borrable()                              OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_dependencia_entrada()                         OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_dependencia_sin_ciclo()                       OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_copiar_horario(uuid, uuid)                    OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_copiar_calendario_a_cronograma(uuid, uuid)    OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_crear_calendario_corrido(uuid)                OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_crear_cronograma(uuid, date, uuid)            OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_cambiar_calendario_cronograma(uuid, uuid)     OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_curvas(uuid, uuid[], date[], integer[], text) OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_guardar_linea_base(uuid, text, uuid[], date[], integer[], uuid)
                                                                    OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_linea_base_editable_cronograma()              OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_historia_linea_base()                         OWNER TO construsoft_owner;

SET client_min_messages = warning;
SELECT app.fn_aplicar_rls();
RESET client_min_messages;

-- La aplicación: lee todo (la RLS filtra); escribe las entradas por columna;
-- el cronograma y las líneas base nacen solo por sus funciones.
GRANT SELECT ON app.cronograma, app.grupo_tramite, app.actividad_programada,
                app.actividad_calculo, app.dependencia, app.linea_base,
                app.linea_base_actividad, app.linea_base_periodo
    TO construsoft_app, construsoft_superadmin;
GRANT UPDATE (fecha_inicio, version, calculado_version, calculado_revision)
    ON app.cronograma TO construsoft_app;
GRANT INSERT, DELETE ON app.grupo_tramite TO construsoft_app;
GRANT UPDATE (nombre, orden) ON app.grupo_tramite TO construsoft_app;
GRANT INSERT (id, tenant_id, cronograma_id, tipo, presupuesto_item_id, nombre, codigo,
              orden, grupo_id, usa_corrido, cuadrillas, duracion_manual_horas,
              restriccion_tipo, restriccion_fecha, restriccion2_tipo, restriccion2_fecha)
    ON app.actividad_programada TO construsoft_app;
GRANT UPDATE (nombre, codigo, orden, grupo_id, usa_corrido, cuadrillas,
              duracion_manual_horas, restriccion_tipo, restriccion_fecha,
              restriccion2_tipo, restriccion2_fecha)
    ON app.actividad_programada TO construsoft_app;
GRANT DELETE ON app.actividad_programada TO construsoft_app;
GRANT INSERT, UPDATE, DELETE ON app.actividad_calculo TO construsoft_app;
GRANT INSERT (id, tenant_id, cronograma_id, predecesora_id, sucesora_id, tipo, desfase_horas)
    ON app.dependencia TO construsoft_app;
GRANT UPDATE (tipo, desfase_horas) ON app.dependencia TO construsoft_app;
GRANT DELETE ON app.dependencia TO construsoft_app;
GRANT DELETE ON app.linea_base TO construsoft_app;

-- calendario: la aplicación crea y edita los de la empresa; tipo y
-- cronograma_id los escriben solo las funciones del cronograma.
REVOKE INSERT, UPDATE ON app.calendario FROM construsoft_app;
GRANT INSERT (id, tenant_id, nombre, horas_por_dia, por_defecto,
              festivos_lista_id, festivos_propia_id, festivos_hasta)
    ON app.calendario TO construsoft_app;
GRANT UPDATE (nombre, horas_por_dia, por_defecto,
              festivos_lista_id, festivos_propia_id, festivos_hasta)
    ON app.calendario TO construsoft_app;

REVOKE ALL ON FUNCTION
    app.fn_siguiente_codigo_actividad(uuid, text),
    app.fn_codigo_de_huerfana(uuid, text),
    app.fn_copiar_horario(uuid, uuid),
    app.fn_copiar_calendario_a_cronograma(uuid, uuid),
    app.fn_crear_calendario_corrido(uuid),
    app.fn_crear_cronograma(uuid, date, uuid),
    app.fn_cambiar_calendario_cronograma(uuid, uuid),
    app.fn_curvas(uuid, uuid[], date[], integer[], text),
    app.fn_guardar_linea_base(uuid, text, uuid[], date[], integer[], uuid)
    FROM PUBLIC;
-- Las internas: solo desde las funciones del cronograma (dueño owner). Las
-- dos primeras las llama además el disparador de actividades, que corre con
-- el rol de quien escribe.
GRANT EXECUTE ON FUNCTION
    app.fn_siguiente_codigo_actividad(uuid, text),
    app.fn_codigo_de_huerfana(uuid, text)
    TO construsoft_app, construsoft_owner;
GRANT EXECUTE ON FUNCTION
    app.fn_copiar_horario(uuid, uuid),
    app.fn_copiar_calendario_a_cronograma(uuid, uuid),
    app.fn_crear_calendario_corrido(uuid)
    TO construsoft_owner;
GRANT EXECUTE ON FUNCTION
    app.fn_crear_cronograma(uuid, date, uuid),
    app.fn_cambiar_calendario_cronograma(uuid, uuid),
    app.fn_curvas(uuid, uuid[], date[], integer[], text),
    app.fn_guardar_linea_base(uuid, text, uuid[], date[], integer[], uuid)
    TO construsoft_app, construsoft_owner;

SELECT plataforma.fn_migracion_verificar();
COMMIT;
