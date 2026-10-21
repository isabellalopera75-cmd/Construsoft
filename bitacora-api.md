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

## 2026-10-21 · miércoles, `npm run demo-cronograma` (DEMO-003)

**Hecho** (`307b02e`, 689 de 689)

- **`npm run demo-cronograma`** agrega DEMO-003 a la empresa de demostración
  y no toca DEMO-001 ni DEMO-002. Lo corre el dueño con su `.env`, y
  necesita:
  - `DEMO_CORREO`, `DEMO_CONTRASENA` y `VERSION_TERMINOS`, las mismas de
    `npm run demo`;
  - las conexiones `APP_DB_*` y `AUTH_DB_*`.

  Si DEMO-003 ya existe, se niega. También se niega si el correo no es de
  la empresa de demostración: la reconoce por su NIT.
- **Cómo lo arma:** el catálogo, el presupuesto y la activación van con los
  módulos, como `sembrar.ts`. El cronograma va por la API en el mismo
  proceso, con una sesión real de la empresa, así que pasa por las mismas
  validaciones que la pantalla. No hay ninguna fila escrita a mano.
- **Lo que sale, contra `construsoft_test`:**
  - **Presupuesto:** 11 capítulos y 32 ítems; cada ítem tiene su APU, con la
    cuadrilla a 1/rendimiento jornales por unidad y sus insumos. Total:
    **$3.240.304.754**.
  - **Calendario:** «Lunes a sábado medio día», con los festivos de Colombia.
    El cronograma empieza el **3 de noviembre de 2026 a las 7:00**.
  - **Hitos, trámites y relaciones:** van con los códigos y los grupos de tu
    tabla (H-001/H-002, T-001…T-003) y sus **46 relaciones**.
  - **Antes de la desviación:** el fin es el **2 de julio de 2027** y el
    director queda en **183 días**. Esa es la línea base «Contrato».
  - **Con el muro a 3 cuadrillas:** el fin pasa al **29 de julio de 2027**,
    **202,3 días**, y aparece el aviso de la administración con
    **19,0 días de más**.
  - **La holgura de H-002 es 0,0, no negativa.** El fin queda dos meses
    antes del 30 de septiembre, así que esa fecha no hay que moverla.

**Qué divergió:** nada. Las relaciones son exactamente las de tu tabla.

**Qué necesito de ti:** nada me bloquea. Una cosa para que la decidas tú, y
el guion no la toca: con tu tabla quedan **seis actividades sin sucesora**,
además de H-002, y el panel de revisión las va a mostrar:
- 1.2 Cerramiento provisional;
- 1.3 Campamento y bodega;
- 3.4 Escaleras en concreto;
- 4.2 Dinteles y columnetas;
- 5.2 Red sanitaria;
- «Entrega de cimentación».

Su holgura llega hasta el fin del proyecto. Si las quieres atadas, dime a
qué y lo agrego. La prueba fija esa lista, así que el cambio va en los dos
lados.

**Para que lo sepas:** la petición de los tres XER en `npm run muestras`
sigue pendiente. Es lo siguiente de mi lista.

---

## 2026-10-21 · miércoles, el XER para P6

**Hecho** (`a6a61e9`, 683 de 683)

- **`GET /api/exportacion/p6`** devuelve las tres versiones del §19.9, en su
  orden. **`formato=xer&p6=<id>`** descarga `PRE-001 - Cronograma.xer`. Una
  versión que no está en la lista, o ninguna, es 422 en `p6`.
- **El archivo** va en Windows-1252, con CRLF y sin BOM. Sus tablas son
  `CURRTYPE`, `OBS`, `PROJECT`, `CALENDAR`, `PROJWBS`, `TASK` y `TASKPRED`.
  Las columnas son exactamente las de las muestras, en su orden. Lo comprobé
  contra los tres archivos. 8.2 y 15.2 solo difieren en la versión de
  `ERMHDR`. 21.12 suma `SCHEDOPTIONS`.
- **La EDT:**
  - el nodo del proyecto lleva el código del presupuesto, y también es el
    `proj_short_name`;
  - debajo van los capítulos, cada uno con el último tramo de su código;
  - «Hitos y trámites» va como `HT`, con sus grupos numerados 1, 2…;
  - la administración y las que ya no están en el presupuesto quedan en el
    nodo del proyecto.
- **Las actividades:**
  - tipos: `TT_Task`, `TT_Mile` para el hito de inicio, `TT_FinMile` para
    el de fin, y `TT_LOE` para la administración;
  - las fechas tempranas y tardías son las del motor;
  - duraciones, holguras y desfases van en horas;
  - las dos restricciones van en `cstr_type`/`cstr_type2`;
  - la fecha de corte es la fecha de inicio a las 00:00.
- **La administración como LOE:** una CC desde la actividad que empieza
  primero hacia el LOE, y una FF desde el LOE hacia la que termina de
  última. Si hay empate, gana la primera en el orden de la pantalla.
- **`costo=true`** agrega `PROJCOST`: un gasto por actividad del presupuesto
  y otro para la administración, con `CL_Uniform`. Sin `costo`, la tabla no
  va.

**Qué divergió:** nada del contrato. Donde el §19.9 dejaba algo abierto,
decidí lo siguiente. Si alguna no te sirve, dímelo y la cambio:

1. **Un carácter que no existe en Windows-1252** pierde la marca que no
   tiene: `ő` sale como `o`. Si ni así cabe, sale `?`. `m²`, `Nº`, `—`, `€`
   y las tildes del español salen tal cual.
2. **La moneda es `COP`**, en `ERMHDR` y en `CURRTYPE`. Las muestras traen
   `USD` porque son de esa empresa.
3. **El calendario del desfase (RN-29):**
   - **En 21.12**, `SCHEDOPTIONS` lleva
     `sched_calendar_on_relationship_lag = rcal_Successor`. El valor lo
     deduje del `rcal_Predecessor` de la muestra. Ninguna muestra trae
     `rcal_Successor`.
   - **En 8.2 y 15.2** no hay dónde decirlo. P6 usará el calendario de la
     predecesora, y eso solo cambia algo en una relación entre una actividad
     de obra y una del corrido.
4. **La medianoche del final del día** (`24:00`) sale como `00:00`, igual
   que en el XML. Ninguna muestra tiene un calendario de 24 horas.
5. **Los dos calendarios van como `CA_Base`**, igual que el calendario por
   defecto del proyecto en las muestras. Al importar, quedan como
   calendarios globales. Por eso se llaman `PRE-001 - <nombre>`: así no
   chocan con uno que ya exista.
6. **`PROJCOST` solo aparece en la muestra de 21.12.** En 8.2 y 15.2 sale con
   esas mismas columnas, sin poder confirmarlas.
7. **Los GUID salen del uuid de cada cosa.** Si se exporta dos veces, P6 ve
   las mismas actividades.

**Qué necesito de ti:** nada me bloquea. Para cerrar el §19.9 falta
que el dueño importe un XER en P6. Lo que hay que mirar en esa importación:

- abre sin errores en las tres versiones;
- al programar (F9), las fechas coinciden con las de la pantalla;
- el LOE va de la primera actividad a la última;
- con `costo=true`, abre también en 8.2;
- en 21.12, «Calendar for scheduling relationship lag» dice Successor;
- una espera del corrido dura sus días de 24 horas.

Hay que actualizar la cabecera del §19 («salvo el XER») y el §19.11. Además
sigue pendiente la muestra de P8 («lo más tarde posible»).

**Para que lo sepas:** el `TextDecoder('windows-1252')` de Node 20 decodifica
0x80–0x9F como Latin-1, así que la raya `—` (0x97) desaparece. Las pruebas
leen el XER con su propia tabla. Si lees un XER con Node, no te fíes de ese
decodificador. Los navegadores y MPXJ lo hacen bien.

---

## 2026-10-21 · miércoles, `inicioSemana` y `?lineaBase=` en las escrituras

**Hecho** (`8997afd`, 668 de 668)

- **`inicioSemana`** en `VistaCronograma.cronograma` (§19.5): 1 = lunes … 7
  = domingo. Sale de la configuración de la empresa en la misma lectura, así
  que la pantalla ya no necesita suponer el lunes.
- **`?lineaBase=<id>` en todas las escrituras del §19.6 y en el 409**, con
  el mismo efecto que en el `GET`: la respuesta trae la `lineaBase` y el
  aviso de la administración de esa línea base.
  - **Una línea base de otro cronograma** es 404, como en el `GET`, y se
    resuelve dentro de la transacción de la escritura: la escritura no se
    guarda. Lo cubre una prueba, que comprueba que la versión y la fecha
    siguen como estaban.
  - Sin `?lineaBase=`, la respuesta sigue sin línea base, como antes.
- **Las muestras de `muestras/cronograma/` regeneradas** (`432d92f`):
  `vista.json` ya trae `inicioSemana`. Las cinco salen de la misma corrida,
  así que todos los ids cambiaron. `cronograma.xml` no cambió.

**Qué divergió:** nada.

**Qué necesito de ti:** nada. Vi que leíste el XML corregido con MPXJ y está
bien.

---

## 2026-10-21 · miércoles, el XML de Project corregido con tu lectura en MPXJ

**Hecho** (`7057349`, 664 de 664). `muestras/cronograma/cronograma.xml` está
regenerado: su diff es solo la corrección, y las otras cuatro muestras no
cambiaron.

- **La espera en el corrido: tenías razón, y lo hice como propusiste.** La
  duración va en días transcurridos (`DurationFormat 8`): `T-001` sale con
  `PT168H0M0S`, que son «7 edías». No encontré una salida mejor. En horas
  («168 h») sería exacto pero menos natural, y en Project el día transcurrido
  equivale justo a lo que significa el corrido (D-86). Conserva además
  `CalendarUID 2`.
- **Faltaba un caso que no estaba en tu lectura: el desfase hacia una sucesora
  del corrido.** Se cuenta en el calendario de la sucesora (RN-29), así que un
  día de desfase son 24 h, y con `LagFormat 7` Project lo mostraría como 3
  días. Ahora va con `LagFormat 8`. En la muestra es el del concreto al
  curado.
- **El WBS de las tareas resumen: lo puse explícito.** «Hitos y trámites» es
  `HT` y sus subgrupos `HT-1`, `HT-2`…, en su orden. Dejarlo a Project no es
  neutro: el «5» que inventó MPXJ chocaría con el capítulo 5 en un
  presupuesto que lo tenga. El contrato no fija estos códigos; si prefieres
  otros, se cambian aquí.

**Qué divergió:** nada del contrato.

**Qué necesito de ti:** que vuelvas a leer `cronograma.xml` con MPXJ, para
confirmar que `T-001` sale con 7 días transcurridos.

---

## 2026-10-21 · miércoles, las muestras del cronograma en `muestras/cronograma/`

**Hecho** (`fc8d916`). Son las respuestas reales de la API, pedidas por HTTP
(con `inject`) sobre `construsoft_test`, para el presupuesto de referencia
PRE-2026-001:

- `vista.json`: el `GET` del cronograma con `?lineaBase=`;
- `curvas-semana.json` y `curvas-mes.json`, con la línea base;
- `cronograma.xml`: `formato=xml&costo=true`;
- `gantt.pdf`: escala por semana, con la línea base.

**Lo que tiene el cronograma de muestra**

- Empieza el 2 de noviembre de 2026, con el calendario de por defecto, y
  todos los ítems tienen duración escrita a mano.
- 10 relaciones, entre ellas una CC con un día de desfase y una FF.
- **El hito con restricción:** «Fin del proyecto» lleva «fin en o antes de»
  el 29 de enero de 2027.
- **El trámite en el corrido:** «Curado del concreto» (`T-001`), 7 días. No
  sale crítico, y es correcto: termina el jueves a las 16:00 y la formaleta
  no puede empezar hasta el viernes a las 7:00, así que le sobran 15 horas
  corridas.
- **La línea base «Contrato»** se guardó con el presupuesto Activo. Después
  la excavación pasó de 5 a 7 días. Por eso la vista trae una variación de
  2 días al fin de la excavación, y el aviso de la administración con 2 días
  de más.
- Las dos curvas, la de ahora y la de la línea base, cierran en
  180.590.155.

**Qué divergió:** nada.

**Para que lo sepas**

- **`muestras/` está en `.gitignore`.** No lo toqué: estos cinco archivos
  entraron con `git add -f`, y las demás muestras siguen fuera del
  repositorio.
- **El guion que las genera no está en el repositorio.** Si las necesitas de
  nuevo, se regeneran; los ids cambian en cada corrida.

---

## 2026-10-21 · miércoles, la exportación: el Gantt en PDF y el XML de Project

**Hecho** (el hook en verde; el último, 662 de 662)

- **El Gantt en PDF** (`131a568`), en `GET …/exportar?formato=pdf&escala=…`.
  - Carta apaisada, con las fuentes incrustadas como en la oferta. A la
    izquierda va la tabla (código, actividad, días, inicio y fin); a la
    derecha, la escala de tiempo.
  - El dibujo:
    - los capítulos como barras resumen;
    - las actividades en azul, o en rojo si son críticas;
    - la administración en gris;
    - los hitos como rombos, verde el de inicio y negro el de fin;
    - la línea base como una barra amarilla debajo;
    - las relaciones como líneas en codo;
    - una marca naranja al final de una barra que termina a mitad de
      jornada (RN-27);
    - el tiempo no laborable sombreado en la escala por día.
  - **Si la obra no cabe a lo ancho, el tiempo sigue en otra hoja**, como
    imprime P6, y la tabla se repite. Por día caben unos 30 días por hoja,
    por semana unos 90 y por mes unos 7 meses.
  - Cada hoja dice quién la emite, qué cronograma es, la línea base si hay, y
    «Página i de n».
  - Lo revisé dibujado, no solo leyendo su texto.
- **El XML de Project** (`ff8dc3a`), en `GET …/exportar?formato=xml&costo=…`.
  - Los capítulos y los grupos de «Hitos y trámites» son tareas resumen en su
    nivel de la EDT, y el código va en `WBS`. Van los dos calendarios, con sus
    tramos y excepciones.
  - Las relaciones van con su tipo y su desfase.
  - La restricción principal va con la fecha al comienzo o al cierre de la
    jornada, como la usa el motor (A7).
  - «Inicio el» e «inicio obligatorio» salen como MSO; «fin el» y «fin
    obligatorio», como MFO. La secundaria se conserva solo si es «fin en o
    antes de», como `Deadline`.
  - La administración va como tarea normal.
  - Con `costo=true`, las actividades del presupuesto y la administración
    llevan su costo como `FixedCost`, en centavos como lo guarda MSPDI. La
    conversión se hace sobre el texto, sin coma flotante.
  - Comprobé que el archivo está bien formado con un lector de XML.
    **No lo abrí en Project ni en ProjectLibre:** no tengo ninguno de los dos.
- **El XER no está.** `GET /api/exportacion/p6` devuelve la lista vacía, y
  `formato=xer` es 422 en `p6` hasta que lleguen las muestras.
- **Otros rechazos de la ruta:** un `formato`, una `escala` o un `costo` que
  no existen son 422 con su campo. Sin `PRESUPUESTOS.EXPORTAR` es 403, y el
  cronograma de otra empresa, 404.

**Qué divergió.** Nada de las formas del §19.9. Hay tres cosas que el
contrato no dice y que resolví así:

- La escala del PDF, en puntos por día: 12 por día, 4 por semana y 1,6 por
  mes. El sombreado de lo no laborable va solo por día, porque en semanas o
  meses no se leería.
- Una relación se dibuja solo si sus dos actividades caen en la misma hoja,
  contando hacia abajo.
- En el XML, el desfase va en días (`LagFormat 7`), y una actividad del
  corrido lleva su calendario propio (`CalendarUID 2`).

**Qué necesito de ti**

- **Que el dueño abra un XML en ProjectLibre**, para encontrar los errores
  gruesos, como dice el 07 §6.9. Se descarga de cualquier cronograma con
  `formato=xml`.
- **Los XER de muestra**, que siguen pendientes, para el XER y para confirmar
  P8 (§19.11).

**Para que lo sepas:** una corrida del hook tardó 549 s por una pausa de la
máquina. La batería completa tarda 158 s.

---

## 2026-10-20 · martes, la 0007, el aviso, P7, P8, P9 y las cuatro lecturas

**Hecho** (cada commit con el hook en verde; el último, 654 de 654)

- **La 0007 está commiteada** (`dcb09d0`) con su `.revertir.sql`,
  `prueba-d94.sql` y el cambio de `prueba-d81-d92.sql`.
  - Va en el mismo commit que el recálculo que la escribe, porque la columna
    `NOT NULL` sin valor por defecto rompía el upsert: el upsert escribe
    `en_presupuesto`, también en el `DO UPDATE`, y el recálculo escribe
    `calculado_valor_total`.
  - `construsoft` la tiene, aplicada con `npm run migrar`.
  - Las dieciséis baterías dan verde sobre `construsoft_test` recién
    rehecha, D-94 7 de 7.
- **P8** (`2a68b58`): «lo más tarde posible» corre las fechas tempranas, y la
  holgura total baja en lo que se corrió, como dijiste.
- **P7** (`897fe54`): `rendimientoActividad` en `GET`, `POST` y `PUT` de APU,
  con el 422 en su campo.
  - En el `PUT`, si no viene, la versión nueva hereda el de la vigente; con
    `null`, se quita.
  - Cada cambio es una versión nueva, por el camino de siempre.
- **El aviso (D-93, D-94)** (`4ede8c0`):
  - Lo arma solo la lectura que recalcula porque cambió el presupuesto,
    nunca el primer cálculo ni una escritura del cronograma. Una escritura lo
    anula.
  - Acumula con tus cuatro reglas.
  - Las pruebas cubren seis casos: una cantidad que alarga una actividad con
    rendimiento y el fin de la obra; la vuelta al valor de antes, que lo
    anula; el renombre de un capítulo, que no crea franja; un ítem que entra
    y sale; uno que estaba y sale, con su código `X-`; y cerrarla, y escribir.
  - Probé con mutaciones dos de las reglas de acumulación.
- **P9** (`2682875`): gzip con `@fastify/compress` en todas las respuestas de
  más de 1 KB, si el navegador lo acepta.
  - **Fijé la versión 9.2.0 exacta**, publicada el 8 de agosto. Las dos
    siguientes tienen menos de dos semanas, y con un rango `^` npm habría
    instalado la 9.2.2.
  - La vista de prueba pesa menos de un tercio.
- **Las cuatro lecturas** (`35165d4`): `GET /api/calendarios` y
  `GET /api/festivos`, con `PRESUPUESTOS.VER` o, con `?para=CONFIG`,
  `CONFIG.PREFERENCIAS`; los dos detalles, con `CONFIG.PREFERENCIAS`.
  - Otro valor de `?para=` es 422 en `para`.
  - La copia de la obra de un cronograma no existe para el detalle.

**Qué divergió:** nada.

**Qué necesito de ti:** nada nuevo. Siguen esperando los XER de muestra para
la exportación a P6 y para confirmar P8 (§19.11).

**Lo que sigue de mi lado:** la exportación (§19.9). Primero el PDF del
Gantt, después el XML de Project y, con las muestras, el XER.

---

## 2026-10-20 · martes, el paso 4: §19.5–§19.8 construidos y RNF-29 medido

**Hecho** (cada commit con el hook en verde; el último, 642 de 642)

- **`81d0fce`.** Tres piezas que usa todo lo demás:
  - `traducirError` pasa el `ciclo` del detalle de la base;
  - `ErrorParaElUsuario` tiene un 409 propio (`CONFLICTO`);
  - `ejecutarConPermisoEnUnaFoto` es la transacción en REPEATABLE READ de
    B4, con hasta dos reintentos ante 40001.
- **`f2f1afb`, leer, crear y editar (§19.5–§19.6).**
  - Están las 21 rutas de escritura y la lectura, que recalcula si hace
    falta.
  - Cada escritura bloquea la fila del cronograma, compara la versión,
    aplica el cambio, sube la versión, anula la franja y recalcula, todo en
    la misma transacción. Los resultados entran en un solo upsert.
  - Antes de calcular, la API pone las actividades al día con el
    presupuesto: primero el refresco y después las inserciones, como pediste.
- **`7535d66`, las curvas y las líneas base (§19.7–§19.8).**
  - El motor entrega los minutos por día y `fn_curvas` reparte la plata;
    las acumuladas salen de la base. La facturación del presupuesto de
    referencia cierra en 180.590.155.
  - Las líneas base cubren P1: si el cronograma estaba desactualizado al
    guardar, la API recalcula, no guarda y responde 409 con la vista.
- **`88234c3` y `31142c0`, 27 pruebas HTTP del cronograma.** Cubren:
  - que el presupuesto manda: un ítem nuevo, uno que sale (`X-`), una
    cantidad que cambia;
  - el Cerrado, el solo lectura y la suscripción vencida;
  - el aislamiento;
  - el calendario de la obra, los hitos, los trámites y las restricciones.

  Probé con mutaciones el rechazo explícito del Cerrado y la creación de
  las actividades de los ítems nuevos.

**RNF-29, medido** sobre la base, con 1.500 actividades, 3.000 relaciones y
30 frentes (mediana de 7 vueltas):

| Operación | Tiempo |
|---|---|
| Una edición completa: bloquear, cambiar, poner al día, motor, escribir y confirmar | **294 ms** (máximo 341) |
| La lectura que recalcula tras un cambio del presupuesto | **304 ms** |
| Leer un cronograma al día | 55 ms |
| Armar la vista | 53 ms |

Las dos operaciones que mide RNF-29 quedan por debajo de los 500 ms. El
primer cálculo, al crear, tardó 470 ms. Duplicar ese presupuesto, con su
cronograma, tarda 1,2 s.

**Qué divergió, y cómo lo resolví**

- **Los campos de las restricciones.** La base marca sus rechazos con
  `restriccionTipo`, `restriccionFecha`, `restriccion2Tipo` y
  `restriccion2Fecha`; el §19.6 dice `restriccion.tipo`, `restriccion.fecha`,
  `restriccionSecundaria.tipo` y `restriccionSecundaria.fecha`. La API los
  traduce a los del contrato, y la base no cambia.
- **Un segundo cronograma para el mismo presupuesto.** La base lo rechaza
  como P0001, que sería 422; el §19.5 dice 409. La API lo pregunta antes y
  responde 409.
- **Cosas que el contrato no dice, resueltas así; si alguna no te sirve, se
  cambia:**
  - **El `costo` de `ADM`** es la administración del AIU del presupuesto
    (RN-37).
  - **`recalculado` es falso al crear**, aunque crear calcula, porque el
    campo habla de una lectura.
  - **Las fechas tardías de un instante** de inicio (un hito de inicio, una
    actividad de duración cero) caen en el siguiente instante laborable, como
    las tempranas; las de un hito de fin, al cierre. Antes salían al cierre
    del viernes anterior, a veces antes de que empezara el cronograma. Lo
    encontró una prueba, y lo corregí en el motor.
  - **`?lineaBase=`** de una línea base de otro cronograma es 404.

**Qué necesito de ti**

- **Sigue abierto, de entradas anteriores:**
  - el cambio de esquema del aviso (D-93); hasta entonces `avisos.presupuesto`
    sale siempre nulo;
  - el permiso de las cuatro lecturas de calendarios y festivos;
  - P7, RF-APU-25 en el formulario de APU;
  - P8, «lo más tarde posible» y la holgura total.
- **P9. La vista pesa 1,6 MB de JSON con 1.500 actividades, y viaja en cada
  edición** (§19.1). Medido así, cabe en los 500 ms en la máquina, pero en
  una red lenta no. Propongo comprimir las respuestas (gzip) con
  `@fastify/compress`. Es una dependencia nueva y no cambia ninguna forma.
  ¿Te parece, o prefieres que la edición devuelva menos?

**Lo que sigue de mi lado:** la exportación (§19.9). El PDF del Gantt no
depende de nada. El XER espera los archivos de muestra, y el XML lo armo
contra el esquema de Project.

---

## 2026-10-20 · martes, el aviso del presupuesto necesita dos datos que la base no guarda

**Qué necesito de ti. Es un cambio de esquema; me bloquea solo el aviso
(D-93).** El resto del paso 4 sigue.

El aviso compara contra el cálculo anterior, y de él la base guarda las
fechas y las duraciones (`actividad_calculo`). Así salen `duracionesCambiadas`,
`finAntes` y `entraron`, que son las actividades sin cálculo anterior. Hay dos
cosas que no salen de ningún lado:

- **`valorTotalAntes`.** Es el valor total del presupuesto cuando se hizo el
  cálculo anterior, y ninguna tabla lo conserva.
- **`salieron`.** Al borrar un ítem, su actividad queda con
  `presupuesto_item_id` nulo y código `X-…`, pero nada dice si estaba en el
  presupuesto en el cálculo anterior. Una huérfana de hace un mes y una de
  hoy se ven iguales, y sin eso la franja volvería a listar las viejas.

**Propongo lo mínimo, las dos escritas por el recálculo:**

- `app.cronograma.calculado_valor_total app.dinero`, nula hasta el primer
  cálculo, con `UPDATE` para la aplicación como las otras `calculado_*`;
- `app.actividad_calculo.en_presupuesto boolean NOT NULL`: si la actividad
  tenía ítem al calcularse.

Con eso, `salieron` son las huérfanas cuyo cálculo anterior dice
`en_presupuesto = true`. Si prefieres otra forma, como una foto en `jsonb`
del cálculo, me sirve igual; lo que hace falta es el dato.

**Para que lo sepas:** a una actividad huérfana sin duración manual le dejo
la duración de su último cálculo, en vez de cero. Así no se acorta en
silencio la cadena que el usuario tiene que ver romperse (RN-33). El 07 no lo
dice; si debe ser otra cosa, avísame.

---

## 2026-10-20 · martes, §19.3–§19.4 sin las lecturas, RF-APU-25 y el motor

**Hecho** (cada paso con su commit y el hook en verde; el último, 610 de 610)

- **§19.3, las escrituras de los calendarios** (`a465934`): crear, editar
  (la semana se reemplaza entera), eliminar, marcar por defecto,
  excepciones y copiar festivos.
  - Los tramos los valido como un solo campo: el error llega en `semana` o
    en `tramos`, no en `semana.0.1.inicio`.
  - `ux_calendario_nombre` da 409 en `nombre`.
  - Un calendario de un cronograma no existe para estas rutas: es 404.
- **§19.4, las listas propias** (`4d1180e`), con su plantilla y su
  importación (`1f71c3f`). Siguen el §10: todo o nada y todos los errores
  por fila. El éxito responde 201 con la `ListaPropia`.
- **§19.4, el panel** (`e5e986f`): `GET /api/superadmin/festivos` y
  `POST …/festivos/:pais/extender`. Un país sin lista es 404.
- **RF-APU-25, la plantilla de APU** (`6c06b41`): la hoja APU gana la
  columna «Rendimiento de la actividad». Es opcional, mayor que cero y con
  hasta cuatro decimales, y se guarda con la llamada de siete argumentos.
  Las instrucciones aclaran que no es el Rendimiento de la hoja Composición.
- **El motor, puro y sin base** (`src/cronograma/`), en tres commits
  (`106f466`, `df9e844` y `caa4b3f`):
  - el calendario compilado, con las dos operaciones de la D-81;
  - el CPM con las restricciones de P6, las holguras y la administración;
  - las conversiones exactas: la duración al minuto hacia arriba y los días
    con un decimal.

  Lo prueban 40 casos calculados a mano, y lo comprobé con mutaciones, una
  defensa a la vez.
- **Medido el motor** (RNF-29): 1.500 actividades, 3.000 relaciones, 30
  frentes en paralelo, sábados medio día y festivos de cinco años. Compilar
  los dos calendarios, el CPM y los minutos por día de las curvas tardan
  49 ms en caliente (máximo 66) y 94 ms en frío. Sin contar la base.

**Qué divergió.** Nada de las formas del §19. Hay cuatro cosas que el
contrato no dice y que resolví así; si alguna no te sirve, se cambia:

- Una fecha mal escrita en la ruta de una excepción es 422 en `fecha`.
- **Una plantilla de APU vieja, de tres columnas, se rechaza entera** con
  «no tiene las columnas de la plantilla… descárguela de nuevo».
- **El desfase se redondea al minuto a la mitad alejándose del cero;** la
  duración manual, hacia arriba, como la calculada (A6). Solo cambia algo
  cuando el factor del calendario tiene centésimas: 0,1 días de 8,33 h son
  49,98 minutos.
- **La holgura libre puede salir negativa** cuando una restricción
  obligatoria pone a la sucesora antes del fin de su predecesora. No la
  corto en cero.

**Qué necesito de ti.** Nada de esto me bloquea el paso siguiente.

- **Sigue abierto el permiso para leer calendarios y festivos** (mi entrada
  anterior). Esas cuatro lecturas son lo único de §19.3–§19.4 sin construir.
- **P7. RF-APU-25 en el formulario de APU.** El §6 no tiene el campo. Hace
  falta que `Apu` (o su versión) traiga `rendimientoActividad` y que crear
  y editar lo acepten, con la pregunta de propagación de siempre al
  cambiarlo. Es una forma nueva, así que primero va en el contrato.
- **P8. «Lo más tarde posible» y la holgura total.** Al correr la
  actividad para consumir su holgura libre, dejo la holgura total como salió
  del cálculo, así que la actividad no se vuelve crítica solo por ser «lo más
  tarde posible». La documentación de P6 que conozco no es clara en esto.
  ¿Lo confirmas, o la holgura se recalcula con las fechas corridas?

**Qué encontré que deberías saber**

- **El horizonte del calendario lo dimensiona la API según el cronograma.**
  En la medición, una red en serie de 1.500 actividades largas daba una obra
  de décadas, y el cálculo se salía del horizonte. No toca la base: es mío.

**Lo que sigue de mi lado:** el paso 4, las rutas de §19.5–§19.8 con el
recálculo en una transacción (B4), el aviso, la revisión y las líneas base.

---

## 2026-10-20 · martes, §19.2 hecho y una contradicción en §19.3–§19.4

**Hecho**

- **El guion de reseteo prueba la última migración sobre una base con una
  empresa** (`0bd1f8d`). Carga todo menos la última, siembra una empresa con
  `fn_alta_tenant`, aplica la última encima, y si pasa rehace la base limpia,
  así que las pruebas siguen arrancando sin empresas.
  - Comprobé que falla: con la 0004 de `1a10a00` se detiene en la línea 599,
    con el mismo error que dio `construsoft`.
  - Las migraciones de hoy pasan.
- **§19.2** (`ea3c326`): `Preferencias` trae `horasPorJornal` (`"8.00"`) e
  `inicioSemana` (1…7). Fuera de rango, con más de dos decimales o con el
  tipo equivocado, es 422 con su `campo`. El `PUT` los exige, como al resto
  de `Preferencias`.

**Qué necesito de ti. Me bloquea solo las cuatro lecturas.**

- **Dos árbitros se contradicen en el permiso para leer.** El §19 dice que
  `GET /api/calendarios`, `GET /api/configuracion/calendarios/:id`,
  `GET /api/festivos` y `GET /api/configuracion/festivos/:id` se leen «sin
  permiso propio, como las unidades (§7)». Pero las unidades sí piden
  permiso: `GET /api/unidades` exige `RECURSOS.VER`, o `APU.VER` con
  `?para=APU` (§5). Lo que no piden es `CONFIG.PREFERENCIAS`.
- **Leer de verdad sin permiso tiene un costo.** Hay que pasar por
  `ejecutarSinPermiso`, que se salta `fn_exigir_permiso`, y esa función es
  también la que aplica el 423 de una cuenta suspendida (D-74). Una empresa
  suspendida leería sus calendarios. Es su propio dato y no se fuga nada,
  pero rompe la regla de que una cuenta suspendida solo entra a la
  suscripción. Las nueve exenciones que existen hoy son todas de antes de
  saber qué permiso aplica (la sesión, el formato numérico, el logo).
- **Propongo seguir el precedente de las unidades:**
  - `GET /api/calendarios` y `GET /api/festivos` (los desplegables) con
    `PRESUPUESTOS.VER`, o con `CONFIG.PREFERENCIAS` si llega
    `?para=CONFIG`, igual que `?para=APU`;
  - el detalle (`/api/configuracion/calendarios/:id` y
    `/api/configuracion/festivos/:id`) con `CONFIG.PREFERENCIAS`, como el
    resto de la pestaña. La pantalla del cronograma no lo necesita: el
    calendario de la obra viene en la `VistaCronograma`.

  ¿Así, o prefieres otra cosa? Mientras tanto construyo las escrituras,
  que piden todas `CONFIG.PREFERENCIAS` y no tienen duda.

---

## 2026-10-20 · martes, la 0006 aplicada y el §19 leído

**Hecho**

- **Antes del commit** apliqué la 0006 sobre `construsoft_test` con la
  demostración sembrada y dos cronogramas ya confirmados. Se aplica, y los
  dos quedan con `aviso_presupuesto` nulo.
- **La 0006 está commiteada** (`e64947b`) con su `.revertir.sql` y
  `docs/prueba-d93.sql`. El hook dio 539 de 539. `TIPOS_EVENTO` no cambió.
- **`construsoft` tiene la 0006**, aplicada con `npm run migrar`. Una
  segunda corrida dice «al día».
- **Las quince baterías en verde** sobre `construsoft_test` recién rehecha
  (D-93 8 de 8), y los verificadores en cero o sin error. `prueba-d93.sql`
  quedó en mi lista.
- **Leí el §19 completo.** Casi todo me sirve tal como está. Lo que no, va
  abajo como pregunta. No construyo esas piezas hasta tener respuesta; el
  resto lo empiezo ya.

**Comprobado, para que no se discuta después.** Un `GET` que recalcula con
la suscripción en solo lectura (§19.1) no choca con la base: la suscripción
la comprueba `fn_exigir_permiso` según el permiso de la petición, y el `GET`
corre con `PRESUPUESTOS.VER`. No hace falta ningún cambio.

### Lo que necesito de ti antes de construir esas piezas

Ninguna de estas preguntas me bloquea el motor ni las rutas de §19.2–§19.4.
Me bloquean la franja, la lista de revisión y guardar líneas base.

- **P1. Guardar una línea base con el cronograma desactualizado (§19.8).**
  `version` es «la que la persona está viendo», pero un cambio del
  presupuesto no sube la versión. Pasa así:
  - la persona ve la versión 7 con el fin el 10 de marzo;
  - alguien cambia una cantidad;
  - la persona guarda la línea base con `version` 7.

  La versión coincide, y la API recalcula antes de guardar (la base exige
  que esté al día). Queda guardado un fin del 14 de marzo que la persona
  nunca vio. Propongo responder 409 con la vista recalculada cuando el
  cronograma estaba desactualizado al guardar: lo que vio ya no es lo que se
  guardaría. ¿De acuerdo, o se guarda igual?
- **P2. `AvisoDelPresupuesto.desde`, «el primer cambio sin cerrar».** La API
  no sabe cuándo fue el primer cambio: la base guarda solo la última
  modificación (`presupuesto.fecha_modificacion`). Propongo que `desde` sea
  la `fecha_modificacion` que leo en el recálculo que crea el aviso, o sea,
  el último cambio antes de ese primer recálculo, y que los recálculos
  siguientes la conserven. No es exactamente «el primer cambio». Si tiene
  que serlo, hace falta guardar la fecha en la base, y eso es tuyo.
- **P3. ¿Hay aviso cuando no cambió nada que se vea en él?** La revisión del
  presupuesto sube también con un cambio de precio o el renombre de un
  capítulo. Las dos listas de actividades (entraron y salieron) y las
  duraciones salen vacías, y el fin queda igual. Propongo no crear el aviso,
  ni tocar uno que ya exista, cuando esas tres listas salen vacías y el fin
  no cambió. Un cambio de precio sí mueve las curvas, y eso el aviso no lo
  muestra. Es decisión de producto, porque la franja aparece o no.
- **P4. Cómo se acumula el aviso.** La forma no lo dice. Propongo:
  - un ítem que entró y salió antes de que se cierre el aviso desaparece de
    las dos listas;
  - una duración que volvió a su valor de antes sale de
    `duracionesCambiadas`;
  - `antesDias` y `finAntes` conservan el valor del primer recálculo, y
    `ahoraDias` y `finAhora` toman el del último.

  ¿De acuerdo?
- **P5. `revision.sinProgramar`: ¿solo para actividades `ITEM`?** La
  respuesta a C4 hablaba de ítems nuevos. Un hito sin relaciones ya sale en
  `sinPredecesora` y `sinSucesora`. Si `sinProgramar` aplica a todos los
  tipos, los hitos recién creados salen dos veces en la lista.
- **P6. `finAMitadDeJornada`.** Propongo esta definición: el fin no coincide
  con el cierre del último tramo de ese día en el calendario de la
  actividad. Es falso en los hitos. ¿Así?

**Lo que sigue de mi lado, en este orden:**

1. El guion de reseteo siembra una empresa antes de la última migración.
2. Las rutas de §19.2–§19.4 (jornal, semana, calendarios y festivos, con la
   plantilla) y la columna del rendimiento en la plantilla de APU
   (RF-APU-25).
3. El motor: calendario compilado, CPM con las restricciones de P6 y las
   holguras, con sus pruebas calculadas a mano y la medición de RNF-29.
4. Las rutas de §19.5–§19.8, con las respuestas a P1–P6.
5. La exportación, cuando lleguen los XER de muestra.

---

## 2026-10-20 · martes, la 0005 commiteada y aplicada en `construsoft`

**Hecho**

- **Antes del commit** apliqué la 0005 sobre `construsoft_test` con la
  demostración sembrada (DEMO-001 Activo, DEMO-002 Abierto), que es lo más
  parecido a `construsoft`. Se aplica, y `fn_crear_cronograma` crea el
  cronograma de los dos (13 ítems, dos `ADM`, dos hitos de inicio y dos de
  fin), dentro de una transacción con ROLLBACK.
- **La 0005 está commiteada** (`f28ffba`) con su `.revertir.sql` y
  `docs/prueba-d81-d92.sql`. El hook dio 539 de 539.
- **`construsoft` tiene la 0005**, aplicada con `npm run migrar`. Una
  segunda corrida dice «al día».
- **Las catorce baterías en verde** sobre `construsoft_test` recién rehecha
  (D-81…D-92 127 de 127), y los cuatro verificadores en cero o sin error.
  La batería nueva quedó en mi lista.

**Qué divergió, y cómo se resolvió**

- **El primer intento del commit lo frenó el hook, con 538 de 539.** La
  0005 agrega seis tipos a `app.tipo_evento` (`CRONOGRAMA_CREADO`,
  `CRONOGRAMA_CALENDARIO`, `CRONOGRAMA_FECHA_INICIO` y `LINEA_BASE_GUARDADA`,
  `_REEMPLAZADA` y `_ELIMINADA`). Una prueba mía exige que `TIPOS_EVENTO` de
  `historial.ts` sea exactamente ese catálogo. Los agregué en el mismo
  commit de la migración: por separado, cualquiera de los dos queda en
  rojo.
- **Con eso, el filtro `tipo` de `GET …/historial` acepta los seis.** La
  forma de la respuesta no cambia, y el contrato no enumera los tipos, así
  que no hay nada que corregir allí.

**Qué necesito de ti:** nada. No me bloquea nada hasta el §19.

**Qué encontré que deberías saber**

- **Cuando una migración agregue tipos de evento o permisos, dilo en tu
  entrada.** Mis pruebas comparan las dos listas (`TIPOS_EVENTO` y
  `CODIGOS_PERMISO`) con su catálogo, y el hook no deja commitear la
  migración sin que la mía crezca en el mismo commit.

**Lo que sigue de mi lado**

- En un commit propio, el guion de reseteo siembra una empresa antes de la
  última migración.
- La columna del rendimiento en la plantilla de APU (RF-APU-25).
- El motor, en cuanto esté el §19.

---

## 2026-10-20 · martes, la 0004 corregida y aplicada en `construsoft`

**Hecho**

- **Antes del commit** probé la corrección con el caso que fallaba: 05 más
  0001…0003, una empresa creada con `fn_alta_tenant` y la 0004 encima. Se
  aplica, y la empresa queda con «Lunes a viernes», por defecto, 8 h por día
  y 10 tramos.
- **La corrección está commiteada** (`6a4ec55`). El hook dio 539 de 539.
- **`construsoft` tiene la 0004**, aplicada con `npm run migrar`. Una
  segunda corrida dice «al día». Las empresas de la base de desarrollo
  recibieron su calendario por el relleno corregido.

**Qué divergió:** nada.

**Qué necesito de ti:** nada. Sigo con lo mío mientras escribes la 0005 y
el §19.

**Lo que sigue de mi lado:**

- En un commit propio, que el guion de reseteo siembre una empresa antes de
  la última migración. Lo aceptaste en tu entrada de hoy.
- Después, la columna del rendimiento en la plantilla de importación de
  APU (RF-APU-25), con la llamada de siete argumentos.

---

## 2026-10-20 · martes, la 0004 commiteada y rechazada por `construsoft`

**Hecho**

- **La 0004 está commiteada** (`1a10a00`), con su `.revertir.sql` y
  `docs/prueba-d84-d91.sql`. El hook dio 539 de 539.
- **En `construsoft_test`, recién rehecha:** las trece baterías en verde
  (D-84…D-91 56 de 56) y los cuatro verificadores en cero o sin error. La
  batería nueva quedó en mi lista.
- **Mis llamadas a `fn_nueva_version_apu` siguen bien.** Son todas de cinco
  argumentos, y ninguna la nombra con `::regprocedure` ni en un `GRANT`.

**Qué necesito de ti. Me bloquea la base de desarrollo, no el código.**

- **`npm run migrar` sobre `construsoft` falla, y la base quedó intacta.**
  La migración corre entre `BEGIN` y `COMMIT`, así que el error la deshizo
  entera. Una segunda corrida vuelve a intentarlo, señal de que no quedó
  anotada. El error dice:

  ```
  0004-cimientos-del-cronograma.sql:599: ERROR: no se puede hacer ALTER TABLE
  en «calendario» porque tiene eventos de "trigger" pendientes
  ```

  - **La causa:** la línea 528 crea el calendario de cada empresa existente.
    Eso encola los eventos de los tres disparadores diferidos
    (`tg_tramo_sin_cruce`, `tg_tramo_ex_sin_cruce` y
    `tg_un_calendario_por_defecto`, líneas 464–498). Después, el
    `ALTER TABLE app.calendario OWNER TO …` de la 599 choca con esos eventos
    pendientes.
  - **Por qué pasó la batería:** `construsoft_test` arranca con cero
    empresas, así que la línea 528 no crea nada y no queda ningún evento
    pendiente.
  - **Cómo reproducirlo:** cargar el 05 y la 0001…0003, crear una empresa
    con `fn_alta_tenant` y aplicar la 0004. Falla en la misma línea. Lo
    reproduje así en `construsoft_test`.
  - **El arreglo es tuyo, porque la migración es tuya.** Un
    `SET CONSTRAINTS ALL IMMEDIATE;` justo después del relleno de la 528, o
    mover el relleno después del bloque de dueños y RLS. Cualquiera de los
    dos comprueba las reglas al momento, en vez de dejarlas para el
    `COMMIT`. Como la 0004 ya está commiteada y no se aplicó en ninguna
    base, se puede corregir en el mismo archivo. Nadie tiene anotada su
    huella.
- **Cuando esté corregida**, corro `npm run migrar` sobre `construsoft` y lo
  anoto aquí.

**Qué encontré que deberías saber**

- **El hook y las baterías aplican las migraciones sobre una base vacía.**
  Por eso una migración que rellena datos de empresas existentes nunca se
  prueba con empresas. Propongo, de mi lado, que el guion de reseteo cree
  una empresa entre la 0003 y la siguiente migración, o sea, antes de la
  última. Lo hago en un commit propio si estás de acuerdo.
- **Las baterías D-74 y D-78 dan rojo si corren justo después de
  `npm test`.** Cuentan filas de toda la base, y las pruebas de la API dejan
  empresas y eventos. No es un defecto: con la base rehecha dan verde. Desde
  hoy las corro siempre sobre una base recién rehecha.

---

## 2026-10-20 · martes, el capítulo 6 leído por quien escribe el motor

**Hecho.** Leí completos el 07 §6 (con la 6.9 y las parejas del 20) y los
cotejé con el 05 y el contrato §1–§2. Fue solo lectura, sin código. Nada de
esto bloquea la 0004, salvo B3, que puede entrar en ella o en la 0005. Los
puntos van numerados para que respondas por número.

### A. Lo que el motor necesita y la 6.7 no tiene

- **A1. El amarre al ítem, y que sobreviva a su borrado.** Hace falta
  `actividad_programada.presupuesto_item_id`, nulo para hitos, trámites y
  administración. La RN-33 dice que borrar un ítem no borra su actividad, y
  eso choca con dos cosas:
  - con `ON DELETE CASCADE` la actividad se iría sola;
  - con `SET NULL` sobre la llave compuesta `(tenant_id, presupuesto_item_id)`
    se anularía también `tenant_id`.

  PostgreSQL 15 admite `ON DELETE SET NULL (presupuesto_item_id)`, que anula
  solo esa columna. Con eso, «ya no está en el presupuesto» se lee
  directamente (`tipo = 'ITEM' AND presupuesto_item_id IS NULL`) y no hace
  falta otra marca. Necesita un índice sobre la columna, porque el borrado de
  un ítem, hoy en 8,3 ms, va a recorrerla.
- **A2. El nombre, el código y el orden.** La 6.7 no tiene `nombre` ni
  `orden`. Los hitos y los trámites no tienen de dónde sacarlos, y el orden
  hace falta para la tabla, el Gantt y el XER. Además, la actividad huérfana
  de A1 pierde la descripción y el número que leía del ítem. Propongo que
  `nombre` y `codigo` estén en todas las actividades: el recálculo los
  refresca desde el ítem mientras ese ítem exista, y el usuario los escribe
  en los hitos y los trámites.
- **A3. Hasta qué año llegan los festivos de cada calendario.** RF-CFG-32
  pide avisar cuando el cronograma pasa del último año cargado. Si las fechas
  se copian como excepciones sueltas que después se editan una por una, ese
  dato se pierde. Propongo `calendario.festivos_hasta` (y de qué lista
  salieron), escrito al copiar la lista.
- **A4. El factor del corrido no está escrito. Pregunta: ¿«1 día = 24 h»?**
  Es lo que hace P6 con un calendario de 24 h: una espera de 7 d son 168 h.
  Si fuera 8, esa misma espera duraría 56 h corridas sin que nadie lo
  notara. Sea cual sea, que quede escrito en el 07.
- **A5. La duración manual: ¿horas o días? Las dos fuentes se contradicen.**
  La 6.7 dice «horas manuales» y la 6.9 dice «días del calendario de la
  actividad, con un decimal». La diferencia se ve cuando cambia el factor del
  calendario, por ejemplo de 8 h a 10 h:
  - guardada en horas, se conservan las horas y el usuario pasa a leer
    4,0 d donde antes leía 5,0 d;
  - guardada en días, se conservan los días y cambian las horas.

  Propongo horas, igual que el desfase de la RN-29 y como lo guarda P6. Es
  decisión de producto porque el usuario lo ve.
- **A6. A qué resolución redondea el motor.** RN-27 prohíbe redondear
  fechas, pero 30 m³ ÷ 7 m³/d × 8 h son 2.057,14 minutos, y algo hay que
  redondear. Pregunta: ¿se redondea la duración al minuto, hacia arriba, sin
  tocar nunca las fechas? Es mi propuesta, pero no la decido yo.
- **A7. Una restricción que cae en un día no laborable.** La 6.9 dice que
  las de inicio toman el comienzo de la jornada y las de fin el cierre, pero
  no dice qué pasa en un domingo o un festivo. Pregunta: ¿se hace lo mismo
  que en P6?
  - una de inicio pasa al siguiente instante laborable;
  - una de fin queda al cierre del último tramo laborable anterior.

  Va en el motor, no en la base, porque depende del calendario. La fecha de
  la restricción es `date`, y solo puede ser nula con «lo más tarde posible».
- **A8. Tres reglas del motor que no están en el 07.** Pregunta: ¿se hacen
  como P6? No necesitan columna, pero tienen que quedar escritas en el 07
  antes de que las programe:
  - ninguna actividad empieza antes de la fecha de inicio del cronograma,
    aunque un desfase negativo la empuje hacia atrás;
  - el paso hacia atrás arranca del fin temprano más tardío, y las
    actividades sin sucesora toman ese fin tardío;
  - el plazo del contrato se expresa como restricción del hito de fin
    (RN-28).

### B. Dónde quedan los resultados y cómo escribe un recálculo

- **B1. Los resultados van en una tabla aparte, `actividad_calculo`.** Es
  1 a 1 con la actividad y se borra en cascada con ella. Lleva estas
  columnas:
  - inicio y fin tempranos y tardíos, como `timestamp` sin zona;
  - la duración calculada, en minutos enteros;
  - la holgura total y la libre, en minutos laborables del calendario de su
    actividad, con negativos permitidos;
  - `critica`, generada a partir de `holgura_total <= 0`.

  Hay tres motivos para no meterlos en la tabla de la actividad:
  - Un GET puede tener que recalcular (D-91), y eso pasa en dos casos en los
    que nadie está editando:
    - un cronograma Cerrado que quedó desactualizado, porque nadie lo abrió
      entre la última edición del presupuesto Abierto y su activación;
    - un usuario sin permiso de edición (RN-43) que abre un cronograma
      desactualizado.

    El guardián de solo lectura (RN-34) y los permisos tienen que proteger
    las entradas y dejar escribir los resultados en cualquier estado y con
    cualquier rol que pueda leer. Con tablas separadas eso es una línea; con
    una sola tabla, es una lista de columnas exentas dentro del guardián.
  - El recálculo reescribe 1.500 filas. Si fueran las filas de entrada,
    dispararía 1.500 veces los guardianes de entrada (estado, parejas de la
    RN-30), y todas esas comprobaciones serían inútiles.
  - El recálculo no escribe historial. Ninguno de los cuatro eventos de la
    6.9 es un recálculo.
- **B2. Dos marcas en `cronograma`, no una.**
  - `version` cubre las entradas: la sube cada guardado y es la que decide
    el 409.
  - `calculado_version` y `calculado_revision` dicen con qué entradas y con
    qué revisión del presupuesto (B3) se hizo el último cálculo.

  El cronograma está al día si las dos coinciden con las actuales. Escribir
  resultados **no** sube `version`: si la subiera, alguien que solo abre el
  cronograma le haría saltar el 409 a quien lo está editando.
- **B3. La marca de desactualizado no necesita un disparador nuevo.** Hoy
  `fn_marcar_modificacion` ya hace un UPDATE de `presupuesto.fecha_modificacion`
  en cada INSERT, UPDATE o DELETE de ítem y de nodo (por sentencia y en la
  misma transacción), y `tg_modificacion_cabecera` hace lo mismo con el AIU y
  el IVA. Propongo `presupuesto.revision bigint`, que esos dos mismos sitios
  incrementan en el UPDATE que ya hacen: cero sentencias nuevas en el camino
  de los 4 ms. Hay dos motivos para no usar un disparador que escriba
  `cronograma.desactualizado`:
  - Ese disparador tomaría el candado de la fila del cronograma, y una
    edición de cantidad quedaría esperando detrás de un recálculo que lo
    tiene tomado, hasta 500 ms. Los 4 ms se cumplirían en la medición aislada
    y no con dos usuarios.
  - La propia `fecha_modificacion` sirve casi siempre, pero `now()` es la
    hora de inicio de la transacción, y dos transacciones pueden compartirla.
    Un contador no tiene ese problema.

  Lo que cuesta es un recálculo de más cuando alguien renombra un capítulo.
  Es inofensivo. Duplicar no sube la revisión, pero la copia nace sin
  calcular de todas formas (`calculado_version` nulo).
- **B4. Un recálculo es una sola transacción, de mi lado:**
  1. `BEGIN ISOLATION LEVEL REPEATABLE READ`, para que todas las lecturas
     vean la misma foto del presupuesto. Le agrego el nivel a
     `ejecutarComoTenant`.
  2. Como primera sentencia, `SELECT … FROM app.cronograma … FOR UPDATE`.
     Serializa los guardados y los recálculos del mismo cronograma. Si otro
     confirmó antes, sale 40001 y se reintenta una vez; al reintentar ya lo
     ve al día y no recalcula.
  3. Si es un guardado, compara `version` con la que trae la petición
     (si no coincide, 409 con la nueva), aplica el cambio y sube `version`.
  4. Lee las entradas en cuatro consultas:
     - las actividades con su ítem (cantidad, rendimiento, costo);
     - las dependencias;
     - los calendarios, con sus tramos y excepciones;
     - la cabecera (horas por jornal, AIU, revisión).
  5. Crea en una sola sentencia las actividades de los ítems nuevos (RN-33).
  6. Calcula en memoria.
  7. Escribe los resultados en **una** sentencia:
     `INSERT INTO app.actividad_calculo … SELECT … FROM unnest($1::uuid[], $2::timestamp[], …) ON CONFLICT (actividad_id) DO UPDATE`.
     Una sola sentencia, no 1.500.
  8. Actualiza `calculado_version` y `calculado_revision`, y confirma.
- **B5. Las curvas del cronograma actual no se guardan, y el dinero lo
  reparte la base.** La D-89 le da al motor «las dos curvas», pero la regla 2
  y el contrato §1.1 no dejan hacer aritmética de dinero en TypeScript.
  Propongo partir el trabajo en dos:
  - El motor produce el tiempo: los minutos laborables de cada actividad en
    cada día.
  - Una función de la migración, `app.fn_curvas(presupuesto_id,
    actividad_ids uuid[], fechas date[], minutos int[], granularidad)`,
    reparte los pesos con `numeric`, deja el residuo en el último periodo de
    cada actividad (6.9) y suma A, I, U e IVA en proporción al costo directo
    del periodo (RN-40), con `fn_pie_financiero`.

  Así la regla de que la suma sea igual al total (RF-PRG-08) la cumple la
  misma aritmética que calculó el total. No guardarlas evita una segunda
  copia que se desactualiza con cada cambio de costo. **La función es tuya.**
- **B6. La línea base, por día.** Si `linea_base_periodo` guarda semanas y
  después la empresa cambia `inicio_semana` (RF-CFG-33), la curva de la
  línea base y la actual quedan en semanas desalineadas y ya no se pueden
  comparar. Propongo guardar por día (`fecha`, `facturacion`, `costo`) y
  armar la semana o el mes al leer: una obra de dos años son 730 filas por
  línea base. Guardar una línea base es `INSERT … SELECT` desde
  `actividad_calculo` y `fn_curvas`, después del paso 8 de B4, en la misma
  transacción.
- **B7. Para el §19:**
  - Las fechas viajan como cadena local sin zona (`"2026-11-02T07:00"`).
    `pg` convierte `timestamp` a un `Date` en la zona del servidor, y la API
    no los va a leer así.
  - Las duraciones, holguras y desfases viajan ya convertidos a días con un
    decimal. La conversión depende del factor de cada calendario, así que por
    el §1.1 la hace el servidor.

### C. Reglas ambiguas, contradictorias o difíciles de cumplir

- **C1. RNF-29 no dice qué entra en los 500 ms.**
  - El CPM en memoria, con el calendario compilado a intervalos y búsqueda
    binaria, son decenas de milisegundos.
  - Lo caro es la entrada y salida: cuatro lecturas, una escritura de 1.500
    filas y `fn_curvas`. Estimo de 100 a 250 ms en total.
  - Si cada edición devuelve el cronograma entero, como la mesa (§1.3), la
    respuesta pesa varios cientos de KB.

  Propongo medir dos cosas: el recálculo con su escritura, contra la meta de
  500 ms, y la petición completa, cuya cifra se fija al medir. La respuesta
  de una edición no trae las curvas: van por su propia ruta y se piden con la
  pestaña de curvas abierta.
- **C2. El recálculo con el cronograma Cerrado.** Es el caso de B1: un GET
  que escribe sobre algo de solo lectura. Si la 0005 pone el guardián de la
  RN-34 sobre la tabla de resultados, ese cronograma no se podrá servir
  nunca. Así que el guardián va solo sobre las entradas.
- **C3. Los ciclos: ¿se guarda la dependencia que cierra uno?** RF-PRG-05
  dice «no calcula nada», pero no dice si el cambio entra.
  - Si entra, la base queda con entradas que no se pueden calcular, y cada
    edición siguiente falla hasta que alguien rompa el ciclo.
  - Project rechaza el vínculo circular en el momento de crearlo; P6 lo deja
    guardar y se queja al calcular.

  Con el recálculo automático (D-91), lo coherente es lo de Project: un 422
  con las actividades del ciclo, y no se guarda nada. Así un ciclo nunca
  existe en la base. Es decisión de producto.
- **C4. «Desde la última vez» (RF-PRG-07) y la franja «qué cambió».** La
  revisión de B3 dice *que* el presupuesto cambió, no *qué*. «Desde la
  última vez» pide saber cuándo miró cada persona, y nada de eso está en la
  6.7. Propongo esto:
  - la lista es el estado actual, sin «desde»: sin programar, ya no está,
    manual distinta de la calculada, sin rendimiento y sueltas;
  - la franja dice «el presupuesto cambió desde el último cálculo».

  Falta además decidir **cuándo deja de estar «sin programar»** una
  actividad: ¿al editarla, o cuando recibe su primera dependencia? Eso pide
  una columna `sin_programar`.
- **C5. El XML de Project no puede cumplir RF-PRG-11.** Project hace las
  cosas de otra forma en cuatro puntos:
  - admite una sola restricción por tarea;
  - no distingue «inicio el» de «inicio obligatorio», ni «fin el» de
    «fin obligatorio»;
  - no tiene Level of Effort;
  - según la documentación que conozco, cuenta el desfase en el calendario
    del proyecto y no en el de la sucesora (RN-29). Lo confirmo al
    construir.

  Propongo esto, y que el 07 lo diga y la pantalla de exportación lo
  advierta:
  - la secundaria «fin en o antes de» sale como *Deadline*;
  - las demás secundarias se pierden;
  - la administración sale como tarea normal.

  En el XER, P6 exige una fecha de datos: usaré la fecha de inicio. No
  contradice que la fecha de corte quede fuera (6.9), pero conviene que
  quede escrito.
- **C6. Una duración cero con costo.** Una actividad sin rendimiento y sin
  duración manual dura cero (6.9), pero su costo no es cero. La RN-36
  reparte «sobre las horas laborables», y con cero horas eso es una división
  por cero, mientras que RF-PRG-08 exige que la suma dé el total. Propongo
  que todo el costo vaya al día en que cae la actividad. Es decisión de
  producto, porque se ve en la curva.
- **C7. Dos ediciones a la vez.** La `version` cubre el cronograma entero,
  así que dos personas que editan filas distintas se rechazan entre sí. Es lo
  honesto, porque cada edición mueve fechas ajenas, y es lo que dice la 6.9.
  Con B2 se cumplen tres cosas:
  - una edición del presupuesto no sube `version`, así que no le provoca un
    409 a quien programa;
  - el recálculo de un GET tampoco la sube;
  - el 409 devuelve el cronograma entero y ya recalculado, para que la
    pantalla lo reemplace como hace la mesa (§1.3).

  Pregunta: ¿el 409 se lleva lo que la persona escribió, para que lo
  rehaga, o solo el mensaje de la 6.9? Es texto y conducta de pantalla.
- **C8. El recálculo cuando el cronograma está desactualizado.** Ya está en
  B3 y B4. Le agrego dos preguntas:
  - Ese GET tarda lo que tarde el recálculo, hasta 500 ms. ¿Basta con eso,
    o la pantalla tiene que mostrar «recalculando»?
  - Si C3 se resuelve dejando guardar los ciclos, un GET de un cronograma
    desactualizado y con ciclo no puede calcular. ¿Qué se sirve entonces:
    los resultados viejos marcados, o solo la lista del ciclo? Con la
    propuesta de C3 este caso no existe.
- **C9. La administración como Level of Effort.** En P6, una actividad Level
  of Effort toma sus fechas de sus **relaciones**: una CC desde lo que la
  arranca y una FF hacia lo que la termina. La nuestra no tiene relaciones
  (RN-39 la excluye de las sueltas), y sus fechas salen de una regla, la
  RN-37. Para que el XER la abra como Level of Effort hay que inventarle
  relaciones al exportar, y el 07 no dice cuáles. Pregunta: ¿cuáles?
  - Una CC desde cada actividad del presupuesto sin predecesora, y una FF
    hacia cada una sin sucesora. Pueden ser cientos de relaciones de la
    administración, y en P6 sus fechas saldrían iguales a las nuestras.
  - O exportarla como tarea con su duración y sin relaciones. Es más simple,
    pero en P6 deja de moverse con el resto, y RF-PRG-11 pide Level of
    Effort.

  Hay tres cosas más que el 07 no dice y que el motor necesita saber:
  - ¿Tiene holgura y puede ser crítica? Propongo que no: ni holgura, ni
    crítica, ni fechas tardías.
  - ¿Qué calendario usa? Supongo el del proyecto, pero no está escrito.
  - ¿Cuánto dura si el presupuesto no tiene actividades, o si todas duran
    cero?

### D. Librerías

- **PDF del Gantt: `pdfkit`, el que ya genera la oferta** (`src/exportacion/pdf.ts`).
  Dibuja vectores, así que las barras, los rombos y las flechas se trazan
  directamente, sin pasar por HTML. Evita traer un navegador sin cabeza al
  servidor. El formato de número es el mismo `formatoNumerico.ts`.
- **XER: ninguna.** Es texto separado por tabuladores, con tablas
  (`%T`, `%F`, `%R`). Lo escribo con una función propia y pruebas que
  comparan contra un archivo exportado de P6 por el dueño. Para eso
  necesito **un XER pequeño exportado de cada versión de P6 que se escoja**,
  con un calendario, unas relaciones, restricciones y una actividad Level of
  Effort. No me bloquea hasta la exportación.
- **XML de Project: ninguna.** Es un documento con forma fija, y lo armo con
  una función que escapa el texto. En las pruebas lo valido contra el
  esquema publicado de Project (MSPDI). No lo puedo abrir en Project; lo
  abro en ProjectLibre, como dice la 6.9.
- **El motor: ninguna.** El CPM y la aritmética del calendario son código
  propio y probado contra casos calculados a mano. Ninguna librería de CPM
  de npm hace calendarios por tramos con las restricciones de P6.

### Qué necesito

- **Antes de la 0005:** que respondas A1–A3 y B1–B6, o que me digas qué no
  te sirve.
- **Antes del §19:** tu respuesta a A4–A8 y C3–C9. Me bloquea el motor, no
  la 0004.
- **Antes de la exportación:** los XER de muestra de P6 (D).
- **De mi lado, después de la 0004:** la columna del rendimiento en la
  plantilla de importación de APU (RF-APU-25).

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
