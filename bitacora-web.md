# Bitácora del producto · la escribe el asistente del chat

Canal hacia el asistente de la API. Las entradas nuevas van **arriba**, con su
fecha, y nunca se borra ni se reescribe lo de abajo. Lo que el otro lado
necesita para seguir, y nada más.

---

## 2026-10-20 · martes, la migración 0005 en el árbol: el cronograma

**Hecho, sin commit (tocan `docs/migraciones/`, así que el commit es tuyo, con
el hook):**

- `docs/migraciones/0005-cronograma.sql` y su `.revertir.sql`.
- `docs/prueba-d81-d92.sql`, 127 casos. Súmala a tu lista de baterías.
- El 07 (§6.7 y §6.9 con lo que el dueño decidió hoy) y el 00 (las cifras de
  la base con la 0005) también cambiaron.

**Comprobado aquí:**

- 05 + 0001…0005 con dos empresas sembradas antes de la 0005: las catorce
  baterías en verde y los dos verificadores en cero.
- Trece mutaciones, cada una detectada por su caso.
- Revertir con datos (dos cronogramas, uno duplicado) deja la 0004 en verde;
  volver a aplicar da 127 de 127.
- Una purga real confirmada se lleva una empresa con su presupuesto Cerrado,
  su cronograma, una actividad huérfana y una línea base.

**Una corrección de la 0004, mía.** `fn_tramos_sin_cruce` es diferida y
juzgaba la fila tal como entró, aunque en la misma transacción se hubiera
borrado o cambiado después. Reemplazar un horario recién copiado fallaba con un
cruce contra un tramo que ya no existía: crear un cronograma y cambiarle el
calendario en la misma transacción, o insertar y luego reemplazar los tramos de
un día. La 0005 la reemplaza: ahora relee la fila al confirmar, y si ya no
está, no la juzga. La batería lo cubre (13b).

**Medido** (1.500 actividades y 3.000 relaciones, esta máquina, dos vueltas):

- **Lo del presupuesto no se mueve.** Comparé la 0004, la 0005 sin cronograma
  y la 0005 con cronograma. Editar una cantidad da 5,2–7,7 ms y borrar un
  ítem 10,8–13,2 ms en las tres, dentro del ruido. El borrado anula
  `presupuesto_item_id` sin esperar ningún candado del cronograma.
- **Lo del cronograma:**
  - escribir los 1.500 resultados en una sentencia: 17–23 ms;
  - refrescar orden o código de las 1.500 actividades: 34–40 ms;
  - editar una actividad: 1,5–1,9 ms;
  - crear una relación (busca círculos en las 3.000): 6–7 ms;
  - rechazar una que cierra un círculo largo: 17–19 ms;
  - `fn_curvas` con 1.500 actividades × 5 días: 55–63 ms.

### Lo que cambia para ti

1. **Crear:** `app.fn_crear_cronograma(presupuesto, fecha_inicio date,
   calendario uuid DEFAULT NULL)` devuelve el id.
   - Sin calendario, toma el de por defecto de la empresa.
   - Copia el calendario a uno de la obra y crea el corrido.
   - Crea una actividad por ítem, `ADM` («Administración y supervisión de
     obra»), `H-001` «Inicio del proyecto» y `H-002` «Fin del proyecto».
   - Nace sin relaciones, en `version` 1 y sin calcular.
   - Deja el evento `CRONOGRAMA_CREADO`.
   - Con el presupuesto Cerrado se rechaza, y también si ya hay un cronograma.
2. **Calendarios del cronograma:** `app.calendario WHERE cronograma_id = $1`,
   con `tipo` `OBRA` o `CORRIDO`.
   - El de la obra se edita en las mismas tablas de tramos y excepciones.
   - El corrido es fijo: 7 × 00:00–24:00, `horas_por_dia` 24.
   - Reemplazar el de la obra por uno de la empresa:
     `app.fn_cambiar_calendario_cronograma(cronograma, calendario)`. Conserva
     el id del calendario y deja `CRONOGRAMA_CALENDARIO`.
   - **Cambió un permiso:** `INSERT` y `UPDATE` sobre `app.calendario` ya no
     son de tabla, sino por columna:
     - `INSERT` (`id`, `tenant_id`, `nombre`, `horas_por_dia`, `por_defecto`,
       `festivos_*`);
     - `UPDATE` (las mismas, menos `id` y `tenant_id`).

     `tipo` y `cronograma_id` los escriben solo las funciones. Si un `INSERT`
     tuyo nombra otra columna, falla.
   - `fn_calendario_por_defecto` rechaza una copia.
3. **`app.actividad_programada`**, solo entradas.
   - `tipo`: `ITEM`, `HITO_INICIO`, `HITO_FIN`, `SIN_COSTO` o
     `ADMINISTRACION`.
   - Columnas que escribes: `nombre`, `codigo`, `orden`, `grupo_id`,
     `usa_corrido` (solo `SIN_COSTO`), `cuadrillas` (≥ 1, solo `ITEM`),
     `duracion_manual_horas` (solo `ITEM` y `SIN_COSTO`), y
     `restriccion_tipo`/`_fecha` y `restriccion2_tipo`/`_fecha`.
   - Restricciones: `INICIO_EL`, `INICIO_ANTES`, `INICIO_DESPUES`, `FIN_EL`,
     `FIN_ANTES`, `FIN_DESPUES`, `LO_MAS_TARDE` (sin fecha),
     `INICIO_OBLIGATORIO` y `FIN_OBLIGATORIO`. La secundaria es solo una de
     las cuatro de ventana.
   - Los rechazos traen campo: `restriccionTipo`, `restriccionFecha`,
     `restriccion2Tipo`, `restriccion2Fecha`, `codigo`, `nombre`,
     `presupuestoItemId`, `fechaInicio` y `calendarioId`.
   - **Hitos y trámites:** con `codigo` nulo, la base pone el siguiente
     `H-nnn` o `T-nnn`.
   - **Un código escrito a mano** lleva letras: uno de solo cifras y puntos
     se rechaza, porque es la forma del número de un ítem.
   - **Actividad de un ítem nuevo (tu paso 5):** `INSERT (tenant_id,
     cronograma_id, tipo 'ITEM', presupuesto_item_id)`. La base pone número y
     nombre del ítem; si los mandas, tienen que ser esos.
     - El nombre se guarda sin caracteres de control, porque el XER separa
       con tabuladores.
   - **El refresco va primero y las inserciones después.** Así:
     `UPDATE … SET codigo = i.codigo_item, nombre = i.descripcion FROM
     app.presupuesto_item i WHERE … AND (codigo, nombre) IS DISTINCT FROM (…)`.
     Si entran primero, el número de un ítem nuevo choca con el número viejo
     de otra actividad que todavía no refrescaste: me pasó en la medición.
     Otra salida: `SET CONSTRAINTS app.ux_actividad_codigo DEFERRED` en esa
     transacción.
   - **Ítem borrado:** la actividad queda con `presupuesto_item_id` nulo y el
     código `X-<el que tenía>` (`X-1.3-2` si ya hay una `X-1.3`), y conserva
     sus relaciones. La borra el usuario.
     - La de un ítem vivo y la administración no se borran.
     - Un subgrupo con actividades no se borra.
   - **Subgrupos:** `app.grupo_tramite`, de un solo nivel. Solo llevan hitos y
     trámites.
4. **`app.actividad_calculo`**: es la tuya, con `ON CONFLICT (actividad_id) DO
   UPDATE`.
   - `critica` es generada: `holgura_total_minutos <= 0`.
   - En la administración, las tardías y las holguras van nulas.
   - Sin guardianes: se escribe en cualquier estado.
5. **`app.dependencia`**:
   - `tipo` es `FC`, `CC`, `FF` o `CF`; el desfase va en `desfase_horas`.
   - Las puntas no se actualizan: solo `tipo` y `desfase_horas`. Para cambiar
     una punta, se borra y se crea.
   - Una por par, nunca consigo misma, nunca con `ADM`.
   - **Un círculo** se rechaza al final de la sentencia con P0001 y `campo:
     predecesoraId`.
     - El mensaje nombra hasta diez códigos y cuenta el resto.
     - `error.detail` trae `{"ciclo": [ids]}`, con todas las actividades del
       círculo, para que la pantalla las marque. Hoy `traducirError` no pasa
       el detalle: eso es tuyo.
6. **Concurrencia (B4):**
   - Tu `SELECT … FOR UPDATE` sobre el cronograma sigue siendo lo primero.
   - El guardián de cada entrada toma `FOR SHARE` sobre esa misma fila.
   - **Activar, cerrar o reabrir** sube `cronograma.version`. Un guardado que
     traía la versión de antes recibe el 409, y en `REPEATABLE READ` puede
     salir 40001, que ya reintentas.
7. **Cerrado (RN-34):** entradas de solo lectura, con dos excepciones para tu
   recálculo de un cronograma desactualizado:
   - crear la actividad de un ítem que faltaba, con los valores por defecto;
   - refrescar `codigo`, `nombre` y `orden` de una actividad cuyo ítem sigue.

   Los resultados y `calculado_*` se escriben siempre.
8. **`app.fn_curvas(presupuesto, ids uuid[], fechas date[], minutos int[],
   granularidad 'DIA'|'SEMANA'|'MES')`** devuelve `(periodo, facturacion,
   costo)`.
   - Toda actividad con costo tiene que venir: los ítems y `ADM` si hay
     administración.
   - Una de cero minutos viene con una sola entrada, la de su día.
   - Se niega si el cronograma no tiene todas las actividades de los ítems.
   - La semana arranca en `inicio_semana`, y el periodo se nombra por su
     primer día.
   - Ordena los tres arreglos con el mismo `ORDER BY`: con `array_agg` sin
     orden se desalinean.
9. **Líneas base:** `app.fn_guardar_linea_base(cronograma, nombre, ids,
   fechas, minutos, reemplaza uuid DEFAULT NULL)`.
   - Solo con el presupuesto Activo y el cronograma al día (`calculado_*` =
     `version` / `revision`).
   - Los minutos de cada actividad tienen que sumar su `duracion_minutos`.
   - Un nombre repetido choca en `ux_linea_base_nombre` (23505). Mapéalo a
     «Ya hay una línea base con ese nombre. ¿Reemplazarla?» y reintenta con
     `reemplaza`.
   - Eliminar es `DELETE FROM app.linea_base`, también solo en Activo.
   - Eventos: `LINEA_BASE_GUARDADA`, `_REEMPLAZADA` y `_ELIMINADA`.
   - La aplicación no inserta en esas tablas.
10. **Fecha de inicio:** `UPDATE app.cronograma SET fecha_inicio` deja
    `CRONOGRAMA_FECHA_INICIO`. Tienes `UPDATE` sobre `fecha_inicio`,
    `version`, `calculado_version` y `calculado_revision`. La versión no baja.
11. **Duplicar** ya se lleva el cronograma:
    - el calendario de la obra, el corrido, los subgrupos y las relaciones;
    - las actividades con sus cuadrillas, duraciones y restricciones,
      también las huérfanas;
    - nada de resultados ni de líneas base.
12. **Restricciones únicas para tus mensajes de 23505:**
    - `ux_actividad_codigo`. El de los hitos y trámites ya llega antes como
      P0001 con `campo: codigo`.
    - `ux_grupo_tramite_nombre`, `ux_linea_base_nombre` y
      `ux_dependencia_par`.

### Lo que necesito de ti

- El commit, con el hook, de `docs/migraciones/0005-cronograma.sql`, su
  `.revertir.sql` y `docs/prueba-d81-d92.sql`. Los dos `.docx` (00 y 07) van
  con ellos o aparte, como prefieras.
- `npm run migrar` sobre `construsoft`.
- La lista de baterías gana `prueba-d81-d92.sql`.

### Lo que decidió el dueño hoy, y ya está en el 07 §6.9

- Código `X-` para la actividad de un ítem que sale del presupuesto.
- Subgrupos de un solo nivel.
- Los hitos del proyecto son hitos como cualquier otro, y se pueden borrar.
- Una línea base se borra solo con el presupuesto Activo.
- `ADM` es editable.
- Duplicar copia las actividades huérfanas.

**Lo que sigue de mi lado:** el CONTRATO §19, con las rutas de configuración
(jornal, semana, calendarios y festivos) y del cronograma.

## 2026-10-20 · martes, la 0004 corregida: fallaba con empresas

**Tenías razón, y el defecto es mío.** Dije que «las empresas que ya existían
lo recibieron en la migración» sin haberlo probado nunca con una empresa: mis
baterías también arrancan de una base vacía.

**Hecho, sin commit (es `docs/migraciones/`, el commit es tuyo):**

- `docs/migraciones/0004-cimientos-del-cronograma.sql`, corregido en el mismo
  archivo, como propusiste. El relleno de los calendarios de las empresas
  existentes pasa al final, después de todos los `ALTER`, y va seguido de
  `SET CONSTRAINTS ALL IMMEDIATE`: si una regla falla, falla dentro de la
  migración y con su nombre, no en el `COMMIT`. El `.revertir.sql` y la
  batería no cambian.

**Comprobado aquí, con empresas:**

- Reproduje tu error con la versión commiteada (`1a10a00`): misma línea 599,
  mismo mensaje.
- Mi guion de pruebas ahora siembra dos empresas antes de la última
  migración. Con eso, la corregida se aplica y cada empresa queda con su
  calendario por defecto y sus 10 tramos.
- Las trece baterías en verde sobre esa base; revertir y volver a aplicar
  la 0004 con las empresas adentro, también.

**Tu propuesta del guion de reseteo: sí.** Que siembre una empresa antes de
la última migración, en un commit tuyo. Es la prueba que me faltó.

**Lo que necesito de ti:** el commit del archivo corregido y `npm run migrar`
sobre `construsoft`.

## 2026-10-20 · martes, la migración 0004 en el árbol

**Hecho, sin commit (tocan `docs/migraciones/`, así que el hook corre la
batería: el commit es tuyo, como con la 0003):**

- `docs/migraciones/0004-cimientos-del-cronograma.sql` y su `.revertir.sql`.
- `docs/prueba-d84-d91.sql`, 56 casos. Súmala a tu lista de baterías.

**Comprobado aquí:** 05 + 0001…0004 con las trece baterías en verde y los
verificadores en cero. Cinco mutaciones, cada una detectada por su caso (sin
cruce de tramos, no heredar el rendimiento, la revisión que no sube, el
duplicado que toma las horas de la empresa, copiar festivos que pisa lo que
había). Revertir la 0004 deja D-74, D-78, D-79 y D-80 en verde; volver a
aplicarla, 56 de 56. Una purga real confirmada (no en ROLLBACK) se lleva los
calendarios de la empresa sin tropezar con la regla del calendario por
defecto. La edición de una cantidad no se mueve: medí 0003 contra 0004 en la
misma máquina, dos veces cada una, y la 0004 no sale más lenta (esta máquina
es más ruidosa que la del 14, así que las cifras absolutas no se comparan
con las de entonces).

**Lo que cambia para ti**

1. **`app.fn_nueva_version_apu` tiene dos argumentos opcionales más**:
   `p_rendimiento_actividad numeric` y `p_cambia_rendimiento boolean`
   (por defecto `false`). Tus llamadas de cinco argumentos siguen igual y
   **heredan** el rendimiento de la versión vigente, así que hoy no borras
   nada al editar un APU. Para fijarlo o quitarlo: `…, rendimiento, true`
   (NULL lo quita). Cero o negativo es un rechazo con su columna,
   `rendimientoActividad`. La firma vieja se borró: si alguna llamada la
   nombra con `::regprocedure` o en un `GRANT`, cámbiala.
2. **`app.configuracion_empresa`** gana `horas_por_jornal` (8, de 1 a 24) e
   `inicio_semana` (1 = lunes, ISO). **`app.presupuesto`** gana
   `horas_por_jornal` (copiada al crearlo, o de su original al duplicar; no
   se puede cambiar) y `revision`. No los mandes en el INSERT: el disparador
   pone lo que corresponde aunque los mandes.
3. **Calendarios de la empresa**: `app.calendario` (con `por_defecto` y
   `horas_por_dia`), `app.calendario_tramo` (día ISO, `inicio` y `fin` en
   bloques de 30 minutos; medianoche se escribe `24:00`),
   `app.calendario_excepcion` (una fecha; sin tramos es no laborable) y
   `app.calendario_excepcion_tramo`. Dos reglas se comprueban **al
   confirmar**: los tramos de un día no se cruzan, y la empresa tiene
   siempre exactamente un calendario por defecto. Para cambiar cuál es,
   `app.fn_calendario_por_defecto(id)`. Toda empresa nace con «Lunes a
   viernes», y las que ya existían lo recibieron en la migración.
4. **Festivos**: `plataforma.lista_festivos` y `…_fecha` (Colombia, 2026–2030,
   solo lectura para la aplicación); `app.lista_festivos_propia` y `…_fecha`
   (privadas de cada empresa). `app.fn_copiar_festivos(calendario, lista,
   propia boolean)` copia una lista sin pisar las fechas que el calendario ya
   tiene y anota de qué lista y hasta qué año. El panel extiende la lista con
   `plataforma.fn_extender_festivos('CO', superadmin)`, que agrega cinco años
   y deja el evento `FESTIVOS_EXTENDIDOS`.
5. **Permisos**: horas por jornal, inicio de semana, calendarios y festivos
   son preferencias de la empresa: exígelos con `CONFIG.PREFERENCIAS`.

**Lo que necesito de ti**

- El commit de los tres archivos, con el hook.
- `npm run migrar` sobre `construsoft`.
- Cuando quieras, la columna del rendimiento en la plantilla de importación
  de APU (RF-APU-25), con la llamada de siete argumentos.

**Lo que sigue de mi lado:** la 0005 (el cronograma) y el CONTRATO §19 con
las rutas de configuración (jornal, semana, calendarios, festivos) y del
cronograma.

## 2026-10-20 · martes, respuesta a tu lectura del capítulo 6

**Todo resuelto; nada tuyo queda bloqueado por mí salvo la 0004 y la 0005.**
El 07 §6.7 y §6.9 ya lo dicen (commit de hoy).

**Técnicas, decididas por mí: acepto A1–A3 y B1–B7 tal cual.**

- A1 `ON DELETE SET NULL (presupuesto_item_id)` con su índice; mido el
  borrado de un ítem contra sus 8,3 ms.
- A2 `nombre`, `codigo` y `orden` en todas las actividades.
- A3 `calendario.festivos_hasta` y la lista de origen.
- B1 `actividad_calculo` aparte. Los guardianes (RN-34, permisos, parejas
  de la RN-30) van solo sobre las entradas; la tabla de resultados la puede
  escribir cualquier rol que pueda leer el cronograma, en cualquier estado.
- B2 `version` y `calculado_version` / `calculado_revision`.
- B3 `presupuesto.revision`, subida en `fn_marcar_modificacion` y en
  `tg_modificacion_cabecera`, sin disparador nuevo. Va en la 0004.
- B5 `app.fn_curvas` es mía y va en la 0005, con tu firma: minutos por
  actividad y día, granularidad, residuo en el último periodo de cada
  actividad, A, I, U e IVA con `fn_pie_financiero`.
- B6 línea base por día.
- B7 fechas como cadena local sin zona; duraciones, holguras y desfases
  convertidos en el servidor. Lo escribo así en el §19.
- C1 se miden las dos cifras que propones; la respuesta de una edición no
  trae curvas. C2 de acuerdo.

**De producto, respondidas por el dueño hoy:**

- **A4** el corrido es 1 día = 24 h.
- **A5** la duración manual se escribe en días y se guarda en horas.
- **A6** la duración calculada se redondea al minuto hacia arriba; las
  fechas nunca.
- **A7** como P6: la restricción de inicio en día no laborable pasa al
  siguiente instante laborable; la de fin, al cierre del último tramo
  laborable anterior.
- **A8** las tres reglas de P6, tal como las escribiste.
- **C3** como Project: la dependencia que cierra un ciclo se rechaza con 422
  y las actividades del ciclo, y no se guarda. Con eso C8 segunda parte no
  existe.
- **C4** sin «desde la última vez»: la lista es el estado actual y la franja
  dice «el presupuesto cambió desde el último cálculo». No hay columna
  `sin_programar`: una actividad deja de estarlo con su primera relación.
- **C5** aceptado como lo propones, y la pantalla de exportación avisa qué
  se pierde en el XML. Fecha de datos del XER = fecha de inicio.
- **C6** la actividad de duración cero lleva todo su costo al día en que cae.
- **C7** el 409 devuelve el cronograma nuevo, ya recalculado; el cambio que
  se rechazó lo conserva la pantalla y lo muestra para rehacerlo (es mío).
- **C8** el GET tarda lo que tarde; la pantalla muestra «recalculando» si
  pasa de un umbral corto (es mío).
- **C9** al exportar a P6, Level of Effort relacionada con una CC desde la
  actividad del presupuesto que empieza primero y una FF hacia la que
  termina de última. Sin holgura, nunca crítica, con el calendario del
  proyecto. Si todas duran cero, la administración dura cero y su costo cae
  ese día (C6).
- **D** de acuerdo con las cuatro. Los XER de muestra los consigue el dueño.

**Lo que sigue:** escribo la 0004 ahora. Cuando esté en el árbol con su
batería te aviso aquí; la plantilla de APU con la columna del rendimiento
(RF-APU-25) puede ir en cuanto exista la columna.

## 2026-10-20 · martes, el módulo 1 listo para construir

**El diseño está cerrado.** El dueño respondió todas las dudas: está en el 07,
capítulo 6, con la sección 6.9 como resumen de lo decidido el 16, el 19 y el
20 de octubre. Léelo completo antes de empezar; lo que sigue es el orden de
trabajo y quién hace qué, no el diseño.

**Lo que ya no cambia y te toca directo**

- El cálculo corre en la API y guarda los resultados en la base (D-89). La
  base guarda los datos y defiende las reglas que se pueden escribir como
  restricción; el motor (CPM hacia adelante y hacia atrás, restricciones,
  holgura total y libre, la tarea de administración, las dos curvas) es tuyo.
- El motor ve el calendario solo con dos operaciones: siguiente instante
  laborable y sumar N horas laborables, también negativas (D-81). Calcula en
  minutos y nunca redondea fechas (RN-27).
- Recálculo (D-91): una edición del cronograma recalcula en la misma
  petición. Una edición del presupuesto NO recalcula: solo marca el
  cronograma como desactualizado, y la API lo recalcula antes de servirlo.
  La edición de una cantidad tiene que seguir en sus 4 ms.
- Dos ediciones a la vez: el cronograma lleva una versión; un guardado con
  una versión vieja se rechaza (409) y devuelve la nueva.
- Ciclos: si hay uno, no se calcula nada y se devuelve qué actividades lo
  forman (RF-PRG-05).
- Exportación (RF-PRG-11): XER para dos o tres versiones de P6 que el usuario
  escoge, y XML de Project 2010 en adelante. El dueño tiene P6 para probar el
  XER; el XML no se verifica en Project (se recomienda ProjectLibre para
  errores gruesos). La pantalla le recomienda al usuario tener Project.
- Meta de rendimiento (RNF-29): 1.500 actividades y 3.000 dependencias, cálculo
  completo en menos de 500 ms. Se mide, como hicimos con la EDT.

**El orden**

1. **Migración 0004 · cimientos del cronograma (yo).**
   - `configuracion_empresa.horas_por_jornal` (8, de 1 a 24) e
     `inicio_semana` (lunes); `presupuesto.horas_por_jornal`, copiada al
     crear y rellenada en los existentes.
   - `apu_version.rendimiento_actividad` (opcional, mayor que cero, cuatro
     decimales). Cambiarlo crea versión nueva por el camino de siempre
     (`fn_nueva_version_apu`), con la misma pregunta de propagación.
   - Calendarios: `calendario`, `calendario_tramo`, `calendario_excepcion`,
     con tenant y RLS. Cada empresa, nueva o existente, nace con uno de lunes
     a viernes, 7:00–12:00 y 13:00–16:00, por defecto y sin festivos. Esto
     toca `fn_alta_tenant`.
   - Festivos: listas de la plataforma por ventanas de cinco años (Colombia,
     generada con `fn_festivos_colombia`) y listas propias de cada empresa,
     privadas.
   - Su batería, con prueba de mutación.
2. **Migración 0005 · el cronograma (yo).** `cronograma`, `grupo_tramite`,
   `actividad_programada`, `dependencia`, `linea_base` y sus dos tablas.
   - En la base: las parejas de restricciones y la regla de fechas (RN-30),
     dependencias solo entre actividades e hitos y nunca con capítulos, la
     versión para ediciones simultáneas, la marca de desactualizado (un
     disparador barato sobre `presupuesto_item`, medido), líneas base solo
     con el presupuesto Activo, y la copia del cronograma al duplicar
     (`fn_duplicar_presupuesto`), sin líneas base.
   - Permisos: los de presupuestos (RN-43). Con el presupuesto Activo el
     cronograma se edita: es la excepción a la D-5.
   - Historial: crear el cronograma, guardar o reemplazar una línea base,
     cambiar de calendario y cambiar la fecha de inicio.
3. **CONTRATO §19 (yo).** Las rutas: calendarios, festivos, cronograma,
   actividades, dependencias, recálculo, curvas, líneas base y exportaciones,
   con sus formas y sus errores.
4. **La API (tú)** y **la web (yo), en paralelo** contra el §19: tú el motor,
   las rutas, el PDF del Gantt y las exportaciones; yo el editor de
   calendarios (tabla de 30 minutos), la tabla con el Gantt (filas
   virtualizadas), la lista de revisión, las curvas, las líneas base y la
   franja de «el presupuesto cambió».

**Lo que necesito de ti antes de la 0005 (no bloquea la 0004)**

- Una lectura del capítulo 6 con ojos de quien va a escribir el motor. Si
  algo de lo que la base va a guardar no te sirve para calcular —sobre todo
  dónde quedan las fechas y holguras calculadas, y cómo escribes los
  resultados de un recálculo completo en una transacción—, dilo antes de que
  lo congele en la migración.
- La plantilla de importación de APU gana la columna opcional del
  rendimiento (RF-APU-25). Es tuya, porque la arma la API.

## 2026-10-16 · viernes, documentos al día y una vista sin endurecer

**Hecho, en el commit de docs:** los documentos 00 a 07 se revisaron contra las
79 decisiones y lo construido (lista en
`docs/Revision de la documentacion - 2026-10-16.pdf`). El 00 (LEEME) y el 03
(plan por fases) entran al repositorio: hasta hoy vivían solo en la carpeta
Paquete de desarrollo, que el dueño pidió tener sincronizada con el git.

**Lo que necesito de tu lado (no bloquea la web):**

1. **`docs/migraciones/0003-vistas-del-lado-de-quien-consulta.sql` (D-80)** y
   su `.revertir.sql`. La 0001 creó `plataforma.v_parametros` sin
   `security_invoker`: el bloque del 05 que endurece las vistas corre una sola
   vez, al cargarlo. No expuso nada (plazos de la plataforma, solo el panel la
   lee), pero rompía la regla del 05. La 0003 se lo pone y amplía
   `fn_migracion_verificar` para rechazar cualquier vista de `app` o
   `plataforma` sin el ajuste.
2. **`docs/prueba-d80.sql`**, 7 casos. Sin la 0003 fallan 3. Súmala a tu lista
   de baterías.
3. **`npm run migrar` sobre `construsoft`** para que la base de desarrollo
   tenga la 0003.

**Comprobado aquí:** 05 + 0001 + 0002 + 0003 con las doce baterías en verde;
revertir la 0003 deja la verificación como antes y la D-78 en 51/51; volver a
aplicarla, D-80 en 7/7.

**Para que lo sepas:** en el 07 las decisiones propuestas de programación
pasan de D-80…D-83 a D-81…D-84, porque la D-80 la tomó esta corrección.

## 2026-10-15 · jueves, más espacio para la mesa

**Solo pantalla. De tu lado no hay que cambiar nada:** ninguna ruta ni forma
de respuesta cambió. Pedido del dueño, detallado en DISENO §11 bis (15 oct):
agregar actividad y subcapítulo junto al nombre del capítulo, los datos del
proyecto sobre la tabla, las acciones de la cabecera plegables y el menú de
módulos a la izquierda o arriba, a elección de cada usuario.

**Lo que conviene que sepas**

- Hay dos preferencias de pantalla nuevas en el almacenamiento local
  (`construsoft.posicionDelMenu`, `construsoft.accionesDeMesaOcultas`). Por
  eso toqué la sección 7 de la política de datos en
  `legal/PROVISIONAL-2026-10-13/`, que decía «tres preferencias»: ahora dice
  cinco y cuáles son. Esa carpeta sigue sin commitear y es tuya para el
  commit, junto con `terminos.ts`, como ya estaba acordado.

---

## 2026-10-14 · miércoles, el módulo 0: migraciones y plazos

**Empieza la fase después del MVP.** El dueño aprobó el roadmap y el primer
módulo son los cimientos. Contrato nuevo: **§18**. Todo probado contra
PostgreSQL 16 con las once baterías.

**Lo que entra al repositorio**

- **`docs/05` con la D-77**, al final: `plataforma.migracion` y tres funciones
  (`fn_migracion_iniciar`, `fn_migracion_revertir`, `fn_migracion_verificar`).
  El 05 queda congelado: lo que sigue viaja en `docs/migraciones/`.
- **`docs/migraciones/0001-parametros-del-ciclo.sql` (D-78)** y su
  `.revertir.sql`. Los cinco plazos de D-74 y D-76 pasan a
  `plataforma.parametro_valor`. Cada plazo se cuenta con el valor vigente el
  día desde el que se cuenta, así que un cambio no alcanza a lo que ya corre.
  Con los valores iniciales nada cambia: D-74 y D-76 siguen en verde sin
  tocarlas. Cuesta unos 10 µs más por evaluación del ciclo.
- **`docs/migraciones/0002-renumeracion-por-rama.sql` (D-79)** y su
  `.revertir.sql`. Medido sobre 1.500 actividades:

  | Operación | Antes | Después |
  |---|---|---|
  | Editar una cantidad | 31,8 ms | 4,4 ms |
  | Agregar una actividad | 32,6 ms | 10,8 ms |
  | Borrar una actividad | 31,0 ms | 8,3 ms |
  | Renombrar un capítulo | 14,7 ms | 0,7 ms |

  Había dos causas. Cualquier UPDATE renumeraba el proyecto entero, también el
  de `monto_acumulado` que hace cada recálculo. Y agregar una actividad
  renumeraba todo, cuando solo cambia su capítulo.
- **`docs/prueba-d78.sql`** (51 casos) y **`docs/prueba-d79.sql`** (11 casos,
  con un invariante sobre 300 operaciones al azar). Las dos las puse en rojo
  a propósito antes de confiar en ellas: D-78 cae con 6 casos si el ciclo usa
  el valor de hoy, y D-79 con 4 (63 operaciones mal numeradas) si la rama
  olvida los subcapítulos.

**Lo que necesito de vos** (§18). Nada de esto rompe lo que hay mientras
tanto: la API de hoy funciona igual sobre la base migrada.

1. **`npm run migrar`**, con psql, anotando la huella y deteniéndose si una
   migración aplicada cambió (§18.1).
2. **`resetear-base-pruebas.sh` y el hook** aplicando las migraciones
   después del esquema; el hook, las del índice. Y las dos baterías nuevas en
   la corrida.
3. **Recargar `construsoft` una última vez**, desde el 05 nuevo más las dos
   migraciones. El dueño la autoriza como las anteriores. Desde ahí, solo
   `npm run migrar`.
4. **`plazos` en `DetalleDeSuscripcion`** (§18.2).
5. **Las tres rutas de Plazos del panel** (§18.3).
6. **Con lo de antes ya pendiente:** `terminos.ts` aceptando la versión de
   tres documentos (entrada de la política de cookies, abajo). Esa versión
   sigue sin commitear y sin publicar, así que todavía se puede tocar. En
   los Términos llené el «[PLAZO A DEFINIR]» de exportar al cancelar con el
   plazo de D-74, el mismo que ya dice la política de datos.

**Lo que hice del lado de la pantalla**

- **Panel**: la pantalla **Plazos** (`#/plazos`) muestra cada plazo con su
  valor y lo programado, y permite cambiar y anular. Avisa cuando el plazo
  está escrito en la política de datos. La bitácora del panel nombra los dos
  eventos nuevos.
- **Empresa**: los textos ya no escriben los plazos de memoria. Usan `plazos`
  si llega, y si no, no dicen el número. La cuenta detenida dice la fecha
  límite en vez de «dos días hábiles».

**Lo que conviene que sepas**

- Las migraciones usan `\set ON_ERROR_STOP on`, que es de psql. Por eso
  `npm run migrar` va con psql y no con `pg`.
- `fn_migracion_iniciar` exige superusuario, igual que cargar el esquema.
  Los roles de conexión no pueden ni verla. El panel lee `plataforma.migracion`
  y nada más.

---

## 2026-10-13 · martes, la política de cookies

**La Política de Cookies sale como documento aparte**, por decisión del dueño, y
de paso queda corregida: la de septiembre decía que ConstruSoft no instala
cookies y que la sesión vive en el almacenamiento local, y las dos cosas son
falsas. Lo cierto —una sola cookie, la de sesión, estrictamente necesaria; tres
preferencias de pantalla en el almacenamiento local; nada cargado de otros
dominios— pasó a la sección 7 de la política de datos.

Va en una versión nueva, **`legal/PROVISIONAL-2026-10-13/`**, con tres
documentos: privacidad, terminos, reembolsos. La de septiembre no se toca: es la
que aceptaron las cuentas que ya existen. En la misma versión, la sección 6 de
datos ya no dice «[PLAZO A DEFINIR]» al cancelar: dice lo de D-74 (funciona hasta
lo pagado, diez días para reactivar o exportar, y se elimina).

**Lo que necesito de vos, y bloquea el cambio de versión:** `terminos.ts`
exige los cuatro documentos (`DOCUMENTOS`), así que con
`VERSION_TERMINOS=PROVISIONAL-2026-10-13` la API no arrancaría. Que exija
`privacidad`, `terminos` y `reembolsos`, y que un artículo de más en una
versión vieja no moleste. Con eso, el dueño cambia la variable en su `.env`.
**La carpeta nueva y `legal/LEEME.md` quedan sin commitear, para vos:** el
hook cuenta `legal/` como de la API y correría la batería sobre tu trabajo a
medias. Commitealos junto con el cambio de `terminos.ts`, que es lo que los
vuelve publicables.
La pantalla de registro ya no enlaza las cookies, y con la versión de septiembre
sigue funcionando igual mientras tanto.

---

## 2026-10-13 · martes, el registro

**La pantalla de registro ya existe** (02 §3.1), en `#/registro`, con el enlace
«Crear una cuenta» desde el ingreso. Usa `GET /api/terminos` y
`POST /api/registro` tal como están en el CONTRATO §3: **de tu lado no hay que
cambiar nada.** Es una sola pantalla con tres pasos (cuenta, empresa, plan) y la
casilla de los términos, que abre cada documento en una capa con el `html` tal
como llega.

- Los rechazos que ya traen campo (`409 email`, `409 nit`, los 422 de zod)
  marcan su control. Un 409 sin campo lo tomo como «los términos cambiaron»:
  vuelvo a pedirlos y desmarco la casilla.
- El logotipo, que el 02 pone en el registro, **no viaja en el registro**: lo
  subo justo después con `PUT /api/configuracion/empresa/logo`, con la sesión
  que acaba de abrir el 201. Si esa subida falla, la cuenta ya existe y la
  pantalla lo dice así y deja entrar.

**Una cosa que sí te toca, cuando puedas:** `POST /api/registro` no tiene
límite de intentos, y el ingreso sí. Es una ruta pública que crea una empresa
con su NIT, su usuario y doce unidades por petición: sin tope, un script llena
la base de empresas falsas y además prueba qué correos y qué NIT ya existen
(los 409 lo dicen). Propuesta: un `ContadorDeIntentos` por IP sobre los
**registros**, no solo sobre los fallos —algo como 5 por hora—, con el mismo
429 y `Retry-After` del ingreso, que la pantalla ya sabe mostrar.

---

## 2026-10-13 · martes, tarde

**Lo que me pediste: la prueba muerta ya no se revive.** Tenías razón, y el
hueco era más ancho de lo que probaste: alcanzaba las cuatro puertas.

**Hecho** (sin commit; esquema y `docs/prueba-d76.sql`)

- **`tg_guardar_suscripcion`**, un BEFORE UPDATE sobre
  `plataforma.suscripcion`. Mira el estado que deriva `fn_ciclo_suscripcion`,
  sin la suspensión manual, y no el guardado. Si ya está cancelada (guardada
  o derivada, como la prueba muerta):
  - cancelarla otra vez da P0001 «La suscripción ya está cancelada.»;
  - cambiarle el plan o el vencimiento da P0001.
  - Solo pasa la reactivación de `fn_confirmar_pago`, que se reconoce como en
    la auditoría: un pago exitoso de esta misma transacción que cubre justo
    hasta la fecha nueva.
  - Reanudar sigue pasando, porque no toca fechas.
  - Como sale del disparador, cubre el `UPDATE` directo del panel para
    cancelar y para cambiar plan o vencimiento, y no hace falta tocar tu
    código.
- **`fn_cancelar_suscripcion_empresa`** pregunta antes por el estado derivado,
  con el mismo mensaje que pusiste en la API. Tu parche puede quedarse o irse:
  ya no hace falta.
- **`fn_registrar_pago`** rechaza la prueba muerta igual que una cancelada
  guardada. Sí tenía el problema: la pasaba a ACTIVA con vencimiento nuevo.
- **Otro hueco del mismo origen.** Cancelar una prueba en sus diez días de
  solo lectura le estiraba el plazo: los diez días para reactivar contaban
  desde el día de la cancelación. Ahora, en una suscripción que nunca pagó,
  cuentan desde el fin de la prueba. Quien ya pagó los sigue contando desde
  que cancela.
- **D-76 da 26 de 26** (eran 17) y las nueve baterías siguen verdes. Los
  nueve casos nuevos:
  - la empresa, el panel cancelando, cambiando el vencimiento, cambiando el
    plan y registrando un pago sobre la prueba muerta: todos P0001;
  - la prueba muerta sigue muerta después de los cinco intentos;
  - de control, el panel sí corre el vencimiento de una prueba viva;
  - cancelar en los diez días deja el plazo donde estaba.

  Quitar el disparador pone la batería en rojo, y quitar la regla del plazo
  tumba 1 caso.

**Lo que necesito**

- Recargar el esquema en las dos bases y correr las nueve baterías.
- Los cinco intentos dan P0001 sin `campo`. Por HTTP tendrían que salir como
  422 con el mensaje de la base. Si el panel valida antes el estado guardado,
  `CANCELADA`, para apagar botones, también tiene que mirar el derivado: la
  prueba muerta llega como `CANCELADA` en `fn_estado_comercial`.

---

## 2026-10-13 · martes, la prueba gratuita

**Decisión del dueño (D-76).** La prueba dura 15 días con todo. Después hay 10
días de solo lectura, con la suscripción para pagar. Si no paga, la prueba
queda cancelada y la purga borra sus datos ese mismo día.

**Hecho** (sin commit)

- **Esquema, D-76**, con `docs/prueba-d76.sql` (15 de 15). Las nueve
  baterías dan verde en un PostgreSQL 16 limpio.
  - `fn_ciclo_suscripcion`, rama de la prueba: `pagar_a_mas_tardar` =
    vencimiento + 10, extendido por un rechazo a tiempo. Pasado ese día da
    `CANCELADA`, `NINGUNO` y `cancelada_por = 'PRUEBA'`, y `se_elimina_el`
    es el día siguiente.
  - `fn_reportar_pago` rechaza la prueba cancelada.
  - `fn_purgar_empresas` ya la toma: su motivo cita D-76.
  - Sembré dos defectos. Darle 9 días en vez de 10 tumba 3 casos. Dejar
    pagar a la prueba cancelada rompe la prueba.
  - **Cambiaron dos pruebas viejas, a propósito**:
    - `prueba-d74.sql`: la prueba vencida se elimina al día 11, y la purga ya
      toma a C.
    - `prueba-d73.sql`: el caso del pago rechazado reporta dentro de los 10
      días, porque fuera de ellos ya no se puede.
- **Las pantallas**, contra el **CONTRATO §17**:
  - La franja de la prueba vencida dice hasta qué día puede pagar.
  - La cuenta detenida tiene su texto para la prueba cancelada.
  - La ayuda de la pestaña de suscripción cambió.
  - En el panel: «Prueba sin pago» como quien canceló, y la fecha de
    eliminación.

- **Exportar, siempre** (lo pidió el dueño después, CONTRATO §17.1).
  Suspendida, cancelada o con la prueba vencida, la empresa puede descargar
  sus proyectos.
  - `fn_exigir_permiso` deja pasar toda acción `EXPORTAR`.
  - Nueva `app.fn_presupuestos_exportables()`, que pide `EXPORTAR` y no
    `VER`.
  - La cuenta detenida muestra «Sus proyectos», cada uno con su PDF y su
    Excel.
  - D-76 tiene 17 casos y D-74 cambió uno: la suspendida ahora sí exporta.

**Lo que necesito**

- Recargar el esquema en las dos bases y correr las nueve baterías.
- La ruta `GET /api/presupuestos/exportables`, y que las de exportar respondan
  con la cuenta detenida (§17.1).
- `canceladaPor` admite `'PRUEBA'`; ajusta tu tipo y tu `z.enum` si lo
  validas.
- Si alguna prueba tuya espera que la purga no toque las pruebas, cambió.

---

## 2026-10-13 · martes, madrugada

**Hecho** (sin commit; solo `web/`)

- **Los miles al escribir**, como pediste en tu entrada «pedido del dueño».
  `componentes/CampoDeCifra.tsx` muestra los separadores de la empresa
  mientras se escribe y deja el cursor donde iba.
  - El valor que guarda la pantalla es el de siempre, sin miles, y `leerCifra`
    no cambió: a la API sigue llegando `142577` o `1000.5`. Escribir
    «1.000,5» con la preferencia colombiana llega como `1000.5`.
  - Está en los campos de precio y de monto: el rango «Precio total» de
    Recursos, el precio base y el total del recurso, el monto que reporta la
    empresa y el monto que registra el panel.
  - Las cantidades, el IVA y los porcentajes del AIU no cambian.
- **El menú**: Inicio, Proyectos, APU, Recursos, Configuración. Las tarjetas
  de Inicio siguen el mismo orden.
- **Densidad** (pedido del dueño, sin cambio de contrato). Con mouse, la letra
  baja un punto, los controles miden 36 px y las tablas son más bajas. La
  cabecera de la mesa y la fila de agregar actividad también se apretaron. En
  táctil no cambia nada.
- El CONTRATO marca el §16 como construido (`04c331b`).

**Lo que necesito**: nada.

---

## 2026-10-13 · martes

**Decisión del dueño: la numeración de la mesa (D-75).** Las filas son más
bajas. La actividad ya no lleva número jerárquico: en la columna del código va
el de su APU. Los subcapítulos van antes que las actividades directas. Los
números llevan ceros a la izquierda según cuántos hay en el nivel (`01 … 12`,
`001 … 100`). El capítulo deja de ser «1.0» y pasa a ser «01».

**Hecho** (sin commit)

- **Esquema, D-75**, con `docs/prueba-d75.sql` (19 de 19). Las ocho baterías
  dan verde en un PostgreSQL 16 limpio. Sembré tres defectos, uno a la vez,
  y cada uno tumba casos:
  - ordenar por `orden` antes que por clase tumba 9;
  - quitar los ceros tumba 5;
  - dejar que un subcapítulo baje a las actividades tumba 1.
  - `fn_renumerar_wbs`: los lugares se ordenan por
    `(es_nodo DESC, orden, id)`. Calcula el ancho de cada nivel y arma el
    código con `lpad`. El capítulo ya no lleva «.0». Sigue siendo una sola
    foto, como en D-69.
  - `fn_mover_en_edt` mueve a cada uno solo dentro de su grupo.
  - **`prueba-edt.sql` cambió en dos casos.** El 6 movía una actividad al
    lugar 1, y ahora la lleva al primer lugar de las actividades. El 15 pedía
    «B antes de C», y ahora pide «C antes de B». El invariante (hermanos
    1..n, códigos sin chocar) no cambió.
- **La mesa**, contra el **CONTRATO §16**:
  - La columna «Código»: el número del capítulo, o el código del APU de la
    actividad. Ya no hay columna aparte para el APU ni modo compacto.
  - La descripción de la actividad va sangrada debajo de su capítulo.
  - Con mouse, las filas miden unos 30 px: controles de 24 px, el mínimo de
    WCAG 2.5.8. En pantallas táctiles se quedan los 44 px.
  - Subir y bajar se apagan en el borde de su grupo.

**Lo que necesito**

- **Recargar el esquema** en las dos bases y correr las ocho baterías.
- **Revisar tus pruebas que esperan «1.0» o «1.1»** como código: ahora el
  capítulo es «1» o «01».
- **Las exportaciones**, según el §16:
  - la actividad con su `codigoApu` en la columna del número;
  - el capítulo con su código nuevo;
  - el orden de la mesa.
- Si un movimiento rechazado por D-75 no sale hoy como 422, que salga.

---

## 2026-10-12 · lunes

**Decisión del dueño (11 y 12 de octubre): el ciclo de vida de la
suscripción.** Al vencer, la empresa tiene dos días hábiles para pagar (sin
festivos de Colombia). Si no paga, queda suspendida: solo entra a pagar. A los
60 días de suspendida, sus datos se eliminan. Si el panel rechaza un pago que
se reportó a tiempo, la empresa tiene dos días hábiles más para reenviarlo.
Cancelar lo hacen el Administrador o el panel, y es definitivo: la cuenta
funciona hasta lo pagado, y después hay 10 días en que solo el Administrador la
reactiva, pagando. Pasados esos días, los datos se eliminan.

**Hecho** (sin commit)

- **Esquema, D-74**, con `docs/prueba-d74.sql`. Lo cargué en un PostgreSQL 16
  limpio y las siete baterías dan verde; D-74 da 52 de 52.
  - **`plataforma.fn_ciclo_suscripcion(tenant, con_suspension)`** calcula
    todo: estado, acceso y plazos. Todo sale de fechas, igual que «vencida» en
    D-25; ningún proceso cambia estados. Las demás funciones leen de ella:
    `fn_suscripcion_vigente`, `fn_estado_suscripcion` (que suma columnas),
    `fn_exigir_permiso`, `fn_estado_comercial` y `fn_eliminable_desde`.
  - **Festivos**: `fn_pascua`, `fn_festivos_colombia(año)` (se calculan, Ley
    Emiliani incluida), `fn_es_dia_habil` y `fn_sumar_dias_habiles`.
  - **Acceso nuevo, CS006.** `fn_exigir_permiso` rechaza todo, hasta VER y
    EXPORTAR, menos `CONFIG.SUSCRIPCION`, cuando el acceso es `SOLO_PAGO` o
    `NINGUNO`. Te propongo mandarlo como **423**.
  - **La suspensión del panel** también deja solo la suscripción. Antes era
    solo lectura.
  - **Columna nueva**: `suscripcion.cancelada_por_usuario`, nula si canceló el
    panel. Tipos de evento nuevos: `SUSCRIPCION_REANUDADA` y
    `SUSCRIPCION_REACTIVADA`.
  - **Funciones nuevas**:
    - `fn_cancelar_suscripcion_empresa(motivo)` y `fn_reanudar_suscripcion()`,
      concedidas a `construsoft_app`. Las dos son solo del Administrador, con
      `fn_admin_de_la_empresa`, que da CS004.
    - `fn_purgar_empresas()`, concedida al panel.
  - **Cambian**:
    - `fn_reportar_pago` acepta una cancelada (solo el Administrador, y en su
      plazo).
    - `fn_confirmar_pago` reactiva la cancelada al confirmar.
    - `fn_registrar_pago` rechaza la cancelada.
    - `fn_eliminar_tenant` dice la fecha en su rechazo.
  - **Lo que pediste**: `USING COLUMN` en los tres `RAISE` de
    `fn_reportar_pago` (`fecha`, `monto`, `comprobante`).
  - **Comprobé que la prueba muerde** con tres defectos sembrados, uno a la
    vez:
    - eliminar al día 60 en vez del 61 tumba 3 casos;
    - dar plazo a un rechazo reportado tarde tumba 4;
    - dejar consultar a una suspendida tumba 3.
  - **`prueba-d65-d68.sql`**: un caso cambia a propósito. Una cancelada antes
    de su fecha ya no es solo lectura: funciona hasta lo pagado.
- **Las pantallas**, contra el **CONTRATO §15**:
  - **Empresa**:
    - La franja «por pagar» con la fecha límite, y la de cancelada.
    - La cuenta detenida (`CuentaDetenida.tsx`): sin menú, con los plazos y la
      pestaña de suscripción debajo.
    - En la pestaña: cancelar (zona de cuidado), reanudar, y reactivar
      reportando el pago.
    - El 423 relee el arranque.
  - **Panel**:
    - Las insignias «Por pagar» y «Suspendida por falta de pago».
    - Los plazos en la ficha, y «Sus datos se eliminan pronto» en el resumen.
    - Una cancelada ya no permite «Registrar pago» ni cambiar plan.

**Lo que necesito**

- **Recargar el esquema** en `construsoft` y `construsoft_test`, y correr las
  siete baterías. `prueba-d65-d68.sql` cambió en un caso.
- **Construir el CONTRATO §15**, y el **§14** si no lo construiste todavía.
  - El 423 para CS006.
  - Las columnas nuevas del arranque.
  - Las dos rutas de cancelar y reanudar.
  - Los campos nuevos del panel.
  - La propuesta de fecha para una cancelada con un pago pendiente.
- **La purga diaria**: un planificador que llame a `fn_purgar_empresas()` una
  vez al día, más `npm run purgar` para correrla a mano. Es irreversible:
  revisá que solo la llame el rol del panel.
- Si la API compara estados en algún lado (el `z.enum` de
  `rutasSuperadmin.ts`, `EstadoSuscripcion` de `contextoTenant.ts`), suma
  `POR_PAGAR`.

**Queda abierto para el dueño**: la prueba gratuita no cambió. Vencida sigue en
solo lectura y se elimina a mano a los 10 días.

---

## 2026-10-11 · domingo, tarde

**Decisión del dueño, 11 de octubre:** la empresa reporta su pago con el
comprobante y vos (el panel) lo verificás. Reportar no da acceso: un
comprobante puede ser falso. Solo lo da el superadministrador al confirmarlo.

**Hecho** (sin commit; los hace el dueño o tú)

- **Esquema, D-73**, con `docs/prueba-d73.sql`. Lo cargué en un PostgreSQL 16
  limpio y las seis baterías están en verde; D-73 da 25 de 25. Comprobé que
  detecta dos defectos sembrados: dejar reportar a cualquiera hace caer 1
  caso, y contar un pago rechazado como pagado hace caer 4.
  - `pago.origen` admite REPORTADO. Columnas nuevas en `pago`:
    `reportado_por`, `verificado_en` y `rechazo_motivo`. `ck_pago_origen_manual`
    dice quién responde por cada origen.
  - A lo sumo un pago reportado PENDIENTE por suscripción
    (`ux_pago_reportado_pendiente`).
  - `soporte_pago` admite comprobantes de la empresa, con `tenant_id` y
    `subido_por_usuario`. Se borran con ella.
  - Funciones nuevas:
    - `fn_subir_comprobante_empresa` y `fn_reportar_pago`, concedidas a
      `construsoft_app`. No pasan por `fn_exigir_permiso`, así que una empresa
      vencida puede reportar.
    - `fn_confirmar_pago` y `fn_rechazar_pago`, concedidas al panel. Reciben
      el autor y no necesitan la firma de `set_config`: el disparador reconoce
      el vencimiento que mueve una confirmación.
  - Tipos de evento nuevos: `PAGO_REPORTADO` y `PAGO_RECHAZADO`.
  - **Lo que pediste**: `fn_estado_comercial(tenant)` y
    `fn_eliminable_desde(tenant)`. `fn_eliminar_tenant` ya usa la segunda,
    así que podés borrar tus copias. Un pago rechazado no cuenta como pagado:
    un comprobante falso no compra la conservación de los datos.
- **Las pantallas**, contra el **CONTRATO §14**:
  - Empresa: «Reportar un pago» en Configuración → Suscripción, el aviso
    «en verificación», el rechazo con su motivo y el estado en el historial.
  - Panel: «pagos por verificar» primero en el resumen; en la ficha, el bloque
    con «Ver comprobante», «Confirmar pago» (pide marcar que revisó el
    dinero) y «Rechazar» (pide el motivo); y en Pagos, el filtro por estado.
- **`/superadmin` sin la barra** ahora lleva a `/superadmin/` antes de pintar
  nada (`web/src/main.tsx`). Era lo que dejaba al dueño bloqueado por
  intentos.
- El CONTRATO marca §12 y §13 como construidos, con las decisiones tuyas
  anotadas.

**Lo que necesito**

- **Recargar el esquema** en `construsoft` y `construsoft_test`, y correr las
  seis baterías.
- **Construir el CONTRATO §14.**

**Sobre lo que decidiste solo el 11**

- **Una suscripción cancelada no admite pagos.** Coincide con D-73, que
  tampoco deja reportar ni confirmar. Cómo se reactiva a un cliente cancelado
  sigue sin decidir; lo pregunto al dueño cuando haga falta.
- **Suspender a quien ya está suspendida da 422**: de acuerdo.
- **`porPlan` cuenta también las canceladas**: de acuerdo por ahora.

---

## 2026-10-11 · domingo

**Hecho: D-72 en el esquema** (sin commit; los hace el dueño o tú). Son los
cuatro puntos que me pediste el 9, con `docs/prueba-d72.sql`. Lo cargué en un
PostgreSQL 16 limpio:

- Las cinco baterías están en verde: fase 0, EDT, D-65 a D-68, D-71 y D-72
  con 27 de 27.
- Comprobé que la batería nueva detecta el defecto: le quité la exigencia de
  firma a la base y cayeron 9 casos.

Lo que cambió:

1. **Las acciones del panel van firmadas.** `fn_auditar_tenant` y
   `fn_auditar_suscripcion` leen el autor y el motivo de la transacción, con
   tu propuesta:
   ```sql
   SELECT set_config('plataforma.usuario_id', $1, true),
          set_config('plataforma.motivo',     $2, true);
   ```
   - Lo fijás antes del UPDATE, en la misma transacción.
   - Sin las dos, o con un autor que no es un superadministrador activo, el
     UPDATE se rechaza (P0001). El evento queda con `usuario_plataforma_id` y
     el motivo en `justificacion`.
   - Cubre suspender, reactivar, cambiar plan, cambiar vencimiento (ahora
     también deja evento, `PLAN_CAMBIADO` con «Vencimiento a → b») y cancelar.
   - `fn_registrar_pago` no necesita firma aparte: el vencimiento que mueve un
     pago de la misma transacción no escribe otro evento.
   - La carga inicial como superusuario queda exenta. Una prueba con SET ROLE
     tiene que firmar, como el panel.
2. **`plataforma.fn_alta_usuario_plataforma(email citext, nombre text, hash
   text) → uuid`** y **`plataforma.fn_clave_usuario_plataforma(email, hash)`**.
   - Son SECURITY DEFINER y solo aceptan un hash `$argon2id$`: la contraseña
     en claro se rechaza.
   - Están concedidas a `construsoft_superadmin`, para el comando de terminal
     y no para una ruta de la API.
   - `npm run superadmin` ya tiene por dónde. Si querés, que el mismo comando
     acepte `--cambiar-clave`.
3. **`plataforma.fn_proponer_cubre_hasta(suscripcion uuid, meses smallint) →
   date`**. `fn_registrar_pago` la usa, así que `…/pagos/propuesta` y el pago
   dan siempre la misma fecha.
4. **`plataforma.fn_sin_tildes(text)`**, sobre la extensión `unaccent`, que el
   esquema ahora crea. Para el filtro `texto`:
   ```sql
   plataforma.fn_sin_tildes(razon_social) LIKE '%' || plataforma.fn_sin_tildes($1) || '%'
   ```
   Sin índice: son decenas de empresas.

**Encontré y corregí un defecto anterior.** Dentro de una función con
`search_path` propio sin `public`, `email = p_email` comparaba como texto y
distinguía mayúsculas, porque el operador de citext vive en `public`.

- `fn_autenticar` no encontraba a quien ingresaba con otra mayúscula, salvo
  que la API normalice el correo antes. Revisá si lo hace.
- `fn_designar_admin` podía intentar crear a la misma persona dos veces.

Ahora las cuatro funciones que comparan correos usan `OPERATOR(public.=)`.

**Lo que necesito**

- **Recargar el esquema** en `construsoft` y `construsoft_test`, y correr las
  cinco baterías. La extensión `unaccent` la crea el esquema; viene con
  PostgreSQL y no hay que instalar nada aparte.
- **Construir lo que quedaba frenado**: suspender, reactivar, cambiar plan o
  vencimiento, cancelar y `npm run superadmin`. El CONTRATO §12.1 ya dice
  cómo se firma.

---

## 2026-10-09 · viernes

**Decisión del dueño, 9 de octubre:** se construyen ya, en local, el
**superadministrador** (fase 7) y el **logotipo**. El correo sigue por terminal
(`npm run activacion` y `npm run enlace`) porque todavía no se paga un
proveedor, y el despliegue espera a que el sistema esté listo en local.

**Hecho** (sin commit; los hace el dueño o tú)

- **Esquema, D-71** (`docs/05`, con `docs/prueba-d71.sql`). Lo cargué en un
  PostgreSQL 16 limpio: el aislamiento queda verificado, las tres pruebas de
  psql siguen verdes y la nueva da 19 de 19.
  - `app.logo`: una fila por imagen, con la llave (empresa, sha256). Solo PNG
    y JPEG, hasta 1 MB, en un `CHECK`. La aplicación tiene INSERT y SELECT y
    nada más, porque una versión puede nombrar cualquier logo (D-64).
    `plataforma.tenant.logo_ruta` guarda el id de la fila vigente, y
    `tg_logo_de_la_empresa` hace de llave foránea: el logo tiene que existir y
    ser de la misma empresa.
  - `plataforma.soporte_pago`: los comprobantes de RF-SAD-09, en PNG, JPEG o
    PDF hasta 5 MB. El panel tiene INSERT y SELECT; la aplicación, nada.
    `pago.soporte_ruta` guarda su id.
  - **Los índices únicos de nombre que pediste**: `ux_recurso_nombre` y
    `ux_apu_nombre`, sobre `(tenant_id, lower(btrim(nombre)))`. Conectalos a
    `MENSAJES_DE_RESTRICCION` y `CAMPO_DE_RESTRICCION`. Si tu base de
    desarrollo tiene nombres repetidos de antes de tu regla, el índice no se
    crea: avisame cuáles y lo resuelve el dueño.
- **El panel del superadministrador**, en `web/superadmin/` y servido en
  `/superadmin/`. Es otro paquete de Vite: el de las empresas no carga nada de
  él. Pantallas:
  - resumen;
  - empresas, con filtros;
  - ficha de la empresa: pago con comprobante, plan y vencimiento, suspender
    y reactivar, designar administrador, cancelar y eliminar;
  - pagos por rango de fechas;
  - bitácora.
- **El logotipo** en Configuración → Datos de empresa: subir, cambiar y quitar.
- Todo contra la forma que propongo en el **CONTRATO §12 y §13**.

**Lo que necesito**

- **El CONTRATO §12 completo.** Lo que más importa:
  - otra conexión (`superadmin_login`, §16.8 del esquema) y otra cookie
    (`cs_plataforma`, con `Path=/api/superadmin`), sin mezclarse con las de
    las empresas;
  - el alta por terminal, `npm run superadmin -- correo "Nombre"`: pide la
    contraseña dos veces sin mostrarla;
  - cada acción firmada en `plataforma.evento_plataforma`;
  - la fecha propuesta de un pago la calcula la base (`…/pagos/propuesta`), no
    la pantalla;
  - el panel no ve proyectos ni catálogos, solo conteos (01 §9);
  - la búsqueda de empresas ignora mayúsculas y tildes.
- **El CONTRATO §13**: subir, quitar y servir el logo, y dibujarlo en el PDF y
  el Excel. El proyecto vivo usa el logo vigente; una versión usa el
  `logo_ruta` de su fotografía. Hoy el exportador recibe la ruta y no tiene de
  dónde leer la imagen: ahora la lee de `app.logo`.
- **La variable del `.env` para la conexión del panel** la crea el dueño, con
  el rol y su contraseña. Decile el nombre que esperás y qué tiene que correr
  en psql (`CREATE ROLE superadmin_login …`), sin escribir la contraseña: él
  la pone.

**Lo que conviene que sepas**

- El esquema todavía no tiene cómo cambiar la contraseña de un
  superadministrador. Por ahora es por terminal; si hace falta, otro comando.
- Si alguna regla del §12 choca con el esquema (por ejemplo, de dónde lee
  `fn_auditar_tenant` el autor al suspender), dímelo antes de inventar.

---

## 2026-10-08 · jueves

**Hecho** (sin commit; los hace el dueño o tú)

- **Usuarios y roles, 02 §11.4**, contra la forma que propongo en el
  **CONTRATO §11**. Es una pestaña nueva de Configuración, visible con
  `USUARIOS.GESTIONAR`:
  - Plan Personal: invitar al asistente, con el rol fijo, y los permisos del
    rol Asistente marcados en la pestaña misma.
  - Plan Empresarial: invitar con cualquier rol, editar, revocar y devolver el
    acceso, y crear, editar y borrar roles personalizados.
  - La matriz de permisos aplica al marcar las reglas de la base: Ver es
    prerrequisito (RF-CFG-25), D-59 y D-70. Lo que no se puede desmarcar dice
    quién lo exige.
- **La pantalla de activación**, `#/activar?token=`. Es la de recuperación con
  otras palabras y otra ruta, `POST /api/activacion`.
- **Documentos 01 y 02 al día**: «Proyectos», IVA por defecto, tarjetas,
  ítems por nivel, nombres únicos de recursos y APU, la importación (02 §5.5 y
  §6.6; ya no está en «lo que no se construye» ni en las exclusiones del 01) y
  la activación sin correo (02 §11.4).
- Leí tu entrada sobre los nombres únicos. Recursos y APU ya muestran el 422
  con `campo: "nombre"` debajo del nombre, sin cambios en pantalla.

**Decisión del dueño, 8 de octubre: el enlace de activación lo genera él**

Igual que la recuperación: `npm run activacion -- correo`. Responde tu pregunta
de si Usuarios se hacía como la recuperación o esperaba a la fase 8. El administrador **no ve** el enlace, porque con él
se elige la contraseña de otra persona (D-7). La pantalla lo dice así, y no
promete un correo que todavía no sale.

**Lo que necesito**

- **El CONTRATO §11 completo**: `GET /api/usuarios`, invitar, editar, revocar
  y restituir; roles; `POST /api/activacion`; y `npm run activacion`, con
  `URL_ACTIVACION` en el `.env` del dueño. Si alguna regla choca con el
  esquema, dímelo antes de inventar. Las que más importan:
  - el correo solo se edita mientras el usuario está PENDIENTE;
  - nadie se revoca a sí mismo;
  - los permisos del rol se reemplazan enteros, en una transacción, para que
    el disparador diferido vea el resultado final;
  - Administrador no se edita, y Asistente no se renombra.
- **El correo repetido entre empresas** da el mismo mensaje sin decir de qué
  empresa es (RN-01).

**Lo que conviene que sepas**

- `app.permiso.descripcion` dice «presupuestos». La pantalla usa sus propios
  textos y no lee esa columna, así que no urge; sería del esquema.
- Hasta la fase 8, «Reenviar enlace» no está en la pantalla: sin correo no
  hay nada que reenviar. Lo hace el mismo comando del dueño.

---

## 2026-10-06 · martes (tarde)

**Hecho** (sin commit; los hace el dueño o tú)

- Correcciones del dueño sobre las pantallas: «Proyectos» en vez de
  «Presupuestos» en toda la interfaz (`#/proyectos`; `#/presupuestos` sigue
  abriendo), proyectos en tarjetas, Configuración centrada, campos de cifra que
  no dejan escribir letras, IVA del 19 % por defecto al crear material y
  equipo, y agregar ítems en subcapítulos sin ambigüedad.
- **La pantalla de importar desde Excel**, en Recursos y APU, contra la forma
  que propuse en el **CONTRATO §10**. Todo o nada, solo crea, informe por fila.

**Lo que necesito**

- **La importación desde Excel, CONTRATO §10.** Es alcance nuevo, decidido
  por el dueño el 6 de octubre. Son cuatro rutas: dos plantillas y dos
  importaciones. La plantilla se arma con `exceljs`, y la importación corre en
  una sola transacción. **La interfaz ya llama a las cuatro**; hasta que
  existan, el botón recibe un 404 y lo muestra. Las reglas que más importan:
  todo o nada; solo crea; los dos precios llenos es error aunque cuadren; la
  `fila` es la que Excel muestra; se informan todos los errores, no el primero.
  Si alguna regla choca con el esquema, dímelo antes de inventar.
- **Los mensajes de la API que dicen «presupuesto» y nombran la cosa**, no sus
  cifras: «Ese presupuesto no existe en su empresa», «Ya existe un presupuesto
  con ese código», «El presupuesto está en estado ACTIVO…». La interfaz los
  muestra tal cual. Para el dueño ahora es «proyecto». Las rutas y los nombres
  internos no cambian: es solo texto para la persona.

**Lo que conviene que sepas**

- El IVA por defecto es de la pantalla, no de la API: un recurso sin `ivaPct`
  sigue siendo 0 % (RF-REC-08), y en la plantilla, IVA vacío también es 0 %.
- La importación de APU exige que los recursos existan antes. En la plantilla
  de APU, la hoja «Recursos» es de consulta y no se importa.

---

## 2026-10-06 · martes

**Hecho** (sin commit: los commits los hace el dueño o tú; desde esta máquina
virtual git no puede borrar su propio `index.lock` y deja el repositorio
trabado)

- **Todas las pantallas del MVP** en `web/src/modulos/`, contra las rutas que
  ya existen, con las formas leídas del código y no solo del contrato:
  - **Mesa** (`mesa/`): árbol por `padreId`/`nodoId` ordenado por `posicion`;
    capítulo con clasificación sin valor por defecto, subnivel, renombrar,
    reclasificar, subir, bajar y eliminar (409 → confirmación con tu mensaje →
    `?confirmado=si`); actividades con buscador de APU, «+ Crear Nuevo APU»
    encima, cantidad editable y quitar; pie de dos renglones con el aviso de
    `sinBaseAiu` en la barra; panel lateral no modal con el desglose y los
    cuatro porcentajes; historial con filtros; versiones con consulta en solo
    lectura y exportación; activar (texto textual del 02 §9.1 y aviso de
    `aiuEnCero`), cerrar, reabrir con justificación, guardar versión, editar
    cabecera y estructura, duplicar con APU desactualizados, archivar y
    eliminar.
  - **Recursos** (`recursos/`): cuatro pestañas y «Todos»; con texto no se
    manda `tipo`; doble vía de precio con bloqueo cruzado; la pregunta de
    presupuestos afectados.
  - **APU** (`apu/`): lista con inactivos; consultar y «Editar» en la misma
    capa; composición con recurso creado al vuelo encima; la pregunta del 02
    §6.4 con su texto; 422 al eliminar → «Marcar como inactivo».
  - **Configuración** (`configuracion/`): mi cuenta y cambio de contraseña,
    empresa, preferencias con unidades (mismo permiso) y suscripción. Usuarios
    no, como quedó decidido.
- `tsc` y `eslint` limpios en la máquina del dueño. Recorrido completo en
  Chromium contra una API simulada, en los dos temas, como Administrador, como
  rol de solo consulta y con la suscripción vencida, y de 390 a 1920 px.

**Divergió, y lo resolví en el contrato**

- **La regla 1.1 tiene ahora dos excepciones** (CONTRATO §5): el precio
  complementario del recurso, que se envía, y las vistas previas del 02 §2,
  que no se envían nunca. Las dos en `web/src/decimal.ts`, con aritmética
  exacta. El complementario coincide con `round(…, 6)` en 4000 casos.

**Lo que necesito, nada me bloquea**

- **Una prueba contra la base real.** Yo pruebo contra una simulada: no
  alcanzo tu PostgreSQL. Si puedes, recorre por HTTP lo que la interfaz manda
  y que tus pruebas quizá no cubren: `PATCH /api/nodos/:id` dos veces seguidas
  (primero `nombre`, después `clasificacion`, nunca juntos); `DELETE
  /api/nodos/:id?confirmado=si`; `POST /api/nodos/:id/actividades` con
  cantidad `"0"`; `PUT /api/recursos/:id` con `presupuestosAReapuntar: []`.
- **`URL_RECUPERACION=http://localhost:5173/#/recuperar?token=`** en el
  `.env.example`, cuando el dueño te dé permiso para editarlo.

**Lo que conviene que sepas**

- **Qué decide si un botón se ve**: `editable` de la cabecera para todo lo
  que edita la mesa; `PRESUPUESTOS.ESTADO` y el estado para activar, cerrar y
  reabrir; para eliminar, además, que no haya una versión con disparador
  `ABIERTO_A_ACTIVO`. Si eso no basta para saber si «alguna vez se activó»,
  dime y lo cambio.
- **Las fechas del historial** viajan como instantes ISO: «desde» es la
  medianoche local del día elegido y «hasta» su último milisegundo.
- **Un rechazo sin `campo` relee la mesa entera**, como dice el contrato. Si
  un rechazo de dato llega sin `campo`, la pantalla lo trata como cambio del
  mundo: avísame cuáles quedan.

---

## 2026-10-05 · lunes (noche)

**Hecho** (sin commit todavía: lo hace el dueño, ver abajo)

- **Cascarón, ingreso, inicio y vista maestra de presupuestos** en `web/src/`:
  barra lateral por permisos (cajón en teléfono, iconos entre 641 y 1024),
  barra superior con migas, quién soy, tema y salir; la franja de suscripción
  para prueba, vencida, cancelada, suspendida y nula; el ingreso con 401, 403 y
  429 (respeta `Retry-After`); el menú de inicio; la vista maestra con búsqueda,
  filtro de estado, «Ver archivados» y la capa de crear presupuesto, que
  redirige a la mesa. Recursos, APU, Configuración y la mesa tienen por ahora
  un lugar «todavía no disponible».
- **La capa** (`componentes/Capa.tsx`) está hecha sobre `<dialog>` con
  `showModal()`: foco atrapado, Escape solo cierra la de arriba y pregunta si
  hay cambios. Es la que van a usar Recursos, APU y la mesa.
- **Pantalla de recuperación** en `#/recuperar?token=…`: consume el enlace
  (`POST /api/recuperacion`).
- `tsc`, `eslint` y `vite build` limpios. Recorrido completo probado en
  Chromium contra una API simulada con las formas del contrato, en los dos
  temas y en diez anchos, de 390 a 1920.

**Divergió, y era mío**

- **`web/src/api/cliente.ts` leía el error envuelto en `{ error: { … } }`**,
  del borrador 1 del contrato. La API responde plano, como dice el contrato
  hoy: con el sobre, todo rechazo se habría mostrado como «no se pudo hablar
  con el servidor». Corregido. También `App.tsx` esperaba
  `{ presupuestos: [...] }` y la lista llega como arreglo suelto, y `tipos.ts`
  tenía `archivado: boolean` en vez de `archivadoEn`. Las tres eran del
  andamio; la API estaba bien.

**Lo que necesito, nada me bloquea**

- **`URL_RECUPERACION=http://localhost:5173/#/recuperar?token=`** en el
  `.env.example` (sin valor secreto: es una dirección). El token va después del
  `#` a propósito: no sale del navegador, ni al servidor ni en el `Referer`.
- **La moneda en el arranque.** El 02 §7.1 la muestra como dato fijo en el
  formulario de crear; leerla de preferencias pide `CONFIG.PREFERENCIAS`, que
  quien crea presupuestos puede no tener. Pido `monedaBase` en
  `GET /api/sesion`. Mientras tanto la tomo de cualquier fila de la lista
  (D-6: una sola moneda por empresa); con la lista vacía dice «La de su
  empresa». Lo agrego al §3.1 del contrato como pedido.

**Lo que conviene que sepas**

- **Las direcciones van con `#`** (`#/presupuestos`, `#/presupuestos/:id`). El
  servidor de producción no necesita devolver `index.html` para rutas
  desconocidas.
- Cualquier 401 después del arranque lleva al ingreso con «Su sesión
  terminó…» y conserva la dirección. El 401 del propio ingreso no.
- Los textos de la franja de suscripción y de los vacíos no los fija el 02: los
  escribí yo y quedan a revisión del dueño (DISENO §12).

---

## 2026-10-05 · lunes (tarde)

**Hecho**

- **D-70 en el esquema**: crear o editar un APU exige también `RECURSOS.VER`.
  Gemelo exacto de D-59 —un bloque más en `fn_rol_permisos_coherentes`, aparte
  y sin generalizar—. Alcanza a CREAR y EDITAR, no a ELIMINAR, y cubre el
  DELETE: quitarle `RECURSOS.VER` a un rol que arma APU se rechaza al
  confirmar. Corregido también el comentario de D-59, que decía «el único
  prerrequisito ENTRE módulos». Con esto la lista queda cerrada en dos: son los
  dos eslabones de recurso → APU → presupuesto. **Hay que recargar el esquema.**
- **Contrato al día**: nueve secciones. `POST /api/recuperacion` ahora dice que
  consume el enlace. Entraron Recursos (§5), APU (§6), Configuración (§7),
  exportación y versiones (§8), con las formas de tu bitácora y no inventadas.
  Los títulos de §3 y §4 ya no dicen «lo que falta».
- El precio complementario de Recursos quedó escrito como **la única excepción
  a la regla 1.1**, con su motivo, para que no parezca un descuido.

**Decisiones que pedías**

- **`legal.html` → `legal/<VERSION_TERMINOS>/legal.html`**, no `docs/`. Es
  dependencia de arranque y registro legal a la vez: la carpeta de una versión
  no se edita nunca más, un texto nuevo es una carpeta nueva, y el nombre de la
  carpeta es el valor de la variable. Seguí con un archivo único de cuatro
  secciones: te sigue costando una línea en `RUTA_BORRADOR`.
- **Usuarios espera**, y no por difícil: nada de la demostración necesita un
  segundo usuario, y la pantalla obligaría a un modo donde el administrador ve
  el enlace de activación de otra persona —impersonación— para algo que nadie
  va a mirar antes del 18. Si hace falta: `npm run invitar -- correo`, cero
  interfaz. Pendiente de confirmar con el dueño.
- **El logotipo (D-71) no se escribió todavía, y encontré por qué no podía
  escribirse rápido**: D-64 congela el logo con cada versión y prohíbe borrar un
  objeto referenciado por una. Una fila por empresa no sirve —reemplazar el logo
  pisaría el que una versión tiene congelado—; va **una fila por imagen,
  direccionada por su hash**, con `empresa` apuntando a la vigente. Lo demás ya
  está decidido: tabla aparte (que el arranque no arrastre 200 KB), RLS forzado,
  **solo PNG y JPEG** (un SVG servido en línea es ejecución de script en el
  dominio de la aplicación), tope en un `CHECK`, y la ruta manda el tipo
  guardado con `nosniff` e `inline`, nunca el nombre que subió el usuario.

**Lo que necesito**

- Recargá el esquema y corré las cuatro pruebas de psql. Comprobé que los dos
  caminos de siembra le dan al Administrador todos los permisos y que el
  Asistente nace sin ninguno, así que D-70 no debería romper la carga, pero no
  lo corrí contra PostgreSQL: eso es de tu lado.
- `prototipo/` ya está restaurado. **Lo había borrado yo** el 4 de octubre
  siguiendo una instrucción que resultó equivocada: el clon «más nuevo» era más
  viejo en contenido y no traía `legal.html`. Hiciste bien en no restaurarlo.

**Lo que conviene que sepas**

- Las pantallas van en este orden: cascarón y navegación, ingreso y vista
  maestra, mesa de lectura, mesa editable, Recursos, APU, Configuración. La mesa
  es la que tiene que quedar impecable; el tablero no es obligatorio.
- Configuración va recortada a cuatro pestañas: mi cuenta, datos de empresa,
  preferencias y suscripción.

---

## 2026-10-04 · domingo

**Hecho**

- **D-69**: `fn_renumerar_wbs` calculaba los lugares dos veces y la segunda leía
  un estado a medio escribir, lo que dejaba dos hermanos con el mismo código.
  Arreglado con una sola foto en tabla temporal, como la `z_orden` de
  `fn_mover_en_edt`. Esquema entregado a las tres carpetas, más
  `docs/prueba-edt.sql`: quince casos, se juzga solo, comprobado en las dos
  direcciones.
- **`web/` existe**: tokens, `DISENO.md`, `CONTRATO.md`, el cliente de la API y
  el andamio con el camino de la sesión probado de punta a punta. `tsc`, `eslint`
  y `vite build` limpios.
- **`CONTRATO.md` en borrador 5**, con los cuatro puntos del grupo 2.
- **`.env.example`** con las cinco variables de la API, sin valores.
- **Documento 04**: §8.6 nuevo, el límite de intentos movido del §8.5 al §8.6, y
  la regla de mutar una defensa a la vez en la fila «Pruebas».

**Lo que necesito, nada bloqueante**

- **La inconsistencia de `campo` con `posicion`.** Llega con campo cuando la
  valida la API y sin campo cuando la base la rechaza por rango. Es el mismo
  campo y la misma corrección, y la pantalla reacciona distinto: marca el
  control o recarga la mesa entera. Si se puede mapear ese rechazo a
  `campo: 'posicion'`, mejor. Si implica adivinar de qué campo habla un mensaje
  de la base, decilo y queda como está.

**Lo que viene de mi lado en el esquema, para que no lo esperes antes**

- **Un SQLSTATE propio para el conflicto de estado** —«el presupuesto ya no está
  Abierto»—, hoy indistinguible de un dato inválido. Después de las primeras
  pantallas. Cuando exista, de tu lado es una línea de mapeo.
- **`app.fn_puede(codigo)`**: un booleano implementado llamando a
  `fn_exigir_permiso` y atrapando solo CS004 y CS005, para que no pueda
  divergir. Entonces `editable` sale en la misma transacción que la lectura y
  desaparece la excepción como control de flujo en la capa HTTP. No cambies nada
  hasta que esté.
- **El propósito `RESTABLECIMIENTO`** de los tokens, cuando el 02 describa la
  pantalla. Aprobado de diseño, no construido.

**Lo que conviene que sepas aunque no te bloquee**

- **Cinco tonos del tema claro no pasaban el contraste** y están corregidos en
  `web/src/estilos/tokens.css`. La revisión de septiembre los midió solo contra
  blanco, que es el fondo de las tarjetas, y el fondo de la aplicación es un
  paso más oscuro. Si alguna vez el backend genera HTML con colores —un correo,
  la página de términos—, los tonos salen de ahí y **no** de
  `prototipo/css/styles.css`, que tiene los viejos.
- **Una llave foránea no mira el aislamiento por filas.** Lo encontraste al
  crear capítulos: sin comprobar primero que el presupuesto exista, el id de
  otra empresa llegaba como 422 en vez de 404 y delataba que existe. Vale como
  patrón, no como arreglo suelto: revisá el `apu_id` al agregar una actividad en
  el grupo 3, y lo mismo en Recursos y APU.
- **`prototipo/legal.html` dejó de ser descartable**: desde `abe56ed` la API lo
  lee y se niega a arrancar si falta un documento. Borrar esa carpeta deja la
  API sin arrancar. Ya quedó escrito en el 04.

**Lo que sigue de mi lado**

El cascarón con navegación y tema, el ingreso y la vista maestra. Después la
mesa, en cuanto el grupo 3 esté.
