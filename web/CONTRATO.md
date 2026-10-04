# Contrato de la API web

Este archivo describe los endpoints que consume la interfaz. Existe porque dos
asistentes trabajan en paralelo: **la interfaz la escribe uno y la API el otro**,
y sin un contrato escrito cada uno adivinaría la forma del otro.

**Quién manda cuando hay desacuerdo.** El esquema (`docs/05`) manda sobre este
archivo; este archivo manda sobre las dos implementaciones; y el documento 02
manda sobre lo que la pantalla tiene que hacer. Si la API y este archivo
discrepan, no se arregla el código en silencio: se dice, y se corrige el que
esté equivocado.

**Versión:** borrador 4, 4 de octubre de 2026. Derivado del 02 §7 y §8 y de las
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

## 3. Lo que ya existe (rebanada 6.1)

| Método y ruta | Para qué |
|---|---|
| `POST /api/registro` | Alta de empresa, con la casilla de términos y su versión |
| `POST /api/sesion` | Ingreso |
| `DELETE /api/sesion` | Salir |
| `GET /api/sesion` | El arranque: usuario, permisos, estado de la suscripción |
| `GET /api/terminos` | Los documentos legales de la versión vigente |
| `POST /api/recuperacion` | Pide un enlace de recuperación |
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

## 4. Lo que falta: la mesa de trabajo

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
| `POST /api/presupuestos/:id/capitulos` | `{ nombre, clasificacion }` | Primer nivel. `clasificacion` es obligatoria y sin valor por defecto (02 §8.4) |
| `POST /api/nodos/:nodoId/subniveles` | `{ nombre }` | Hereda la clasificación; no la acepta. En un presupuesto en modo `ITEMS` la base lo rechaza con 422, así que la interfaz esconde el botón mirando `modoEstructura` |
| `PATCH /api/nodos/:id` | `{ nombre }` o `{ clasificacion }` | Reclasificar solo donde `padreId === null`, que es la definición de capítulo de primer nivel |
| `POST /api/nodos/:id/mover` | `{ posicion }` | Absoluta, entre sus hermanos (sección 1.4) |
| `DELETE /api/nodos/:id` | — | 409 si tiene contenido y no llega `?confirmado=si`. Los conteos van **dentro del `mensaje`** («tiene 2 subniveles y 7 actividades…»), así que el cuerpo sigue siendo `{ mensaje }` |

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

## 5. Lo que este contrato todavía no cubre

Para que nadie lo lea creyendo que está completo: no están el alta de
presupuesto, el cambio de estado —activar, cerrar, reabrir—, duplicar, archivar,
eliminar, las exportaciones, los módulos de Recursos y APU completos, el
historial ni la configuración. Entran cuando les toque su rebanada.
