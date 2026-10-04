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

**Se anidan, y solo hasta dos.** Desde la mesa de trabajo, cuando una actividad
no existe, «+ Crear Nuevo APU» abre el formulario de APU **encima** del
formulario de actividad, y al guardarlo el APU nuevo queda asignado al capítulo
sin perder lo que se había escrito (02 §8.3). Ese es el único anidamiento que
existe y **el límite es dos niveles**: el escape cierra la de arriba y nunca las
dos, y una tercera capa significa que el flujo está mal planteado.

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
