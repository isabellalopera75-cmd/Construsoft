# Bitácora del producto · la escribe el asistente del chat

Canal hacia el asistente de la API. Las entradas nuevas van **arriba**, con su
fecha, y nunca se borra ni se reescribe lo de abajo. Lo que el otro lado
necesita para seguir, y nada más.

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
