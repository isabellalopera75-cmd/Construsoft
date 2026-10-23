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
  **Corregido el 13 de octubre de 2026 (D-75):** el dueño pidió filas que
  midan lo que la letra más un margen mínimo. Con mouse (`pointer: fine`), los
  controles de la mesa miden 24 px, el mínimo de WCAG 2.5.8, y la fila queda en
  unos 30 px. En pantallas táctiles siguen los 44 px.
- **Densidad, 13 de octubre de 2026** (el dueño: «todo se ve muy grande»).
  Con mouse (`pointer: fine`): letra de 15 px el cuerpo y 13 px lo
  secundario y las tablas, controles de 36 px, barra superior de 56 px, celdas
  de tabla de 6 × 12 px, y la cabecera de la mesa y su fila de agregar
  actividad apretadas. En táctil no cambia nada. Los valores están en
  `tokens.css` y al final de `componentes.css`.
- **La columna «Código» de la mesa** (D-75): el número del capítulo o
  subcapítulo, con ceros, o el código del APU de la actividad, en terracota y
  alineado con los números. No hay columna aparte para el APU.

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

- **El panel del superadministrador, 9 de octubre de 2026** (CONTRATO §12).
  El prototipo no servía, así que se diseñó desde la plataforma: el mismo
  marco (barra lateral plegable, migas, quién soy), las mismas tarjetas,
  capas e insignias, y los mismos tokens. Lo que lo distingue es un sello
  «Plataforma» con un escudo bajo la marca, para que nadie confunda en qué
  consola está antes de suspender una empresa. La ficha de la empresa pone
  arriba lo de todos los días (registrar un pago) y abajo, separada, una
  «zona de cuidado» con lo que no tiene vuelta atrás. La suspensión y el
  estado de la suscripción son dos insignias, porque son dos cosas. La fecha
  hasta la que queda cubierto un pago la calcula la base, no la pantalla.
- **El logotipo** (CONTRATO §13) va en su propia sección de Datos de empresa,
  sobre un fondo blanco fijo también en el tema oscuro: se imprime sobre
  papel blanco. Elegir el archivo lo sube; no hay «Guardar».

### 14 de octubre de 2026 · Los plazos (D-78)

- **Ningún texto escribe un plazo de memoria.** Los plazos del ciclo de
  suscripción los cambia el superadministrador. Lo que ya pasa se dice con su
  fecha («el plazo era hasta el 16 oct 2026»), y lo que pasaría se dice con
  `plazos`, que manda la API. Sin ese dato, el texto no dice el número.
- **La pantalla Plazos del panel** muestra una tarjeta por plazo con la cifra
  grande, lo programado debajo con su botón para anularlo, y arriba, siempre
  visible, la regla que lo hace seguro: un cambio solo alcanza a los plazos que
  empiezan a correr. El que está escrito en la política de datos lo avisa en
  la tarjeta y en el diálogo.

### 15 de octubre de 2026 · Más espacio para la tabla (pedido del dueño)

Cuatro cambios para que la estructura del proyecto se vea más grande y el
mouse viaje menos:

- **Agregar actividad y agregar subcapítulo van junto al nombre** del
  capítulo o subcapítulo, después de la insignia Directo/Indirecto. Subir,
  bajar, renombrar y eliminar se quedan a la derecha. **La fila fija
  «Agregar actividad en…» bajo cada nivel se quitó**: el icono es el único
  camino. La fila del buscador aparece al pulsarlo, al final del nivel, y
  a la izquierda dice a qué nivel va; se cierra con su ×. Esto reemplaza los
  «dos caminos» de las correcciones del 6 de octubre. Con mouse, esa fila
  mide lo que una de capítulo: campo de 24 px, cada opción de la lista en una
  sola línea (código, nombre, unidad, costo) y, elegido el APU, la cantidad y
  los botones en la misma línea. El buscador del formulario de APU no cambia.
- **Los datos del proyecto** (ubicación, moneda, estructura, última
  modificación) van en la franja de arriba de la tabla, al lado de «Agregar
  Capítulo». El texto que explicaba la estructura por EDT se quitó: la
  estructura ya se lee en esa misma franja.
- **Las acciones de la cabecera se ocultan** con «Ocultar acciones», arriba a
  la derecha. Ocultas, se deslizan a alto cero y quedan inertes (ni foco ni
  lector de pantalla). La elección vale para todos los proyectos y se recuerda
  en el navegador.
- **El menú puede ir arriba.** Cada usuario lo elige en Configuración › Mi
  cuenta › Mi pantalla, y se aplica al elegir. Arriba, la barra lateral
  desaparece y los módulos, con sus submenús, van en la barra superior entre
  las migas y «quién soy», centrados en la barra; con menos de 1440 px solo
  los iconos, con el nombre en un globo. En el teléfono el menú sigue siendo
  el cajón. El panel del superadministrador no tiene esta opción.
- El contenido sigue con su máximo de 1280 px: el menú arriba gana ancho en
  ventanas de menos de unos 1550 px, que es donde la barra lateral lo quitaba.

### 15 de octubre de 2026 · Configuración en dos columnas (pedido del dueño)

- **Solo organiza, no agrega información.** Las imágenes de referencia del
  dueño traían datos que el sistema no tiene (último acceso, «verificada»,
  ayuda y soporte); no se pusieron.
- Cada pestaña: arriba, una tarjeta a lo ancho con el resumen en **fichas**
  (lo guardado, no lo que se está escribiendo); debajo, las tarjetas de
  trabajo en **dos columnas** de igual alto. Con menos de 880 px de
  contenido, una sola columna. El botón principal de una tarjeta va arriba a
  la derecha, frente al título (Invitar usuario, Crear rol, Agregar unidad).
- Mi cuenta: Contraseña | Mi pantalla. Datos de empresa: formulario |
  logotipo. Preferencias: formato de números | avisos por correo (un solo
  «Guardar» para las dos) y las unidades a lo ancho. Suscripción: los días
  restantes destacados arriba; vigencia y cómo pagar | historial de pagos;
  la zona de cuidado abajo, a lo ancho. El historial, en media columna, va
  en tres columnas con su dato de apoyo debajo (fecha y concepto, monto y
  método, estado y hasta cuándo cubre) y las fechas cortas: no pierde ningún
  dato.
  Usuarios: personas | roles (o los permisos del asistente en el plan
  Personal).
- Configuración deja el ancho de lectura (960 px, 6 de octubre) por
  `--ancho-configuracion` (1160 px): dos tarjetas de unos 560 px.
- Piezas en `modulos/configuracion/piezas.tsx`: `Seccion` con `accion`,
  `Fichas` y `DosColumnas`.

### 21 de octubre de 2026 · Programación de obra (07 §6, CONTRATO §19)

- **El cronograma usa el ancho entero.** Es la única pantalla sin los 1280 px
  de §7: el Gantt es una línea de tiempo, no texto que leer, y cada píxel de
  más es tiempo a la vista. Queda a revisión del dueño. Se entra desde la mesa
  («Cronograma») y vive en `#/proyectos/:id/cronograma`.
- **Tabla y barras en un solo desplazamiento.** La tabla (código, actividad,
  días, inicio, fin, holgura) queda fija a la izquierda al correr el tiempo, y
  la escala fija arriba al bajar. Con el panel de una actividad abierto, la
  tabla suelta inicio y fin, que están en el panel, para que quede tiempo a la
  vista.
- **Solo se pintan las filas visibles** (RNF-29), con las flechas que cruzan
  ese tramo. Medido con 1.504 actividades y 2.978 relaciones en Chromium: la
  primera pintura tarda 430 ms, hay 38 filas en el documento, y cada paso de
  400 px de desplazamiento se pinta en dos cuadros (33 ms de mediana, 53 ms en
  el percentil 95). El alto de la fila es una cifra de `Gantt.tsx`, no un token:
  el cálculo de qué fila cae dónde la necesita, y se le pasa al CSS como
  variable.
- **Una fecha-hora del cronograma se corta, no se parsea.** Es la excepción a
  §5, y es a propósito: «2026-11-02T07:00» es la hora local de la obra, sin
  zona (CONTRATO §19.1). Pasarla por `Date` la leería como hora del navegador o
  como UTC, y se correría. Las posiciones del Gantt son minutos enteros
  contados con el calendario civil, en `modulos/cronograma/tiempo.ts`. Los
  instantes con «Z» (cuándo se guardó una línea base, el último cambio del
  presupuesto) siguen la regla de §5.
- **Los colores del Gantt** son alias en `tokens.css`: lo normal en azul y lo
  crítico en el tono de peligro, como el PDF del Gantt que arma la API; los
  capítulos como barra resumen en el color del texto; la administración
  rayada; la línea base en el tono de aviso, debajo; los hitos como rombos,
  verde el de inicio y del color del texto el de fin; y una marca terracota al
  final de la barra que termina a mitad de jornada (RN-27). Lo crítico no se
  dice solo con color: la holgura está en su columna, y el panel lo dice con
  palabra. Hay una leyenda sobre el Gantt.
- **`--azul-grafico` es el único tono nuevo.** Hacía falta un segundo tono que
  no fuera un estado, para el Gantt y para las curvas. Es el primero de la
  paleta de la guía de gráficos, escalonado para cada tema, y está medido con
  su validador: separación para daltonismo de 23,8 contra el terracota y 24,0
  contra el peligro en oscuro, y de 25,1 y 26,9 en claro (el objetivo es 8);
  contraste de marca gráfica de 3:1 o más sobre los dos fondos de cada tema.
  No se usa para texto.
- **Las curvas S** van en terracota (facturación) y azul (costo), con la línea
  base punteada en el mismo tono. Tienen leyenda y el nombre de cada curva al
  final de la línea, en color de texto; un globo con las cuatro cifras del
  periodo al pasar el mouse o con las flechas; y la tabla de cifras al lado.
  Las cifras son el texto del servidor. Para dibujar hace falta una posición, y
  la única conversión de dinero a número de toda la interfaz está en
  `Curvas.tsx` (`aproximar`), con la regla de lint desactivada en esa línea y
  su razón: sirve para poner un punto en el plano, no se muestra, no se suma y
  no se guarda.
- **El 409 no pierde el trabajo** (07 §6.9). Si otra persona cambió el
  cronograma, la pantalla muestra la versión nueva y una franja con el cambio
  rechazado en palabras («Cambios en 3.1») y un botón para volver a aplicarlo
  sobre la versión nueva. Toda escritura pasa por una sola función
  (`escribir`), que lleva la versión y atiende el 409, el círculo y el 422 sin
  campo.
- **Un círculo de relaciones** marca en la tabla, con una raya roja a la
  izquierda, todas las actividades que lo forman, y el panel dice por qué no se
  guardó.
- **Las franjas** van arriba del Gantt, a la vista de todos: el cambio del
  presupuesto (D-93), con lo que entró, salió o cambió de duración, el fin y el
  valor total antes y después, y «Entendido, cerrar aviso» para quien puede
  editar; los festivos que no alcanzan al fin de la obra, con «Copiar
  festivos»; y los días de más contra la línea base que se está mirando.
- **La línea base que se mira** se elige sobre el Gantt y se recuerda en el
  navegador por proyecto. Sin elección guardada, se muestra la primera que se
  guardó, que suele ser la del contrato; sin ella, el aviso de la
  administración no aparecería nunca. La escala (día, semana, mes) también se
  recuerda.
- **El calendario es una cuadrícula de medias horas**, como en P6: se pinta
  arrastrando, o con las flechas y la barra espaciadora; cada celda dice su día,
  su media hora y si se trabaja. El llenado rápido (entrada, horas, almuerzo,
  días y un sábado más corto) pinta la tabla. Debajo, cada día en texto. La
  misma capa sirve para el calendario de la empresa y para el de la obra.
- **La semana tipo lleva rótulos** (pedido del dueño, 21 de octubre de 2026):
  «Semana tipo» y una línea que dice que se repite todas las semanas, «Hora del
  día · cada hora tiene dos casillas de 30 minutos» sobre la tabla, y las horas
  escritas como «8:00», una etiqueta cada dos horas con una raya más marcada,
  porque «10:00» no cabe sobre una sola hora.
- **El mes del calendario** (pedido del dueño, 21 de octubre de 2026, porque
  la semana tipo sola no se entendía): cada fecha como queda con la semana
  tipo y las excepciones, con sus horas, como la vista de mes de P6. Los
  festivos y días libres van con borde punteado de aviso y su motivo, y los
  días con otras horas, con borde punteado terracota: el borde y el texto
  dicen lo que el color sugiere. Un clic en un día abre su excepción.
- **Configuración** gana la pestaña «Calendarios y festivos», y Preferencias
  la tarjeta «Programación de obra» (horas por jornal e inicio de semana), con
  el mismo «Guardar preferencias». El formulario de APU gana el rendimiento de
  la actividad bajo el nombre y la unidad, con su explicación para que no se
  confunda con el rendimiento de cada recurso (RF-APU-25).
- **Piezas nuevas**: `modulos/calendarios/` (la cuadrícula, la capa de un
  calendario, las excepciones, copiar festivos y la pestaña) y
  `modulos/cronograma/` (la pantalla, el Gantt, el panel de la actividad, las
  capas, las curvas y la revisión). Los iconos nuevos son de Lucide:
  calendario, gantt, curva, rombo, enlace, bandera y revisión.

### 21 de octubre de 2026 · Cómo se sirve en producción (despliegue de prueba)

- **La web es solo archivos estáticos**, servidos por nginx (`web/Dockerfile`,
  `web/nginx.conf`). `/api` llega a la API por el proxy del servidor, en el
  mismo dominio, porque la cookie es `SameSite=Strict`.
- **Las cabeceras de seguridad** van en `web/nginx.conf`. La CSP solo admite
  el propio dominio para scripts, estilos, fuentes y llamadas. Admite dos
  excepciones, cada una con su motivo:
  - `font-src data:`, porque Vite mete en el CSS las fuentes de menos de
    4 KB;
  - `img-src blob:`, por la vista previa del logotipo en el registro.

  Ningún estilo en línea: React pone los `style` por el DOM, y eso la CSP no
  lo bloquea. **Si una pantalla nueva carga algo de otro dominio, o usa
  `<style>` en línea, la CSP la va a romper en producción y no en `npm run
  dev`.** Hay que probarla detrás de nginx, como se probó esta.
- **Las direcciones con `#`** hacen que nginx no tenga que devolver
  `index.html` para rutas desconocidas. `/superadmin` lleva a `/superadmin/`
  con una redirección relativa.

### 21 de octubre de 2026 · Las pantallas de tablas usan todo el ancho (pedido del dueño)

- La mesa, el cronograma, Proyectos, APU y Recursos no tienen el tope de
  1280 px (`Cascaron anchoCompleto`): llenan lo que deje el menú, abierto,
  plegado o arriba. Inicio, Configuración y lo «suelto» del cronograma
  (cargando, error) se quedan con su ancho y centrados.
- **El ancho de más se lo lleva el texto, no los huecos.** En la mesa, unidad,
  cantidad, precio, valor e incidencia miden lo que su cifra; el resto es de
  la descripción. Con más de 1300 px de tabla, las cifras llevan un aire fijo
  entre ellas. En APU, Recursos y la lista de Proyectos, con más de 900 px de
  tabla, las columnas cortas no se parten; en la lista de Proyectos el nombre
  se lleva el sobrante, y en APU y Recursos el nombre ocupa el 45 % y el resto
  se reparte, para no dejar un hueco en medio de la fila.
- **APU y Recursos llevan 48 px de margen a los lados** (24 en las demás),
  desde 1025 px de ventana: son catálogos que se leen fila por fila. El
  marco marca la pantalla en `#contenido` con `data-pantalla`.
- **El pie de la mesa va en una sola línea** (con mouse): cada etiqueta al
  lado de su cifra y el botón del desglose de 30 px. Mide 48 px en vez de 80.

### 22 de octubre de 2026 · Niveles, columnas y el alto del Gantt (pedido del dueño)

- **«Nivel», «Expandir todo» y «Contraer todo»** (`componentes/Niveles.tsx`),
  en la barra de la estructura de la mesa y en la barra del Gantt. Funcionan
  como los niveles de esquema de Excel: el nivel N muestra las filas a N
  niveles o menos de la raíz, y el último lo muestra todo. Cuántos niveles hay
  sale de la estructura, no es un número fijo. El nivel marcado se deduce de
  lo que está plegado; si el usuario pliega una fila a mano, no queda ninguno
  marcado. Es estado de la pantalla: no se guarda.
- **Las columnas de la tabla del Gantt** se ajustan arrastrando el borde
  derecho del encabezado, o con las flechas sobre ese borde (8 px; 32 con
  Mayús). Doble clic vuelve al ancho de siempre. El ancho vive en el estado
  del cronograma: sobrevive al cambio de pestaña y se pierde al salir.
  «Actividad» deja de ser `1fr` y pasa a tener ancho propio, 236 px.
- **El alto del Gantt** llega al fondo de la ventana, medido desde donde
  empieza el Gantt en la página. Así su barra de desplazamiento de lado
  siempre se ve sin bajar la página. Con poco espacio arriba no baja de
  320 px. En 1440 × 900 queda en el mínimo, porque arriba están la cabecera,
  el aviso, las pestañas, la barra y la leyenda.
- **Cantidad y rendimiento de una línea de APU** nacen vacíos, sin el 1 de
  antes. El 02 §6.2 lo pedía precargado; el dueño lo cambió.
- **El panel de una actividad va al pie** (`PanelLateral` con `abajo`), ya no
  a la derecha. Es una franja `sticky` al borde de abajo de la ventana, a
  todo el ancho del contenido, de 200 px como máximo. Va en tres columnas que
  se desplazan cada una por su lado: fechas, datos y relaciones. La letra
  baja a 13 px, y a 12 en etiquetas y ayudas. Las ayudas son texto corrido,
  y `--letra-xs` dice que no va en texto corrido: es una excepción de este
  panel, por el pedido de compacidad. Los campos y botones quedan de 30 px: bajo el mínimo de
  toque de 44 px, por pedido de compacidad, pero sobre los 24 px de WCAG
  2.5.8. El Gantt deja de esconder inicio y fin con el panel abierto. Al
  abrirse, la página sube hasta dejar el Gantt bajo la barra superior, y el
  Gantt mide lo que queda entre esa barra y el panel.
- **El cronograma, compacto** (pedido del dueño, 22 de octubre de 2026, para
  que quepan más actividades). Antes, en 1440 × 900 y con 1.500 actividades,
  se veían 8 filas; ahora se ven 22. Los cambios:
  - las filas del Gantt bajan a 24 px y la letra a 12, códigos incluidos;
  - la escala baja a 40 px, y las barras, los rombos y la línea base se
    midieron otra vez para ese alto;
  - la cabecera va en dos renglones: arriba volver, código, estado, título y
    botones; abajo, los datos del cronograma;
  - el aviso, las pestañas y la barra van con menos relleno, con botones de
    32 px y letra de 13;
  - la pantalla deja menos margen arriba y abajo;
  - la leyenda dice «Crítica (holgura ≤ 0)», para que quepa en un renglón.

  Los botones de 32 px quedan bajo el mínimo de toque de 44 px, como los del
  panel.
- **El aviso de la administración** (D-93) va en un solo renglón, al lado de
  las pestañas, del ancho de su texto (pedido del dueño, 23 de octubre de
  2026). El texto se acortó: «Termina 19,0 días después que «Contrato» (02
  jul 2027 → 29 jul 2027): la administración del presupuesto sigue igual.».
  Si no cabe, se corta con puntos suspensivos y el texto entero queda en el
  título. Las otras franjas siguen arriba, porque piden una acción.

### 23 de octubre de 2026 · El tamaño de la letra y los buscadores (pedido del dueño)

- **Tamaño de la letra** (`tamanoDeLetra.ts`), en Configuración › Mi cuenta ›
  Mi pantalla: chica, mediana o grande.
  - Cambia el `font-size` del `<html>` (`data-letra`): 90 %, 95 % y 100 %.
    Las letras y los espacios de los tokens van en rem, así que todo cambia
    junto.
  - **Aplica a todo el sistema** (lo recordó el dueño el 23 de octubre): la
    aplicación de las empresas, el panel del superadministrador y el Gantt.
    El Gantt sigue la elección también en el alto de la fila: 22, 24 y 26 px
    (`ALTO_FILA_POR_LETRA` en Gantt.tsx), con las barras ubicadas desde la
    mitad de la fila. Lo que sigue en px y no cambia: el alto máximo del
    panel de una actividad (200 px) y los mínimos de toque.
  - **Regla para lo que se construya después:** toda letra y todo espacio va
    con los tokens (rem). Una letra en px no seguiría la elección de la
    persona.
  - **Grande** es el tamaño de antes. **Mediana**, la de partida, porque el
    dueño pidió la letra más chica en general.
  - Con mouse, en mediana el cuerpo queda en 14,25 px, el secundario en
    12,35 y las etiquetas en 11,4. En chica, 13,5, 11,7 y 10,8: bajo los 12 px
    que DISENO tenía de piso para etiquetas. Es elección de cada quien.
  - Se recuerda en el navegador, como el tema y la posición del menú. Si se
    quiere que siga a la persona entre equipos, hace falta guardarlo en la
    cuenta, y eso es un cambio de la API.
- **Las listas de los buscadores** van compactas y en un renglón, como la de
  agregar actividades en la mesa: la de vincular un recurso en el APU y la de
  las relaciones del cronograma también. El campo de búsqueda, con letra de
  13. Solo con mouse; en pantalla táctil siguen como antes, para el dedo.

### 23 de octubre de 2026 · El panel de una actividad, sin textos de ayuda (pedido del dueño)

- **Como el panel de abajo de P6:** sin textos de ayuda ni de ejemplo. Las
  explicaciones pasan al `title` de su campo o de su insignia, y aparecen al
  pasar el mouse: qué hacen las cuadrillas, cuándo manda la duración manual,
  la administración y «ya no está en el presupuesto».
- **Se fueron del todo:**
  - la ayuda de las restricciones;
  - la del desfase al agregar una relación;
  - el aviso de que una principal no admite secundaria: el campo
    simplemente no aparece;
  - la nota de holgura negativa: el rojo de la cifra lo dice.
- **Quedaron cortos:** «Sin predecesoras.», «Sin sucesoras.», la duración
  calculada en un renglón («Calculada: 7,4 días · 18,50 m³ a 2,5/jornal,
  1 cuadrilla») y «Corre todos los días, 24 horas».
- **Las etiquetas van a la izquierda de su campo**, en el mismo renglón;
  cuadrillas y duración manual, lado a lado.
- **Más denso, como P6** (mismo día): todo el panel en letra de 12, títulos
  incluidos, con campos y botones de 24 px y casi sin aire entre renglones.
  24 px es el mínimo de WCAG 2.5.8; P6 usa unos 18, pero más chico ya no se
  atina con el mouse sin riesgo. Esto reemplaza los 30 px y la letra de 13
  del 22 de octubre.

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
