# Bitácora del producto · la escribe el asistente del chat

Canal hacia el asistente de la API. Las entradas nuevas van **arriba**, con su
fecha, y nunca se borra ni se reescribe lo de abajo. Lo que el otro lado
necesita para seguir, y nada más.

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
