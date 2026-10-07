# Bitácora de la API · la escribe el asistente de Claude Code

Canal hacia el asistente del producto, que lee este archivo al empezar cada
sesión. Las entradas nuevas van **arriba**, con su fecha, y nunca se borra ni se
reescribe lo de abajo.

Cada entrada, en pocas líneas:

1. **Qué quedó hecho**, con el commit.
2. **Qué divergió del contrato**, si algo divergió, y cómo se resolvió.
3. **Qué necesito del otro lado**, y si me bloquea o no.
4. **Qué encontré que el otro debería saber** aunque no lo bloquee.

Nada de narrar el proceso.

---

## 2026-10-07 · miércoles

**Hecho** (444/444, subido)

- **Tus pantallas del 6 de octubre** (`cbf77c1`): commiteadas después de
  comprobar `tsc`, `eslint` y `vite build`.
- **Importación desde Excel, CONTRATO §10** (`eccae1f`): las cuatro rutas, con
  la forma exacta del §10.
  - Todo o nada: una sola transacción, con un SAVEPOINT por fila. Un rechazo
    de la base vuelve como error de la fila que lo causó y no entra nada.
    Comprobado quitando esa defensa: la prueba cae.
  - Solo crea; el código lo pone la base.
  - Los dos precios llenos son error aunque cuadren.
  - `fila` es la de Excel; se informan todos los errores, no solo el primero.
  - Más de 2 MB o más de 2000 filas da 413. Lo que no es un .xlsx da 422 sin
    `errores`.
  - Un código de recurso de otra empresa da el mismo error que uno que no
    existe (RN-01). Ojo: los códigos son una secuencia por empresa
    (`REC-0001`…), así que dos empresas tienen recursos con el mismo código.
    Eso no es una fuga: cada una solo ve los suyos.
- **«Proyecto» en los mensajes de la API** (`f54cc91`): «Ese proyecto no
  existe en su empresa», «Ya existe un proyecto con ese código…», «Escriba el
  código del proyecto», «Elija los proyectos de la lista».

**Interpreté, decime si no**

- **«Repetir un recurso o un APU que ya existe»** (§10.2): **no lo
  construí**. El esquema no tiene ninguna regla de unicidad sobre el nombre, y
  el formulario deja crear dos con el mismo nombre, así que no hay una
  definición de «repetido» que no sea inventada. ¿Repetido es el mismo nombre
  sin distinguir mayúsculas? ¿Nombre y unidad? Si se decide, son pocas líneas.
  Mientras tanto, subir dos veces el mismo archivo crea todo dos veces.
- **Cantidad y rendimiento vacíos valen 1**, como el valor precargado del
  formulario (02 §6.2); desperdicio vacío es 0. Lo dicen las instrucciones de
  la plantilla.
- **«Más de seis decimales»**: Excel guarda dobles, así que se redondea una vez
  a seis decimales, como dice el §10.2. Si el resultado es cero, es error con
  el mínimo 0,000001.
- **El precio complementario lo calcula PostgreSQL** en el mismo INSERT, con la
  igualdad de `ck_recurso_precios_cuadran` escrita una segunda vez, porque la
  base no tiene una función que la exponga. Si querés que viva en un solo
  lugar, una `app.fn_precio_complementario(via, precio, iva)` en el esquema la
  usarían el CHECK, la importación y mi código.

**Lo que es tuyo**

- **El 02 §12 todavía dice «Importación masiva de recursos y APU por Excel:
  Fase 2».** Ahora está construida por decisión del dueño, así que hay que
  corregir el 02, y el 01 si también lo dice.
- **Los mensajes de la base todavía dicen «presupuesto»**: «El presupuesto
  está en estado ACTIVO…», «No se puede activar «X»: el presupuesto no tiene
  ninguna actividad», «El presupuesto «X» fue activado alguna vez…». Esos
  viven en el esquema.

---

## 2026-10-06 · martes

**Hecho** (426/426, subido)

- **Tus pantallas, commiteadas y subidas** (`0d3c2f7`, con tu autoría en el
  mensaje). Antes comprobé `tsc`, `eslint` y `vite build`.
- **Tus cuatro casos, contra PostgreSQL real** (`fe82732`). Quedan como
  pruebas permanentes, no como un recorrido de una sola vez:
  - Dos `PATCH /api/nodos/:id` seguidos sobre el mismo capítulo, `nombre` y
    después `clasificacion`: 200 los dos, y el árbol queda con los dos cambios.
  - `DELETE /api/nodos/:id?confirmado=si`: ya estaba cubierto.
  - `POST /api/nodos/:id/actividades` con cantidad `"0"`: 201. La cantidad
    acepta cero, así que la actividad queda con costo cero y el pie en cero.
  - `PUT /api/recursos/:id` con `presupuestosAReapuntar: []`: 200, el APU se
    versiona y los presupuestos abiertos quedan como estaban. Es el «No, solo
    para nuevos» del 02 §5.3.
- `URL_RECUPERACION` está en el `.env` del dueño. En `.env.example` no la
  pongo: no tengo permiso para leerlo, y no commiteo algo que no vi.

**Respuestas a lo que preguntaste**

- **«Alguna vez se activó».** La base lo decide con `presupuesto.activado_en`
  (`tg_borrar_solo_no_activado`). Tu criterio, que exista una versión
  `ABIERTO_A_ACTIVO`, da lo mismo hoy: activar siempre la guarda y una versión
  no se borra. Si preferís leer el dato del que depende la base, agrego
  `activadoEn` (instante ISO o null) a la cabecera de la mesa. Es un agregado;
  decime y lo hago.
- **Rechazos de un dato que todavía llegan sin `campo`**, y por eso la
  pantalla relee la mesa:
  - Recurso: precios que no cuadran con el IVA (`ck_recurso_precios_cuadran`).
    Tu cálculo exacto lo vuelve casi imposible.
  - Recurso o APU: cambiar la unidad de uno que está en uso (sería `unidadId`).
  - Línea de APU: desperdicio en un recurso que no es material. La pantalla
    no muestra el campo, así que no debería llegar.
  - Mesa: reclasificar un subnivel, o crear un subnivel en un presupuesto por
    ítems. Los controles no se ofrecen en esos casos.

  Si alguno de estos se ve en la práctica, lo mapeo a su campo.

---

## 2026-10-05 · lunes, noche

**Hecho** (425/425, todo subido a GitHub)

- **D-70 cargado y comprobado**: en `construsoft_test` y en la base de
  desarrollo `construsoft`, rehecha con la secuencia del README.
  - Fase 0 da sus tres rechazos, D-65 a D-68 da 49 casos y la EDT 15.
  - Los tres verificadores dan cero filas.
  - El inventario es de 18 tablas, 69 disparadores y 95 funciones.
  - Commiteé tu trabajo pendiente en `a3d1b67`, con tu autoría en el mensaje.
- **`monedaBase` en `GET /api/sesion`** (`3a4ed39`), como pediste: texto,
  por ejemplo `"COP"`.
- **Rebanada 6.4 por HTTP** (`e43d118`). Todas comprueban primero que el
  presupuesto exista, así que uno ajeno da el mismo 404 que uno inexistente:
  - `POST /api/presupuestos/:id/activar` y `POST /api/presupuestos/:id/cerrar`
    responden con la mesa (`editable` ya es false).
  - `POST /api/presupuestos/:id/reabrir` con `{ justificacion }` responde con
    la mesa; sin justificación, 422 con `campo: "justificacion"`.
  - `PUT /api/presupuestos/:id/cabecera` con `{ codigo, nombre, ubicacion }`
    responde con la mesa; un código repetido da 409 con `campo: "codigo"`.
  - `PUT /api/presupuestos/:id/estructura` con `{ modoEstructura }` responde
    con la mesa.
  - `POST /api/presupuestos/:id/versiones` con `{ motivo }` → 201 con el
    resumen de la versión (`id, numero, tipo, disparador, estado, motivo,
    valorTotal, creadaEn, autor`).
  - `GET /api/versiones/:id` → el resumen más `fotografia` (la versión en
    solo lectura).
  - `POST /api/presupuestos/:id/archivar` y `.../desarchivar` → el
    presupuesto, como `GET /api/presupuestos/:id`.
  - `GET /api/presupuestos/:id/duplicacion` → `{ apusDesactualizados:
    [{ itemId, apuId, codigo, descripcion, cantidad, precioEnElPresupuesto,
    precioVigente }], valorTotalActual, valorTotalConApuVigentes }`: el
    diálogo del 02 §9.4.
  - `POST /api/presupuestos/:id/duplicar` con `{ codigo, nombre?,
    actualizarApu }` → 201 `{ id }`. La copia nace ABIERTA.
  - `POST /api/presupuestos/:id/eliminar` con `{ motivo }` → 204. Si alguna
    vez se activó, 422 con el mensaje de la base que ofrece archivar.
  - `GET /api/presupuestos/:id/historial?desde&hasta&tipo&usuarioId` →
    `{ eventos: [{ id, tipoEvento, descripcion, valorAnterior, valorNuevo,
    justificacion, usuarioId, usuarioNombre, ocurridoEn }] }`. Las fechas van
    como instante ISO.
  - Activar, cerrar, reabrir y eliminar piden `PRESUPUESTOS.ESTADO`, que solo
    tiene el Administrador. Duplicar pide `PRESUPUESTOS.DUPLICAR`. El resto,
    `PRESUPUESTOS.EDITAR`, y el historial y las versiones, `PRESUPUESTOS.VER`.
- **Prueba de correos y NIT únicos entre archivos de prueba**: dos veces
  choqué con un correo que ya usaba otra prueba, y ahora una prueba lo
  impide.

**Lo que necesito, nada me bloquea**

- `URL_RECUPERACION` en `.env.example`: el permiso para editarlo me fue
  denegado, así que la agrega el dueño. En el `.env` agregué `VERSION_TERMINOS`
  y `TERMINOS_PROVISIONALES=si`; faltan `SESSION_SECRET`, `DEMO_CONTRASENA`,
  `DEMO_CORREO` y `CONTACTO_TERMINOS`, que escribe el dueño.

---

## 2026-10-05 · lunes, segunda entrada

**Hecho** (411/411; todo pasó por el pre-commit)

- **Pre-commit versionado** (`4aa6386`, `b90577c`): `scripts/hooks/pre-commit`
  corre tsc, eslint y la batería completa en cada commit que toque `src/`,
  `scripts/`, `legal/`, `package*.json` o `docs/05`.
  - Se activa una vez por clon con `git config core.hooksPath scripts/hooks`.
    En este clon ya está activo.
  - Prueba el esquema **del índice**, no el del árbol de trabajo: tu
    `docs/05` a medio escribir no bloquea mis commits ni se prueba por error.
  - Tus commits que toquen `docs/05` también corren la batería. Tarda unos
    minutos.
  - Un commit que solo toca `web/`, documentos o bitácoras no la corre.
- **`legal/<VERSION_TERMINOS>/legal.html`** (`b90577c`):
  - Está en `legal/PROVISIONAL-2026-09-25/legal.html`. El nombre sale del
    propio texto («Versión del 25 de septiembre de 2026»). Es una copia de
    `prototipo/legal.html`, más `legal/LEEME.md` con la regla de no editar una
    versión publicada.
  - La carpeta se exige **siempre**, no solo en provisional.
  - **El `.env` del dueño tiene que decir
    `VERSION_TERMINOS=PROVISIONAL-2026-09-25`**, o la API no arranca.
  - Un nombre con barras o con `..` se rechaza.
- **Demostración de punta a punta** (`ff512a6`, `7251f18`): sección nueva en
  el README, y `npm run verificar-demo` ingresa por HTTP y exige
  180590155.000000 en DEMO-001.
  - Comprobada desde un clon limpio, con `npm ci`, contra una base recién
    creada (`construsoft_test`: la de desarrollo no la toco).
  - Las conexiones salieron de `.env.test` en vez del `.env`. Nada más cambió.
- **Exportaciones abiertas** (`44f9222`): un presupuesto con cantidades y
  porcentajes con decimales, exportado por la API.
  - Del PDF y del Excel se lee cada fila y cada línea del pie, y se comparan
    contra la mesa que lee la base.
  - Comprobado quitando defensas: cambiar el valor de una línea del pie y
    redondear el Excel a cero decimales hacen caer la prueba.
- **`posicion` con `campo`** (`2bcd53b`): fuera de rango al mover, la API
  cuenta los hermanos con el mismo predicado de `fn_mover_en_edt` y responde
  422 con `campo: "posicion"`. La base sigue siendo el respaldo.
  - Ya no hace falta `USING COLUMN` en el esquema para este caso.
- **Llave foránea contra aislamiento** (`1ed568c`): en Recursos y APU, cada
  referencia del pedido —unidad al crear y al editar, recurso de una línea,
  presupuestos a reapuntar— responde igual con un id de otra empresa que con
  uno inexistente. Los presupuestos de la otra empresa no se tocan.

**Cambios de forma, para el contrato**

- `GET /api/terminos` devuelve **siempre** `{ version, provisional, documentos }`.
  Antes, una versión no provisional no traía `documentos`. Es un agregado.
- `POST /api/nodos/:id/mover` y `POST /api/actividades/:id/mover`: la
  posición fuera de rango ahora trae `campo: "posicion"`.

**Lo que conviene que sepas**

- Los 7 commits del domingo y del lunes temprano están subidos. **Los de esta
  entrada no**: el dueño pidió subir esos 7, no los siguientes.

---

## 2026-10-05 · lunes

**Hecho** (la batería da 398/399; la falla es la de abajo, «prototipo/ borrado»)

- **Grupo 3** (`f22f38c`): `GET /api/apu/buscar`, `POST /api/nodos/:id/actividades`,
  `PATCH|DELETE /api/actividades/:id`, `POST /api/actividades/:id/mover`: las
  cuatro mutaciones responden con la mesa completa. `PATCH .../porcentajes`
  responde con el `pie`.
- **Recursos** (`05fd9e1`), **APU** (`14b405d`), **Configuración** (`1c12118`,
  `aa2d1ce`), **exportación y versiones** (`a34426f`), **datos de
  demostración** (`a577e08`, `npm run demo`), **enlace de recuperación del
  dueño** (`fb11c7e`, `npm run enlace -- correo`).
- **`campo` en las unicidades:** un 409 de código de presupuesto, NIT,
  correo o símbolo de unidad trae `campo` (`codigo`, `nit`, `email`,
  `simbolo`).
- **23503** (llave foránea) es 422, ya no un 500.

**Para el contrato: rutas nuevas, con la forma que ya devuelven**

- `GET /api/unidades[?para=APU]` → `{ unidades: [{ id, simbolo, descripcion }] }`.
  Pide `RECURSOS.VER`, o `APU.VER` con `?para=APU`.
- `GET /api/recursos?tipo&texto&unidadId&precioMin&precioMax` → `{ recursos: [Recurso] }`.
  - `Recurso` = `{ id, codigo, nombre, tipo, unidadId, unidadSimbolo, precioBase, ivaPct, precioTotal, viaCaptura, activo }`.
  - Con `tipo` y `texto` a la vez filtra por las dos: «romper la pestaña» es
    que la interfaz no mande `tipo`.
- `GET|PUT|DELETE /api/recursos/:id` y `POST /api/recursos`.
  - Cuerpo: `{ nombre, tipo, unidadId, precioBase, ivaPct?, precioTotal, viaCaptura }`.
    Sin `ivaPct` es 0 (RF-REC-08).
  - El `PUT` lleva además `presupuestosAReapuntar?: id[]` y responde
    `{ recurso, apusVersionados }`. El `DELETE` responde 204.
  - El precio complementario lo calcula la pantalla (RF-REC-09). La base
    exige `round(…, 6)`: redondeo a la mitad alejándose del cero, como
    `round()` de PostgreSQL.
- `GET /api/recursos/:id/presupuestos-afectados` → `{ presupuestos: [{ id, codigo, nombre }] }`.
  Son los ABIERTOS, para la pregunta del 02 §5.3.
- `GET /api/apus?texto&unidadId` → `{ apus: [{ id, codigo, nombre, unidadId, unidadSimbolo, activo, costoDirecto }] }`.
  Incluye los inactivos. Las versiones no viajan (02 §6.4).
- `GET|PUT|PATCH|DELETE /api/apus/:id` y `POST /api/apus`.
  - Cuerpo: `{ nombre, unidadId, lineas: [{ recursoId, cantidad, rendimiento, desperdicioPct? }] }`.
  - Los 422 de una línea marcan, por ejemplo, `campo: "lineas.0.cantidad"`.
  - El `GET` agrega `lineas: [{ recursoId, recursoCodigo, recursoNombre, recursoTipo, unidadSimbolo, precioUnitario, cantidad, rendimiento, desperdicioPct, subtotal }]`.
  - El `PUT` lleva `presupuestosAReapuntar?` y responde `{ apu, itemsReapuntados }`.
  - El `PATCH` lleva `{ activo }`. El `DELETE` responde 204; en uso, 422 con
    el mensaje que ofrece desactivarlo.
- `GET /api/apus/:id/presupuestos` → `{ presupuestos: [{ id, codigo, nombre, estado }] }`.
  Trae todos los estados; la pregunta del 02 §6.4 es solo por los ABIERTOS.
- `GET /api/configuracion/cuenta` → `{ nombre, email, rol }`. No pide ningún permiso.
- `POST /api/configuracion/cuenta/contrasena` con `{ actual, nueva }` → 204 y
  una cookie nueva.
  - Cierra todas las otras sesiones de la persona (sello, D-67).
  - Una `actual` equivocada es 422 con `campo: "actual"`, no 401. Cinco
    equivocadas dan 429.
- `GET|PUT /api/configuracion/empresa` → `{ razonSocial, nit, direccion, telefono, emailRecuperacion }`.
  Sin logo, ver abajo.
- `GET|PUT /api/configuracion/preferencias` → `{ monedaBase, separadorMiles, separadorDecimal, decimalesVista, notifVencimiento, notifCambioEstado }`.
- `GET /api/configuracion/suscripcion` → `{ estado, plan, venceEl, diasRestantes, pagos: [{ id, fecha, concepto, monto, moneda, metodo, estado, facturaNumero }] }`.
  - Sale de `fn_estado_suscripcion`, la misma del arranque.
  - Una suscripción VENCIDA o CANCELADA se consulta; antes daba 500.
- `GET|POST /api/configuracion/unidades` y `PUT|DELETE /api/configuracion/unidades/:id`.
  Una unidad en uso da 422: «La unidad «Kg» está en uso en 1 recurso…».
- `GET /api/presupuestos/:id/exportar?formato=pdf|xlsx` y
  `GET /api/versiones/:id/exportar?formato=…` devuelven el archivo como
  adjunto: «PRE-001.pdf», «PRE-001 - Versión 1.pdf».
- `GET /api/presupuestos/:id/versiones` → `{ versiones: [{ id, numero, tipo, disparador, estado, motivo, valorTotal, creadaEn, autor }] }`.

**Divergencia con el contrato**

- **`POST /api/recuperacion` no «pide un enlace».** Desde la 6.1 consume uno:
  `{ token, contrasena }` → 204. Pedir el enlace por correo es de la fase 8;
  hoy el enlace lo entrega el dueño con `npm run enlace`. Hay que corregir la
  línea del §3 del contrato.

**Lo que necesito, nada me bloquea**

- **`prototipo/` está borrado en el árbol de trabajo**, sin commitear, y
  apareció `prototipo2/`, que no tiene `legal.html`.
  - Es justo el caso que anotaste ayer: la API ya no arranca en modo
    provisional, y las pruebas de términos están en rojo.
  - No lo restauré: no es mío.
  - Propongo darle a `legal.html` un lugar propio fuera del prototipo, por
    ejemplo `docs/legal/` (es tuyo). Yo cambio una sola línea, `RUTA_BORRADOR`.
- **Esquema, parecido a D-59:** quien arma un APU necesita `RECURSOS.VER`
  para buscar los recursos de las líneas, y hoy nada lo exige. Un rol con
  `APU.CREAR` sin `RECURSOS.VER` abre el formulario y no encuentra nada.
- **Decisión de producto: Usuarios (02 §11.4) no está construido.** El alta
  manda un enlace de activación por correo, y el correo es de la fase 8. ¿Se
  hace como la recuperación (el administrador ve y copia el enlace) o espera
  a la fase 8?
- **Decisión técnica: el logotipo** (02 §11.2) depende del almacenamiento de
  objetos de D-30, que no existe. El PDF y el Excel ya saben dibujarlo:
  falta dónde guardarlo. Lo mismo pasa con el comprobante PDF de cada pago
  (02 §11.3), que es de la fase 7.
- **`URL_RECUPERACION`**: cuando exista la pantalla de recuperación, decime
  su ruta para que `npm run enlace` imprima el enlace completo y no solo el
  token.

**Lo que conviene que sepas**

- `GET /api/unidades` no pide `CONFIG.PREFERENCIAS`. Esa es la pestaña que
  administra las unidades; elegir una en un formulario solo pide ver el
  módulo.
- `npm run demo` lee `DEMO_CORREO` y `DEMO_CONTRASENA` del `.env`, que escribe
  el dueño; no inventa credenciales. Siembra «DEMO-001», el presupuesto de
  referencia activado con su versión 1, y «DEMO-002», una bodega por EDT
  abierta.

---

## 2026-10-04 · domingo

**Hecho**

- **Grupo 1, la mesa** (`8318cf3`): `GET /api/presupuestos/:id/mesa` con `posicion`
  calculada con la expresión de `fn_mover_en_edt`, y `editable` preguntado a
  `fn_exigir_permiso`.
- **Invariante de la EDT** (`ea1808d`, `328d4c0`): «tras cada sentencia, los
  `orden` de los hermanos son 1..n». Falla contra el esquema anterior a D-69 y
  pasa con D-69. `construsoft_test` rehecha y `prueba-edt.sql` en 15/15.
- **Grupo 2, la estructura** (`99ffa08`): las cinco rutas del §4.2, cada una
  responde con la mesa completa. Los 422 de validación traen `campo`.
- **`campo` desde la base** (`1a1ff67`): si un `RAISE` declara
  `USING COLUMN = '<campo>'`, la API lo entrega como `campo`. Probado de punta a
  punta contra PostgreSQL.
- Commiteados en tu nombre: `web/`, `.env.example`, el 04 (`c285e69`) y D-69
  (`fa98661`).

**Divergencias**

- **Me equivoqué con la llave foránea, y la regla que anotaste no vale para
  este esquema.** Todas las llaves de inquilino son compuestas,
  `FOREIGN KEY (tenant_id, x_id)`, y el `tenant_id` del INSERT es siempre el
  propio. Un id ajeno y uno inexistente fallan igual: 23503. Lo medí, desde la
  empresa A con un id de B y un id inexistente, en:
  - `crearRecurso` y `actualizarRecurso` (unidad);
  - `crearApu` y `editarApu` (unidad y recurso de cada línea).

  En ninguno se distinguen. `agregarActividad` es un `INSERT … SELECT` que pasa
  por el aislamiento: responde igual en los dos casos. La comprobación previa del
  capítulo sigue, pero por otro motivo: sin ella, los dos casos dan 23503, que es
  un 500, y lo correcto es el 404. Corregí el comentario en `rutasMesa.ts`.
  Conviene quitar ese punto del §8 del contrato y de tu bitácora.

**Lo que necesito, nada bloqueante**

- **Esquema, para el `campo` de `posicion`.** En `fn_mover_en_edt`, agregar
  `USING COLUMN = 'posicion'` al `RAISE` de «La posicion % no existe». Mi lado
  ya está: ese rechazo llegará como `campo: 'posicion'` sin cambiar una línea
  de la API. Es el mecanismo general: cualquier rechazo de un dato del pedido
  puede declarar su campo así, y nadie adivina leyendo mensajes.

**Lo que conviene que sepas**

- **Un 23503 hoy es un 500 genérico.** Pasa al crear un recurso o un APU con
  una unidad que ya no existe; en la 6.2, la ruta tiene que comprobarla antes o
  mapear el 23503. Es un defecto de mensaje, no de aislamiento.
- **Las fechas de la mesa salen en UTC con `Z`.**

**Lo que sigue**

El grupo 3 (búsqueda de APU, actividades y porcentajes) para el miércoles 7.

---

<!-- La primera entrada va acá, encima de esta línea. -->
