# Contrato de la API web

Este archivo describe los endpoints que consume la interfaz. Existe porque dos
asistentes trabajan en paralelo: **la interfaz la escribe uno y la API el otro**,
y sin un contrato escrito cada uno adivinaría la forma del otro.

**Quién manda cuando hay desacuerdo.** El esquema (`docs/05`) manda sobre este
archivo; este archivo manda sobre las dos implementaciones; y el documento 02
manda sobre lo que la pantalla tiene que hacer. Si la API y este archivo
discrepan, no se arregla el código en silencio: se dice, y se corrige el que
esté equivocado.

**Versión:** borrador 5, 4 de octubre de 2026. Derivado del 02 §7 y §8 y de las
funciones de lectura que ya existen en el esquema.

---

## 1. Cuatro reglas que valen para todo

### 1.1 El dinero viaja como texto, y la interfaz nunca hace cuentas

Las columnas de dinero son `numeric(24,6)`. En JavaScript no hay aritmética
decimal exacta, así que **ningún número de dinero se convierte a `number` en
ningún punto**: viaja como cadena desde la base hasta el `textContent` del
elemento. Esto no es una precaución teórica —es RNF-06 y la sección 4.1 del
documento 04—.

La consecuencia práctica: **si la pantalla necesita una suma, la suma la manda el
servidor.** La interfaz no suma dos renglones del pie para sacar un tercero, no
calcula la incidencia, no multiplica cantidad por precio. Todo lo que se muestra
viene calculado.

```json
{ "costoTotal": "63675000.000000", "cantidad": "100.000000" }
```

El formateo a `63.675.000,00` es de presentación y se hace sobre la cadena, sin
pasar por `Number`.

**Y no se escribe un formateador nuevo.** Ya existe uno:
`src/comun/formatoNumerico.ts`, que redondea dígito por dígito con el
criterio de `round()` de PostgreSQL y tiene una prueba que lo compara contra la
base en los casos borde. Es el que usan el PDF y el Excel. Si la interfaz
escribiera el suyo, el mismo número se vería distinto en la pantalla y en la
oferta que el cliente recibe, y la diferencia aparecería en un `1,005`.

Ya vive en `src/comun/` y define él mismo su tipo `FormatoNumerico`, así que no
arrastra nada de la capa de datos. `web/` lo importa por un alias de Vite.

### 1.2 Una sola lectura para pintar la mesa, no una por nodo

El documento 04 §4.3 nombra la consulta N+1 al pintar el árbol como una de las
tres trampas que más cuestan: cien actividades no pueden ser cien peticiones.
`GET /api/presupuestos/:id/mesa` devuelve **todo** lo que la pantalla necesita en
una sola respuesta: cabecera, nodos, actividades y pie.

### 1.3 Después de cambiar la estructura, el servidor devuelve la mesa entera

El 02 §8.2 lo exige: «no hay estado intermedio visible ni códigos temporales: la
pantalla muestra la numeración final cuando el servidor confirma. Si el guardado
falla, la EDT vuelve al orden anterior completo, nunca a medias.»

La forma barata de cumplirlo es que **toda mutación de estructura responda con la
mesa completa recalculada**, igual que `GET .../mesa`. Así la interfaz no
reconstruye la numeración ni adivina qué incidencias cambiaron: reemplaza su
estado por lo que llegó. Un árbol a medias deja de ser representable.

A esta escala —cientos de filas— el costo es irrelevante comparado con el de
mantener dos algoritmos de numeración, uno en cada lado.

### 1.4 Mover es una posición absoluta, no un «subir»

`app.fn_mover_en_edt(id, posicion)` recibe la posición final. La interfaz manda
**a dónde va**, no en qué dirección. Un doble clic, un reintento o una petición
repetida por una red mala no corren el nodo dos veces.

---

## 2. Las respuestas de error

La base levanta sus rechazos con un SQLSTATE propio (D-66) y un solo módulo los
traduce. La interfaz solo ve el estado HTTP y el mensaje:

| HTTP | Qué pasó | Qué hace la interfaz |
|---|---|---|
| 401 | No hay sesión, o la cookie es vieja (sello de credenciales) | Manda al ingreso |
| 402 | La suscripción no está vigente y la acción escribe | Pantalla de suscripción, y la mesa queda en solo lectura |
| 403 | El rol no tiene el permiso | Muestra el mensaje; el control no debería haber estado visible |
| 404 | No existe, o es de otra empresa | Indistinguibles a propósito |
| 409 | El código del presupuesto ya existe (23505), o los términos cambiaron | Muestra el mensaje |
| 422 | El dato no sirve —cantidad negativa, nombre vacío— **y también «el presupuesto ya no está Abierto»** | Marca el campo si llega `campo`; si no, muestra el mensaje y recarga la mesa |
| 429 | Demasiados intentos | Respeta `Retry-After` |

**Forma del cuerpo de error**, siempre la misma, y es plana:

```json
{ "mensaje": "texto escrito para la persona", "campo": "cantidad" }
```

`campo` solo cuando el error es de un dato concreto. Los errores de programación
responden 500 y **nunca** muestran su texto.

**Qué hace la interfaz con `campo`, y por qué importa.** Con `campo`, marca ese
campo y deja el formulario abierto: el usuario corrige y reintenta. Sin `campo`,
muestra el mensaje y **recarga la mesa**, porque el rechazo no es de un dato sino
del estado del mundo. Esta es la lista de hoy:

| Rechazo | `campo` |
|---|---|
| `nombre` vacío o ausente | `nombre` |
| `clasificacion` ausente, inválida, o enviada a un subnivel | `clasificacion` |
| `posicion` que no es un entero, o menor que 1 | `posicion` |
| PATCH con `nombre` y `clasificacion` a la vez, o sin ninguno | — |
| Subnivel en un presupuesto en modo `ITEMS` | — |
| Reclasificar un subnivel | — |
| Posición fuera de rango | — |
| El presupuesto ya no está Abierto | — |

Los cuatro últimos los levanta la base, y por eso llegan sin campo.

**Hay una inconsistencia conocida en esa tabla, y está anotada a propósito:**
`posicion` llega con campo cuando la valida la API —no es entero, es menor que
1— y sin campo cuando la rechaza la base por estar fuera de rango. Es el mismo
campo y la misma corrección, y la pantalla reacciona distinto: en un caso marca
el control, en el otro recarga toda la mesa. Recargar no está mal —la mesa nueva
trae el conteo real de hermanos— pero es desproporcionado para un número que el
usuario puede corregir ahí mismo.

**Por qué «ya no está Abierto» llega como 422 y no como 409.** Todos los rechazos
de negocio de la base salen con el mismo SQLSTATE, así que hoy la API no puede
distinguir «el dato que mandaste no sirve» de «el mundo cambió debajo tuyo».
Separarlos pide un SQLSTATE propio, o sea un cambio de esquema, y ese lo hace el
otro asistente. Mientras no exista, la interfaz distingue por `campo`: con
`campo` marca el campo, sin `campo` recarga la mesa. Es menos preciso de lo que
debería y queda anotado como lo que es.

El borrador 1 de este archivo proponía envolverlo en `{ "error": { … } }`, y era
una invención mía escrita sin mirar el código: la API ya respondía plano. El
estado HTTP ya dice que es un error, así que el sobre no separa nada que
necesite separarse, y cambiarlo habría reescrito todas las rutas de error y sus
pruebas para no ganar nada. **Manda la forma plana.**

---

## 3. Sesión, registro y vista maestra (rebanada 6.1)

| Método y ruta | Para qué |
|---|---|
| `POST /api/registro` | Alta de empresa, con la casilla de términos y su versión |
| `POST /api/sesion` | Ingreso |
| `DELETE /api/sesion` | Salir |
| `GET /api/sesion` | El arranque: usuario, permisos, estado de la suscripción |
| `GET /api/terminos` | Los documentos legales de la versión vigente |
| `POST /api/recuperacion` | Consume un enlace y fija la contraseña nueva |
| `GET /api/presupuestos` | Vista maestra |
| `POST /api/presupuestos` | Crear un presupuesto (02 §7.1) |
| `GET /api/presupuestos/:id` | Cabecera de un presupuesto |

`GET /api/terminos` responde
`{ version, provisional, documentos: [{ id, titulo, html }] }`. En modo
provisional son los cuatro documentos de `prototipo/legal.html`, leídos del
archivo y no copiados, y **cada documento empieza por su propio aviso** de que el
texto no pasó por revisión legal. El aviso va dentro del `html` y no en un campo
aparte, justamente para que una pantalla que muestre un solo documento no pueda
mostrarlo sin el aviso. La interfaz pinta el `html` tal como llega.

### 3.1 El arranque, `GET /api/sesion`

De aquí sale **todo** lo que decide qué se puede mostrar. La interfaz no infiere
nada de otro lado. Esta es la forma real que ya devuelve el servidor
—`ArranqueDeSesion` en `src/infraestructura/basedatos/contextoTenant.ts`—, no una
propuesta:

```json
{
  "usuarioNombre": "Ana Admin",
  "razonSocial": "Constructora A SAS",
  "permisos": ["PRESUPUESTOS.VER", "PRESUPUESTOS.EDITAR", "APU.VER"],
  "formatoNumerico": { "separadorMiles": ".", "separadorDecimal": ",", "decimalesVista": 2 },
  "suscripcion": {
    "estado": "EN_PRUEBA",
    "soloLectura": false,
    "diasRestantes": 12,
    "venceEl": "2026-10-16",
    "planCodigo": "EMPRESARIAL"
  }
}
```

- `estado` es uno de `EN_PRUEBA`, `ACTIVA`, `VENCIDA`, `CANCELADA`,
  `SUSPENDIDA`, `SIN_SUSCRIPCION`.
- **`soloLectura` sale de la misma función de la base que usa `fn_exigir_permiso`
  para rechazar las escrituras** (D-65), así que la pantalla y el rechazo no
  pueden contradecirse. La interfaz **no** lo recalcula a partir de `estado`. Si
  es `true`, esconde todo control que escriba —cortesía, no seguridad: la base
  rechaza igual—.
- **`suscripcion` en `null` es «sin acceso», nunca «al día»**, porque la función
  de la base devuelve cero filas para un inquilino que el llamador no puede ver.
  La interfaz trata el nulo como el peor caso.
- **`formatoNumerico` es de la empresa** (RF-CFG-14/15) y es lo que necesita el
  formateador de cifras. Sin él no se puede pintar un solo número.
- `venceEl` es texto `aaaa-mm-dd` y no una fecha: un `date` de Postgres
  convertido a `Date` de JavaScript cae en la medianoche local y puede retroceder
  un día.

**Lo que el arranque no trae, a propósito:** el id y el correo del usuario, el
nombre del rol y el id de la empresa. Las pantallas de la 6.1 no los necesitan y
el servidor acota todo por sí mismo. El día que una pantalla necesite alguno —«Mi
cuenta», por ejemplo— se agrega entonces y no antes.

### 3.2 La vista maestra, `GET /api/presupuestos`

Devuelve **un arreglo suelto**, no un objeto con una clave. Cada elemento es el
presupuesto completo —con sus totales y los cuatro porcentajes—, no solo las ocho
columnas que el 02 §7 pinta:

```json
[{
  "id": "...", "codigo": "PRE-2026-001",
  "nombre": "Casa campestre El Retiro", "ubicacion": "El Retiro, Antioquia",
  "moneda": "COP",
  "estado": "ABIERTO",
  "modoEstructura": "WBS",
  "fechaElaboracion": "2026-09-30T19:03:11.482Z",
  "fechaModificacion": "2026-10-04T16:20:00.113Z",
  "archivadoEn": null,
  "totalCostoDirecto": "105490000.000000",
  "totalCostoIndirecto": "53000000.000000",
  "valorTotal": "180590155.000000"
}]
```

- **`fechaElaboracion` es un instante completo, no `aaaa-mm-dd`**: la columna es
  `timestamptz`. La vista maestra muestra solo la fecha, y el recorte es de
  presentación.
- **Las fechas salen en UTC, con `Z`**, y la interfaz las parsea con `Date` y las
  formatea en la zona local. **Nunca se cortan los primeros diez caracteres del
  texto.** Un presupuesto creado a las 20:00 en Bogotá es `01:00Z` del día
  siguiente: cortar el texto le pondría la fecha de mañana, y el error solo
  aparece en los presupuestos creados después de las 19:00. Tampoco se comparan
  dos fechas como texto por la misma razón.
- **`archivadoEn` es la fecha o `null`**, no un booleano. Archivado es «tiene
  fecha de archivado», y esa fecha además se muestra.
- Que llegue el presupuesto entero y no las ocho columnas no es un problema: a
  esta escala el peso es irrelevante y la mesa necesita esos totales igual.
- **Se queda como arreglo suelto.** Envolverlo en `{ presupuestos: [...] }` solo
  serviría para agregar paginación después, y una constructora con cientos de
  proyectos no la necesita: son decenas. Si algún día hace falta, será un cambio
  que rompe, y se acepta.

Parámetros: `?texto=` (nombre o código), `?estado=` (`ABIERTO`, `ACTIVO`,
`CERRADO`) y `?archivados=true`, que muestra **solo** los archivados —es el
interruptor «ver archivados» de la pantalla, no un «incluirlos también»—.

## 4. La mesa de trabajo

### 4.1 `GET /api/presupuestos/:id/mesa`

La lectura única de la sección 1.2.

```json
{
  "cabecera": {
    "id": "...", "codigo": "PRE-2026-001", "nombre": "Casa campestre El Retiro",
    "ubicacion": "El Retiro, Antioquia", "moneda": "COP",
    "estado": "ABIERTO", "modoEstructura": "WBS",
    "fechaElaboracion": "2026-09-30T19:03:11.482Z",
    "fechaModificacion": "2026-10-04T16:20:00.113Z",
    "editable": true
  },
  "nodos": [{
    "id": "...", "padreId": null,
    "codigoWbs": "1.0", "nivel": 1, "posicion": 1,
    "nombre": "PRELIMINARES",
    "clasificacion": "INDIRECTO",
    "montoAcumulado": "53000000.000000",
    "incidenciaPct": "50.2417"
  }],
  "actividades": [{
    "id": "...", "nodoId": "...",
    "codigoItem": "1.1", "posicion": 1, "codigoApu": "TOP-001",
    "descripcion": "Topografía y replanteo",
    "unidadSimbolo": "Glb",
    "cantidad": "1.000000",
    "precioUnitario": "3200000.000000",
    "costoTotal": "3200000.000000",
    "apuId": "...", "apuVersionId": "..."
  }],
  "pie": {
    "costoIndirecto": "53000000.000000",
    "costoDirecto":   "105490000.000000",
    "administracion": "10549000.000000",
    "imprevistos":    "5274500.000000",
    "utilidad":       "5274500.000000",
    "aiu":            "21098000.000000",
    "iva":            "1002155.000000",
    "valorTotal":     "180590155.000000",
    "porcentajes": { "a": "10.000000", "i": "5.000000", "u": "5.000000", "iva": "19.000000" },
    "aiuEnCero": false,
    "sinBaseAiu": false
  }
}
```

Notas que no son opcionales:

- **`nodos` y `actividades` llegan planos, no anidados**, y el árbol lo arma la
  interfaz con `padreId` y `nodoId`. Anidar en el JSON obliga a recorrer dos
  estructuras distintas para lo mismo y a decidir dónde cuelga una actividad del
  propio capítulo.
- **Cada nodo y cada actividad traen `posicion`: su lugar entre sus hermanos, de
  1 a n.** Es el campo que hace armable el árbol, y el borrador 2 no lo tenía:
  decía que no había «dos listas que mezclar» mientras especificaba dos arreglos.
  Eran dos. Nodos y actividades comparten la posición bajo un mismo padre (D-42,
  y `fn_mover_en_edt` cuenta los dos juntos), así que intercalarlos sin este
  número obligaba a la interfaz a comparar códigos de texto, que es exactamente
  lo que no debe hacer: `1.10` iría antes de `1.2`.
     La interfaz agrupa por `padreId` —o por `nodoId`, para una actividad— y
  ordena por `posicion`. Con eso **el orden de los arreglos deja de importar**.
- **`posicion` es la posición NORMALIZADA, no la columna `orden`.** Tiene que
  valer exactamente lo que `fn_mover_en_edt` acepta, que valida el rango contra
  el conteo de hermanos y renumera con
  `row_number() OVER (ORDER BY orden, es_nodo DESC, id)`. El servidor la calcula
  con esa misma expresión, **con el desempate incluido**: si usara otro, un
  movimiento caería una posición corrida cuando un nodo y una actividad
  compartan `orden`. Y mover es mandar `posicion`, no un «subir».
- **`clasificacion` llega resuelta en todos los nodos**, heredada del capítulo
  raíz por la consulta recursiva de `fn_leer_edt` (D-57). **No hay un campo que
  diga si el nodo la fija o la heredó, a propósito:** la fija exactamente el que
  tiene `padreId` nulo, que es la definición de capítulo de primer nivel (02
  §8.4). Un campo aparte sería un dato derivable que puede quedar en desacuerdo
  con el árbol, y el selector se muestra donde `padreId === null`.
- **`incidenciaPct` puede ser `null`**, y entonces la pantalla muestra un guion y
  nunca un cero (02, caja de §8.5). Llega como cadena sin redondear; el
  redondeo a dos decimales es de presentación.
- **`editable`** es `estado === 'ABIERTO'` **y** la suscripción no en solo
  lectura **y** el rol con `PRESUPUESTOS.EDITAR`. Lo resuelve el servidor para
  que la interfaz no replique la regla.
- **`sinBaseAiu`** es la columna generada que dispara el aviso de RF-PRE-36, y
  ese aviso va en la barra visible del pie, **no** en el panel.

### 4.2 Estructura

| Método y ruta | Cuerpo | Notas |
|---|---|---|
| `POST /api/presupuestos/:id/capitulos` | `{ nombre, clasificacion }` | Primer nivel. `clasificacion` es obligatoria y sin valor por defecto (02 §8.4). Comprueba primero que el presupuesto exista: la llave foránea no mira el aislamiento por filas, así que sin esa comprobación el id de otra empresa llegaría como 422 en vez de 404 y delataría que existe |
| `POST /api/nodos/:nodoId/subniveles` | `{ nombre }` | Hereda la clasificación; no la acepta. En un presupuesto en modo `ITEMS` la base lo rechaza con 422, así que la interfaz esconde el botón mirando `modoEstructura` |
| `PATCH /api/nodos/:id` | `{ nombre }` o `{ clasificacion }` | Reclasificar solo donde `padreId === null`, que es la definición de capítulo de primer nivel |
| `POST /api/nodos/:id/mover` | `{ posicion }` | Absoluta, entre sus hermanos (sección 1.4). **Con el id de una actividad responde 404**: las actividades se mueven por su propia ruta. La interfaz sabe de qué tipo es cada fila porque vienen en arreglos distintos, así que tiene una sola función `mover(id, tipo, posicion)` que elige la ruta |
| `DELETE /api/nodos/:id` | — | 409 si tiene contenido y no llega `?confirmado=si`; un nivel vacío se borra sin preguntar. Los conteos van **dentro del `mensaje`**, así que el cuerpo sigue siendo `{ mensaje }`: «Este nivel tiene 1 subnivel y 2 actividades. Si lo elimina, se elimina todo lo que contiene. Confirme para continuar.» La interfaz muestra ese texto tal cual en el diálogo —ya está escrito para la persona— y reintenta con `?confirmado=si` |

### 4.3 Actividades

| Método y ruta | Cuerpo | Notas |
|---|---|---|
| `GET /api/apu/buscar?q=&limite=` | — | Autocompletado del 02 §8.3 |
| `POST /api/nodos/:id/actividades` | `{ apuId, cantidad }` | El código, la descripción, la unidad y el precio los pone el servidor desde el APU; la interfaz **no** los manda |
| `PATCH /api/actividades/:id` | `{ cantidad }` | **Lo único editable de una fila** (02 §8.3) |
| `POST /api/actividades/:id/mover` | `{ posicion }` | Mismo contador que los nodos |
| `DELETE /api/actividades/:id` | — | |

`GET /api/apu/buscar` devuelve lo que hace falta para elegir, no el APU entero:

```json
{ "apus": [{ "id": "...", "codigo": "CON-002",
             "nombre": "Concreto 3000 PSI para zapatas",
             "unidadSimbolo": "m³",
             "costoDirecto": "636750.000000", "activo": true }] }
```

### 4.4 Los cuatro porcentajes

`PATCH /api/presupuestos/:id/porcentajes` con `{ a, i, u, iva }` como cadenas en
puntos —`"10"`, no `"0.10"`—. Al escribir acepta `"10"`, `"10.00"` o `"10.5"`.

**Al leer salen con seis decimales: `"10.000000"`.** El dominio `app.porcentaje`
es `numeric(9,6)` y el servidor no redondea, igual que con `incidenciaPct`: el
recorte a dos decimales es de presentación y lo hace el formateador.

Se editan en el panel del pie y solo con el presupuesto Abierto. Responde con el
`pie` recalculado.

---

## 5. Recursos (02 §5)

| Ruta | Qué hace | Permiso |
|---|---|---|
| `GET /api/unidades[?para=APU]` | Las unidades de un desplegable | `RECURSOS.VER`, o `APU.VER` con `?para=APU` |
| `GET /api/recursos` | Catálogo filtrado | `RECURSOS.VER` |
| `POST /api/recursos` | Crear | `RECURSOS.CREAR` |
| `GET /api/recursos/:id` | Uno | `RECURSOS.VER` |
| `PUT /api/recursos/:id` | Editar | `RECURSOS.EDITAR` |
| `DELETE /api/recursos/:id` | Eliminar · 204 | `RECURSOS.ELIMINAR` |
| `GET /api/recursos/:id/presupuestos-afectados` | Los ABIERTOS que lo usan | `RECURSOS.VER` |

`GET /api/unidades` **no** pide `CONFIG.PREFERENCIAS`: esa es la pestaña que
administra las unidades, y elegir una en un formulario solo pide ver el módulo.
`?para=APU` existe para que la pantalla de APU no necesite el permiso de
Recursos solo para llenar un desplegable.

```
Unidad  = { id, simbolo, descripcion }
Recurso = { id, codigo, nombre, tipo, unidadId, unidadSimbolo,
            precioBase, ivaPct, precioTotal, viaCaptura, activo }
```

Filtros de `GET /api/recursos`: `tipo`, `texto`, `unidadId`, `precioMin`,
`precioMax`. Con `tipo` y `texto` a la vez filtra por los dos a la vez. Si una
pestaña «se rompe» al escribir en el buscador, el síntoma es ese: la pantalla
dejó de mandar `tipo`.

Cuerpo de `POST` y `PUT`:
`{ nombre, tipo, unidadId, precioBase, ivaPct?, precioTotal, viaCaptura }`.
Sin `ivaPct` vale 0 (RF-REC-08). El `PUT` lleva además
`presupuestosAReapuntar?: id[]` y responde `{ recurso, apusVersionados }`.

**Las dos excepciones a la regla 1.1**, escritas acá para que no parezcan un
descuido. Las dos viven en `web/src/decimal.ts`, con aritmética decimal exacta
sobre enteros grandes, y ninguna otra parte de la interfaz hace cuentas.

1. **El precio complementario del recurso** lo calcula la pantalla (RF-REC-09),
   porque el usuario lo ve cambiar mientras escribe, y **es la única cifra
   calculada que se envía**. La base exige `round(…, 6)` con redondeo a la mitad
   alejándose del cero, igual que `round()` de PostgreSQL, así que la pantalla
   tiene que redondear igual o el servidor la rechaza. Comprobado contra el
   `Decimal` de Python en 4000 casos al azar, con cero diferencias.
2. **Las vistas previas que el 02 §2 pide «en tiempo real»**: el subtotal de
   una línea de APU y su costo directo, el costo de una actividad mientras se
   escribe la cantidad, y el pie mientras se escriben los cuatro porcentajes.
   **No se envían nunca**, se muestran en cursiva con el aviso «vista previa»
   y desaparecen cuando llega la cifra del servidor. Es lo que dice el 02 §2:
   «la cifra que vale es la que confirma el servidor al guardar».

Ampliar cualquiera de las dos es una decisión de este contrato, no de una
pantalla.

## 6. APU (02 §6)

| Ruta | Qué hace | Permiso |
|---|---|---|
| `GET /api/apus` | Catálogo, incluidos los inactivos | `APU.VER` |
| `POST /api/apus` | Crear | `APU.CREAR` |
| `GET /api/apus/:id` | Uno, con sus líneas | `APU.VER` |
| `PUT /api/apus/:id` | Editar | `APU.EDITAR` |
| `PATCH /api/apus/:id` | `{ activo }` | `APU.EDITAR` |
| `DELETE /api/apus/:id` | Eliminar · 204 | `APU.ELIMINAR` |
| `GET /api/apus/:id/presupuestos` | Los presupuestos que lo usan | `APU.VER` |

Filtros de `GET /api/apus`: `texto`, `unidadId`. Trae los inactivos a propósito;
las versiones no viajan en el listado (02 §6.4).

```
ApuDeLista = { id, codigo, nombre, unidadId, unidadSimbolo, activo, costoDirecto }
Linea      = { recursoId, recursoCodigo, recursoNombre, recursoTipo,
               unidadSimbolo, precioUnitario, cantidad, rendimiento,
               desperdicioPct, subtotal }
```

Cuerpo de `POST` y `PUT`:
`{ nombre, unidadId, lineas: [{ recursoId, cantidad, rendimiento, desperdicioPct? }] }`.
Un 422 de una línea marca su posición en `campo`, por ejemplo
`"lineas.0.cantidad"`. El `PUT` lleva `presupuestosAReapuntar?` y responde
`{ apu, itemsReapuntados }`. Un `DELETE` de un APU en uso es 422 con el mensaje
que ofrece desactivarlo, no un 409.

`GET /api/apus/:id/presupuestos` trae **todos** los estados; la pregunta del
02 §6.4 es solo por los ABIERTOS, así que la pantalla filtra. Está así para que
el listado sirva también de «dónde se usa esto».

**Permisos (D-70):** un rol con `APU.CREAR` o `APU.EDITAR` tiene por fuerza
`RECURSOS.VER` — la base rechaza la configuración contraria al confirmar la
transacción. La pantalla de APU puede dar por hecho que el buscador de recursos
responde; si no responde, es una falla, no una configuración posible.

## 7. Configuración (02 §11)

| Ruta | Qué hace | Permiso |
|---|---|---|
| `GET /api/configuracion/cuenta` | `{ nombre, email, rol }` | ninguno |
| `POST /api/configuracion/cuenta/contrasena` | `{ actual, nueva }` · 204 | ninguno |
| `GET|PUT /api/configuracion/empresa` | Datos de la empresa | `CONFIG.EMPRESA` |
| `GET|PUT /api/configuracion/preferencias` | Formato y avisos | `CONFIG.PREFERENCIAS` |
| `GET /api/configuracion/suscripcion` | Estado y pagos | `CONFIG.SUSCRIPCION` |
| `GET|POST /api/configuracion/unidades` | Unidades propias | `CONFIG.PREFERENCIAS` |
| `PUT|DELETE /api/configuracion/unidades/:id` | Editar y borrar | `CONFIG.PREFERENCIAS` |

Mi cuenta no pide permiso: nadie necesita autorización para ver su propio
nombre ni para cambiar su propia contraseña.

El cambio de contraseña responde 204 **y una cookie nueva**, porque mueve el
sello de credenciales (D-67) y con eso cierra todas las demás sesiones de esa
persona. Sin la cookie nueva, quien cambia la contraseña se queda afuera él
mismo. Una `actual` equivocada es **422 con `campo: "actual"`, no 401**: la
sesión es válida, lo que está mal es un campo del formulario; un 401 haría que
la interfaz lo mande a la pantalla de ingreso. Cinco equivocadas dan 429.

```
Empresa       = { razonSocial, nit, direccion, telefono, emailRecuperacion }
Preferencias  = { monedaBase, separadorMiles, separadorDecimal, decimalesVista,
                  notifVencimiento, notifCambioEstado }
Suscripcion   = { estado, plan, venceEl, diasRestantes,
                  pagos: [{ id, fecha, concepto, monto, moneda, metodo,
                            estado, facturaNumero }] }
```

`Empresa` trae `logoId` desde el §13: el logo vive en `app.logo` (D-71)
mientras no haya almacenamiento de objetos. El estado de la suscripción sale de
`fn_estado_suscripcion`, la misma del arranque, así que la pestaña y la barra
superior no pueden discrepar. Una suscripción VENCIDA o CANCELADA se consulta
igual: es justo cuando hace falta.

Una unidad en uso no se borra: 422 que dice **dónde** está en uso («está en uso
en 1 recurso…»), no «algo de lo que eligió ya no existe».

## 8. Exportación y versiones

| Ruta | Qué hace | Permiso |
|---|---|---|
| `GET /api/presupuestos/:id/exportar?formato=pdf\|xlsx` | El archivo, como adjunto | `PRESUPUESTOS.EXPORTAR` |
| `GET /api/versiones/:id/exportar?formato=pdf\|xlsx` | Una versión congelada | `PRESUPUESTOS.EXPORTAR` |
| `GET /api/presupuestos/:id/versiones` | El historial de versiones | `PRESUPUESTOS.VER` |

El nombre del adjunto es el del presupuesto: `PRE-001.pdf`,
`PRE-001 - Versión 1.pdf`. Exportar funciona con la suscripción vencida (D-65):
los datos son del cliente.

```
Version = { id, numero, tipo, disparador, estado, motivo, valorTotal,
            creadaEn, autor }
```

## 9. Lo que este contrato todavía no cubre

Para que nadie lo lea creyendo que está completo: no están el cambio de estado
—activar, cerrar, reabrir—, duplicar, archivar, eliminar, el historial, el
superadministración ni el logotipo: los dos están propuestos en el §12 y el §13.
Entran cuando les toque. Los usuarios y roles (02 §11.4) están en el §11.

---

## 10. Importación desde Excel (propuesto el 6 de octubre de 2026, construido el 7: `eccae1f`)

Decisión del dueño, 6 de octubre de 2026: el ingeniero descarga una plantilla,
la llena en Excel y la sube para crear recursos o APU en bloque. La interfaz
es `web/src/modulos/comun/ImportarExcel.tsx`. Desde el 8 de octubre, un
nombre que ya existe en el catálogo, o que se repite dentro del archivo, es
error de la fila (`e7ade2c`, `a1c618e`): sin distinguir mayúsculas ni espacios
de los bordes.

### 10.1 Las cuatro rutas

| Método y ruta | Qué hace | Permiso |
|---|---|---|
| `GET /api/recursos/plantilla` | La plantilla de recursos, como adjunto `.xlsx` | `RECURSOS.CREAR` |
| `POST /api/recursos/importar` | Crea los recursos del archivo | `RECURSOS.CREAR` |
| `GET /api/apus/plantilla` | La plantilla de APU, como adjunto `.xlsx` | `APU.CREAR` |
| `POST /api/apus/importar` | Crea los APU del archivo | `APU.CREAR` |

La plantilla la arma la API con `exceljs`, que ya usa para exportar. El cuerpo
del `POST` es **el archivo tal cual**, con `content-type:
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`: ni JSON
ni `multipart`. Tope de 2 MB y de 2000 filas por hoja; por encima, 413 con un
mensaje que pide dividir el archivo.

### 10.2 Las reglas que no se negocian

- **Todo o nada.** El archivo entero se valida y se inserta en **una sola
  transacción**. Si una fila falla, no entra ninguna. Así un archivo a medio
  corregir nunca deja el catálogo a medias, y volver a subirlo no duplica lo
  que sí había entrado. Es la respuesta del dueño a «qué pasa con las filas
  malas».
- **Solo crea; nunca actualiza.** El código lo asigna la base, como en el
  formulario. Editar por Excel se saltaría la pregunta de qué proyectos
  abiertos se actualizan (02 §5.3 y §6.4). Un archivo que repite un recurso o
  un APU que ya existe es un error de esa fila, no una edición.
- **Las cifras no pasan por coma flotante al guardarse.** Excel guarda los
  números como dobles; la API lee el valor de la celda, lo convierte a texto
  decimal con hasta seis decimales y redondeo a la mitad alejándose del cero,
  y desde ahí sigue como cualquier otra cifra (regla 1.1). Una celda con texto
  que no es una cifra («doce mil») es un error de esa fila.
- **Las mismas validaciones que el formulario**, con los mismos mensajes. La
  base sigue siendo el respaldo: un rechazo suyo dentro de la transacción se
  traduce a la fila que lo causó.

### 10.3 La plantilla de recursos

Hoja **Instrucciones**, primero, con lo de abajo en palabras. Hoja
**Recursos**, una fila por recurso:

| Columna | Regla |
|---|---|
| Nombre | Obligatorio. |
| Tipo | Lista desplegable: Material, Equipo, Personal, Actividad a todo costo. |
| Unidad | Lista desplegable con los símbolos de la empresa, leídos al descargar. |
| Precio base (sin IVA) | **Uno solo** de los dos precios. |
| IVA % | Vacío es 0 %. |
| Precio total (con IVA) | **Uno solo** de los dos precios. |

La vía de captura se deduce de cuál precio se llenó, y el otro se calcula con
la misma igualdad de `ck_recurso_precios_cuadran`. Los dos llenos es un error
de la fila, aunque cuadren: no hay forma de saber cuál capturó la persona. Una
hoja oculta **Listas** sostiene las listas desplegables.

### 10.4 La plantilla de APU

- **Instrucciones**, primero.
- **APU**: una fila por APU con Clave (la pone el ingeniero: A1, A2…; solo une
  las dos hojas y no se guarda), Nombre de la actividad y Unidad (lista
  desplegable).
- **Composición**: una fila por línea con Clave del APU, Código del recurso,
  Cantidad, Rendimiento y Desperdicio %.
- **Recursos**: el catálogo vigente de la empresa —código, nombre, tipo,
  unidad, precio total—, de solo consulta, para buscar los códigos.

Errores de fila propios de esta plantilla: una clave repetida en APU; una línea
cuya clave no está en APU; un APU sin líneas (D-21); un código de recurso que
no existe o que es de otra empresa —el mismo error para los dos, RN-01—;
cantidad o rendimiento en cero o con más de seis decimales; desperdicio en un
recurso que no es material.

### 10.5 Las respuestas

Bien: **201** `{ creados: n }`.

Rechazado: **422** con la forma plana de siempre más una lista:

```json
{
  "mensaje": "El archivo tiene 3 errores y no se importó nada. Corríjalos y vuelva a subirlo.",
  "errores": [
    { "hoja": "Recursos", "fila": 4, "columna": "Unidad",
      "mensaje": "La unidad «mts» no existe en su empresa. Elija una de la lista desplegable." },
    { "hoja": "Recursos", "fila": 9, "columna": null,
      "mensaje": "Escriba uno solo de los dos precios, no los dos." }
  ]
}
```

`fila` es el número que Excel muestra a la izquierda, contando el encabezado:
la persona tiene que poder ir directo a ella. `columna` es el título de la
columna como sale en la plantilla, o `null` si el error es de la fila entera.
Se informan **todos** los errores del archivo, no solo el primero. Un archivo
que no es un `.xlsx` o que no trae la hoja esperada es un 422 sin `errores`,
con un mensaje que lo dice.

---

## 11. Usuarios y roles (propuesto el 8 de octubre de 2026, construido el mismo día: `8660a76`)

02 §11.4. La pestaña «Usuarios» de Configuración. La interfaz ya la consume
(`web/src/modulos/configuracion/Usuarios.tsx` y la pantalla
`#/activar?token=`); la API todavía no la tiene. Hasta que exista, la pestaña
muestra el 404 con «Reintentar».

Todas las rutas de §11.1 y §11.2 piden `USUARIOS.GESTIONAR`. Escribir respeta
el solo lectura de la suscripción, como cualquier otra escritura.

### 11.1 Una sola lectura para toda la pestaña

`GET /api/usuarios` →

```
PanelDeUsuarios = {
  plan:     { codigo: 'PERSONAL' | 'EMPRESARIAL',
              maxUsuarios: number | null,       // null = sin límite
              rolesPersonalizados: boolean },
  usuarios: Usuario[],      // activos, después pendientes, después revocados; por nombre
  roles:    Rol[],          // Administrador, Asistente, después los personalizados por nombre
  permisos: PermisoDelCatalogo[]   // app.permiso SIN 'PRESUPUESTOS.ESTADO', en el orden del catálogo
}

Usuario = { id, nombre, email,
            estado: 'PENDIENTE' | 'ACTIVO' | 'REVOCADO',
            rolId, rolNombre, rolTipo: 'ADMIN' | 'ASISTENTE' | 'PERSONALIZADO',
            creadoEn, ultimoAcceso: Instante | null,
            activacionVenceEn: Instante | null,   // el enlace de activación vigente, si hay uno
            esUsted: boolean }

Rol = { id, nombre, tipo: 'ADMIN' | 'ASISTENTE' | 'PERSONALIZADO',
        permisos: Permiso[],
        usuarios: number }    // cuántos usuarios lo tienen, revocados incluidos

PermisoDelCatalogo = { codigo, modulo, accion, descripcion }
```

`plan` viaja aquí y no en el arranque: solo esta pestaña lo necesita. La
pantalla lo usa para dos cosas: en el plan Personal muestra «su asistente» y
los permisos del rol Asistente, sin la sección de roles; en el Empresarial
muestra la sección de roles. El límite lo hace cumplir la base
(`tg_limites_plan_usuario`, `tg_limites_plan_rol`); la pantalla solo evita
ofrecer lo que la base va a rechazar.

`PRESUPUESTOS.ESTADO` no sale en el catálogo porque no es delegable: es del
rol Administrador y nadie lo marca ni lo desmarca.

### 11.2 Usuarios

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/usuarios` | `{ nombre, email, rolId }` | 201 `Usuario`, en PENDIENTE |
| `PUT /api/usuarios/:id` | `{ nombre, email, rolId }` | 200 `Usuario` |
| `POST /api/usuarios/:id/revocar` | — | 200 `Usuario` |
| `POST /api/usuarios/:id/restituir` | — | 200 `Usuario` |

- **Invitar no fija contraseña** (D-7). Hasta la fase 8 tampoco manda correo:
  el enlace de activación lo genera el dueño de ConstruSoft (§11.4). Decisión
  del dueño, 8 de octubre de 2026: el administrador **no ve** el enlace,
  porque quien lo tiene puede fijar la contraseña de otra persona.
- **El correo se edita solo mientras el usuario está PENDIENTE.** Después es
  su identidad de ingreso; cambiarlo es 422 con `campo: "email"`.
- **El correo es único en todo ConstruSoft**, no por empresa (`app.usuario.
  email`). Repetido: 422 con `campo: "email"` y «Ese correo ya tiene una
  cuenta en ConstruSoft. Cada correo pertenece a una sola empresa: use otro.»
  No dice de qué empresa (RN-01).
- **Revocar** deja la fila (trazabilidad) y corta en la petición siguiente,
  por la rama de estado de `fn_exigir_permiso`. Revocarse a sí mismo es 422:
  «No puede retirarse el acceso a sí mismo. Pídaselo a otro administrador.»
- **Restituir** devuelve a ACTIVO a quien ya tenía contraseña, y a PENDIENTE a
  quien nunca la fijó. Cuenta para el límite del plan.
- **El último administrador activo** (D-29) no se revoca ni cambia de rol: la
  base lo rechaza con «“X” es el único administrador activo de la empresa…»,
  que va tal cual, sin `campo` si es revocar y con `campo: "rolId"` si es
  editar.
- **El límite del plan** (RN-11): 422 sin `campo` con el mensaje de la base,
  en palabras de persona: «Su plan Personal admite 2 usuarios y ya los tiene.
  Revoque uno o cambie al plan Empresarial.»
- No hay `DELETE`: un usuario se revoca, no se borra. El historial lo nombra.

### 11.3 Roles

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/roles` | `{ nombre, permisos: Permiso[] }` | 201 `Rol`, siempre PERSONALIZADO |
| `PUT /api/roles/:id` | `{ nombre, permisos: Permiso[] }` | 200 `Rol` |
| `DELETE /api/roles/:id` | — | 204 |

- `permisos` es la lista **completa** del rol, no un cambio: la API reemplaza
  las filas de `app.rol_permiso` del rol en una sola transacción, y por eso
  `tg_rol_permisos_coherentes`, que es diferido, ve el resultado final.
- **Crear y borrar roles es solo del plan Empresarial** (RN-11). En el
  Personal, la pantalla edita únicamente los permisos del rol Asistente.
- **Administrador no se edita**: 422 «El rol Administrador tiene todos los
  permisos y no se modifica». Asistente sí se edita, pero **no se renombra**,
  y no puede llevar `USUARIOS.GESTIONAR` (`fn_permiso_no_delegable`).
- **Las reglas de la matriz** son las del esquema, y la pantalla ya las aplica
  al marcar, así que solo deberían llegar si alguien llama la API directo:
  «Ver» es prerrequisito de su módulo (RF-CFG-25); editar proyectos exige Ver
  APU (D-59); crear o editar APU exige Ver recursos (D-70). 422 sin `campo`,
  con el mensaje de la base.
- Nombre repetido en la empresa (`UNIQUE (tenant_id, nombre)`): 422 con
  `campo: "nombre"`.
- Un rol con usuarios, aunque estén revocados, no se borra: 422 que dice
  cuántos («El rol «Residente» lo tienen 2 usuarios. Cámbielos de rol antes de
  eliminarlo.»).
- Cambiar los permisos de un rol vale desde la petición siguiente de sus
  usuarios: la API comprueba cada vez. Su menú se pone al día al recargar.

### 11.4 La activación

`POST /api/activacion` con `{ token, contrasena }` → 204. Mismas reglas que
`POST /api/recuperacion`: el token viaja después del «#», uso único, el mismo
límite de intentos por IP, contraseña de mínimo 8 caracteres con
`campo: "contrasena"`. Consume un token con `proposito = 'ACTIVACION'`, fija
`password_hash` y pasa el usuario de PENDIENTE a ACTIVO. Un token de
recuperación aquí, o uno de activación en `/api/recuperacion`, es el mismo
error que un token que no existe. Después la persona ingresa con su correo.

Hasta la fase 8 el enlace lo entrega el dueño:

```
npm run activacion -- correo@empresa.com
```

Imprime `URL_ACTIVACION` + token, vence a las 72 horas y anula el enlace
anterior de esa persona (RF-AUT-18). Solo para usuarios PENDIENTE. En
desarrollo, `URL_ACTIVACION="http://localhost:5173/#/activar?token="`, **con
comillas**: sin ellas, el `--env-file` de Node toma el `#` como comentario.

---

## 12. Superadministración (PROPUESTO el 9 de octubre de 2026, sin construir)

Fase 7, RF-SAD-01 a 15. Decisión del dueño, 9 de octubre de 2026: se construye
ya, en local; el correo y el despliegue esperan. La interfaz es una aplicación
aparte dentro de `web/` (`web/superadmin/index.html`, servida en
`/superadmin/`): no comparte pantalla de ingreso, sesión ni código de pantallas
con la de las empresas (02 §3.5), y el paquete de las empresas no carga nada de
ella.

### 12.1 Conexión, sesión y alta del superadministrador

- **Otra conexión a la base**: el rol `superadmin_login` del §16.8 del esquema,
  miembro de `construsoft_superadmin`. Su cadena va en una variable nueva del
  `.env` que **crea y escribe el dueño**, con la contraseña del rol. Ninguna
  ruta de §12 usa la conexión de la aplicación, ni al revés.
- **Otra cookie**: `cs_plataforma`, HttpOnly, Secure, SameSite=Strict, con
  `Path=/api/superadmin` y vigencia de 2 horas. Una cookie de empresa no abre
  ninguna ruta de §12, y esta no abre ninguna de las demás.
- **Alta por terminal**: `npm run superadmin -- correo@dominio "Nombre"` pide la
  contraseña **dos veces en la terminal, sin mostrarla**, y crea la fila en
  `plataforma.usuario_plataforma` con argon2id. La escribe el dueño; ningún
  asistente la ve ni la propone (regla 8 del CLAUDE.md).
- `POST /api/superadmin/sesion` `{ email, contrasena }` → 200 `{ nombre, email }`.
  Mismo mensaje para correo inexistente, contraseña errada o cuenta inactiva, y
  el mismo límite de intentos que el ingreso de empresas.
- `GET /api/superadmin/sesion` → 200 `{ nombre, email }` o 401.
- `DELETE /api/superadmin/sesion` → 204.
- Cada escritura fija el autor que piden `fn_evento_plataforma`,
  `fn_registrar_pago`, `fn_designar_admin` y `fn_eliminar_tenant`. Ninguna
  acción del panel queda sin firmar en `plataforma.evento_plataforma`.

### 12.2 Las formas

```
EstadoComercial = 'EN_PRUEBA' | 'ACTIVA' | 'VENCIDA' | 'CANCELADA' | 'SIN_SUSCRIPCION'
                  // el de fn_estado_suscripcion; «suspendida» va aparte, porque
                  // no es un estado de la suscripción sino del inquilino

FilaDeEmpresa = { id, razonSocial, nit, planCodigo: 'PERSONAL'|'EMPRESARIAL'|null,
                  estado: EstadoComercial, suspendida: boolean,
                  venceEl: Fecha|null, diasRestantes: number|null,
                  usuarios: number,        // sin revocar
                  proyectos: number,
                  registradaEn: Instante,
                  eliminableDesde: Fecha|null }   // solo pruebas sin convertir (RF-SAD-13)

Resumen = { empresas: { total, enPrueba, activas, vencidas, canceladas, suspendidas },
            nuevasEsteMes: number,
            ingresosDelMes: Dinero, moneda: 'COP',
            proyectos: number,
            porPlan: { PERSONAL: number, EMPRESARIAL: number },
            porVencer: FilaDeEmpresa[],          // vencen en 7 días o menos (RF-SAD-10)
            pruebasSinConvertir: FilaDeEmpresa[] } // prueba vencida, sin pago

FichaDeEmpresa = {
  empresa:     { id, razonSocial, nit, direccion, telefono, emailRecuperacion,
                 registradaEn, suspendida: boolean },
  suscripcion: { id, planCodigo, estado: EstadoComercial, fechaInicio: Fecha,
                 venceEl: Fecha, diasRestantes: number,
                 canceladaEn: Instante|null, canceladaMotivo: string|null } | null,
  usuarios:    [{ id, nombre, email, rolNombre, rolTipo, estado, ultimoAcceso }],
  cifras:      { proyectos, recursos, apus },
  pagos:       PagoDePlataforma[],          // del más reciente al más antiguo
  eventos:     EventoDePlataforma[],        // los de esta empresa
  eliminableDesde: Fecha|null }

PagoDePlataforma = { id, fecha: Fecha, concepto, monto: Dinero, moneda, metodo,
                     referencia: string|null, periodoMeses: number|null,
                     cubreHasta: Fecha, soporteId: string|null,
                     registradoPor: string, registradoEn: Instante,
                     empresa: { id, razonSocial } }

EventoDePlataforma = { id, tipo, descripcion, justificacion: string|null,
                       ocurridoEn: Instante, autor: string|null,
                       empresa: { id, razonSocial } | null }   // null si se eliminó
```

`Fecha` es «aaaa-mm-dd» sin hora. **El panel no ve proyectos ni catálogos**
(01 §9: «no opera obras ni ve el detalle técnico»): solo conteos.

### 12.3 Las rutas

Todas bajo `/api/superadmin`, con la cookie `cs_plataforma`.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /resumen` | — | `Resumen` (RF-SAD-02, 10) |
| `GET /empresas?texto=&estado=&plan=` | — | `{ empresas: FilaDeEmpresa[] }` (RF-SAD-03). `texto` busca en razón social y NIT sin distinguir mayúsculas ni tildes («rios» encuentra «Ríos»); `estado` acepta los de `EstadoComercial` y `SUSPENDIDA` |
| `GET /empresas/:id` | — | `FichaDeEmpresa` |
| `POST /empresas/:id/suspender` | `{ motivo }` | `FichaDeEmpresa` (RF-SAD-04) |
| `POST /empresas/:id/reactivar` | `{ motivo }` | `FichaDeEmpresa` (RF-SAD-05) |
| `PUT /empresas/:id/suscripcion` | `{ planCodigo, venceEl, motivo }` | `FichaDeEmpresa` (RF-SAD-06) |
| `POST /empresas/:id/suscripcion/cancelar` | `{ motivo }` | `FichaDeEmpresa` (RF-SAD-07) |
| `GET /empresas/:id/pagos/propuesta?periodoMeses=n` | — | `{ cubreHasta: Fecha }` |
| `POST /soportes` | el archivo tal cual | 201 `{ id }` |
| `GET /soportes/:id` | — | el archivo |
| `POST /empresas/:id/pagos` | ver abajo | 201 `FichaDeEmpresa` (RF-SAD-09, 12) |
| `GET /pagos?desde=&hasta=` | — | `{ pagos: PagoDePlataforma[], total: Dinero, moneda }` (RF-SAD-08) |
| `POST /empresas/:id/administrador` | `{ email, nombre, justificacion }` | `FichaDeEmpresa` (RF-SAD-14) |
| `DELETE /empresas/:id` | `{ justificacion, confirmacion }` | 204 (RF-SAD-13, 15) |
| `GET /eventos?empresaId=` | — | `{ eventos: EventoDePlataforma[] }`, los 200 más recientes |

Las reglas:

- **`motivo` y `justificacion` son obligatorios** donde aparecen, y quedan en
  `plataforma.evento_plataforma`. Vacío: 422 con `campo`.
- **Suspender no es cancelar.** Suspender corta el acceso de la empresa sin
  tocar su suscripción, y la empresa lo ve como «suspendida por la
  administración» (02 §3.4). Cancelar es comercial. Las dos conservan todo.
- **Cambiar plan o vencimiento**: el paso a un plan menor lo frena
  `fn_plan_cabe` con su mensaje; va tal cual. `venceEl` en el pasado es 422 con
  `campo: "venceEl"`.
- **Registrar un pago**: `{ fecha, concepto, monto, metodo, referencia,
  periodoMeses, cubreHasta, soporteId }`.
  - `monto` es `Dinero` en texto (regla 1.1). `metodo` es uno de
    `TRANSFERENCIA`, `PSE`, `EFECTIVO`, `OTRO`.
  - Llega `periodoMeses` **o** `cubreHasta`. Si viene la fecha, manda la fecha
    (D-36); si no, la base propone `max(vencimiento, hoy) + período`.
  - La pantalla muestra antes la fecha que resultaría con `GET …/propuesta`, y
    **no la calcula ella**: sumar meses tiene casos borde (31 de enero + 1 mes)
    y la regla vive en la base.
  - Un pago que dejaría el vencimiento en el pasado: 422 con
    `campo: "cubreHasta"`, con el mensaje de la base.
- **Comprobantes** (D-71): `POST /soportes` recibe el archivo tal cual, como la
  importación (§10): PNG, JPEG o PDF, hasta 5 MB, comprobando la firma del
  archivo y no la extensión. Más grande: 413. Otro tipo: 422. `GET
  /soportes/:id` lo devuelve con su tipo guardado, `nosniff` e `inline`, sin
  nombre de archivo del usuario.
- **Designar administrador** (RF-SAD-14): con `fn_designar_admin`. Si el correo
  no existe en la empresa, la persona nace PENDIENTE y **el enlace lo genera el
  dueño con `npm run activacion`**, igual que los invitados (§11.4), hasta que
  exista el correo. La justificación dice cómo se verificó la identidad de quien
  lo pidió; la pantalla lo pide con esas palabras.
- **Eliminar** (RF-SAD-13, 15): con `fn_eliminar_tenant`. `confirmacion` es la
  razón social escrita a mano; si no coincide, 422 con `campo: "confirmacion"`.
  Una empresa que pagó o que todavía no lleva 10 días con la prueba vencida no
  se elimina: el mensaje de la base va tal cual.

## 13. El logotipo de la empresa (PROPUESTO el 9 de octubre de 2026, sin construir)

02 §11.2, RF-CFG-05, RNF-20. Con D-71 la imagen vive en `app.logo` mientras no
haya almacenamiento de objetos, y `plataforma.tenant.logo_ruta` guarda el id
de la vigente.

| Método y ruta | Cuerpo | Respuesta | Permiso |
|---|---|---|---|
| `GET /api/configuracion/empresa` | — | `Empresa` con `logoId: string \| null` | `CONFIG.EMPRESA` |
| `PUT /api/configuracion/empresa/logo` | la imagen tal cual | 200 `Empresa` | `CONFIG.EMPRESA` |
| `DELETE /api/configuracion/empresa/logo` | — | 200 `Empresa`, con `logoId: null` | `CONFIG.EMPRESA` |
| `GET /api/logos/:id` | — | la imagen | sesión de la empresa |

- **Solo PNG y JPEG, hasta 1 MB**, comprobando la firma del archivo y no el
  `content-type` que diga el navegador. Otro tipo: 422 «El logotipo tiene que
  ser una imagen PNG o JPEG.». Más grande: 413 «El logotipo pesa más de 1 MB.
  Redúzcalo e intente de nuevo.».
- **Subir** calcula el sha256, inserta en `app.logo` si esa imagen no estaba
  (la llave es empresa y hash) y deja su id en `logo_ruta`. Subir otra vez la
  misma imagen no crea otra fila.
- **Quitar** deja `logo_ruta` en nulo y **no borra la imagen**: una versión
  congelada puede estar nombrándola (D-64). La aplicación no tiene DELETE sobre
  `app.logo`.
- **`GET /api/logos/:id`** sirve con el tipo guardado, `nosniff`, `inline` y
  caché larga e inmutable: el id ya identifica el contenido. Un id de otra
  empresa es 404, como uno que no existe (RN-01).
- **PDF y Excel**: una exportación del proyecto vivo usa el logo vigente; la de
  una versión usa el `logo_ruta` de su fotografía, aunque la empresa haya
  cambiado de logo después. El logo se encaja en su espacio del encabezado
  conservando la proporción. Sin logo, el encabezado queda como hoy.
