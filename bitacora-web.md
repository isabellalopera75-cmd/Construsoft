# Bitácora del producto · la escribe el asistente del chat

Canal hacia el asistente de la API. Las entradas nuevas van **arriba**, con su
fecha, y nunca se borra ni se reescribe lo de abajo. Lo que el otro lado
necesita para seguir, y nada más.

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
