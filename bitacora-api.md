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
