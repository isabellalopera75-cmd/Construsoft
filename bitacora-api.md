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

## 2026-10-18 · sábado, la migración 0003

**Hecho**

- **La 0003 (D-80) está commiteada** (`b467ea9`), con sus dos archivos. El
  hook corrió la batería con las migraciones del índice: 539 de 539.
- **`construsoft` la tiene**, aplicada con `npm run migrar`. Una segunda
  corrida dice «al día».
- **Las doce baterías dan verde en las dos bases**, `prueba-d80.sql`
  incluida (7 de 7), y los verificadores dan cero.
- Es el primer uso real de `npm run migrar` sobre la base de desarrollo:
  funcionó con las variables nuevas del `.env` del dueño.

---

## 2026-10-15 · jueves, el módulo 0

**Hecho** (539/539, sin commit)

- **§18.1, las migraciones.**
  - `scripts/aplicar-migraciones.sh` aplica en orden todas las de una
    carpeta y anota la huella de cada una. Lo usa
    `resetear-base-pruebas.sh` después del esquema.
  - **El hook** arma una carpeta con las migraciones del índice, como ya
    hacía con el esquema.
  - **Encontré y corregí un defecto viejo del hook.** Preparaba la base con
    el esquema del índice, pero después corría `npm test`, y npm ejecuta
    antes `pretest`, que volvía a cargar el esquema del árbol. Ahora
    `ESQUEMA` y `MIGRACIONES` se exportan y `pretest` los hereda.
  - **`npm run migrar`**, en `src/dueno/migrar.ts`.
    - Compara las huellas y se detiene si una aplicada cambió.
    - Aplica las que falten con psql y anota la huella.
    - Va todo por psql: no abre una cuarta conexión de `pg`.
    - Probado contra `construsoft_test` en cuatro casos: al día, una
      revertida, una huella alterada y una sin huella.
  - **La huella ignora los `\r`.** Con `core.autocrlf=true`, el mismo
    archivo llega con otros bytes a otro clon, y `migrar` gritaría «cambió»
    sin que nadie lo hubiera tocado. El guion de shell calcula la misma.
- **Las once baterías en verde** en las dos bases, con el 05 más 0001 y
  0002. D-78 da 51 de 51 y D-79 11 de 11; los verificadores, en cero.
- **`construsoft` recargada por última vez**, desde el 05 más las dos
  migraciones. La demo está sembrada. El dueño tiene que crear otra vez su
  superadministrador. Desde hoy, solo `npm run migrar`.
- **§18.2.** `DetalleDeSuscripcion.plazos`, con los cinco de
  `fn_parametro(…, current_date)`.
- **§18.3, las tres rutas de Plazos.**
  - `vigenteDesde` nulo en vez de `-infinity`, traducido en el SQL.
  - `valor` llega como texto de dígitos; otra cosa es 422 en `valor`.
  - Una clave que no existe es 404: se pregunta antes, porque la base la
    rechaza como P0001.
  - Los rechazos de la base salen con su columna.
  - Las pruebas solo programan cambios para 2099 y los anulan: los plazos
    son de toda la plataforma y los demás archivos corren a la vez.
- **`terminos.ts` exige tres documentos:** privacidad, términos y
  reembolsos. El artículo de cookies de la versión de septiembre se sigue
  leyendo sin exigirse ni servirse. `GET /api/terminos` devuelve tres.
  `legal/PROVISIONAL-2026-10-13/` y `legal/LEEME.md` entran con esto.

**Qué divergió**

- Nada del contrato. `npm run migrar` necesita dos variables nuevas en el
  `.env` del dueño, porque migrar lo exige la base al superusuario:
  `MIGRACION_DB_USER` y `MIGRACION_DB_PASSWORD`. El destino sale de
  `APP_DB_HOST`, `APP_DB_PORT` y `APP_DB_NAME`.

**Lo que conviene que sepas**

- Con `VERSION_TERMINOS=PROVISIONAL-2026-10-13` la API ya arranca: el
  dueño puede cambiar la variable.
- **`npm run demo` falla la primera vez después de recargar `construsoft`**
  («ya existe», con la tabla de empresas vacía), y la segunda funciona.
  Pasó en las dos últimas recargas. En `construsoft_test`, después de las
  mismas baterías, el alta funciona a la primera, así que no son las
  baterías. No lo pude explicar; no le toca a la pantalla.

---

## 2026-10-13 · martes, noche

**Hecho** (524/524, sin commit)

- **`construsoft` recargada con D-76.**
  - Las nueve baterías en verde (D-76 26 de 26) y los verificadores en cero.
  - La demo está sembrada. El dueño tiene que crear otra vez su
    superadministrador.
  - Las sesiones que la frenaban eran de pgAdmin; las cerré con
    `dropdb --force`.
- **`GET …/pagos/propuesta` responde 422 para la prueba muerta**, sin
  `campo`, con «La suscripción de esta empresa está cancelada: no admite
  pagos ni cambios de plan.». Lo pidió el dueño, para que el panel ni la
  muestre.
  - La regla es «`fn_estado_comercial` da `CANCELADA` y no hay un pago
    reportado esperando».
  - Con un pago esperando sigue respondiendo: es la reactivación del §15.4,
    y su prueba sigue verde.

**Qué divergió**

- Nada. El 422 de la propuesta es nuevo y no cambia la forma: ya era el 422
  de una cancelada guardada.

---

## 2026-10-13 · martes, tarde

**Hecho**

- **Tu D-76 de la tarde está commiteado** (`b98ab4d`, con tu mensaje). Lo
  cargué en `construsoft_test`: las nueve baterías en verde, D-76 26 de 26,
  y los verificadores en cero.
- **`construsoft` NO quedó recargada.** `dropdb` falló porque había 11
  sesiones abiertas contra ella, seguramente la API o la web corriendo. No
  las corté sin preguntar.
- **Los cinco caminos dan 422 con el mensaje de la base y sin `campo`.**
  Probado por HTTP sobre la prueba muerta:
  - la empresa cancela;
  - el panel cancela;
  - el panel corre el vencimiento;
  - el panel cambia el plan;
  - el panel registra un pago, por meses o con la fecha escrita.

  Después de los cinco intentos sigue `CANCELADA`, `NINGUNO`, `PRUEBA` y sin
  pagos. De control: el panel sí corre el vencimiento de una prueba viva.
- **Corregí un defecto mío que apareció con eso.** El pago del panel con la
  fecha escrita marcaba `campo: "cubreHasta"` ante CUALQUIER rechazo de la
  base, también ante «la suscripción está cancelada». Ahora marca el campo
  solo si la fecha de verdad ya pasó, como `confirmarPago`.
- **Quité mi parche de cancelar.** La base da el mismo 422 con el mismo
  mensaje. `puedeCancelar` y `puedeReportar` de la pestaña siguen mirando el
  estado derivado.

**Lo que conviene que sepas**

- `GET …/pagos/propuesta` todavía propone una fecha para la prueba muerta,
  porque solo mira la suscripción guardada. Registrar después lo rechaza la
  base, así que no revive nada; solo es una propuesta que no sirve. Si la
  pantalla del panel apaga «Registrar pago» con el estado derivado, como
  dijiste, no llega a pedirla.

---

## 2026-10-13 · martes, la prueba gratuita

**Hecho** (521/521, sin commit)

- **D-76 cargado en las dos bases.** El dueño autorizó recrear `construsoft`.
  - Las nueve baterías dan verde en las dos: fase 0 con sus 3 rechazos,
    EDT 15, D-65 a D-68 49, D-71 19, D-72 27, D-73 25, D-74 52, D-75 19 y
    D-76 17.
  - Los tres verificadores dan cero.
  - La demo está sembrada. Al dueño le toca crear otra vez su
    superadministrador con `npm run superadmin`.
- **CONTRATO §17.1.**
  - `GET /api/presupuestos/exportables` devuelve
    `{ presupuestos: { id, codigo, nombre, estado, archivado }[] }`, de
    `app.fn_presupuestos_exportables()`. Pide `PRESUPUESTOS.EXPORTAR`: sin
    él, 403.
  - Las cuatro descargas (proyecto y versión, PDF y Excel) ya pedían solo
    `EXPORTAR`. Están probadas con la cuenta en `SOLO_PAGO` y en `NINGUNO`.
  - Aislamiento probado: la lista de A no trae nada de B, y los archivos de B
    dan 404.
- **CONTRATO §17.** `canceladaPor` admite `'PRUEBA'` en la sesión y en la
  ficha. Probados los días 16 a 25, el día 26 y la purga de la prueba.
- **Corregí un defecto mío.** Una prueba cancelada por D-76 sigue guardada
  `EN_PRUEBA`, y la pestaña la daba por vigente: ofrecía «Cancelar» y
  «Reportar pago». Ahora se mira el estado que deriva la base.
- **Movida una prueba.** «Eliminar desde el panel» pasó de
  `superadmin.test.ts` a `cicloDeSuscripcion.test.ts`, con la purga. Desde
  D-76 la prueba vencida 11 días es purgable, y en archivos distintos las
  dos corrían en paralelo sobre la misma clase de empresas.

**Lo que necesito** (no me bloquea: lo tapé en la API, pero es tuyo)

- **Cancelar revive una prueba que terminó sin pago.**
  `fn_cancelar_suscripcion_empresa` busca la suscripción por el estado
  GUARDADO (`EN_PRUEBA`/`ACTIVA`), y la prueba muerta sigue `EN_PRUEBA`.
  - Probado: cancelarla el día 26 respondía 200. Pasaba de `NINGUNO` a
    `SOLO_PAGO`, «cancelada por EMPRESA», con `reactivableHasta` diez días
    después, `puedeReportar` verdadero y la purga corrida.
  - En la API la cancelación ahora pregunta antes el estado que deriva
    `fn_estado_suscripcion`. Si es `CANCELADA`, responde el mismo 422 «La
    suscripción ya está cancelada.».
  - Pero la base debería rechazarlo ella. Lo mismo vale para
    `cancelarSuscripcion` del panel, que es un `UPDATE` sobre la guardada y
    tendría el mismo efecto, con `PLATAFORMA`.
  - Y, por la misma causa, quizá `fn_registrar_pago` y el cambio de plan
    del panel sobre una prueba muerta. Eso no lo probé.

---

## 2026-10-13 · martes, pedido del dueño

**Lo que necesito** (no me bloquea; es tuyo, está en `web/`)

- **Los campos de precio muestran los separadores de miles mientras se
  escribe.** El dueño lo pidió con una captura del filtro «Precio total ·
  Desde» de Recursos: hoy se lee `142577` y tiene que leerse `142.577`.
  Vale para todo campo donde se escribe un precio o un monto.
  -tambien que intercambies en el nav/menu el modeulo recuersos por proyecto en el orden, es decir, no va (inicio, recuros, apu, proyectos, configuracion) sino (inicio, proyectos, apu, recursos, configuracion)
  - El separador es el de la empresa (`formatoNumerico` del arranque), no un
    punto fijo: una empresa con `,` de miles ve `142,577`.
  - **El contrato no cambia.** A la API el valor sigue llegando como `Dinero`
    en texto, con punto decimal y sin separadores de miles (regla 1.1). Si
    llega `142.577` en un campo de precio, se lee como ciento cuarenta y dos
    con 577 milésimas: el formato es solo de la pantalla.
  - Ojo con los decimales: un precio admite hasta seis, y con la preferencia
    colombiana la coma decimal es la otra tecla. Escribir «1.000,5» tiene que
    llegar como `1000.5`.

---

## 2026-10-13 · martes, verificación

- **`construsoft` ya está recargada con D-75.** Corrige la entrada de abajo.
  Las ocho pruebas de psql pasan (fase 0 con sus 3 rechazos, EDT 15, D-65 a
  D-68 49, D-71 19, D-72 27, D-73 25, D-74 52, D-75 19) y los verificadores
  dan cero. La demo está sembrada.
- **La columna del PDF y del Excel se llama «Código»**, como en la mesa.
  Lo decidió el dueño el 13 de octubre, contestando la pregunta de la
  entrada de abajo.
- **Revisé el §16.** Pasan 516 de 516. `filas.ts` solo ordena y elige qué
  código mostrar, sin calcular nada, y el presupuesto de referencia sigue
  cerrando en $180.590.155.

---

## 2026-10-13 · martes

**Hecho** (516/516, sin commit)

- **D-75 cargado en `construsoft_test`.** Las ocho baterías de psql dan
  verde: fase 0 con sus 3 rechazos, EDT 15, D-65 a D-68 49, D-71 19,
  D-72 27, D-73 25, D-74 52 y D-75 19. Los tres verificadores dan cero.
- **`construsoft` NO quedó recargada con D-75.** El permiso de esta
  terminal volvió a negar el `dropdb`. Le toca al dueño.
- **Las pruebas que esperaban «1.0»** (siete archivos) ahora esperan «1».
  La de D-42 cambió de sentido, no solo de número: ahora espera el
  subcapítulo en `1.1`, su actividad en `1.1.1` y las directas en `1.2` y
  `1.3`.
- **CONTRATO §16 en el PDF y el Excel.** Todo vive en `filasDeLaOferta`,
  que usan los dos:
  - en la columna del número, la actividad lleva su `codigoApu`;
  - el capítulo lleva su `codigoWbs` tal cual: «01», sin «.0»;
  - el nivel de la actividad es el de su capítulo más uno, como pediste.
  - El orden sigue saliendo de `codigoWbs` y `codigoItem` leídos como
    enteros. Con D-75 eso da el orden de la mesa: los subcapítulos ocupan
    `1…n`. Una versión aprobada antes conserva sus códigos y su orden
    (RN-04), y también está probada.
  - En el PDF la columna del número pasó de 42 a 50 pt, a costa de la
    descripción, para que quepa «APU-10000» en negrita.
- **El movimiento que rechaza D-75 ya salía como 422**, sin `campo` y con el
  mensaje de la base. No hizo falta cambiar código; quedó una prueba por
  HTTP que lo fija.
- Comprobé que las pruebas muerden: mostrar el número de ítem en vez del
  código del APU tumba 11 pruebas; ordenar por el código que se muestra
  tumba 7.

**Qué divergió**

- Nada del contrato. La cabecera del §16 todavía dice «sin construir».

**Lo que necesito** (no me bloquea)

- **El título de esa columna en el PDF y el Excel sigue siendo «Ítem»**,
  pero ahora trae el código del APU, y la mesa la llama «Código». Es un
  texto que lee el cliente: decime cuál va y lo cambio.

**Lo que conviene que sepas**

- **El dueño tiene que recargar `construsoft`** con la secuencia del README
  (pasos 1, 2 y 4), correr las ocho baterías y `npm run demo`, y volver a
  crear su superadministrador con `npm run superadmin`.

---

## 2026-10-12 · lunes, verificación

**Hecho** (513/513, sin commit)

- **Revisé el §15 contra el contrato y contra D-74. Está bien construido.**
  - La API lee los plazos de la base y no recalcula ninguno.
  - CS006 → 423 se traduce solo en `errores.ts`.
  - Los cambios a las pruebas que ya existían las dejan iguales o más
    estrictas, ninguna más débil.
- **`construsoft` ya está recargada con D-74.** Esto corrige la entrada de
  abajo.
  - Las siete pruebas de psql pasan (fase 0 con sus 3 rechazos, EDT 15,
    D-65 a D-68 49, D-71 19, D-72 27, D-73 25, D-74 52) y los verificadores
    dan cero.
  - La demo está sembrada.
  - `npm run purgar` contra la base de desarrollo responde «ninguna empresa
    cumplió su plazo».
- **Gracias por los `USING COLUMN` de `fn_reportar_pago`.** Las pruebas del
  §14 ahora exigen `campo: "fecha"` y `campo: "comprobante"` (el de otra
  empresa), y no solo el 422.

**Sigue abierto**: la decisión de abajo sobre el panel que cancela con un
pago pendiente.

---

## 2026-10-12 · lunes

**Hecho** (513/513, sin commit: tu D-74 y mi §15 quedan juntos en el árbol)

- **D-74 cargado en `construsoft_test`.** Las siete pruebas de psql en verde
  (fase 0 con sus tres rechazos, EDT 15, D-65 a D-68 49, D-71 19, D-72 27,
  D-73 25, D-74 52) y los tres verificadores en cero.
- **`construsoft` NO quedó recargada.** El permiso de esta terminal me negó
  borrar la base de desarrollo. Le queda al dueño (ver abajo).
- **CONTRATO §15 completo.**
  - CS006 → **423** con `{ mensaje }`. Probado consultando y escribiendo con
    la cuenta suspendida; la pestaña, `GET /api/sesion`, Mi cuenta y
    reportar un pago siguen respondiendo.
  - `GET /api/sesion`: `suscripcion` trae todos los campos del §15.1, tal
    cual de `fn_estado_suscripcion`. `estado` puede ser `POR_PAGAR`.
  - `GET /api/configuracion/suscripcion` trae el §15.3 completo, con
    `puedeCancelar` y `puedeReanudar`.
  - `POST …/suscripcion/cancelar` (`{ motivo }`, admite vacío como la base) y
    `POST …/suscripcion/reanudar`: 200 con `DetalleDeSuscripcion`. Si no es
    el Administrador, 403, aunque tenga `CONFIG.SUSCRIPCION`. Ya cancelada,
    con un pago pendiente, o reanudar pasada la fecha: 422 sin `campo`.
  - Panel: `EstadoComercial` suma `POR_PAGAR` y `SUSPENDIDA`; el filtro
    acepta `POR_PAGAR`; `estado=SUSPENDIDA` trae las dos suspensiones;
    `Resumen.empresas.porPagar`; `suspendidas` cuenta las dos;
    `Resumen.porEliminar`; la ficha suma `canceladaPor`, `pagarAMasTardar`,
    `suspendidaDesde` y `reactivableHasta`.
  - `GET …/pagos/propuesta` responde para una cancelada con un pago reportado
    pendiente. Probé de punta a punta: cancela, se pasa la fecha, el
    Administrador reporta, el panel confirma, vuelve ACTIVA y queda el evento
    `SUSCRIPCION_REACTIVADA`.
- **La purga diaria.**
  - La API la corre sola cada día a las **00:05 de Bogotá**, por la conexión
    del panel. No corre al arrancar: un día perdido lo recoge el siguiente.
  - `npm run purgar` la corre a mano e imprime cada empresa eliminada con su
    motivo.
  - Comprobé que la aplicación (`construsoft_app`) no la puede ejecutar:
    permiso denegado.
- Comprobé que las pruebas muerden: tres mutaciones, una a la vez (reactivar
  sin ser Administrador, `porEliminar` con pruebas vencidas, la propuesta sin
  la cancelada), y cada una tumbó una prueba.

**Qué divergió**

- Nada del contrato. La cabecera del §15 todavía dice «sin construir»: ya
  está construido.

**Lo que necesito** (no me bloquea)

- **Decidir qué pasa si el panel cancela con un pago reportado pendiente.**
  `fn_cancelar_suscripcion_empresa` lo rechaza, pero la cancelación del panel
  es un `UPDATE` firmado y la base no lo frena. Si después el panel confirma
  ese pago, `fn_confirmar_pago` la reactiva: es justo lo que el comentario de
  D-74 quiere evitar del lado de la empresa. ¿Rechazarlo en la base para los
  dos lados, o dejarlo así a propósito? No lo arreglo en la API sin que lo
  digas.

**Lo que conviene que sepas**

- **El dueño tiene que recargar `construsoft`** con la secuencia del README
  (pasos 1, 2 y 4), correr las siete pruebas de psql, `npm run demo`, y crear
  otra vez su superadministrador con `npm run superadmin`.
- La API escribe cada corrida de la purga en su consola, con fecha y hora.

---

## 2026-10-11 · domingo, noche

**Hecho** (494/494)

- **D-73 commiteado** con tu trabajo.
  - `construsoft` y `construsoft_test` recargadas. Las seis pruebas de psql
    están en verde en las dos (D-73 da 25 de 25) y los verificadores en cero.
  - La demo está sembrada de nuevo.
  - La recarga borró al superadministrador del dueño: lo tiene que crear
    otra vez con `npm run superadmin`.
- **CONTRATO §14 completo.**
  - Empresa: `POST …/suscripcion/comprobantes` y `POST …/suscripcion/pagos`.
    `GET …/suscripcion` trae la forma nueva de `Pago`, ordenada por registro,
    y `puedeReportar`.
  - Panel: `porVerificar` en el resumen, los campos nuevos de
    `PagoDePlataforma`, `?estado=` en `/pagos`, el autor «… (empresa)» en la
    bitácora, y `POST /pagos/:id/confirmar` y `/rechazar`.
  - Comprobé que cada defensa nueva puede fallar: siete mutaciones, una a la
    vez, y cada una tumbó una prueba.
- **Mis copias ya no existen.** El estado comercial y `eliminableDesde`
  salen de `fn_estado_comercial` y `fn_eliminable_desde`.
- Reportar un pago es la exención 9 de `ejecutarSinPermiso`. El permiso lo
  exige la base, en `fn_quien_reporta`.

**Lo que necesito** (no me bloquea)

- **`USING COLUMN` en tres `RAISE` de `fn_reportar_pago`**:
  - «La fecha del pago no puede ser futura.» → `'fecha'`;
  - «El monto tiene que ser mayor que cero.» → `'monto'`;
  - «Adjunte el comprobante del pago.» → `'comprobante'`.

  El §14.1 pide esos `campo`, y `traducirError` los toma de `error.column`.
  No los saco del texto del mensaje. Mientras tanto:
  - el monto en cero y el comprobante que no llegó los marco yo, desde la
    forma del pedido;
  - la fecha futura y el comprobante de otra empresa salen como 422 sin
    `campo`.

  Cuando agregues el `COLUMN`, las pruebas que ya están lo van a cubrir sin
  cambiar nada.

**Lo que conviene que sepas**

- **El ingreso de las empresas lleva su propio límite de intentos**, aparte
  del panel. El bloqueo que tuvo el dueño en `/superadmin` vino de ahí: ya
  quedó corregido con tu redirección.
- `POST /api/superadmin/pagos/:id/confirmar` con un id que no existe, o que
  no es un id, da 404 «Ese pago no existe.». El contrato solo hablaba del 422
  para el que ya no está pendiente.

---

## 2026-10-11 · domingo

**Hecho** (485/485)

- **D-72 commiteado** con tu trabajo (`2ab5ff0`).
  - `construsoft_test` y `construsoft` recargadas.
  - En desarrollo: las cuatro pruebas de psql en verde (D-65 a D-68 49, D-71
    19, D-72 27, EDT 15) y los dos verificadores en cero.
  - La empresa de demostración está sembrada de nuevo.
- **El panel del superadministrador, CONTRATO §12 completo.**
  - `src/infraestructura/basedatos/plataforma.ts` es la tercera conexión,
    `superadmin_login`. ESLint la admite solo ahí.
  - Las rutas están en `src/http/rutasSuperadmin.ts`: todas las de §12.3,
    con la cookie `cs_plataforma` (Path=/api/superadmin, 2 h) y un límite de
    intentos propio.
  - Las acciones que son un UPDATE (suspender, reactivar, plan y
    vencimiento, cancelar) fijan la firma antes del cambio. Las otras tres le
    pasan el autor a su función.
  - Comprobé que cada defensa puede fallar: sin la firma caen 3 pruebas;
    sin el sello, sin la cuenta inactiva, sin la confirmación o sin la guarda
    del NIT, cae 1 en cada caso.
- **`npm run superadmin -- correo "Nombre"`** y **`npm run superadmin --
  correo --cambiar-clave`**.
  - Pide la contraseña dos veces sin mostrarla y se niega a correr sin una
    terminal interactiva.
  - Cambiar la clave cierra las sesiones abiertas del panel: la cookie lleva
    un sello hecho con el hash guardado.

**Lo que divergió o el contrato no decía** (decidí lo mínimo; corregilo si no
es así)

- **Una suscripción CANCELADA no admite pagos, plan ni propuesta.** Responde
  422 con «La suscripción de esta empresa está cancelada: no admite pagos ni
  cambios de plan.».
  - Motivo: `fn_registrar_pago` la pasaría a ACTIVA con `cancelada_en`
    puesto, y eso viola `ck_suscripcion_cancelacion`.
  - Para reactivar a un cliente cancelado hace falta una regla: ¿una
    suscripción nueva? No la inventé.
- **Suspender una empresa ya suspendida**, o reactivar una que no lo está,
  da 422. Así el motivo escrito no se pierde sin evento.
- **`GET /pagos` exige `desde` y `hasta`**. `total` suma solo los EXITOSOS en
  COP. `ingresosDelMes` usa la fecha del pago, no la del registro.
- **`porPlan` cuenta todas las empresas con ese plan**, también las
  canceladas y vencidas.
- **Formas**:
  - `EventoDePlataforma.id` llega como texto, porque es bigint.
  - `registradoPor` de un pago de pasarela es «Pasarela <nombre>».
  - `GET /soportes/:id` va con `cache-control: private, no-store`.
- **El período no tiene tope.** Lo vigila solo el `CHECK > 0`, porque ningún
  documento pone un máximo.

**Lo que necesito** (no me bloquea)

- **Una función en el esquema para el estado comercial sin la suspensión.**
  - `fn_estado_suscripcion` devuelve SUSPENDIDA y se pierde el estado
    comercial, que §12.2 pide aparte.
  - Por eso `plataforma.ts` repite su elección de suscripción y su CASE.
  - Si la base da algo como `fn_estado_comercial(tenant)`, lo uso y borro la
    copia.
  - Lo mismo vale para `eliminableDesde`, que hoy repite la regla de
    `fn_eliminar_tenant` para saber desde cuándo ofrecer el botón.
- **Marcar §12 y §13 del CONTRATO como construidos** y anotar las
  divergencias de arriba.

**Lo que conviene que sepas**

- **`localhost:5173/superadmin` sin la barra final sirve la aplicación de
  las empresas, no el panel.**
  - El dueño ingresó ahí con su correo de superadministrador, el formulario
    fue a `POST /api/sesion` y terminó bloqueado por los intentos fallidos.
  - Con `/superadmin/` funciona.
  - Te toca a vos, en `web/`: que `/superadmin` redirija a `/superadmin/`, o
    que la app de las empresas no conteste esa ruta.
- **El defecto de los correos era real para las empresas.** La API no
  normalizaba el correo antes de `fn_autenticar`, así que con el esquema
  anterior quien escribía su correo con otras mayúsculas no podía ingresar.
  Lo comprobé cargando el esquema de antes en `construsoft_test`: la prueba
  nueva cae ahí y pasa con D-72.
- **`.env.example` sigue sin commit.** Mis permisos no me dejan leerlo, y no
  commiteo un archivo que no vi. Lo commitea el dueño, o me da acceso.

---

## 2026-10-09 · viernes, tarde

**Hecho** (471/471, subido)

- **D-71 verificado y commiteado** con tu trabajo (`416187d`): las cuatro
  pruebas de psql (D-71 en 19 de 19), los tres verificadores en cero.
  `ux_recurso_nombre` y `ux_apu_nombre` ya llegan con su mensaje y
  `campo: "nombre"`.
- **Base de desarrollo `construsoft` rehecha con D-71**, verificada y con la
  empresa de demostración sembrada de nuevo.
- **Logotipo, CONTRATO §13** (`6cce539`):
  - `PUT` y `DELETE /api/configuracion/empresa/logo`, y `GET /api/logos/:id`.
  - El tipo se decide por la firma del archivo: un PDF que dice ser una imagen
    da 422; más de 1 MB, 413 con el mensaje del contrato.
  - `GET /api/configuracion/empresa` trae `logoId`.
  - El PDF y el Excel dibujan el logo vigente en el proyecto vivo, y el de su
    fotografía en una versión, aunque después se quite.
  - `leerLogo` es la octava excepción de `ejecutarSinPermiso`: cualquier
    usuario de la empresa ve el logo en la cabecera.

**El panel del superadministrador (§12) está frenado. Lo que lo frena:**

1. **Credencial del dueño**: la contraseña de `superadmin_login` en su `.env`
   no es la del rol; PostgreSQL rechaza la conexión. La rotación la hace él.
2. **Esquema: firmar las acciones.** `construsoft_superadmin` no tiene
   permiso de escritura sobre `evento_plataforma` ni EXECUTE sobre
   `fn_evento_plataforma`. Los eventos de suspender, reactivar, cambiar plan y
   cancelar los escriben `fn_auditar_tenant` y `fn_auditar_suscripcion` sin
   `usuario_plataforma_id`, y suspender o reactivar, además, sin motivo. Así,
   «ninguna acción sin firmar» (§12.1) no se puede cumplir.
   - Propuesta: que esas dos funciones lean el autor y el motivo de la
     transacción, con `set_config('plataforma.usuario_id', …, true)` y
     `set_config('plataforma.motivo', …, true)`, que el panel fija antes del
     UPDATE, y que se nieguen si faltan.
   - Pago, designar administrador y eliminar empresa sí reciben el autor, y
     esos los puedo construir tal cual.
3. **Esquema: crear el superadministrador.** Nadie salvo un superusuario de
   PostgreSQL puede insertar en `usuario_plataforma`, así que
   `npm run superadmin` no tiene por dónde hacerlo. Propuesta: una
   `plataforma.fn_alta_usuario_plataforma(email, nombre, hash)` SECURITY
   DEFINER, concedida a un rol que use solo ese comando, o un INSERT concedido
   a `construsoft_superadmin`. Es una decisión de seguridad tuya.
4. **Esquema, menor: la fecha propuesta de un pago.** No hay una función que
   la exponga; `fn_registrar_pago` la calcula adentro. Para que
   `…/pagos/propuesta` no escriba la cuenta una segunda vez, conviene una
   `plataforma.fn_proponer_cubre_hasta(suscripcion, meses)` que use también
   `fn_registrar_pago`.
5. **La búsqueda sin tildes** (§12.3) necesita la extensión `unaccent`, o una
   columna normalizada. Decime cuál querés en el esquema.

Mientras tanto, del §12 sigo con lo que no depende de esto en cuanto exista la
credencial.

---

## 2026-10-09 · viernes

**Corregido** (`bd36280`)

- **`URL_ACTIVACION` y `URL_RECUPERACION` van entre comillas en el `.env`.**
  El `--env-file` de Node toma el `#` como comienzo de un comentario, así que
  `URL_ACTIVACION=http://localhost:5173/#/activar?token=` se lee como
  `http://localhost:5173/`. El enlace que imprimía `npm run activacion` abría la
  página de inicio en vez de la activación. El dueño lo vio al probarlo.
  - Los dos comandos ahora se niegan si la variable no termina en `token=`, y
    dicen por qué.
  - El `.env` del dueño ya está corregido.
  - **El CONTRATO §11.4 y `.env.example` tienen que mostrarlo con comillas**:
    `URL_ACTIVACION="http://localhost:5173/#/activar?token="`.

---

## 2026-10-08 · jueves, noche

**Hecho** (465/465, subido)

- **Tu trabajo de usuarios y documentos** (`fcc6602`): commiteado después de
  comprobar `tsc`, `eslint` y `vite build`.
- **Tokens por propósito** (`2a66f47`): un enlace de activación no sirve en
  `/api/recuperacion`, ni uno de recuperación en `/api/activacion`. Cruzado da
  el mismo error que uno inexistente, y se comprueba antes de decir si estaba
  usado o vencido.
- **Activación** (`5838899`): `POST /api/activacion` con `{ token, contrasena }`
  → 204. Comparte el límite de intentos por IP con la recuperación.
  `npm run activacion -- correo` imprime `URL_ACTIVACION` + token, que vence a
  las 72 horas; solo funciona con cuentas PENDIENTE. `URL_ACTIVACION` ya está
  en el `.env` del dueño.
- **API de usuarios y roles, CONTRATO §11** (`8660a76`): las ocho rutas con la
  forma exacta del contrato, con pruebas de permisos, de suscripción vencida y
  de aislamiento. Comprobé quitando de a una estas cuatro defensas: no
  revocarse a sí mismo, el correo editable solo en PENDIENTE, el último
  administrador con `campo: "rolId"`, y el rol con usuarios que no se borra.

**Diferencias con el contrato, decime si alguna no sirve**

- **Con la suscripción vencida, `GET /api/usuarios` responde 402, no 200.** La
  acción de `USUARIOS.GESTIONAR` es GESTIONAR, y D-65 solo deja pasar VER y
  EXPORTAR. Es la base la que decide; si la pestaña tiene que leerse vencida,
  hace falta un permiso de lectura o un cambio en D-65.
- **`ultimoAcceso` llega siempre en null**: el ingreso no escribe
  `app.usuario.ultimo_acceso`, y nunca lo hizo desde la 6.1. Si la pestaña lo
  muestra, lo agrego al ingreso; es poco.
- **Los mensajes del límite del plan y de los roles personalizados** son los
  de la base, que hablan en técnico: «El plan PERSONAL admite 2 usuario(s) y la
  empresa ya tiene 2 sin revocar (RN-11, RF-SAD-06).» El contrato propone
  «Su plan Personal admite 2 usuarios y ya los tiene…». Ese texto vive en el
  esquema, así que es tuyo.
- **Dos reglas del §11.3 las hace cumplir solo la API**: el rol Administrador
  que no se edita y el Asistente que no se renombra. El esquema no las
  defiende: `fn_proteger_rol_sistema` impide cambiar el tipo y borrar, pero no
  renombrar ni cambiar permisos. Si querés que vivan en la base, es un bloque
  más en esa función.

**Lo que no pude hacer**

- **`.env.example`**: la configuración de permisos de esta máquina me niega
  leerlo, así que no lo modifico ni lo commiteo. Falta agregarle
  `URL_ACTIVACION=http://localhost:5173/#/activar?token=` y
  `URL_RECUPERACION=…`; lo hace el dueño.

---

## 2026-10-08 · jueves, tarde

**Hecho** (448/448, subido)

- **Los APU tampoco repiten nombre** (`a1c618e`). El dueño lo decidió el 8 de
  octubre, con la misma regla que los recursos: mismo nombre sin importar
  mayúsculas ni espacios de los bordes, exigida al crear, al editar y al
  importar. En el formulario da 422 con `campo: "nombre"`; en la importación,
  un error de la fila en la columna «Nombre de la actividad».

**Lo que necesito**

- **Esquema**: el mismo índice único que pedí para recursos, ahora también
  para `app.apu`: `(tenant_id, lower(btrim(nombre)))`.

---

## 2026-10-08 · jueves

**Hecho** (446/446, subido)

- **No hay dos recursos con el mismo nombre** (`e7ade2c`). Decisión del dueño,
  7 de octubre: mismo nombre sin importar mayúsculas ni espacios de los bordes.
  - Se exige en los tres caminos que escriben un nombre: crear, editar y la
    importación. Editar un recurso guardándolo con su propio nombre no cuenta
    como repetirlo.
  - Formulario: 422 con `campo: "nombre"` y «Ya existe un recurso llamado «X»
    (REC-0004). Use otro nombre, o edite el que ya existe.»
  - Importación: error de la fila, en la columna Nombre, si el nombre ya está
    en el catálogo o si repite el de otra fila del mismo archivo.
  - `ErrorParaElUsuario` puede nombrar su campo, y `traducirError` lo entrega.

**Lo que necesito**

- **Esquema: la regla debería vivir en la base**, como las demás. Un índice
  único `(tenant_id, lower(btrim(nombre)))` sobre `app.recurso`, con su
  mensaje en `MENSAJES_DE_RESTRICCION` y su campo en `CAMPO_DE_RESTRICCION`.
  Hoy la comprueba la API dentro de la misma transacción, pero dos pedidos
  simultáneos con el mismo nombre podrían entrar los dos. Cuando exista el
  índice, me avisás y lo conecto.
- **Una pregunta para el dueño, por la importación de APU**: la regla se
  decidió para recursos. Los APU todavía pueden repetir nombre, así que subir
  dos veces la misma plantilla de APU los crea dos veces.

**Lo que conviene que sepas**

- El dueño adelantó que, cuando exista inventario, una fila de la importación
  que coincida con un recurso existente sumará a su cantidad. Hoy no hay
  inventario ni ganchos para eso: es otra fase.

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
