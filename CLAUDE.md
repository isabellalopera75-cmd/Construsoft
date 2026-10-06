# CONSTRUSOFT

SaaS multi-inquilino de presupuestación de obra civil. Colombia, español.

La cadena de datos manda: **recurso → APU → presupuesto**. No se puede construir un
APU sin recursos, ni un presupuesto sin APU. Ese orden gobierna el desarrollo.

---

## Lo primero que tienes que leer

Antes de escribir una línea de código, lee estos archivos de `docs/`:

| Archivo | Qué contiene | De qué es árbitro |
|---|---|---|
| `docs/05 - construsoft_mvp_schema.sql` | **El modelo de datos. Es la definición del sistema, no una sugerencia.** Cada decisión D-n está explicada en un comentario, en el punto del esquema donde vive. | De las reglas de negocio y de los privilegios |
| `docs/01 - Alcance del MVP.docx` | Alcance, reglas de negocio y los 150 requisitos (RF-*, RN-*, RNF-*). Su sección 14 da el porqué de cada decisión. | De qué entra en el MVP y qué no |
| `docs/02 - Guia de comportamiento de interfaz.docx` | Cómo se comporta cada pantalla, módulo por módulo. | De la conducta de la interfaz |
| `docs/06 - Formulas y calculos.docx` | AIU, IVA, incidencia y el presupuesto de referencia verificado a mano. | De los cálculos |
| `docs/04 - Decisiones tecnicas y stack.docx` | Con qué se construye y qué trampas evitar. Su sección 8 recoge lo que decidió la fase 6: la sesión, los parámetros de Argon2id, los dos agrupadores de conexión y la tabla de SQLSTATE a HTTP. | Del stack y de las decisiones técnicas |

La sección 14 del documento 01 explica **por qué** cada regla es como es. Léela
antes de proponer un cambio: casi todo lo que parece una omisión está decidido a
propósito y tiene su motivo escrito.

**Si dos fuentes se contradicen, manda el comentario del esquema.** Ha pasado ya
varias veces que un comentario afirmaba algo falso sobre su propio código; cuando
eso ocurra, no lo interpretes: dilo, y se corrige. Un archivo que se contradice a
sí mismo es un error que hay que arreglar, nunca una ambigüedad que haya que
resolver adivinando.

---

## Las reglas que no se rompen

**1. El esquema manda.** Está auditado, probado contra PostgreSQL 16 y defiende
las reglas de negocio con 59 triggers y 19 políticas de aislamiento. No generes
migraciones desde un ORM: borrarían esas defensas sin avisar. Si algo del código
no cuadra con el esquema, el que está mal es el código.

**2. Los cálculos viven en la base.** El AIU, el IVA, los totales, la incidencia
y la numeración de la EDT los calcula PostgreSQL con funciones y columnas
generadas. **No reimplementes ninguna fórmula en TypeScript.** El backend lee y
muestra; no recalcula por su cuenta. Un total calculado en dos sitios se vuelve
dos totales distintos el día que uno de los dos cambie.

**3. Tres conexiones, no una.**

```
app_login         → construsoft_app             la aplicación
superadmin_login  → construsoft_superadmin      el panel de superadministración
auth_login        → construsoft_autenticador    SOLO el paso de autenticación
```

Iniciar sesión con `app_login` falla con «permiso denegado», y está bien que
falle. `fn_autenticar` solo se alcanza desde la conexión de autenticación.

**El tercero es `construsoft_autenticador`, nunca `construsoft_auth`** (D-50).
Se parecen y no son lo mismo: `construsoft_auth` es el DUEÑO de las funciones de
login y lleva `BYPASSRLS`. Quien sea miembro suyo puede hacer `SET ROLE` y leer
los hashes de contraseña de toda la plataforma. Nadie es miembro de ese rol.
`app.fn_verificar_roles_login()` comprueba que siga siendo así y tiene que
devolver cero filas.

**4. Contexto de inquilino en cada transacción.** Al abrir cada transacción:

```sql
SELECT set_config('app.tenant_id', $1, true);
SELECT set_config('app.usuario_id', $2, true);
```

Ese `true` significa «local»: muere con la transacción. Sin él, el contexto se
filtra a la siguiente petición que reutilice esa conexión del grupo.
`SET LOCAL app.tenant_id = $1` **no es SQL válido** —`SET` no admite parámetros—
y quien lo escriba terminará interpolando la cadena a mano, que es inyección.

El `usuario_id` no es opcional: es el autor que la base escribe en cada evento
del historial. La transacción que no lo fije deja eventos sin firmar.

Para leer el contexto usa `app.fn_tenant_actual()`, nunca `current_setting`
directo: después de la primera transacción devuelve cadena vacía en vez de nulo
y el casteo a uuid revienta con un error 500 en lugar de devolver cero filas.

**5. Buscar por nombre pasa por función.** Usa `app.fn_buscar_recurso`,
`fn_buscar_apu` y `fn_buscar_presupuesto`. Un `LIKE` directo contra la tabla
funciona pero no usa el índice: bajo el aislamiento por filas, PostgreSQL no
puede usar `ILIKE` como condición de índice y termina leyendo el catálogo entero.

**6. Aislamiento entre empresas.** Es la regla más dura del sistema. La empresa A
jamás puede alcanzar un dato de la B, ni por consulta, ni pasando un
identificador ajeno a una función. Debe parecer que usan bases distintas.

**7. La línea base es intocable.** Un presupuesto ACTIVO es de solo lectura
total. Para corregirlo se reabre con justificación escrita, se edita y se vuelve
a activar. Cada transición guarda una versión.

**8. Los secretos no se generan ni se escriben aquí.** No inventes contraseñas,
no las propongas, no las pegues en la conversación y no las pongas en un archivo.
Tampoco las cambies: `ALTER ROLE ... PASSWORD` no lo ejecutas tú nunca, ni
siquiera para «reponer» una que dejó de funcionar. Si una credencial falla, di
cuál falla y detente ahí: la rotación la hace el dueño del proyecto, en su
terminal, con un valor que solo él conoce.

Motivo, sin rodeos: todo lo que pasa por esta conversación queda escrito en
algún lado. Una contraseña que viajó por un chat ya no es un secreto, y la del
superusuario de la base lo es todavía menos. Si necesitas un valor para un
ejemplo, escribe `PONER_LA_CLAVE_AQUI` y sigue.

Los archivos `.env` y `.env.test` los escribe el dueño del proyecto. Tú puedes
decir qué variables hacen falta y para qué sirve cada una; los valores, no.

---

## Lo que NO se construye

El control de obra, el inventario, las compras, los contratos, el avance físico
y los reportes de valor ganado **son de la fase 2 y no existen hoy**. El MVP
termina en el presupuesto aprobado y exportado.

Si una pantalla del prototipo los muestra, está marcada «Fase 2» a propósito.
No los implementes ni dejes ganchos «por si acaso»: reservar hoy la forma de un
módulo que todavía no está diseñado es adivinar.

---

## Orden de construcción

El documento trae el plan completo. El orden es:

```
Fase 0  Cimientos: esquema, roles, aislamiento, autenticación, registro de empresa
Fase 1  Recursos
Fase 2  APU
Fase 3  Mesa de trabajo (presupuestos)
Fase 4  Ciclo de vida y congelamiento
Fase 5  Exportaciones
Fase 6  Aplicación web, en cuatro rebanadas verticales:
          6.1  Sesión, aislamiento por HTTP y una pantalla real
               (antes de la 6.2: los patrones visuales)
          6.2  Recursos y APU
          6.3  Mesa de trabajo del presupuesto
          6.4  Aprobación y exportación   ← aquí ya hay algo que mostrarle a un cliente
Fase 7  Superadministración y cobro
Fase 8  Notificaciones y pulido
```

Las fases 0 a 5 construyen el sistema por debajo: la base y los módulos que
hablan con ella. La fase 6 lo vuelve usable. Cada rebanada termina usable por
sí sola, y la API se deriva de las pantallas del documento 02: no se construye
completa primero.

Cada fase cierra con un hito probado contra una base real. No pases a la
siguiente sin ese hito verde.

Estas son fases de **construcción**. La «fase 2» del producto que nombran los
documentos —control de obra, inventario, compras— es otra cosa: es lo que
viene después del MVP y no tiene número aquí.

---

## Stack

- **Base de datos:** PostgreSQL 15 o superior. Probado sobre la 16.
- **Backend y frontend:** TypeScript.
- **Pruebas:** contra una base de datos real, no contra dobles. El esquema
  defiende las reglas con triggers, así que una prueba con un doble no prueba
  nada.
- **Contraseñas:** Argon2id. El hash se compara en el backend; PostgreSQL no
  sabe calcularlo.

---

## Antes de dar algo por terminado

Corre la batería del esquema: crea la base desde cero, intenta las operaciones
que la sección 19 del documento dice que la base debe rechazar, y comprueba que
`app.fn_verificar_rls()` devuelve **cero filas**. Si devuelve alguna, hay una
tabla de inquilino sin aislamiento y nada más importa hasta arreglarlo.

El presupuesto de ejemplo de la sección 18 debe cerrar exactamente en
**$180.590.155**. Si da otra cifra, hay una fórmula mal.

---

## Quién hace qué, desde el 4 de octubre de 2026

Dos asistentes trabajan en este repositorio y **no comparten ningún archivo**.
Dos autores no se pisan si no tocan los mismos archivos.

| Dueño | Qué le pertenece |
|---|---|
| **El asistente de la API** (Claude Code, en esta terminal) | Todo `src/`, `scripts/`, las pruebas, `package.json` de la raíz, el guion de datos de demostración |
| **El asistente del producto** (en el chat del dueño) | Todo `web/`, `docs/05 - …schema.sql`, y los documentos 01, 02, 04 y 06 |

La frontera es la API, y está escrita en **`web/CONTRATO.md`**. El esquema manda
sobre el contrato; el contrato manda sobre las dos implementaciones; el 02 manda
sobre lo que la pantalla tiene que hacer.

**Nunca toques `web/`, `docs/` ni el esquema.** Si necesitás un cambio ahí,
pedilo por la bitácora.

### Las dos bitácoras

El dueño no reenvía mensajes entre los dos asistentes: cuesta demasiado. El
canal es el repositorio.

- **`bitacora-api.md`** la escribís vos. El otro asistente la lee.
- **`bitacora-web.md`** la escribe el otro. Vos la leés.

**Las dos se leen al empezar cada sesión y se escriben al terminarla.** Son de
solo-agregar: entradas nuevas al principio, con la fecha, y nunca se borra ni se
reescribe lo de arriba. Cada entrada dice, en pocas líneas:

1. **Qué quedó hecho**, con el commit.
2. **Qué divergió del contrato**, si algo divergió, y en qué dirección se
   resolvió.
3. **Qué necesito del otro lado**, si necesito algo, y si me bloquea o no.
4. **Qué encontré que el otro debería saber** aunque no me bloquee.

Nada de narrar el proceso: lo que el otro necesita para seguir, y nada más.

### Cuándo seguís solo y cuándo te detenés

**Seguí sin preguntar** cuando la respuesta está en el esquema, en los
documentos o en el contrato; cuando es una ruta, una prueba o un refactor de lo
tuyo; cuando el contrato describe mal lo que la API ya devuelve —ahí corregís el
contrato por la bitácora y seguís—; y cuando el camino obvio es uno solo.
Trabajá con confianza: la mayor parte del tiempo no hay nada que preguntar.

**Detenete y escribilo en la bitácora** en estos casos, y solo en estos:

- **Hace falta un cambio de esquema.** El esquema no es tuyo. Describí el
  problema, no lo arregles.
- **Es una decisión de producto que ningún documento cubre** y que un usuario
  notaría: un texto que lee una persona, un comportamiento de pantalla, una
  regla de negocio nueva.
- **Dos árbitros se contradicen.** Decilo, no elijas en silencio.
- **Cambiaría la forma de una respuesta que la interfaz ya consume.** Primero se
  cambia el contrato, después el código.
- **Haría falta un secreto, una contraseña o una credencial.** Nunca. Ni
  generarla, ni proponerla, ni escribirla en un archivo. Es la regla 8.

Si algo te detiene, **no te quedes esperando**: anotalo y seguí con lo
siguiente de tu lista. Avisale al dueño en una línea solo si te bloquea del
todo.

### Lo que nunca es autónomo

- **La base de desarrollo `construsoft` no se toca**, y las credenciales
  `TEST_SUPERUSER_*` no se usan contra ella. Tu base es `construsoft_test`.
- **Nada de borrar ni reescribir datos** fuera de `construsoft_test`.
- **Nada de barridos de formato** —fines de línea, comillas, sangrías— mezclados
  con un cambio de verdad. Si hace falta uno, va en su propio commit y con ese
  nombre.
- **El esquema no se edita ni se parchea**, ni «solo para probar».

### Dos hábitos que ya pagaron

- **Mutá una defensa a la vez.** Con varias quitadas, unas tapan a otras y el
  rojo no demuestra nada sobre cada una.
- **Antes de confiar en una prueba, comprobá que falle.** Una prueba del
  invariante de la EDT pasaba también con el esquema roto; el defecto apareció
  recién cuando se armó el caso con la precondición exacta.

---

## Cómo trabajar conmigo

- Si algo de la documentación no resuelve un caso, **pregunta. No lo inventes.**
  Una decisión inventada que se propaga cuesta más que una pregunta.
- Si encuentras una contradicción entre el esquema y el documento, dilo: el
  esquema manda, pero la contradicción hay que corregirla en el documento.
- Escribe en español: nombres, comentarios, mensajes de error y de interfaz.
- Los mensajes de error le dicen al usuario **qué pasó y qué hacer**, no solo que
  algo falló.
