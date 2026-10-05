# ConstruSoft

Plataforma de presupuestación de obra civil. SaaS multi-inquilino.

---

## Levantar la base de datos, en orden

Cinco pasos. El orden importa: cada uno asume que el anterior salió bien.

### Antes de empezar

Necesita **PostgreSQL 15 o superior** (probado sobre la 16). En Windows, el
instalador de EDB deja las herramientas en
`C:\Program Files\PostgreSQL\16\bin`. Agregue esa carpeta al `PATH` o abra
«SQL Shell (psql)» desde el menú de inicio.

### El paso que se salta todo el mundo en Windows

**Antes de correr nada, fije la codificación del cliente.** En PowerShell:

```powershell
$env:PGCLIENTENCODING = "UTF8"
chcp 65001
```

Si no lo hace, `psql` supone que el archivo está en WIN1252 —la página de códigos
de Windows— cuando en realidad está en UTF-8, y se detiene con este error:

```
ERROR:  carácter con secuencia de bytes 0x81 en codificación «WIN1252»
        no tiene equivalente en la codificación «UTF8»
```

El archivo no tiene nada malo. Ese `0x81` es la segunda mitad de una `Á`
—en UTF-8 se escribe `C3 81`— y WIN1252 no tiene ninguna letra en esa posición,
así que se rinde. La primera `Á` del archivo está en un comentario de la línea
915; el número de línea que reporta el error es el del final de la instrucción
que venía leyendo, no el del carácter.

La variable dura lo que dure la ventana de PowerShell. Si abre otra, vuelva a
escribirla.

Todos los comandos se ejecutan **desde la raíz del proyecto**
(`C:\proyectos\construsoft`) y le van a pedir la contraseña del usuario
`postgres`.

---

### Paso 1 · Crear la base

```
createdb -U postgres -E UTF8 -T template0 construsoft
```

El `-E UTF8` no es opcional. El esquema está lleno de acentos y comillas
angulares en los mensajes de error, y esos mensajes son los que va a leer el
usuario final.

**Si salió bien no imprime nada.** Si dice que ya existe y quiere empezar de
cero: `dropdb -U postgres construsoft` y repita.

---

### Paso 2 · Crear el esquema

```powershell
$env:PGCLIENTENCODING = "UTF8"
psql -U postgres -d construsoft -f "docs/05 - construsoft_mvp_schema.sql"
```

Las comillas son necesarias: el nombre del archivo tiene espacios. Y la variable
de codificación, también: sin ella el archivo se detiene a la tercera tabla.

Se ejecuta **como superusuario** porque crea cinco roles de grupo, y dos de
ellos necesitan `BYPASSRLS`. Si lo corre con otro usuario, se detiene en la
primera línea con un mensaje que lo explica.

Va a ver pasar muchas líneas de `CREATE TABLE`, `CREATE FUNCTION` y demás. Lo
que importa son las dos últimas:

```
 fn_aplicar_rls
----------------
             16

NOTICE:  Aislamiento verificado: ninguna tabla de app quedó sin política.
```

Ese 16 son las tablas de inquilino que quedaron aisladas. Si en vez de eso ve un
`ERROR`, deténgase ahí: el archivo corre de principio a fin o no corre.

---

### Paso 3 · Crear los tres roles de conexión

Son tres y no uno, y cada uno tiene su motivo (decisión D-46).

```sql
psql -U postgres -d construsoft

CREATE ROLE app_login        LOGIN PASSWORD 'ponga_una_clave_real';
GRANT construsoft_app        TO app_login;

CREATE ROLE superadmin_login LOGIN BYPASSRLS PASSWORD 'ponga_otra_clave_real';
GRANT construsoft_superadmin TO superadmin_login;

CREATE ROLE auth_login       LOGIN PASSWORD 'y_otra_mas';
GRANT construsoft_autenticador TO auth_login;   -- ¡NO construsoft_auth!
```

| Rol | Para qué | Quién lo usa |
|---|---|---|
| `app_login` | Todo el trabajo diario | El backend, en cada petición |
| `superadmin_login` | Panel de superadministración | Solo el panel |
| `auth_login` | **Únicamente** resolver un correo y un token | Solo el paso de inicio de sesión |

> **Fíjese en el tercero.** Es miembro de `construsoft_autenticador`, no de
> `construsoft_auth`. Los nombres se parecen y el efecto no: `construsoft_auth`
> lleva `BYPASSRLS`, y un miembro suyo puede hacer `SET ROLE construsoft_auth` y
> leer la tabla de usuarios entera —con los hashes— de todas las empresas. Dos
> líneas de SQL, en la única conexión que atiende peticiones sin autenticar.
> `construsoft_autenticador` no lleva `BYPASSRLS` y solo puede ejecutar las dos
> funciones de login: vestirse de él no sirve de nada.

Ninguno es dueño de las tablas ni superusuario. Y no son tres sombreros de la
misma conexión: si el backend intenta iniciar sesión con `app_login`, la base
responde «permiso denegado», y está bien que lo haga.

---

### Paso 4 · Comprobar que quedó bien

```sql
SELECT count(*) FROM app.fn_verificar_rls();
SELECT * FROM app.fn_verificar_roles_login();
```

**Las dos tienen que dar cero.** La primera comprueba que ninguna tabla quedó sin
aislamiento. La segunda, que ninguna conexión puede vestirse de un rol con
`BYPASSRLS` y saltárselo entero: es la comprobación que hay que repetir cada vez
que se toque un `GRANT`. Cero significa que ninguna tabla de inquilino quedó sin
aislamiento. Cualquier otro número: no siga, hay una tabla abierta.

El inventario, para comparar:

```sql
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='app') AS tablas,
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname IN ('app','plataforma')) AS triggers,
       (SELECT count(*) FROM pg_policies WHERE schemaname IN ('app','plataforma')) AS politicas,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('app','plataforma')) AS funciones;
```

```
 tablas | triggers | politicas | funciones
--------+----------+-----------+-----------
     18 |       59 |        19 |        77
```

---

### Paso 5 · La prueba que de verdad importa

Dos empresas, y que ninguna vea a la otra. Es el hito que cierra la fase 0.

Primero se dan de alta, como superusuario:

```sql
SELECT app.fn_alta_tenant('Constructora A SAS','900.123.456-1','EMPRESARIAL',
                          'Ana Admin','ana@a.co','$argon2id$hash_de_prueba');
SELECT app.fn_alta_tenant('Constructora B SAS','800.555.111-2','PERSONAL',
                          'Beto Admin','beto@b.co','$argon2id$otro_hash');
```

Ahora, **el detalle que hay que entender antes de escribir el backend**: el
identificador de la empresa no se busca, llega del inicio de sesión. Con
`app_login` no puede consultarlo, porque sin contexto no ve ninguna fila. Sale
de la conexión de autenticación:

```
psql -U auth_login -d construsoft -Atc "SELECT usuario_id, tenant_id FROM app.fn_autenticar('beto@b.co')"
```

Con esos dos valores, ya como `app_login`:

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<el tenant_id>', true);
SELECT set_config('app.usuario_id', '<el usuario_id>', true);

SELECT count(*) FROM app.usuario;            -- 1: solo el suyo
SELECT razon_social FROM plataforma.tenant;  -- solo Constructora B SAS
SELECT count(*) FROM app.rol;                -- 2: Administrador y Asistente
ROLLBACK;
```

Si ve datos de la otra empresa, algo salió mal en el paso 2 y no hay que seguir
hasta entenderlo.

Y una última, que debe fallar:

```
psql -U app_login -d construsoft -c "SELECT * FROM app.fn_autenticar('ana@a.co')"
```

```
ERROR:  permission denied for function fn_autenticar
```

Ese error es el resultado correcto.

---

## La demostración, de punta a punta

Desde una base vacía hasta el presupuesto de referencia cerrando en
**$180.590.155**, leído por la API. Es la prueba de que el sistema arranca en
una máquina que no es la de quien lo escribió.

**0. La base.** Los pasos 1 a 4 de arriba: base nueva, esquema y los tres roles
de conexión. Si los roles ya existían de una instalación anterior, sirven: son
del servidor, no de la base.

**1. Las dependencias**, desde la raíz del proyecto (Node 20 o superior):

```
npm ci
```

**2. El `.env`** en la raíz. Lo escribe el dueño del proyecto; los valores no
van en ningún otro lado. Estas variables, todas obligatorias:

| Variable | Para qué |
|---|---|
| `APP_DB_HOST`, `APP_DB_PORT`, `APP_DB_NAME`, `APP_DB_USER`, `APP_DB_PASSWORD` | La conexión de la aplicación: `app_login` sobre la base del paso 0 |
| `AUTH_DB_HOST`, `AUTH_DB_PORT`, `AUTH_DB_NAME`, `AUTH_DB_USER`, `AUTH_DB_PASSWORD` | La de autenticación: `auth_login` sobre la misma base |
| `SESSION_SECRET` | Firma la cookie de sesión. Larga y aleatoria |
| `VERSION_TERMINOS` | `PROVISIONAL-2026-09-25`: el nombre de la carpeta de `legal/` con el texto que se publica |
| `TERMINOS_PROVISIONALES` | `si`, escrito así: autoriza publicar un borrador sin revisión legal |
| `CONTACTO_TERMINOS` | A quién escribir mientras los términos sean provisionales |
| `DEMO_CORREO`, `DEMO_CONTRASENA` | Con qué se ingresará a la empresa de demostración (la contraseña, de 8 caracteres o más) |

**3. Sembrar la empresa de demostración:**

```
npm run demo
```

```
→ Empresa de demostración sembrada. Ingrese con <DEMO_CORREO>.
  DEMO-001 Casa campestre El Retiro (activo, versión 1) · DEMO-002 Bodega industrial Rionegro (abierto)
```

Correrlo dos veces no duplica nada: la segunda se niega y lo dice.

**4. Levantar la API**, en otra ventana:

```
npm run api
```

```
⚠ Términos PROVISIONALES (PROVISIONAL-2026-09-25): esta instalación no es para uso real.
→ API de Construsoft escuchando en http://127.0.0.1:3000
```

**5. Comprobar por HTTP**, en la primera ventana:

```
npm run verificar-demo
```

```
✓ Ingreso por HTTP como <DEMO_CORREO>
✓ Vista maestra: DEMO-002 (ABIERTO), DEMO-001 (ACTIVO)
✓ Mesa de DEMO-001: 7 actividades, valor total 180590155.000000
✓ La demostración está lista.
```

Ingresa con la cookie de sesión, lee la vista maestra y la mesa: la cifra
atraviesa la sesión, el aislamiento y la lectura de la API, no una consulta SQL.
Si cierra en otra cifra, hay una fórmula mal y nada más importa hasta
encontrarla.

---

## Si el paso 2 se detuvo a mitad de camino

El archivo corre de principio a fin o no corre: trae `ON_ERROR_STOP` adentro y se
detiene en el primer error. Pero lo que alcanzó a crear antes de detenerse queda
en la base, así que repetir sobre la misma base da «ya existe» y no sirve.
Empiece de cero:

```powershell
dropdb -U postgres construsoft
createdb -U postgres -E UTF8 -T template0 construsoft
$env:PGCLIENTENCODING = "UTF8"
psql -U postgres -d construsoft -f "docs/05 - construsoft_mvp_schema.sql"
```

Los cinco roles de grupo sobreviven al borrado de la base, porque pertenecen al
servidor y no a la base. El esquema los reutiliza si ya existen, así que no hay
que borrarlos ni preocuparse por ellos: repetir el paso 2 funciona igual.

---

## Estructura del proyecto

```
docs/       El esquema y la documentación. Es la fuente de verdad.
legal/      Los términos y la política de datos, una carpeta por versión publicada.
src/        La API y sus pruebas.
web/        La interfaz.
prototipo/  La maqueta de interfaz. Referencia visual, no código de producción.
```

Antes de commitear, active una vez el pre-commit, que corre la batería
completa sobre cada commit que toque la API:

```
git config core.hooksPath scripts/hooks
```

## Antes de tocar nada

Lea `CLAUDE.md`. Está escrito para la herramienta, pero las reglas son las mismas
para las personas.
