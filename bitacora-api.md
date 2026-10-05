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
