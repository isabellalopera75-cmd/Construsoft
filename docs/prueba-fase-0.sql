-- ============================================================================
--  PRUEBA DE LA FASE 0 · El aislamiento entre empresas
--
--  Es el hito que cierra la fase 0: dos empresas se registran y ninguna ve un
--  solo dato de la otra. Se ejecuta como superusuario y usa SET ROLE para
--  actuar como la aplicación, que es donde el aislamiento tiene que funcionar.
--
--      psql -U postgres -d construsoft -f "docs/prueba-fase-0.sql"
--
--  No deja nada: termina con ROLLBACK.
-- ============================================================================
-- ----------------------------------------------------------------------------
--  La guarda. Está aquí porque la cabecera de arriba no alcanzó: este script se
--  intentó correr dos veces con app_login siguiendo una instrucción equivocada,
--  y lo que ocurre entonces es peor que un error claro. El paso 2 falla —esa
--  conexión no puede ejecutar fn_autenticar, y eso está bien, es la D-50— pero
--  falla FUERA de un savepoint, así que aborta la transacción. De ahí en
--  adelante los pasos 4, 5 y 6 también fallan, con «transacción abortada» en
--  vez de con la regla que cada uno prueba. Una lectura rápida ve tres fallos
--  donde esperaba tres fallos y lo da por bueno, sin que ninguno de los tres
--  haya llegado a comprobar nada. Es el falso verde exacto que este script
--  existe para no tener.
--
--  Así que no se avisa: se detiene.
-- ----------------------------------------------------------------------------
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO, no con la conexión'
\echo '  de la aplicación. Usa SET ROLE para ponerse en la piel de la aplicación'
\echo '  cuando toca, y antes de eso necesita hacer cosas que ninguna conexión'
\echo '  legítima puede hacer a la vez: autenticar (paso 2) y ser la aplicación'
\echo '  (paso 3). Que no exista una conexión capaz de las dos cosas no es un'
\echo '  estorbo de la prueba: es justo lo que la D-50 garantiza.'
\echo ''
\echo '      psql -U postgres -d construsoft -f "docs/prueba-fase-0.sql"'
\echo ''
-- Se detiene con una excepción y no con \quit, aunque en pantalla el mensaje
-- sea el mismo. \quit sale con código 0, así que para cualquier herramienta que
-- llame a este script —un pipeline, un script de despliegue, otra prueba—
-- «detenido sin ejecutar nada» y «pasó» se verían idénticos. Es el mismo falso
-- verde que la guarda existe para impedir, una vuelta más arriba: esta vez el
-- engañado no sería un lector distraído sino un proceso automático, que no
-- tiene manera de sospechar.
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION
      'prueba-fase-0 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP off
\echo ''
\echo '=== 0 · El modelo de privilegios no tiene escaleras (D-50)'
\echo '--- Debe devolver cero filas. Cualquier fila aquí significa que una'
\echo '--- conexión puede hacer SET ROLE y salirse del aislamiento entero.'
SELECT * FROM app.fn_verificar_roles_login();

\echo ''
\echo '=== 1 · Dos empresas se registran'

BEGIN;

SELECT 'A · empresa '||id_tenant||' · administrador '||id_usuario AS empresa_a
  FROM app.fn_alta_tenant('Constructora A SAS','900.123.456-1','EMPRESARIAL',
                          'Ana Admin','ana@a.co','hash_de_prueba_A','recupera@a.co');
SELECT 'B · empresa '||id_tenant||' · administrador '||id_usuario AS empresa_b
  FROM app.fn_alta_tenant('Constructora B SAS','800.555.111-2','PERSONAL',
                          'Beto Admin','beto@b.co','hash_de_prueba_B');

\echo ''
\echo '=== 2 · Al iniciar sesión, los identificadores salen de fn_autenticar'
\echo '--- (al registrar salen de fn_alta_tenant, que los devuelve los tres)'
SELECT usuario_id AS u_beto, tenant_id AS t_beto FROM app.fn_autenticar('beto@b.co') \gset

\echo ''
\echo '=== 3 · Ahora, actuando como la aplicación y con el contexto de B'
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id',  :'t_beto', true) AS ctx_empresa,
       set_config('app.usuario_id', :'u_beto', true) AS ctx_usuario \gset x_

SELECT count(*) AS usuarios_que_ve_b   FROM app.usuario;
SELECT razon_social AS empresas_que_ve_b FROM plataforma.tenant;
SELECT string_agg(nombre || ' (' || tipo || ')', ' · ' ORDER BY nombre) AS roles_que_ve_b
  FROM app.rol;

\echo ''
\echo '--- Lo de arriba debe decir: 1 usuario, solo Constructora B SAS,'
\echo '--- y dos roles: Administrador (ADMIN) y Asistente (ASISTENTE).'

-- Cada intento va en su propio punto de retorno. Sin esto, el primer error
-- aborta la transacción y los siguientes no llegan a probarse: se leerían como
-- «rechazados» cuando en realidad ni se intentaron.

\echo ''
\echo '=== 4 · La aplicación intenta pedir el hash de alguien (debe fallar)'
SAVEPOINT intento;
SELECT * FROM app.fn_autenticar('ana@a.co');
ROLLBACK TO SAVEPOINT intento;

\echo ''
\echo '=== 5 · La aplicación intenta crear un rol Administrador (debe fallar)'
SAVEPOINT intento;
INSERT INTO app.rol (tenant_id, nombre, tipo) VALUES (:'t_beto','Admin paralelo','ADMIN');
ROLLBACK TO SAVEPOINT intento;

\echo ''
\echo '=== 6 · La aplicación intenta escribir en el historial a mano (debe fallar)'
SAVEPOINT intento;
INSERT INTO app.evento_auditoria (tenant_id, entidad, entidad_id, tipo_evento, descripcion, usuario_id)
VALUES (:'t_beto','PRESUPUESTO',:'u_beto','CAMBIO_ESTADO','Evento forjado',:'u_beto');
ROLLBACK TO SAVEPOINT intento;

\echo ''
\echo '=== 7 · La aplicación intenta ver los datos de la otra empresa'
SAVEPOINT intento;
SELECT count(*) AS filas_de_a_que_ve_b
  FROM plataforma.tenant WHERE razon_social = 'Constructora A SAS';
ROLLBACK TO SAVEPOINT intento;
\echo '--- Esto NO falla: devuelve cero filas, que es la forma correcta de'
\echo '--- no ver algo. Un error diría que existe; cero filas no dice nada.'

RESET ROLE;
ROLLBACK;

\echo ''
\echo '============================================================'
\echo ' Los pasos 4, 5 y 6 TIENEN que haber fallado, cada uno con su mensaje.'
\echo ' El paso 7 devuelve cero filas y ningun error: asi se ve no ver.'
\echo ' Si alguno pasó sin error, la instalación quedó mal.'
\echo '============================================================'
