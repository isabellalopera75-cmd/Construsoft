# El frontend de ConstruSoft · tonos, letras, espaciado y orden

Referencia para construir pantallas sin volver a decidir lo ya decidido.

**Lo que manda es `src/estilos/tokens.css`.** Este documento explica el porqué;
los valores viven allá y en ningún otro lado. Ningún color, tamaño ni margen se
escribe directo en un componente: si hace falta uno que no existe, se agrega al
archivo de tokens con su razón al lado, no en el componente.

De dónde sale: la paleta es la de `prototipo/css/styles.css`, tal como quedó
después de la revisión de accesibilidad del 25 de septiembre de 2026. Las
escalas de tipografía y espaciado son nuevas, y el porqué está en la sección 4.

---

## 1. El carácter

Terracota sobre carbón azulado. Es una herramienta de trabajo para alguien que
mira cifras varias horas seguidas, así que manda la legibilidad: el color se usa
para señalar, no para decorar. En una pantalla típica hay un solo elemento
terracota —la acción principal— y todo lo demás es texto sobre fondo.

Arranca en oscuro, porque esa es la identidad. Si el sistema operativo de quien
entra está en claro, respeta eso. Una elección manual gana sobre las dos y se
guarda en `data-tema` del `<html>`.

---

## 2. La paleta y el trabajo de cada tono

| Token | Para qué |
|---|---|
| `--bg-app` | El fondo de la ventana. Nada se escribe directo encima salvo títulos. |
| `--bg-barra` | La barra lateral y la superior. |
| `--bg-tarjeta` | Toda superficie que contiene algo: tarjetas, filas, paneles. |
| `--bg-tarjeta-hover` | Solo el paso del cursor. No es un estado seleccionado. |
| `--bg-campo` | El fondo de un campo de texto. |
| `--borde-tenue` | Separar bloques. **Decorativo: no sirve para delimitar un control.** |
| `--borde-campo` | El borde de un campo o un control. Este sí tiene mínimo de contraste. |
| `--borde-activo` | El campo que tiene el foco. |
| `--terracota` | Enlaces, acentos, el número de una cifra destacada. |
| `--terracota-boton` | **Solo** como fondo de botón con texto blanco. Medio paso más oscuro. |
| `--terracota-halo` | El anillo de foco y el resplandor de un control activo. |
| `--terracota-velo` | Un fondo apenas teñido: la fila seleccionada, una franja de aviso. |
| `--texto` | Texto normal. |
| `--texto-segundo` | Etiquetas, encabezados de columna, datos de apoyo. |
| `--texto-apagado` | Lo que está ahí pero no se lee primero: un guion, una ayuda. |
| `--exito`, `--peligro`, `--aviso` | Estado. Nunca solos: siempre con texto o con un icono. |

**El color nunca es la única señal.** Un presupuesto Activo no se distingue del
Cerrado por el color de su insignia: la insignia dice «Activo». Quien no
distingue esos dos tonos tiene que poder trabajar igual.

---

## 3. Los contrastes, medidos

No son estimaciones: salen de la fórmula de la WCAG 2.1 corrida sobre los
valores del archivo de tokens. El mínimo es 4,5:1 para texto y 3:1 para el borde
de un control (pauta 1.4.11).

**Tema oscuro**

| Token | Valor | sobre `--bg-app` | sobre `--bg-tarjeta` | Mínimo | |
|---|---|---|---|---|---|
| `--texto` | `#f1f4fa` | 17.84:1 | 16.70:1 | 4.5 | ✓ |
| `--texto-segundo` | `#94a3b8` | 7.67:1 | 7.18:1 | 4.5 | ✓ |
| `--texto-apagado` | `#6e7f97` | 4.82:1 | 4.51:1 | 4.5 | ✓ |
| `--terracota` | `#d96b43` | 5.74:1 | 5.38:1 | 4.5 | ✓ |
| `--exito` | `#10b981` | 7.75:1 | 7.25:1 | 4.5 | ✓ |
| `--peligro` | `#ef4444` | 5.22:1 | 4.89:1 | 4.5 | ✓ |
| `--aviso` | `#f59e0b` | 9.15:1 | 8.57:1 | 4.5 | ✓ |
| `--borde-campo` | `#576284` | 3.26:1 | 3.05:1 | 3.0 | ✓ |
| blanco sobre `--terracota-boton` | `#c65228` | — | 4.53:1 | 4.5 | ✓ |

**Tema claro**

| Token | Valor | sobre `--bg-app` | sobre `--bg-tarjeta` | Mínimo | |
|---|---|---|---|---|---|
| `--texto` | `#111827` | 16.27:1 | 17.74:1 | 4.5 | ✓ |
| `--texto-segundo` | `#4b5563` | 6.93:1 | 7.56:1 | 4.5 | ✓ |
| `--texto-apagado` | `#686f7d` | 4.63:1 | 5.05:1 | 4.5 | ✓ |
| `--terracota` | `#b5512d` | 4.61:1 | 5.02:1 | 4.5 | ✓ |
| `--exito` | `#057f59` | 4.60:1 | 5.02:1 | 4.5 | ✓ |
| `--peligro` | `#d82323` | 4.60:1 | 5.02:1 | 4.5 | ✓ |
| `--aviso` | `#a75b05` | 4.65:1 | 5.07:1 | 4.5 | ✓ |
| `--borde-campo` | `#858f9d` | 3.00:1 | 3.27:1 | 3.0 | ✓ |
| blanco sobre `--terracota-boton` | `#b5512d` | — | 5.02:1 | 4.5 | ✓ |

**Se miden los dos fondos, y esa es la lección del 4 de octubre.** La revisión de
septiembre midió todo contra blanco, que es el fondo de las tarjetas, y el tema
claro tiene además `--bg-app` en `#f4f5f8`, un paso más oscuro. Cinco tonos
pasaban sobre uno y fallaban sobre el otro: el terracota con 4,17:1, el texto
apagado con 4,43:1 y los tres estados con 4,15:1, 4,43:1 y 4,13:1. Cualquier
enlace o cifra de estado colocado fuera de una tarjeta quedaba por debajo del
mínimo, sin que nada avisara. Los cinco están corregidos arriba.

Para volver a medir después de tocar un tono está `/tmp/contraste.py` del
entorno de trabajo, o cualquier medidor que implemente la fórmula de la norma.
**Quien cambie un valor vuelve a medir y actualiza esta tabla.** Un comentario
con una cifra vieja es peor que no tener comentario.

`--borde-tenue` da 1,19:1 y 1,25:1 a propósito: es un separador decorativo. Si
alguna vez se usa para delimitar un campo de texto, está mal usado.

---

## 4. Las letras

Tres familias, cada una con un trabajo:

| Token | Familia | Para qué |
|---|---|---|
| `--fuente-texto` | Plus Jakarta Sans | Todo el texto de la interfaz. |
| `--fuente-titulo` | Newsreader | Títulos de pantalla y de panel. Da el carácter. |
| `--fuente-cifra` | JetBrains Mono | **Toda cifra.** Ver la sección 5. |

Las tres viajan dentro de la aplicación, instaladas desde npm con licencia OFL.
No se le piden a Google en tiempo de ejecución, por dos razones: una fuente que
depende del entorno es una fuente que algún día no está —ya nos pasó con el `m³`
del PDF—, y pedírselas a un tercero manda la IP de cada usuario a ese tercero en
cada carga, que en un producto sujeto a la Ley 1581 habría que declarar en la
política de tratamiento.

### La escala

| Token | Tamaño | Para qué |
|---|---|---|
| `--letra-xs` | 12px | Etiquetas de insignia y marcas. **Nunca texto corrido.** |
| `--letra-sm` | 14px | Texto secundario, encabezados de columna, celdas de tabla densa. |
| `--letra-md` | 16px | Cuerpo. El valor por defecto. |
| `--letra-lg` | 18px | Subtítulos, el total de un panel. |
| `--letra-xl` | 24px | Título de sección. |
| `--letra-2xl` | 32px | Título de pantalla. |

**Por qué es nueva.** La maqueta usaba doce tamaños entre 0,70rem y 0,90rem
—once a catorce píxeles— sin relación entre sí: 0,70, 0,72, 0,74, 0,75, 0,76,
0,78, 0,80, 0,82, 0,84, 0,85, 0,88 y 0,90. Eso no es una escala, es retoque
acumulado, y además dejaba el cuerpo del texto en once o doce píxeles. La
revisión de septiembre arregló los contrastes y nadie miró los tamaños: un
contraste perfecto en letra de once píxeles sigue siendo difícil de leer. El piso
del texto secundario es catorce.

Pesos: `400` normal, `500` cuando hace falta distinguir sin cambiar tamaño, `600`
subtítulos y encabezados, `700` títulos. Nada de `800` ni `900`.

Interlineado: `1.25` en títulos, `1.55` en texto corrido.

---

## 5. Las cifras

La regla más importante del frontend de este producto, y la única que no es
estética.

```html
<td class="cifra">180.590.155,00</td>
<td class="cifra" data-vacia="si">—</td>
```

Lo que hace la clase `.cifra`: monoespaciada, numerales tabulares, alineada a la
derecha, sin cortes de línea.

**Por qué tabulares.** En una tipografía normal el `1` es más angosto que el `8`,
así que una columna de dinero sale desalineada y dos cifras del mismo largo
parecen de largo distinto. `font-variant-numeric: tabular-nums` le da a cada
dígito el mismo ancho. En una columna de precios eso es la diferencia entre
poder comparar de un vistazo y no poder.

**El texto de la cifra lo manda el servidor.** La interfaz no suma, no
multiplica, no calcula porcentajes y no convierte a número: el dinero es
`numeric(24,6)` y en JavaScript no hay aritmética decimal exacta. Para mostrarlo
se usa `formatearNumero` de `src/formato.ts`, que es el mismo módulo que usan el
PDF y el Excel. Dos formateadores harían que el mismo número se viera distinto en
la pantalla y en la oferta que recibe el cliente, y la diferencia aparecería
recién en un `1,005`. Hay una regla de lint que prohíbe `Number()` en todo
`src/`.

**Las fechas se parsean, no se cortan.** Llegan en UTC con `Z` y se muestran en
la zona local con `Intl.DateTimeFormat` o equivalente. Cortar los primeros diez
caracteres del texto parece funcionar y falla a partir de las 19:00 de Bogotá:
un presupuesto creado a las 20:00 llega como `01:00Z` del día siguiente y se
mostraría con la fecha de mañana. Dos fechas tampoco se comparan como texto.

**El guion no es un cero.** Una incidencia que no se puede calcular —porque el
costo directo es cero— se muestra `—` con `data-vacia="si"`, que lo apaga para
que no se lea como un dato. Un cero diría que ese capítulo no pesa nada, y es
distinto de no poder calcularlo.

---

## 6. Espaciado, radios y sombras

Escala de cuatro: `--e1` 4px, `--e2` 8px, `--e3` 12px, `--e4` 16px, `--e5` 24px,
`--e6` 32px, `--e7` 48px. Nada intermedio. La maqueta tenía siete valores sin
relación —0,2rem, 0,25, 0,5, 0,65, 0,75, 0,85, 1— y la mitad eran la misma
intención escrita distinta.

Radios: `--radio-sm` 6px en controles chicos, `--radio-md` 10px en botones y
campos, `--radio-lg` 14px en tarjetas y paneles, `--radio-redondo` en insignias.

Sombras: solo dos. `--sombra-tarjeta` para lo que está apoyado en el fondo, y
`--sombra-flotante` para lo que está por encima de todo —un panel, un diálogo—.
Si algo necesita una tercera, probablemente no necesita sombra.

`--toque-minimo` son 44px y es el alto mínimo de cualquier cosa que se pueda
pulsar, por la pauta 2.5.5. Un icono de 16px dentro de un botón de 44 está bien;
un botón de 24 no.

---

## 7. El orden de la pantalla

```
┌────────────┬──────────────────────────────────────────────┐
│            │  barra superior: dónde estoy · quién soy     │
│   barra    ├──────────────────────────────────────────────┤
│  lateral   │                                              │
│            │  el contenido, en una columna de 1280px      │
│  (módulos  │  como máximo, centrada                       │
│   según    │                                              │
│  permisos) │                                              │
│            ├──────────────────────────────────────────────┤
│            │  pie fijo, solo en la mesa de trabajo        │
└────────────┴──────────────────────────────────────────────┘
```

- **La barra lateral muestra solo los módulos que el rol permite.** Lo que no
  corresponde no se muestra, no se muestra deshabilitado (02 §4). Los permisos
  salen del arranque y no se infieren.
- **1280px de ancho máximo** para el contenido. Una tabla de presupuesto necesita
  ancho, pero una línea de texto de 1900px no se lee.
- **El pie financiero es fijo y tiene dos renglones**: costo directo y valor
  total. El desglose está en un panel lateral. El porqué está en el 02 §8.6, y no
  es estético: la clasificación de cada actividad se hereda del capítulo, así que
  es lo único del cálculo que puede salir mal sin producir ningún error.
- **El aviso de «no hay capítulos directos» va en la barra visible, nunca en el
  panel.** Un aviso que hay que abrir para verlo no avisa.
- En una pantalla angosta la barra lateral se vuelve un cajón. La mesa de trabajo
  no se usa en un teléfono y no se pretende que lo haga; lo que sí tiene que
  funcionar en un teléfono es ingresar y consultar la lista de presupuestos.

---

## 7 bis. El mapa de navegación

**El flujo está en el documento 02 y no se repite acá.** Cada sección suya dice
de dónde se entra y a dónde se sale, y volver a escribirlo en este documento
crearía dos fuentes que algún día se contradicen. Lo que sigue es un índice para
encontrarlo, con el número de sección donde está la conducta.

```
  Registro (§3.1) ─┐
                   ├─► Ingreso (§3.2) ──► redirige según rol y plan
  Recuperación (§3.3)                     │
                                          ▼
                              PANTALLA DE INICIO (§4)
                       menú de módulos, solo los que el rol permite
                                          │
        ┌───────────────┬─────────────────┼──────────────────┐
        ▼               ▼                 ▼                  ▼
   Recursos (§5.1)  APU (§6.1)   Presupuestos (§7)   Configuración (§11)
        │               │                 │            engranaje, pestañas
   pop-out de      pop-out de        «Crear» (§7.1)         │
   crear/editar    consulta, con     redirige a la      ┌───┴───┐
   (§5.2, §5.3)    «Editar» dentro        ▼            Mi cuenta (§11.1)
        │          (§6.2, §6.3)    MESA DE TRABAJO      Empresa (§11.2)
        │               │               (§8)           Suscripción (§11.3)
        │               │                 │             Usuarios (§11.4)
        │               │           estados, duplicar,  Preferencias (§11.5)
        │               │           exportar (§9)       Parametrización (§11.6)
        │               │           versiones (§10)     Notificaciones (§11.7)
        │               │                 │
        └───────────────┴─────────────────┘
              las capas se anidan hasta tres:
              mesa → APU (§8.3) → recurso (§6.2)

  Suscripción no vigente (§3.4): se entra igual y queda en SOLO LECTURA.
  Superadministración (§3.5): URL propia, no comparte el ingreso.
```

Dos cosas que el mapa deja ver y conviene tener presentes:

- **El menú de inicio es la única bifurcación.** Todo lo demás es entrar a un
  módulo y volver. Por eso el **botón Volver** aparece en el 02 en §6.1, §7 y
  §11: es parte de la navegación y no un adorno, y en este producto siempre
  lleva al inicio o al nivel de arriba, nunca al historial del navegador.
- **Casi nada redirige.** Solo el ingreso y el «Iniciar Presupuesto» del §7.1
  cambian de pantalla; todo el resto de crear, consultar y editar ocurre en una
  capa encima de donde estabas.

---

## 8. Los componentes

**Botones.** Tres y nada más:

| | Cuándo | Cómo |
|---|---|---|
| Principal | La acción de la pantalla. **Uno solo por pantalla.** | Fondo `--terracota-boton`, texto blanco |
| Secundario | Acciones normales | Fondo transparente, borde `--borde-campo`, texto `--texto` |
| Peligroso | Eliminar, reabrir, lo que no se deshace | Texto y borde `--peligro`, fondo transparente |

Un botón que borra nunca es el principal ni queda pegado al principal: se separa
o se pone en un diálogo.

**Campos.** Etiqueta siempre visible y arriba, nunca solo un `placeholder`: el
placeholder desaparece al escribir y quien vuelve a revisar el formulario ya no
sabe qué era ese campo. El error va debajo del campo, con `role="alert"`, y el
campo queda con `aria-describedby` apuntando al error.

**Tablas.** Encabezados en `--letra-sm` y `--texto-segundo`. Las columnas de
cifra llevan `.cifra` y van a la derecha; las de texto a la izquierda. Nada de
rayado alternado: separador `--borde-tenue` entre filas, y `--bg-tarjeta-hover`
solo al pasar el cursor.

**Insignias de estado.** Texto en `--letra-xs`, fondo teñido, radio redondo, y
**siempre con palabra**: Abierto, Activo, Cerrado.

**Vacíos.** Una lista vacía dice por qué está vacía y qué hacer: «Todavía no hay
presupuestos» con el botón de crear al lado. Nunca una tabla con encabezados y
nada debajo. Y cuando el vacío puede ser una falta de permiso —el buscador de
actividades sin `APU.VER`— lo dice, en vez de parecer roto.

**Las capas superpuestas, que son el esqueleto de este producto.** Casi nada
abre una pantalla nueva: crear o editar un recurso, un APU o un presupuesto abre
una capa encima de lo que ya estaba, sin redirigir (02 §5.2, §6.2, §7.1). Así
que la capa no es un adorno, es la estructura, y tiene reglas:

- **Crear y editar son el mismo formulario**, con otro título y otro botón. Si
  en algún momento son dos componentes, se unifican.
- **No cambia la dirección del navegador.** La capa es un estado de la pantalla,
  no un lugar. La consecuencia aceptada: cerrar el navegador con un formulario a
  medias pierde ese formulario.
- **El foco entra a la capa al abrirse, queda atrapado mientras está abierta y
  vuelve al control que la abrió al cerrarse.** Sin eso, quien navega con
  teclado sigue tabulando por la pantalla de atrás, que no puede ver.
- **Escape cierra, salvo que haya cambios sin guardar**, y entonces pregunta.
  Perder un APU a medio llenar por un escape involuntario es exactamente lo que
  el §8.3 pide que no pase.
- **La capa desplaza su propio contenido; la pantalla de atrás no se mueve.**
- **Un botón principal, y dice qué hace**: «Guardar APU», no «Aceptar».
- **El error de un campo va debajo del campo. El error de la operación va arriba
  de la capa**, con `role="alert"`, para que se anuncie y no haya que buscarlo.
- **En pantalla angosta la capa ocupa todo** y se comporta como una hoja.

**Se anidan, y hay que contarlas bien.** El 02 especifica dos saltos, no uno:

- Desde la mesa de trabajo, cuando una actividad no existe, «+ Crear Nuevo APU»
  abre el formulario de APU encima del de actividad, y al guardarlo el APU queda
  asignado al capítulo sin perder lo escrito (§8.3).
- Desde el formulario de un APU, cuando un recurso no existe, un acceso directo
  abre el de crear recursos, y al guardarlo el recurso queda asignado al APU
  «sin perder lo que ya se había» armado (§6.2).

Los dos juntos dan **tres niveles**: mesa → APU → recurso. Este documento decía
antes que el anidamiento era uno solo y que el límite eran dos, y era falso: el
02 manda sobre la conducta de la interfaz y especifica los dos saltos. Corregido
el 4 de octubre de 2026.

Las reglas con tres niveles:

- **Escape cierra solo la de arriba**, nunca la pila.
- **Cada capa guarda sus propios cambios sin guardar** y pregunta por los suyos.
  Perder el APU a medio armar por cerrar el de recursos sería exactamente lo que
  el §6.2 promete que no pasa.
- **Al guardar una capa, lo creado se asigna a la de abajo y el foco vuelve
  ahí**, al control que la abrió.
- **Tres es el techo**, y no por elegancia: no hay en el 02 ningún cuarto salto.
  Si aparece uno, es una pregunta para el dueño, no una decisión de quien
  programa.

**Diálogos.** Para confirmar algo que no se deshace, y el texto dice qué va a
pasar, no «¿está seguro?». El de activar un proyecto ya está escrito en el 02
§9.1 y se usa textual.

---

## 9. Los estados

- **Foco:** siempre visible, `2px` de `--terracota` con `2px` de separación.
  Quitar el contorno sin reemplazarlo deja a quien navega con teclado sin saber
  dónde está.
- **Cargando:** la pantalla no salta. El espacio de lo que va a llegar se
  reserva, y si tarda más de un instante se muestra un esqueleto de la tabla, no
  un reloj centrado.
- **Solo lectura por suscripción:** si el arranque dice `soloLectura`, los
  controles que escriben no se muestran. Es cortesía, no seguridad: la base
  rechaza igual, y la pantalla de suscripción explica por qué.
- **Solo lectura por estado:** un presupuesto Activo o Cerrado no se edita. Lo
  dice la insignia y lo dice la ausencia de controles.
- **Error:** el texto del servidor se muestra tal cual, porque está escrito para
  la persona. Un 500 no muestra su texto: dice que algo falló y que no se guardó
  nada.

---

## 10. Lo que no se hace

- Un color escrito directo en un componente.
- Un tamaño o un margen fuera de la escala.
- `Number()`, `parseFloat` o aritmética sobre una cifra de dinero.
- Ordenar una lista por el texto de su código: `1.10` iría antes de `1.2`. Se
  ordena por `posicion`, que es un número y lo manda el servidor.
- Color como única señal de estado.
- Un `placeholder` en lugar de una etiqueta.
- Más de un botón principal por pantalla.
- Una animación que no se pueda apagar con `prefers-reduced-motion`.

---

## 11. Iconos y anchos, que no estaban decididos

**Iconos: trazo, 1,5 px, 24×24 de caja.** La maqueta usa iconos de trazo
embebidos como SVG, de la familia de Lucide, y se sigue con eso: se copian al
repositorio los que se usen, en vez de instalar una librería entera para
veinte iconos. Un icono nunca va solo cuando es la única forma de entender un
control: lleva texto al lado, o un `aria-label` si de verdad no cabe.

**Los anchos.** Tres, y el tercero es una renuncia explícita:

| | Qué pasa |
|---|---|
| Hasta 640 px | La barra lateral se vuelve un cajón. Funcionan ingresar, ver la lista de presupuestos y consultar; las capas ocupan toda la pantalla. |
| 641 a 1024 px | Barra lateral colapsada a iconos. La mesa se puede leer; editarla es incómodo y se acepta. |
| Más de 1024 px | Todo. El contenido se centra con 1280 px de ancho máximo. |

**La mesa de trabajo no se pretende usable en un teléfono**, y es una decisión,
no una falta: armar una EDT de cien actividades con el pulgar no es un caso real.
Lo que sí tiene que funcionar en un teléfono es entrar, mirar la lista de
presupuestos y abrir uno para consultarlo.

---

## 11 bis. Lo que se decidió al construir las pantallas, 6 de octubre de 2026

- **Las direcciones van después del «#»** (`#/presupuestos/:id`,
  `#/configuracion/suscripcion`). El servidor de producción no necesita
  devolver `index.html` para rutas desconocidas, y el token del enlace de
  restablecimiento no sale del navegador: lo que va después del «#» no llega
  al servidor, ni a sus registros, ni al `Referer`.
- **El panel lateral es no modal** (`componentes/PanelLateral.tsx`): el
  desglose del pie y el historial. Lo de atrás sigue vivo; Escape lo cierra
  solo con el foco adentro. En pantalla ancha la mesa le deja lugar en vez de
  quedar tapada. Ancho: `--ancho-panel`.
- **La capa es un `<dialog>` con `showModal()`**: el foco atrapado, lo de
  atrás inerte y el apilado los da el navegador. Escape se maneja a mano
  porque desde Chrome 120 un segundo Escape cierra aunque se cancele el
  evento. La capa con una tabla adentro usa `--ancho-capa-ancha`.
- **Los avisos breves** («Versión 3 guardada») salen arriba, bajo la barra
  superior, y se van solos en cinco segundos. Abajo taparían el valor total del
  pie, que es la cifra que se mira después de una acción.
- **Las columnas de una tabla se sueltan según el ancho de la tabla**, no el
  de la ventana (consultas `@container`): con la barra lateral abierta, una
  ventana de 1280 deja 1000 para la tabla. En la vista maestra de
  presupuestos el valor total no se suelta nunca; por debajo de 560 px cada
  fila es una tarjeta.
- **Un campo de cifra acepta coma o punto como decimal y rechaza el separador
  de miles** (`src/entrada.ts`): «1.500» sería ambiguo, y un precio leído al
  revés es peor que un error que pide escribirlo sin puntos.
- **Las medidas nuevas** están en `tokens.css` con su razón:
  `--ancho-contenido`, `--ancho-barra`, `--ancho-barra-iconos`,
  `--alto-barra`, `--ancho-capa`, `--ancho-capa-ancha`, `--ancho-panel`,
  `--ancho-tarjeta-suelta` y `--texto-sobre-boton`. Los anchos fijos de los
  campos de cifra (7,5 rem, 4,5 rem) viven en `componentes.css`, junto al
  control que los usa.
- **Todo lo que se pulsa mide 44 px**, también los botones de las filas de la
  mesa. Las filas quedan un poco más altas, y se aceptó.

- **Correcciones del dueño, 6 de octubre de 2026 (tarde):**
  - **«Proyectos», no «Presupuestos».** Proyecto es la cosa que se crea, se
    abre, se duplica, se archiva y se activa; «presupuesto» se queda solo
    donde se habla de sus cifras («Desglose del presupuesto») y en el texto
    textual de activar del 02 §9.1. La dirección es `#/proyectos`, y
    `#/presupuestos` sigue abriendo.
  - **Los proyectos se muestran en tarjetas** por defecto, con un conmutador
    a lista que se recuerda en el navegador. La tarjeta entera es el enlace a
    la mesa; el estado va en la insignia con palabra, y la franja de color de
    arriba es solo apoyo.
  - **Configuración va centrada**, con `--ancho-lectura` (960 px): son
    formularios y datos sueltos.
  - **Un campo de cifra no deja escribir letras** (`soloCifra` en
    `src/entrada.ts`): pasan dígitos y el separador decimal de la empresa; el
    de miles se descarta al escribir, así «1.500» es mil quinientos.
  - **Agregar un ítem en cualquier nivel** tiene dos caminos que no se
    confunden: un botón en la fila del capítulo o subcapítulo, con un icono
    distinto del de agregar subcapítulo, y la fila de agregar, que dice a qué
    nivel pertenece («Agregar actividad en 1.2 Vigas de amarre»). Antes un
    subcapítulo con hijos dejaba su fila pegada a la del capítulo de arriba y
    no se sabía cuál era cuál.
  - **La mesa se compacta según su propio ancho**: por debajo de 1250 px de
    tabla, el código del APU va junto a la descripción y sin columna propia.
    Cabe sin desplazarse de lado desde 1280 px de ventana con la barra
    lateral abierta, sin achicar los botones de 44 px.
  - **Importar desde Excel** en Recursos y APU: descargar la plantilla,
    llenarla, subirla; todo o nada, con el informe fila por fila
    (`modulos/comun/ImportarExcel.tsx`, CONTRATO §10).

- **Usuarios y roles, 8 de octubre de 2026** (02 §11.4, CONTRATO §11): una
  pestaña de Configuración que cambia con el plan. Personal: el asistente y
  sus permisos. Empresarial: usuarios y roles. La matriz de permisos va
  agrupada por módulo, y cada casilla lleva la acción y una línea de qué
  abre. Al marcar se marca lo que la acción necesita. Lo que no se puede
  desmarcar queda deshabilitado con el motivo escrito debajo, no en un
  tooltip. No se ofrece revocarse a uno mismo ni revocar o cambiar de rol al
  único administrador. El enlace de activación no se muestra: lo entrega el
  dueño de ConstruSoft hasta que exista el correo.

- **La barra lateral se pliega, 9 de octubre de 2026** (decisión del dueño):
  un botón al pie, «Ocultar menú», la deja solo con iconos, y el navegador lo
  recuerda. Plegada, cada icono muestra solo el nombre del módulo en un globo
  al pasar el mouse o al llegar con el teclado. El nombre sigue dentro del
  enlace para los lectores de pantalla, y no hay `title`, que duplicaría el
  globo. Entre 641 y 1024 px va siempre plegada y sin botón; en el teléfono
  sigue siendo un cajón.

## 12. Lo que todavía no está decidido

Para que nadie lo lea creyendo que está completo:

- **El logotipo.** No existe: la maqueta solo trae iconos, y los `logo-*` del
  tablero son para el logo del *cliente* que va en el PDF. Mientras no haya, la
  marca es la palabra «ConstruSoft» compuesta en Newsreader. Es el punto 3 del
  01 §17.
- **Los textos exactos de las pantallas** están en el 02 cuando el 02 los fija
  —el diálogo de activar, por ejemplo— y se usan textual. Donde no los fija, los
  escribe quien construye la pantalla y quedan a revisión del dueño.
- **El tablero del inicio.** El 02 §4 dice que el inicio es un menú. El dueño
  pidió además cifras reales, que son alcance nuevo y dependen de un endpoint
  que todavía no existe.
