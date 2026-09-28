-- =============================================================================
--  CONSTRUSOFT · Modelo de datos del MVP
--  PostgreSQL 15 o superior. Probado sobre la 16.
--  El MVP no crea ninguna vista, así que el archivo corre tal cual desde la 13.
--  El mínimo queda igual en la 15 y es deliberado: el bloque 16.1 endurece toda
--  vista con security_invoker, que no existe antes de la 15, y la primera vista
--  que alguien agregue sin ese ajuste filtraría todos los inquilinos. Fijar hoy
--  el piso evita esa vista mañana.
--
--  Alcance: «01 - Alcance del MVP.docx». Las referencias RF-*, RN-* y RNF-*
--  corresponden a ese documento; las D-n, a su sección 14.
--
--  ---------------------------------------------------------------------------
--  QUÉ ES ESTE ARCHIVO
--
--  El archivo único desde el que se crea la base de datos. No hay nada que
--  migrar: el sistema no está construido y no existe ninguna base en
--  producción, así que todo lo decidido vive aquí, junto al DDL que lo explica.
--
--      createdb construsoft
--      psql -d construsoft -f "05 - construsoft_mvp_schema.sql"
--
--  Debe ejecutarse como SUPERUSUARIO: crea el rol construsoft_auth, que
--  necesita BYPASSRLS para resolver el login antes de que exista contexto de
--  inquilino (ver la sección 13).
--
--  Cuándo empiezan las migraciones: el día que esta base tenga datos de un
--  cliente. A partir de ahí este archivo NO se edita nunca y todo cambio viaja
--  en archivos .sql numerados.
--
--  Cada regla de este archivo se comprueba contra una base REAL. Una prueba con
--  base simulada puede pasar en verde mientras la base rechaza la operación, o
--  al revés: los triggers y el modelo de privilegios son la mitad del diseño.
--
--  ---------------------------------------------------------------------------
--  LAS DECISIONES DE DISEÑO QUE ESTE ESQUEMA IMPLEMENTA
--
--  Son cincuenta: D-1 a D-51, sin la D-10, que no existe. El motivo de
--  cada una está en la sección 14 del documento de alcance. Aquí va el
--  enunciado, y cada decisión vuelve a aparecer anotada en el punto del esquema
--  donde vive. Las ocho últimas están al final de esta lista y tienen fecha:
--  D-44 a D-49 salieron de la auditoría externa del 24 de septiembre de 2026;
--  D-50 y D-51 son posteriores a ella y se distinguen a propósito, porque
--  nadie debería tener que preguntarle a nadie qué se movió después del
--  dictamen: está escrito aquí.
--
--    D-1  «Rendimiento» es consumo por unidad de actividad y aplica a los
--         cuatro tipos de recurso. El subtotal MULTIPLICA, no divide:
--         subtotal = cantidad * rendimiento * (1 + desperdicio%) * precio
--    D-2  El APU se calcula con el precio TOTAL del recurso (con IVA).
--    D-3  El AIU usa la fórmula convencional: los tres porcentajes se aplican
--         cada uno por separado sobre el costo directo (ver D-16).
--    D-4  No existe módulo de órdenes de cambio: no hay entidad, campos ni flujo
--         de aprobación. El término queda RESERVADO para la fase 2; el MVP no
--         genera ningún evento de ese tipo (no hay código ORDEN_DE_CAMBIO en
--         app.tipo_evento). La modificación de un proyecto activo se resuelve
--         con reapertura + los eventos de edición correspondientes.
--    D-5  Un proyecto ACTIVO es de solo lectura: para modificarlo hay que
--         reabrirlo con justificación. La edición de proyectos activos
--         pertenece al módulo de Control de Proyectos (fase 2).
--         En consecuencia, la propagación de RF-APU-15 alcanza únicamente
--         a los presupuestos en estado ABIERTO.
--         La reapertura tiene una sola puerta: app.fn_reabrir_presupuesto.
--         El UPDATE directo del estado ACTIVO -> ABIERTO queda rechazado,
--         porque es lo único que garantiza que la línea base quede archivada
--         y la justificación en el historial (RF-PRE-28, RN-03).
--    D-6  Una sola moneda por empresa (COP al arrancar). plataforma.moneda
--         es catálogo: entrar a un nuevo país es un INSERT, no construir
--         conversión de divisas.
--    D-7  El administrador crea la cuenta pero no la contraseña: el usuario la
--         fija al abrir un enlace de activación de un solo uso y 72 horas.
--         PENDIENTE = invitado, aún sin activar.
--    D-8  La clasificación directo/indirecto se define en el capítulo de
--         primer nivel; los subniveles la heredan.
--    D-9  % incidencia del capítulo = costo del capítulo / Costo Directo
--         total × 100. El AIU no entra en el denominador.
--   D-11  Los planes no tienen tope de proyectos ni de usuarios, salvo el
--         máximo de un asistente del plan Personal (RN-11).
--   D-12  RESERVADA. Protegía el ítem con avance registrado; vuelve con el
--         módulo de control de obra (D-43).
--   D-13  El cobro es manual en el MVP: transferencia o PSE, el
--         superadministrador registra el pago y extiende el vencimiento.
--         No hay pasarela de pagos. El corte lo hace el sistema por fecha.
--   D-14  Período de prueba gratuito de 15 días (parametrizable por plan),
--         con aviso 2 días antes del vencimiento.
--   D-15  Al crear una empresa se precargan las doce unidades de medida
--         estándar de la construcción en Colombia, editables por el usuario.
--   D-16  SÍ existen capítulos de costo indirecto (topografía, dirección de
--         obra, estudios, pólizas). Cada capítulo de primer nivel se clasifica
--         como DIRECTO o INDIRECTO y sus subniveles heredan (D-8).
--         EL AIU SE APLICA ÚNICAMENTE SOBRE EL COSTO DIRECTO:
--           Costo Directo   = Σ capítulos DIRECTO
--           Costo Indirecto = Σ capítulos INDIRECTO
--           A, I, U         = Costo Directo × cada porcentaje
--           Valor Total     = Costo Directo + Costo Indirecto + AIU
--         Un costo que ya se detalló como capítulo indirecto no vuelve a
--         cobrarse dentro del porcentaje de Administración.
--   D-17  El MVP presupuesta obra de construcción únicamente. La columna
--         presupuesto.tipo_proyecto queda como gancho: admite un solo valor
--         hoy y se amplía sin migrar datos cuando entren interventoría,
--         consultoría u otros servicios.
--   D-18  Archivar cualquier presupuesto; eliminar solo los que nunca se
--         activaron. La licitación perdida se archiva, no se cierra.
--   D-19  Duplicar copia precios y AIU del original.
--   D-20  No se activa un presupuesto sin actividades ni con valor total cero.
--   D-21  Una versión de APU exige al menos una línea y debe cuadrar con su
--         costo directo.
--   D-22  Editar un recurso o APU siempre crea versión nueva y vigente; el
--         Sí/No solo decide si se mueven los presupuestos abiertos.
--   D-23  RESERVADA. Definía el valor ejecutado como columna derivada; vuelve
--         con el módulo de control de obra (D-43).
--   D-24  Códigos REC-0001 y APU-0001, correlativos por empresa, creados en el
--         alta del inquilino.
--   D-25  El corte de acceso es automático por fecha; la cancelación es
--         manual. No existe el estado VENCIDA.
--   D-26  El downgrade de plan se bloquea hasta que la cuenta quepa en el plan
--         destino; no se pierde nada. (Regla de backend, RF-SAD-06.)
--   D-27  Cambios de estado a todos los usuarios activos; avisos de
--         suscripción solo a administradores. (Regla de backend.)
--   D-28  Estructura fija del snapshot jsonb, con número de esquema.
--   D-29  No se puede dejar a una empresa sin administrador; el
--         superadministrador puede designar uno (RF-SAD-14).
--   D-30  Los archivos van a almacenamiento de objetos, no a disco local: en
--         la base queda la llave del objeto, no una ruta.
--   D-31  Renombrar una unidad siempre; cambiar la unidad de algo en uso,
--         bloqueado en el MVP. La unicidad del símbolo ignora mayúsculas.
--   D-32  La suscripción se factura con factura electrónica; el comprobante es
--         esa factura, referenciada por número, CUFE y enlace.
--   D-33  IVA del 19 % sobre la UTILIDAD del AIU (Decreto 1372 de 1992, art. 3,
--         para contratos de construcción). El porcentaje es un campo del
--         presupuesto, copiado de la configuración de la empresa:
--           IVA = Utilidad × %IVA
--           Valor Total = Costo Directo + Costo Indirecto + AIU + IVA
--         No toca la base del AIU ni el denominador de la incidencia.
--   D-34  El NIT es obligatorio para toda empresa —en el plan Personal es el
--         del RUT de la persona natural— y se edita desde Configuración.
--   D-35  Quien registra la empresa nace ACTIVO. PENDIENTE es exclusivamente
--         para los usuarios que la empresa crea después y que todavía no han
--         consumido su enlace de activación.
--   D-36  El pago se registra con su soporte adjunto y con la fecha de
--         vencimiento que fija el superadministrador; el sistema propone
--         max(vencimiento anterior, hoy) + período, pero no la impone.
--   D-37  Las banderas de transacción (purga, recálculo, medición) solo las
--         honran los guardianes cuando corre una función interna. La defensa es
--         el privilegio, no la bandera: el rol de la aplicación puede fijar
--         cualquier variable de sesión, así que una bandera sola no defiende
--         nada (ver app.fn_bandera_interna).
--   D-38  Las acciones del superadministrador —suspender, cambiar plan,
--         registrar pago, designar administrador, eliminar empresa— quedan en
--         plataforma.evento_plataforma, que sobrevive a la empresa borrada.
--   D-39  La renumeración de la EDT, la duplicación de presupuestos y el
--         versionado y la propagación de APU viven en la base, no en el
--         backend: son las operaciones que mueven dinero en varias tablas a la
--         vez.
--   D-40  El cobro sigue siendo manual en el MVP, pero la base ya admite el
--         pago confirmado por una pasarela (Wompi u otra): precio y período en
--         el plan, renovación automática y referencia de pasarela en la
--         suscripción, y origen, referencia, estado y payload en el pago, con
--         registro idempotente por (pasarela, referencia). Conectarla no
--         migrará ninguna tabla con clientes vivos.
--   D-41  El AIU es de cada proyecto y no de la empresa: no existe un AIU
--         estándar que se precargue. Los tres porcentajes nacen en cero en
--         cada presupuesto y se negocian obra por obra.
--   D-43  El avance físico sale del MVP. El seguimiento básico por ítem era
--         una foto sin nada detrás: sin salidas de almacén, sin cortes de obra
--         y sin contratos, la cifra se veía bien y no servía para decidir. El
--         avance entra con el módulo de control de obra completo, donde nace
--         del consumo real de insumos. El MVP llega hasta el presupuesto
--         aprobado y exportado, y un proyecto ACTIVO es de solo lectura total.
--   D-42  Dos formas de estructurar un presupuesto, elegidas al crearlo:
--         ITEMS (capítulo → actividad) y WBS (capítulo → subcapítulo →
--         actividad, con actividades colgando también del capítulo). Es el
--         mismo árbol: ITEMS solo prohíbe los subcapítulos. La numeración la
--         deriva la base —capítulo 1.0, hijos 1.1, 1.2, nietos 1.1.1— y
--         capítulos y actividades comparten contador, que es lo que permite
--         mezclarlos sin que los códigos choquen.
--
--  ---------------------------------------------------------------------------
--  LO QUE SALIÓ DE LA AUDITORÍA EXTERNA DEL 24 DE SEPTIEMBRE DE 2026
--
--  Seis decisiones más, todas nacidas de una auditoría que corrió este archivo
--  sobre PostgreSQL 16 e intentó romperlo con el rol de la aplicación. Ninguna
--  cambia una tabla; las seis cierran la distancia entre lo que los documentos
--  prometían y lo que la base hacía cumplir por su cuenta.
--
--   D-44  El tipo de un rol es inmutable y los roles de sistema los crea la
--         base al dar de alta la empresa. Antes, la aplicación creaba un rol
--         PERSONALIZADO y lo ascendía a ADMIN con un UPDATE de una línea: la
--         garantía de que solo el Administrador activa, cierra y reabre la
--         sostenía el backend. El rol Asistente nace ahora con la empresa, para
--         que el backend no necesite la puerta que se acaba de cerrar.
--   D-45  El historial lo escriben los triggers de este esquema y nadie más.
--         Los eventos de edición que RF-HIS-03 promete no los escribía nadie, y
--         la aplicación podía firmar un evento a nombre de otro usuario.
--   D-46  Autenticar es una conexión aparte (auth_login). fn_autenticar entrega
--         el hash de contraseña —tiene que hacerlo, el backend compara con
--         Argon2id, que PostgreSQL no calcula—, así que lo que se cierra es
--         quién puede pedirlo: desde el contexto de una empresa se podía obtener
--         el hash de un usuario de otra con solo conocer su correo.
--   D-47  La búsqueda por nombre pasa por una función interna. Los seis índices
--         de búsqueda no se usaban nunca: bajo RLS, PostgreSQL no admite ILIKE
--         como condición de índice porque no es LEAKPROOF.
--   D-48  Las llaves primarias se generan con UUID versión 7 monótono. Es un
--         cambio de DEFAULT, no de datos, pero solo sirve si se hace antes de
--         que haya filas: las ya insertadas no se reordenan nunca.
--   D-49  El historial NO se particiona todavía, y esto es lo único que la
--         auditoría recomendó y aquí no se hizo. El motivo, el punto de disparo
--         y la forma de mirarlo están en la sección 0.b.
--
--  ---------------------------------------------------------------------------
--  LO QUE CAMBIÓ DESPUÉS DE LA AUDITORÍA
--
--  Estas dos NO salieron de la auditoría externa: son posteriores a su dictamen
--  y quedan separadas para que se pueda responder sin depender de la memoria de
--  nadie la única pregunta que importa cuando el esquema se mueve — ¿esto hay
--  que volverlo a auditar?
--
--  La raya es esta. Hay que volver a auditar si el cambio toca una tabla, una
--  política de aislamiento, un privilegio, un rol o un disparador: todo eso
--  cambia QUIÉN PUEDE VER QUÉ, y eso es lo que una auditoría mide. NO hay que
--  volver a auditar si el cambio solo altera lo que una función le devuelve a
--  un llamador que ya tenía derecho a esas filas, porque ahí la superficie de
--  lectura es la misma antes y después. D-50 cae del primer lado y se verificó
--  como tal; D-51, del segundo, y abajo está por qué.
--
--   D-50  (posterior a la auditoría · toca roles y privilegios · verificada
--         contra la base) El rol dueño de las funciones de autenticación no se
--         le concede a nadie. La conexión de login es miembro de
--         construsoft_autenticador, que solo puede ejecutar esas dos funciones;
--         ser miembro de construsoft_auth habría permitido SET ROLE y, con él,
--         leer los hashes de toda la plataforma. No lo encontró la auditoría:
--         apareció al revisar una frase suelta sobre el modelo de conexiones, y
--         la escalada se reprodujo entera antes de cerrarla.
--         app.fn_verificar_roles_login() la comprueba en cada instalación.
--   D-51  (posterior a la auditoría · no toca tablas, políticas, privilegios,
--         roles ni disparadores) fn_alta_tenant devuelve las tres cosas que
--         crea: el inquilino, el administrador y su rol. Antes devolvía solo el
--         inquilino, y quien registraba una empresa se quedaba sin la identidad
--         del administrador que acababa de nacer; el camino para recuperarla era
--         llamar a fn_autenticar con el correo, que es justo el uso que D-46
--         acababa de estrechar. La función ya sabía los tres valores.
--         Ocultarlos obligaba a sus llamadores a redescubrirlos por la peor
--         puerta disponible.
--            Por qué esto NO amplía lo que nadie puede leer, aunque la función
--         sea SECURITY DEFINER y su dueño tenga BYPASSRLS: las tres variables
--         que devuelve se asignan en un solo lugar cada una, y es RETURNING id
--         INTO de sus propios tres INSERT. Ningún SELECT sobre filas
--         preexistentes las toca. Devuelve los identificadores de las filas que
--         ella misma acabó de crear en esa misma llamada, y no puede devolver
--         otra cosa.
--
--  ---------------------------------------------------------------------------
--  LO QUE SIGUE ABIERTO, A PROPÓSITO
--
--  La sección 17 del documento 01 enumera lo que todavía no está decidido, con
--  el motivo de cada punto y la fase antes de la cual hay que resolverlo. Nada
--  de eso bloquea las fases 0 a 7, y nada de eso debe resolverse inventando.
--  Lo que toca a este archivo: el correo de usuario es único en toda la
--  plataforma (RF-AUT-04) y así queda aquí mientras no se decida lo contrario.
-- =============================================================================

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- azar criptográfico, hash de tokens
CREATE EXTENSION IF NOT EXISTS citext;     -- correos sin distinción de mayúsculas
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsqueda por subcadena
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- índices GIN encabezados por tenant_id

CREATE SCHEMA IF NOT EXISTS plataforma;    -- operación del SaaS (sin tenant_id)
CREATE SCHEMA IF NOT EXISTS app;           -- datos de los inquilinos

-- =============================================================================
--  0.a  LLAVES PRIMARIAS ORDENADAS EN EL TIEMPO              (D-48)
--
--  Las llaves primarias son uuid, y eso no cambia: cambiarlas a bigint con datos
--  dentro sería reescribir todas las llaves foráneas del esquema. Lo que cambia
--  es de dónde sale el valor.
--
--  gen_random_uuid() produce identificadores aleatorios (versión 4). Un índice
--  B-tree sobre valores aleatorios llena sus páginas al azar, y cada inserción
--  toca una página fría distinta. La auditoría del 24 de septiembre de 2026 lo
--  midió sobre dos millones de filas, y la diferencia que más pesa no es el
--  tamaño del índice sino el WAL —lo que paga la replicación, el respaldo y cada
--  checkpoint—:
--
--      generador                  índice PK   densidad   WAL/100k   inserción 2M
--      gen_random_uuid() (v4)       79 MB      71,8 %      80 MB       13,6 s
--      v7 «ingenuo»                 91 MB      63,0 %      25 MB       15,2 s
--      v7 monótono (este)           60 MB      90,0 %      24 MB       11,1 s
--
--  Nótese la fila del medio: un v7 mal hecho es PEOR que un v4. No basta con
--  poner la fecha delante; los valores generados dentro del mismo milisegundo
--  tienen que salir en orden, o el índice vuelve a llenarse al azar dentro de
--  cada milisegundo. Por eso los doce bits que el estándar deja libres llevan
--  aquí un contador de secuencia y no azar.
--
--  Es un cambio de HOY y no de mañana, y esa es toda su urgencia: cambiar el
--  DEFAULT de una columna no toca un solo dato, pero las filas insertadas antes
--  del cambio quedan desordenadas para siempre. PostgreSQL 18 traerá uuidv7()
--  nativa; cuando el despliegue esté sobre esa versión, esta función se sustituye
--  por ella y el DEFAULT es lo único que cambia.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS app.seq_uuid_v7
    AS bigint MINVALUE 0 MAXVALUE 4095 START 0 CYCLE;

CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_ms    bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    v_cont  bigint := nextval('app.seq_uuid_v7');
BEGIN
    -- 48 bits de milisegundos · versión 7 · 12 bits de contador · variante 10xx
    -- · 62 bits de azar. Lo que hace monótona a esta función es el contador: dos
    -- llamadas del mismo milisegundo salen en el orden en que se pidieron.
    RETURN (
        lpad(to_hex(v_ms), 12, '0')
     || '7' || lpad(to_hex(v_cont), 3, '0')
     || to_hex((8 + floor(random() * 4))::int)
     || substr(md5(random()::text || clock_timestamp()::text), 1, 15)
    )::uuid;
END $$;

COMMENT ON FUNCTION app.uuid_v7() IS
  'UUID versión 7 estrictamente creciente dentro de cada milisegundo (D-48). '
  'Es el DEFAULT de todas las llaves primarias uuid del esquema. Sustituible por '
  'uuidv7() nativa en PostgreSQL 18 sin tocar un dato.';

-- =============================================================================
--  0.b  EL HISTORIAL NO SE PARTICIONA TODAVÍA                (D-49)
--
--  app.evento_auditoria es la tabla que más crece: desde D-45 la escribe la base
--  en cada edición, y la auditoría la midió en 545 bytes por evento, de los
--  cuales el 42 % son sus cuatro índices. En el escenario grande —500 empresas,
--  200 proyectos cada una, 2.000 actividades por proyecto, tres eventos por
--  actividad— son unos 305 GB en una sola tabla.
--
--  La recomendación de la auditoría era particionarla por mes AHORA, porque
--  después cuesta copiar seiscientos millones de filas en una noche. Se decide
--  NO hacerlo, y conviene dejar escrito por qué, para que quien lo reconsidere
--  tenga los dos lados:
--
--    · No es una decisión irreversible, y es la única de la lista que no lo es.
--      Ninguna tabla referencia a evento_auditoria por llave foránea, así que
--      particionarla después es crear la tabla partida, copiar y renombrar: una
--      ventana de mantenimiento, programable, sin rediseño. El UUIDv7 de arriba
--      sí es de hoy porque las filas ya insertadas no se reordenan nunca.
--    · La granularidad correcta —mensual, trimestral— depende del volumen real,
--      que hoy nadie conoce. Elegirla ahora es adivinar, que es justamente lo
--      que la regla 5 del plan de fases prohíbe.
--    · El costo de tenerla partida desde el primer día no es cero: veinticinco
--      particiones en el inventario, políticas de aislamiento en cada una, y una
--      partición que alguien tiene que crear cada mes para siempre.
--
--  El punto de disparo, para que no dependa de que alguien se acuerde: cuando
--  app.evento_auditoria pase de CINCUENTA MILLONES de filas, o de 25 GB con sus
--  índices, se parte por ocurrido_en. A un evento por actividad y un ritmo de
--  crecimiento normal eso son años, y para entonces las migraciones de la fase 2
--  ya habrán tocado esta tabla de todos modos.
--
--      SELECT count(*), pg_size_pretty(pg_total_relation_size('app.evento_auditoria'))
--        FROM app.evento_auditoria;
--
--  Conviene mirarlo una vez al trimestre. Es una consulta, no un proyecto.
-- =============================================================================


-- =============================================================================
--  0. EL ROL DE AUTENTICACIÓN
--
--  El login no puede resolverse bajo la política de aislamiento: la consulta
--  por correo devuelve cero filas porque al autenticar todavía no se conoce el
--  inquilino, y RF-AUT-04 dice que el correo identifica al usuario sin
--  selector de empresa.
--
--  La salida NO puede ser que la aplicación se conecte con un rol BYPASSRLS,
--  que es precisamente el rol que no debe tocar. Se crea un rol propio, sin
--  LOGIN, que existe solo para ser dueño de las dos funciones de autenticación
--  de la sección 13. Su superficie es mínima y no permite enumerar usuarios.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'construsoft_auth') THEN
        CREATE ROLE construsoft_auth NOLOGIN BYPASSRLS;
    END IF;
    -- D-50 · El rol que es DUEÑO de las funciones privilegiadas no puede ser un
    -- rol que alguien pueda vestirse. construsoft_auth lleva BYPASSRLS, así que
    -- cualquier conexión que sea miembro suyo puede hacer SET ROLE y leer la
    -- tabla de usuarios entera —con sus hashes— de TODAS las empresas. Serían
    -- dos líneas de SQL, y en el único punto del sistema que corre sin
    -- autenticar. Por eso la conexión de login no es miembro de construsoft_auth
    -- sino de este otro rol, que no lleva BYPASSRLS y solo tiene permiso de
    -- EJECUTAR las dos funciones. Vestirse de él no da nada.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'construsoft_autenticador') THEN
        CREATE ROLE construsoft_autenticador NOLOGIN;
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'Este esquema crea el rol construsoft_auth (NOLOGIN BYPASSRLS), que solo '
      'puede crear un superusuario. Ejecute el archivo como superusuario.';
END $$;

GRANT USAGE ON SCHEMA app, plataforma TO construsoft_auth, construsoft_autenticador;

-- =============================================================================
--  0.b  EL MODELO DE PRIVILEGIOS  (decisión P4)
--
--  El aislamiento y la inmutabilidad no pueden depender solo de que la
--  aplicación se conecte con los GRANT correctos: con banderas de sesión
--  (app.purga_tenant, etc.) que cualquier conexión fija, «la base lo rechaza»
--  valía lo mismo que la prosa. La defensa real es el privilegio mínimo.
--
--  Cuatro roles, todos NOLOGIN (los roles de conexión, con contraseña, los crea
--  el despliegue y HEREDAN de estos grupos — ver el pie del archivo):
--
--    construsoft_owner   dueño de las tablas y de las funciones sensibles.
--                         NO es superusuario ni BYPASSRLS: con FORCE ROW LEVEL
--                         SECURITY queda sujeto a las políticas, así que una
--                         función SECURITY DEFINER suya sigue aislada por
--                         inquilino. Es lo que cierra el borrado cruzado de APU.
--    construsoft_super   dueño de las funciones que DEBEN cruzar inquilinos o
--                         correr sin contexto: alta y eliminación de inquilino y
--                         registro de pago. BYPASSRLS, NOLOGIN.
--    construsoft_app     grupo de conexión de la aplicación. Privilegio mínimo:
--                         nada de DELETE sobre las tablas inmutables, ni UPDATE
--                         sobre estado ni sobre los totales. Las
--                         escrituras sensibles pasan por funciones SECURITY
--                         DEFINER de construsoft_owner.
--    construsoft_superadmin  grupo del panel del superadministrador.
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='construsoft_owner') THEN
        CREATE ROLE construsoft_owner NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='construsoft_super') THEN
        CREATE ROLE construsoft_super NOLOGIN BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='construsoft_app') THEN
        CREATE ROLE construsoft_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='construsoft_superadmin') THEN
        CREATE ROLE construsoft_superadmin NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA app, plataforma TO construsoft_owner, construsoft_super,
                                         construsoft_app, construsoft_superadmin;


-- -----------------------------------------------------------------------------
--  Dominios numéricos.  RNF-07: precisión completa en almacenamiento; el
--  truncamiento a 0, 1 o 2 decimales es exclusivamente de presentación.
--  Convención: los porcentajes se guardan en PUNTOS (19 = 19 %), no en fracción.
--
--  La precisión es numeric(24,6). Con numeric(18,6) el tope absoluto queda en
--  poco menos de un billón de pesos, y presupuesto.valor_total es la primera
--  columna que lo alcanza: un proyecto de esa magnitud lanzaría «numeric field
--  overflow». Un numeric más ancho cuesta lo mismo.
--
--  Seis decimales también son un piso: el valor representable más pequeño
--  distinto de cero es 0,000001. Un rendimiento menor se redondea a cero al
--  guardarse, y la restricción lo rechaza nombrando el mínimo.
-- -----------------------------------------------------------------------------
CREATE DOMAIN app.dinero     AS numeric(24,6);
CREATE DOMAIN app.cantidad   AS numeric(24,6) CHECK (VALUE >= 0);
CREATE DOMAIN app.porcentaje AS numeric(9,6)  CHECK (VALUE >= 0);

COMMENT ON DOMAIN app.dinero IS
  'numeric(24,6). Dieciocho dígitos enteros y seis decimales: el tope queda '
  'fuera del alcance de cualquier obra.';
COMMENT ON DOMAIN app.cantidad IS
  'numeric(24,6). El valor representable más pequeño distinto de cero es '
  '0,000001; por debajo, la base rechaza el dato en vez de redondearlo a cero '
  'en silencio.';


-- =============================================================================
--  1. ESQUEMA plataforma — inquilinos, planes, suscripciones y pagos   (RF-SAD)
-- =============================================================================

CREATE TABLE plataforma.plan (
    id                    smallint     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo                text         NOT NULL UNIQUE
                                       CHECK (codigo IN ('PERSONAL','EMPRESARIAL')),
    nombre                text         NOT NULL,
    -- D-11: sin tope de proyectos. El único límite de usuarios es el
    -- asistente único del plan Personal (RN-11). NULL = sin límite.
    max_usuarios          integer      CHECK (max_usuarios > 0),
    max_proyectos         integer      CHECK (max_proyectos > 0),
    dias_prueba           smallint     NOT NULL DEFAULT 15
                                       CHECK (dias_prueba >= 0),   -- D-14
    roles_personalizados  boolean      NOT NULL DEFAULT false,   -- RN-11
    -- D-40 · Preparación para la pasarela. El precio del plan sigue sin
    -- decidirse (punto abierto 17.1.1) y por eso nacen nulos, pero la columna
    -- existe desde ahora: el día que Wompi —o quien sea— genere el enlace de
    -- pago, el monto y el período tienen que salir del plan y no de un número
    -- escrito en el código. Añadirlas después sería migrar una tabla con
    -- suscripciones vivas.
    precio                app.dinero   CHECK (precio >= 0),
    moneda                char(3),     -- llave añadida al crear el catálogo
    periodo_meses         smallint     CHECK (periodo_meses > 0),
    activo                boolean      NOT NULL DEFAULT true
);

-- D-6: catálogo de monedas. Entrar a un nuevo país es insertar una fila, no
-- alterar un CHECK repartido por varias tablas.
CREATE TABLE plataforma.moneda (
    codigo     char(3)  PRIMARY KEY,          -- ISO 4217
    nombre     text     NOT NULL,
    simbolo    text     NOT NULL,
    decimales  smallint NOT NULL DEFAULT 2
);

ALTER TABLE plataforma.plan
    ADD CONSTRAINT fk_plan_moneda
    FOREIGN KEY (moneda) REFERENCES plataforma.moneda(codigo);

CREATE TABLE plataforma.usuario_plataforma (        -- Superadministrador, RF-SAD-01
    id             uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    nombre         text        NOT NULL,
    email          citext      NOT NULL UNIQUE,
    password_hash  text        NOT NULL,            -- RNF-02
    activo         boolean     NOT NULL DEFAULT true,
    creado_en      timestamptz NOT NULL DEFAULT now()
);
-- Las credenciales del superadministrador no las lee la aplicación, nunca.
REVOKE ALL ON plataforma.usuario_plataforma FROM PUBLIC;

CREATE TABLE plataforma.tenant (                    -- RF-AUT-01, RF-AUT-02
    id                  uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    razon_social        text        NOT NULL,
    -- D-34 · Obligatorio para todos los planes. En el plan Personal es el NIT
    -- del RUT de la persona natural. Sin NIT no hay encabezado de PDF
    -- (RF-PRE-30) ni forma de facturar la suscripción (D-32), y su unicidad es
    -- lo que impide registrar la misma empresa N veces para encadenar pruebas
    -- gratuitas (RF-AUT-16).
    nit                 text        NOT NULL CHECK (btrim(nit) <> ''),
    -- D-30: llave del objeto en almacenamiento de objetos, NO una ruta de
    -- disco. El disco local no sobrevive a un redespliegue en contenedores y
    -- obliga a respaldar un directorio aparte de la base, que es justo lo que
    -- se olvida. La prueba de restauración de RNF-17 debe incluir un logo.
    logo_ruta           text,                       -- RF-CFG-05
    direccion           text,
    telefono            text,
    -- D-29: correo alterno, distinto del de ingreso, para restablecer el
    -- acceso cuando se pierde al único administrador.
    email_recuperacion  citext,
    -- Ley 1581 de 2012 (punto abierto 17.1.4): dónde queda constancia de la
    -- aceptación de términos y política de tratamiento de datos. El registro es
    -- fase 0 y el texto llega antes de la fase 2, así que las columnas nacen ya
    -- (nulas): añadirlas después sería una migración sobre una tabla con datos
    -- de clientes. Se llenan cuando exista el texto; no bloquean nada hoy.
    acepto_terminos_en  timestamptz,
    version_terminos    text,
    estado              text        NOT NULL DEFAULT 'ACTIVO'
                                    CHECK (estado IN ('ACTIVO','SUSPENDIDO')),  -- RF-SAD-04/05
    creado_en           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN plataforma.tenant.estado IS
  'SUSPENDIDO bloquea el acceso conservando todos los datos (RF-SAD-04, RNF-18).';
COMMENT ON COLUMN plataforma.tenant.logo_ruta IS
  'Llave del objeto en almacenamiento de objetos, servido por URL firmada de '
  'vencimiento corto (D-30). Nunca una ruta de disco local.';

-- El NIT es único en toda la plataforma (RF-AUT-16). Sin esa unicidad se puede
-- registrar la misma empresa N veces para encadenar pruebas gratuitas, que es
-- el abuso más barato posible contra un producto que se vende con 15 días
-- gratis.
-- Único por el NIT normalizado (sin puntos ni guiones): así «900.123.456-1» y
-- «9001234561» no pueden convivir. Ya no es parcial: desde D-34 el NIT es
-- obligatorio en los dos planes, así que no hay filas sin él.
CREATE UNIQUE INDEX ux_tenant_nit
    ON plataforma.tenant (regexp_replace(nit, '\D', '', 'g'));

CREATE TABLE plataforma.suscripcion (               -- RF-SAD-07
    id                    uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id             uuid        NOT NULL REFERENCES plataforma.tenant(id),
    plan_id               smallint    NOT NULL REFERENCES plataforma.plan(id),
    -- D-25: «VENCIDA» NO es un estado almacenado. Vencer es un hecho de
    -- calendario —fecha_vencimiento < hoy— que la interfaz deriva y que se
    -- revierte solo en el instante en que se registra el pago. Cancelar es una
    -- decisión comercial del superadministrador y nunca ocurre sola.
    -- Mezclarlas falsea el informe de bajas: una cuenta que solo dejó de pagar
    -- quedaba registrada como baja comercial.
    estado                text        NOT NULL
                                      CHECK (estado IN ('EN_PRUEBA','ACTIVA','CANCELADA')),
    cancelada_en          timestamptz,
    cancelada_motivo      text,
    -- RF-CFG-21 pide dos avisos: a −2 días del fin de prueba y a −5 del
    -- vencimiento de la suscripción. Son dos marcas y no una: con una sola, el
    -- segundo aviso no volvería a salir después del primero.
    aviso_prueba_en       timestamptz,
    aviso_vencimiento_en  timestamptz,
    fecha_inicio          date        NOT NULL,
    fecha_vencimiento     date        NOT NULL,
    -- D-40 · La renovación automática nace apagada y hoy nadie la enciende: el
    -- cobro es manual (D-13). Cuando entre la pasarela, encenderla es un
    -- UPDATE, y las dos columnas siguientes guardan de qué pasarela es la
    -- suscripción y con qué identificador la conoce ella. Sin este par, migrar
    -- a cobro recurrente obligaría a tocar una tabla con clientes pagando.
    renovacion_automatica boolean     NOT NULL DEFAULT false,
    pasarela              text,
    pasarela_referencia   text,
    creado_en             timestamptz NOT NULL DEFAULT now(),
    CHECK (fecha_vencimiento >= fecha_inicio),
    CONSTRAINT ck_suscripcion_cancelacion
        CHECK ((estado = 'CANCELADA') = (cancelada_en IS NOT NULL))
);
COMMENT ON COLUMN plataforma.suscripcion.cancelada_en IS
  'La cancelación es manual y comercial (D-25): nunca la escribe un proceso '
  'automático. «Vencida» no es un estado, es fecha_vencimiento < hoy.';
COMMENT ON COLUMN plataforma.suscripcion.aviso_prueba_en IS
  'Aviso de fin del período de prueba, dos días antes (RF-CFG-21, D-14).';
COMMENT ON COLUMN plataforma.suscripcion.aviso_vencimiento_en IS
  'Aviso de vencimiento de la suscripción pagada, cinco días antes (RF-CFG-21). '
  'Separado del anterior: una sola marca para dos avisos dejaba el segundo sin '
  'enviar para siempre.';

-- Una sola suscripción vigente por inquilino, esté en prueba o pagada.
CREATE UNIQUE INDEX ux_suscripcion_activa
    ON plataforma.suscripcion (tenant_id)
    WHERE estado IN ('EN_PRUEBA','ACTIVA');
CREATE INDEX ix_suscripcion_vencimiento
    ON plataforma.suscripcion (fecha_vencimiento) WHERE estado = 'ACTIVA';  -- RF-SAD-10

CREATE TABLE plataforma.pago (                      -- RF-SAD-08, RF-SAD-09, RF-CFG-07
    id              uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    suscripcion_id  uuid        NOT NULL REFERENCES plataforma.suscripcion(id),
    fecha           date        NOT NULL,
    concepto        text        NOT NULL,
    monto           app.dinero  NOT NULL CHECK (monto >= 0),
    -- Base e IVA del pago (punto abierto 17.1.2, régimen tributario): nulas
    -- hasta que el contador defina si el servicio queda excluido de IVA. Se
    -- añaden ya para no migrar plataforma.pago con datos (D-32).
    monto_base      app.dinero  CHECK (monto_base >= 0),
    iva             app.dinero  CHECK (iva >= 0),
    moneda          char(3)     NOT NULL DEFAULT 'COP' REFERENCES plataforma.moneda(codigo),
    metodo          text        NOT NULL,
    referencia      text,
    estado          text        NOT NULL
                                CHECK (estado IN ('EXITOSO','RECHAZADO','PENDIENTE')),
    -- D-25 · Sin saber qué período cubre el pago, el sistema no puede extender
    -- el vencimiento: la fórmula no tenía de dónde salir.
    periodo_meses   smallint    CHECK (periodo_meses > 0),
    cubre_hasta     date,
    -- D-32 · El comprobante de RF-CFG-08 deja de ser un PDF propio y pasa a ser
    -- la factura electrónica que emite el proveedor tecnológico.
    factura_numero  text,
    factura_cufe    text,
    factura_url     text,
    -- D-36 · Soporte del pago que adjunta el superadministrador: la foto o el
    -- PDF de la transferencia o del PSE. Es la llave del objeto en el
    -- almacenamiento de objetos, igual que el logo (D-30), nunca una ruta de
    -- disco. No se confunde con la factura: el soporte es lo que el cliente
    -- pagó; la factura es lo que la plataforma le emite.
    soporte_ruta    text,
    -- D-40 · De dónde viene el pago. Hoy todos son MANUAL, con una persona
    -- detrás que lo registró; cuando entre la pasarela serán PASARELA y no
    -- habrá persona, sino un webhook. Por eso registrado_por dejó de ser NOT
    -- NULL y pasó a exigirse por origen: la regla sigue siendo la misma —un
    -- pago manual siempre tiene autor— pero ya cabe el otro caso sin migrar.
    origen          text        NOT NULL DEFAULT 'MANUAL'
                                CHECK (origen IN ('MANUAL','PASARELA')),
    registrado_por  uuid        REFERENCES plataforma.usuario_plataforma(id),
    -- Qué pasarela, con qué identificador de transacción, en qué estado lo
    -- dejó y con qué cuerpo llegó el webhook. El payload completo se guarda
    -- porque una conciliación tardía siempre necesita el dato que nadie
    -- pensó en extraer.
    pasarela        text,
    pasarela_referencia text,
    pasarela_estado text,
    pasarela_datos  jsonb,
    registrado_en   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_pago_origen_manual
        CHECK ((origen = 'MANUAL') = (registrado_por IS NOT NULL)),
    CONSTRAINT ck_pago_origen_pasarela
        CHECK ((origen = 'PASARELA')
               = (pasarela IS NOT NULL AND pasarela_referencia IS NOT NULL))
);
-- Un webhook se reintenta: la misma transacción puede llegar tres veces. Esta
-- unicidad es la que convierte el reintento en un no-evento en vez de en tres
-- meses de suscripción regalados.
CREATE UNIQUE INDEX ux_pago_pasarela
    ON plataforma.pago (pasarela, pasarela_referencia)
    WHERE pasarela IS NOT NULL;
COMMENT ON COLUMN plataforma.pago.cubre_hasta IS
  'Nueva fecha de vencimiento que produjo este pago: '
  'max(vencimiento anterior, hoy) + periodo_meses. El máximo evita que quien '
  'paga con retraso siga bloqueado después de pagar (D-25).';
COMMENT ON COLUMN plataforma.pago.factura_cufe IS
  'Código único de factura electrónica que devuelve el proveedor tecnológico. '
  'El comprobante de RF-CFG-08 es esta factura, no un PDF propio (D-32).';
CREATE INDEX ix_pago_suscripcion ON plataforma.pago (suscripcion_id, fecha DESC);


-- -----------------------------------------------------------------------------
--  D-38 · Auditoría de la plataforma.
--
--  app.evento_auditoria cuenta lo que ocurre DENTRO de una empresa y se borra
--  con ella. Las acciones del superadministrador son otra cosa: suspender una
--  cuenta, cambiarle el plan, registrar un pago, designar un administrador o
--  eliminar los datos de un cliente. Ninguna dejaba rastro, y la justificación
--  escrita que exigen RF-SAD-13, RF-SAD-14 y RF-SAD-15 se perdía en el momento
--  mismo de usarla: la de la eliminación desaparecía con la empresa.
--
--  Por eso vive aquí, y tenant_id queda en NULO cuando la empresa desaparece:
--  el registro tiene que sobrevivir a lo que registra. La razón social y el NIT
--  se copian en «datos» para que el renglón siga siendo legible después.
-- -----------------------------------------------------------------------------
CREATE TABLE plataforma.evento_plataforma (
    id                     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id              uuid        REFERENCES plataforma.tenant(id) ON DELETE SET NULL,
    tipo                   text        NOT NULL CHECK (tipo IN
                                       ('TENANT_CREADO','TENANT_SUSPENDIDO','TENANT_REACTIVADO',
                                        'TENANT_ELIMINADO','PLAN_CAMBIADO','SUSCRIPCION_CANCELADA',
                                        'PAGO_REGISTRADO','ADMIN_DESIGNADO')),
    descripcion            text        NOT NULL,
    justificacion          text,
    datos                  jsonb,
    usuario_plataforma_id  uuid        REFERENCES plataforma.usuario_plataforma(id),
    ocurrido_en            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_evento_plataforma        ON plataforma.evento_plataforma (ocurrido_en DESC);
CREATE INDEX ix_evento_plataforma_tenant ON plataforma.evento_plataforma (tenant_id, ocurrido_en DESC);
COMMENT ON TABLE plataforma.evento_plataforma IS
  'Historial de las acciones del superadministrador (D-38). Sobrevive a la '
  'empresa eliminada: tenant_id pasa a NULO y los datos identificadores quedan '
  'copiados en la columna «datos».';

CREATE OR REPLACE FUNCTION plataforma.fn_evento_plataforma(
    p_tenant_id uuid, p_tipo text, p_descripcion text,
    p_justificacion text DEFAULT NULL, p_datos jsonb DEFAULT NULL,
    p_usuario_plataforma_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO plataforma.evento_plataforma
        (tenant_id, tipo, descripcion, justificacion, datos, usuario_plataforma_id)
    SELECT p_tenant_id, p_tipo, p_descripcion, p_justificacion,
           COALESCE(p_datos, '{}'::jsonb) ||
           COALESCE((SELECT jsonb_build_object('razon_social', t.razon_social,
                                               'nit', t.nit)
                       FROM plataforma.tenant t WHERE t.id = p_tenant_id),
                    '{}'::jsonb),
           p_usuario_plataforma_id
    RETURNING id;
$$;

-- Suspender, reactivar, cambiar de plan y cancelar se hacen con un UPDATE desde
-- el panel, así que el evento lo escribe un trigger: si dependiera de que el
-- panel se acuerde, el día que falte será el que importaba.
CREATE OR REPLACE FUNCTION plataforma.fn_auditar_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, app, pg_temp AS $$
BEGIN
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
        PERFORM plataforma.fn_evento_plataforma(
            NEW.id,
            CASE NEW.estado WHEN 'SUSPENDIDO' THEN 'TENANT_SUSPENDIDO'
                            ELSE 'TENANT_REACTIVADO' END,
            format('Estado de la empresa: %s → %s', OLD.estado, NEW.estado));
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_auditar_tenant AFTER UPDATE OF estado ON plataforma.tenant
    FOR EACH ROW EXECUTE FUNCTION plataforma.fn_auditar_tenant();

CREATE OR REPLACE FUNCTION plataforma.fn_auditar_suscripcion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, app, pg_temp AS $$
BEGIN
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
        PERFORM plataforma.fn_evento_plataforma(NEW.tenant_id, 'PLAN_CAMBIADO',
            format('Plan %s → %s',
                   (SELECT codigo FROM plataforma.plan WHERE id = OLD.plan_id),
                   (SELECT codigo FROM plataforma.plan WHERE id = NEW.plan_id)));
    END IF;
    IF NEW.estado = 'CANCELADA' AND OLD.estado <> 'CANCELADA' THEN
        PERFORM plataforma.fn_evento_plataforma(NEW.tenant_id,
            'SUSCRIPCION_CANCELADA',
            'Suscripción cancelada por el superadministrador',
            NEW.cancelada_motivo);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_auditar_suscripcion AFTER UPDATE ON plataforma.suscripcion
    FOR EACH ROW EXECUTE FUNCTION plataforma.fn_auditar_suscripcion();


-- =============================================================================
--  2. IDENTIDAD Y CONTROL DE ACCESO                              (RF-AUT, RF-CFG)
-- =============================================================================

CREATE TABLE app.rol (
    id          uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id   uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    nombre      text        NOT NULL,
    tipo        text        NOT NULL
                            CHECK (tipo IN ('ADMIN','ASISTENTE','PERSONALIZADO')),
    es_sistema  boolean     NOT NULL DEFAULT false,   -- protege ADMIN y ASISTENTE
    creado_en   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, nombre),
    UNIQUE (tenant_id, id)                            -- soporte de FK compuesta
);

CREATE TABLE app.permiso (                            -- catálogo global, sin tenant
    codigo       text PRIMARY KEY,                    -- 'RECURSOS.CREAR'
    modulo       text NOT NULL,
    accion       text NOT NULL,
    descripcion  text NOT NULL
);

CREATE TABLE app.rol_permiso (
    tenant_id       uuid NOT NULL,
    rol_id          uuid NOT NULL,
    permiso_codigo  text NOT NULL REFERENCES app.permiso(codigo),
    PRIMARY KEY (rol_id, permiso_codigo),
    FOREIGN KEY (tenant_id, rol_id)
        REFERENCES app.rol(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE app.usuario (
    id             uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    rol_id         uuid        NOT NULL,
    nombre         text        NOT NULL,
    -- Único a nivel global, por decisión: un correo pertenece a UNA sola
    -- empresa, y por eso el login (RF-AUT-04) no necesita selector de empresa.
    -- La consecuencia aceptada es que un consultor independiente que trabaje
    -- para dos constructoras necesita un correo distinto en cada una. No lo
    -- cambies a UNIQUE (tenant_id, email): eso obligaría a un selector de
    -- empresa en el login.
    email          citext      NOT NULL UNIQUE,
    -- D-7: el administrador crea la cuenta pero NO la contraseña. Un usuario
    -- invitado nace con password_hash nulo y la fija él mismo al abrir el
    -- enlace de activación (app.token_recuperacion con proposito ACTIVACION).
    -- Así el administrador nunca conoce la contraseña de sus usuarios y el
    -- historial de cambios sigue siendo prueba de quién hizo qué.
    -- El dueño que registra la empresa sí llega con hash: se la puso él mismo.
    password_hash  text,                             -- RNF-02
    -- PENDIENTE ⇒ invitado, aún no ha consumido su enlace de activación
    -- ACTIVO    ⇒ fijó su contraseña al consumir el enlace de activación (P2/M9)
    --             El dueño que registra la empresa nace con contraseña propia.
    -- REVOCADO  ⇒ acceso retirado, se conserva para la trazabilidad
    estado         text        NOT NULL DEFAULT 'PENDIENTE'
                               CHECK (estado IN ('PENDIENTE','ACTIVO','REVOCADO')), -- RF-CFG-12
    creado_en      timestamptz NOT NULL DEFAULT now(),
    ultimo_acceso  timestamptz,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, rol_id) REFERENCES app.rol(tenant_id, id),
    -- La implicación va en un solo sentido, a propósito. Exigirla en los dos
    -- —(estado = 'PENDIENTE') = (ultimo_acceso IS NULL)— impediría revocar a
    -- un usuario que nunca inició sesión, y RF-CFG-12 promete revocar «en
    -- cualquier momento»: alguien creado por error, o que se fue de la empresa
    -- antes de entrar, tiene que poder quedar revocado.
    CONSTRAINT ck_usuario_primer_ingreso
        CHECK (estado <> 'PENDIENTE' OR ultimo_acceso IS NULL),
    -- Nadie llega a ACTIVO sin haber fijado su contraseña: se fija al activar
    -- la cuenta o al registrar la empresa, nunca después de entrar.
    CONSTRAINT ck_usuario_activo_con_password
        CHECK (estado <> 'ACTIVO' OR password_hash IS NOT NULL)
);
CREATE INDEX ix_usuario_tenant ON app.usuario (tenant_id, estado);

-- Una sola tubería para dos usos, porque el mecanismo es idéntico: enlace de
-- un solo uso, hash almacenado, vencimiento. Las vigencias sí difieren y no es
-- capricho: la recuperación la pide el propio usuario y está esperando el
-- correo; la activación la dispara el administrador y el invitado puede verla
-- horas después.
CREATE TABLE app.token_recuperacion (                 -- RF-AUT-06..11, 13, RNF-03
    id          uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    -- tenant_id + FK compuesta + RLS (aplicada al final): sin esto la tabla
    -- quedaba fuera del aislamiento, fn_verificar_rls no la veía (solo revisa
    -- tablas con tenant_id) y un inquilino podía emitir y resolver un token de
    -- otro. RN-01: por ninguna vía.
    tenant_id   uuid        NOT NULL,
    usuario_id  uuid        NOT NULL,
    proposito   text        NOT NULL DEFAULT 'RECUPERACION'
                            CHECK (proposito IN ('ACTIVACION','RECUPERACION')),
    token_hash  text        NOT NULL UNIQUE,          -- se guarda el hash, no el token
    creado_en   timestamptz NOT NULL DEFAULT now(),
    -- RECUPERACION: creado_en + 30 minutos (RF-AUT-07)
    -- ACTIVACION:   creado_en + 72 horas   (RF-AUT-13)
    expira_en   timestamptz NOT NULL,
    usado_en    timestamptz,                          -- uso único (RF-AUT-11)
    -- anulado_en: emitir un token nuevo invalida los anteriores del mismo
    -- usuario y propósito (RF-AUT-18). Lo escribe un trigger BEFORE INSERT.
    anulado_en  timestamptz,
    CHECK (expira_en > creado_en),
    -- La vigencia por propósito deja de ser solo comentario (RNF-03, RF-AUT-13).
    CONSTRAINT ck_token_vigencia CHECK (expira_en <= creado_en +
        CASE proposito WHEN 'RECUPERACION' THEN interval '30 minutes'
                       ELSE interval '72 hours' END),
    FOREIGN KEY (tenant_id, usuario_id)
        REFERENCES app.usuario(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_token_usuario ON app.token_recuperacion (tenant_id, usuario_id)
    WHERE usado_en IS NULL AND anulado_en IS NULL;

-- RF-AUT-18: emitir un token nuevo invalida los anteriores del mismo usuario y
-- propósito. Sin esto, un enlace viejo seguía sirviendo después de reenviar.
CREATE OR REPLACE FUNCTION app.fn_token_anula_anteriores() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app.token_recuperacion SET anulado_en = now()
     WHERE tenant_id = NEW.tenant_id AND usuario_id = NEW.usuario_id
       AND proposito = NEW.proposito
       AND usado_en IS NULL AND anulado_en IS NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_token_anula_anteriores BEFORE INSERT ON app.token_recuperacion
    FOR EACH ROW EXECUTE FUNCTION app.fn_token_anula_anteriores();


-- =============================================================================
--  3. PARAMETRIZACIÓN DEL INQUILINO                                    (RF-CFG)
-- =============================================================================

CREATE TABLE app.configuracion_empresa (
    tenant_id            uuid    PRIMARY KEY
                                 REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    -- D-6: moneda única de la empresa. Todo precio del catálogo y todo
    -- presupuesto del inquilino se expresan en esta divisa.
    moneda_base          char(3) NOT NULL DEFAULT 'COP'
                                 REFERENCES plataforma.moneda(codigo),         -- RF-CFG-13
    separador_miles      char(1) NOT NULL DEFAULT '.',                          -- RF-CFG-14
    separador_decimal    char(1) NOT NULL DEFAULT ',',
    decimales_vista      smallint NOT NULL DEFAULT 2
                                 CHECK (decimales_vista BETWEEN 0 AND 2),       -- RF-CFG-15
    -- D-41 · Aquí NO viven el AIU ni el IVA. El AIU se negocia obra por obra
    -- —no es un parámetro de la empresa sino una decisión de cada oferta— y
    -- precargarlo desde una configuración general es la forma más barata de
    -- que una obra salga con el AIU de otra. Los cuatro porcentajes viven en
    -- app.presupuesto y solo ahí: los tres del AIU nacen en cero y el IVA en
    -- 19 %, que es tarifa de ley y no decisión comercial.
    notif_vencimiento    boolean NOT NULL DEFAULT true,                         -- RF-CFG-21
    notif_cambio_estado  boolean NOT NULL DEFAULT true,
    actualizado_en       timestamptz NOT NULL DEFAULT now(),
    CHECK (separador_miles <> separador_decimal)
);

CREATE TABLE app.unidad_medida (                      -- RF-CFG-17..20
    id           uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id    uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    simbolo      text        NOT NULL,
    descripcion  text        NOT NULL,
    creado_en    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id)
);
-- D-31 · La unicidad del símbolo ignora mayúsculas: «Kg» y «kg» no
-- pueden convivir en la misma empresa, que es exactamente la entrada de datos
-- basura que esta lista existe para impedir (RF-CFG-18).
CREATE UNIQUE INDEX ux_unidad_simbolo
    ON app.unidad_medida (tenant_id, lower(simbolo));

CREATE TABLE app.secuencia_codigo (                   -- RN-02
    tenant_id  uuid   NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    entidad    text   NOT NULL CHECK (entidad IN ('RECURSO','APU')),
    prefijo    text   NOT NULL,
    ultimo     bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, entidad)
);
COMMENT ON TABLE app.secuencia_codigo IS
  'Correlativo por inquilino (D-24). No se usa una SEQUENCE de PostgreSQL '
  'porque los códigos deben ser consecutivos dentro de cada empresa, no '
  'globalmente. Las dos filas nacen en la transacción de alta: sin ellas, el '
  'primer recurso que intente crear un cliente nuevo falla.';


-- =============================================================================
--  4. CATÁLOGO MAESTRO Y COMPOSICIÓN CONGELADA               (RF-REC, RF-APU)
-- =============================================================================

CREATE TABLE app.recurso (
    id              uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    codigo          text        NOT NULL,                       -- backend, RF-REC-11
    nombre          text        NOT NULL,
    tipo            text        NOT NULL CHECK (tipo IN
                                ('MATERIAL','EQUIPO','PERSONAL','ACTIVIDAD_TODO_COSTO')), -- RF-REC-01
    unidad_id       uuid        NOT NULL,
    precio_base     app.dinero  NOT NULL CHECK (precio_base  >= 0),   -- RF-REC-07 vía A
    iva_pct         app.porcentaje NOT NULL DEFAULT 0,                -- RF-REC-08
    precio_total    app.dinero  NOT NULL CHECK (precio_total >= 0),   -- RF-REC-07 vía B
    via_captura     text        NOT NULL CHECK (via_captura IN ('BASE','TOTAL')),
    activo          boolean     NOT NULL DEFAULT true,
    creado_por      uuid,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, codigo),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, unidad_id)
        REFERENCES app.unidad_medida(tenant_id, id) ON DELETE RESTRICT,  -- RF-CFG-19
    -- Con llave foránea: sin ella se aceptaría un uuid inexistente o de otro
    -- inquilino y el panel de historial saldría vacío. Como los usuarios no se
    -- borran (pasan a REVOCADO), la llave no estorba.
    FOREIGN KEY (tenant_id, creado_por)
        REFERENCES app.usuario(tenant_id, id),
    CHECK (precio_total >= precio_base),
    -- La base defiende la fórmula: sin esto se aceptaría un recurso con base
    -- 100, IVA 19 y total 500. La comprobación es direccional según la vía de
    -- captura, porque el camino inverso no cierra exactamente: un total de 100
    -- con IVA 19 da una base de 84,033613, y multiplicarla otra vez no
    -- devuelve 100 redondo.
    CONSTRAINT ck_recurso_precios_cuadran
        CHECK (CASE via_captura
                 WHEN 'BASE'  THEN precio_total = round(precio_base  * (1 + iva_pct/100), 6)
                 WHEN 'TOTAL' THEN precio_base  = round(precio_total / (1 + iva_pct/100), 6)
               END)
);
COMMENT ON COLUMN app.recurso.via_captura IS
  'Vía que usó el usuario al capturar el precio. Permite reproducir el bloqueo '
  'cruzado de campos de RF-REC-10 al reabrir el formulario, y decide cuál de '
  'las dos igualdades de ck_recurso_precios_cuadran se exige.';
CREATE INDEX ix_recurso_tipo    ON app.recurso (tenant_id, tipo, nombre);
CREATE INDEX ix_recurso_nombre  ON app.recurso (tenant_id, lower(nombre));  -- RF-REC-03/14
-- Índice trigrama. El índice sobre lower(nombre) solo sirve búsquedas por
-- prefijo, y la que describe RF-REC-03 —autocompletado, «todos los recursos
-- relacionados»— es ILIKE '%término%', que sin trigramas cae en Seq Scan.
-- Aguanta con 200 recursos; con un catálogo real de 5.000 insumos y varios
-- usuarios escribiendo a la vez, no.
CREATE INDEX ix_recurso_nombre_trgm ON app.recurso
    USING gin (tenant_id, nombre gin_trgm_ops);

-- Cabecera estable del APU: el código vive aquí y nunca cambia (RF-APU-18).
CREATE TABLE app.apu (
    id                  uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id           uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    codigo              text        NOT NULL,                   -- backend, RF-APU-11
    nombre              text        NOT NULL,
    unidad_id           uuid        NOT NULL,
    version_vigente_id  uuid,                                   -- FK añadida más abajo
    activo              boolean     NOT NULL DEFAULT true,
    creado_por          uuid,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, codigo),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, unidad_id)
        REFERENCES app.unidad_medida(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, creado_por)
        REFERENCES app.usuario(tenant_id, id)
);
CREATE INDEX ix_apu_nombre ON app.apu (tenant_id, lower(nombre));   -- RF-APU-02
CREATE INDEX ix_apu_unidad ON app.apu (tenant_id, unidad_id);       -- RF-APU-03
CREATE INDEX ix_apu_nombre_trgm ON app.apu
    USING gin (tenant_id, nombre gin_trgm_ops);

-- Composición congelada. INMUTABLE: solo inserción (RNF-09).
CREATE TABLE app.apu_version (
    id              uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id       uuid        NOT NULL,
    apu_id          uuid        NOT NULL,
    numero          integer     NOT NULL CHECK (numero > 0),
    nombre          text        NOT NULL,          -- snapshot
    unidad_simbolo  text        NOT NULL,          -- snapshot
    -- Sin DEFAULT a propósito: el trigger de inmutabilidad impide corregirlo
    -- después, así que el backend debe calcularlo ANTES de insertar la versión
    -- y luego insertar las líneas. Es justamente lo que pide RNF-06.
    -- D-21 lo comprueba al confirmar la transacción (ver sección 7).
    costo_directo   app.dinero  NOT NULL,                      -- RF-APU-10
    -- GANCHO FASE 2: 'PROYECTO' habilita el «APU del proyecto» del módulo de
    -- control. Hoy solo se acepta 'MAESTRO'.
    ambito          text        NOT NULL DEFAULT 'MAESTRO'
                                CHECK (ambito IN ('MAESTRO')),
    -- La otra mitad del gancho, y la que de verdad costaba: una versión de
    -- proyecto tiene que saber DE QUÉ proyecto es. Ampliar el CHECK de arriba
    -- sin esta columna dejaría versiones de ámbito PROYECTO sin dueño y el
    -- «APU del proyecto» no se podría acotar a su obra. Hoy es siempre nula, de
    -- modo que cuando llegue la fase 2 no hay ningún dato que migrar.
    presupuesto_id  uuid,
    motivo          text,
    creada_por      uuid,
    creada_en       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (apu_id, numero),
    UNIQUE (tenant_id, id),
    -- Sin esta unicidad, la llave compuesta de más abajo solo podría atar una
    -- versión a su inquilino, no a SU APU.
    CONSTRAINT ux_apu_version_de_su_apu UNIQUE (apu_id, id),
    CONSTRAINT ck_apu_version_costo_no_negativo CHECK (costo_directo >= 0),
    -- Ámbito y dueño viajan juntos: MAESTRO no cuelga de ningún proyecto y
    -- PROYECTO no existe sin uno.
    CONSTRAINT ck_apu_version_ambito
        CHECK ((ambito = 'MAESTRO') = (presupuesto_id IS NULL)),
    FOREIGN KEY (tenant_id, apu_id) REFERENCES app.apu(tenant_id, id),
    FOREIGN KEY (tenant_id, creada_por) REFERENCES app.usuario(tenant_id, id)
);

ALTER TABLE app.apu
    ADD CONSTRAINT fk_apu_version_vigente
    FOREIGN KEY (tenant_id, version_vigente_id)
    REFERENCES app.apu_version(tenant_id, id);

-- La llave anterior garantiza el inquilino, no el APU. Sin esta segunda, un APU
-- podría quedar apuntando a la composición de OTRO APU y el usuario vería un
-- costo que no es el suyo.
ALTER TABLE app.apu
    ADD CONSTRAINT fk_version_vigente_es_de_este_apu
    FOREIGN KEY (id, version_vigente_id) REFERENCES app.apu_version (apu_id, id);

-- Líneas del APU. INMUTABLE.
CREATE TABLE app.apu_version_recurso (
    id               uuid    PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id        uuid    NOT NULL,
    apu_version_id   uuid    NOT NULL,
    orden            smallint NOT NULL,
    recurso_id       uuid    NOT NULL,
    -- Snapshots: congelan la versión frente a cambios posteriores del catálogo
    recurso_codigo   text    NOT NULL,
    recurso_nombre   text    NOT NULL,
    recurso_tipo     text    NOT NULL CHECK (recurso_tipo IN
                             ('MATERIAL','EQUIPO','PERSONAL','ACTIVIDAD_TODO_COSTO')),
    unidad_simbolo   text    NOT NULL,
    precio_unitario  app.dinero     NOT NULL CHECK (precio_unitario >= 0),
    -- D-1: subtotal = cantidad × rendimiento × (1 + desperdicio_pct/100) × precio_unitario
    -- El mínimo representable es 0,000001. Por debajo, el valor se redondea a
    -- cero al guardarse, así que la restricción lo rechaza nombrando el mínimo
    -- en vez de dejar que el usuario reciba un error por un cero que no
    -- escribió.
    cantidad         app.cantidad   NOT NULL DEFAULT 1,
    rendimiento      app.cantidad   NOT NULL DEFAULT 1,
    desperdicio_pct  app.porcentaje NOT NULL DEFAULT 0,
    subtotal         app.dinero     NOT NULL,
    CONSTRAINT ck_avr_cantidad_minima    CHECK (cantidad    >= 0.000001),
    CONSTRAINT ck_avr_rendimiento_minimo CHECK (rendimiento >= 0.000001),
    -- DEFERRABLE: reordenar las líneas de un APU con renumeración choca
    -- consigo mismo a mitad del intercambio si la restricción se evalúa fila a
    -- fila. Diferida, el reordenamiento cabe en una sola sentencia, dentro de
    -- la transacción y sin inventar valores temporales.
    CONSTRAINT apu_version_recurso_apu_version_id_orden_key
        UNIQUE (apu_version_id, orden) DEFERRABLE INITIALLY IMMEDIATE,
    FOREIGN KEY (tenant_id, apu_version_id)
        REFERENCES app.apu_version(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, recurso_id)
        REFERENCES app.recurso(tenant_id, id) ON DELETE RESTRICT,   -- RF-REC-13, RN-10
    -- RN-07: el desperdicio solo aplica a materiales.
    CONSTRAINT ck_desperdicio_solo_material
        CHECK (desperdicio_pct = 0 OR recurso_tipo = 'MATERIAL'),
    -- La fórmula más delicada del sistema, defendida en la base: sin esto se
    -- aceptaría una línea con subtotal 1 en lugar de 624.750.
    CONSTRAINT ck_avr_subtotal_cuadra
        CHECK (subtotal = round(cantidad * rendimiento
                                * (1 + desperdicio_pct/100) * precio_unitario, 6))
);
COMMENT ON COLUMN app.apu_version_recurso.cantidad IS
  'DECIDIDO (D-1, 12-sep-2026): número de unidades del recurso que intervienen '
  'simultáneamente en la actividad. Materiales: normalmente 1. Mano de obra: el '
  'número de personas de ese oficio en la cuadrilla.';
COMMENT ON COLUMN app.apu_version_recurso.rendimiento IS
  'DECIDIDO (D-1, 12-sep-2026): consumo del recurso por cada unidad de actividad, '
  'en la unidad del recurso (0,35 m3 de arena por m2 de muro; 0,5 jornales por m3). '
  'Aplica a los cuatro tipos de recurso. Se MULTIPLICA, no se divide. '
  'Mínimo representable: 0,000001.';
COMMENT ON COLUMN app.apu_version_recurso.precio_unitario IS
  'DECIDIDO (D-2, 12-sep-2026): copia congelada de recurso.precio_total, es decir '
  'el precio CON IVA incluido.';
COMMENT ON COLUMN app.apu_version_recurso.subtotal IS
  'subtotal = cantidad * rendimiento * (1 + desperdicio_pct/100) * precio_unitario. '
  'La base lo comprueba: no es solo documentación.';
CREATE INDEX ix_avr_version ON app.apu_version_recurso (apu_version_id, orden);
CREATE INDEX ix_avr_recurso ON app.apu_version_recurso (tenant_id, recurso_id);


-- =============================================================================
--  5. PRESUPUESTOS Y PROYECTOS                                        (RF-PRE)
-- =============================================================================

CREATE TABLE app.presupuesto (
    id                     uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id              uuid        NOT NULL REFERENCES plataforma.tenant(id) ON DELETE CASCADE,
    codigo                 text        NOT NULL,          -- manual y único, RF-PRE-03
    nombre                 text        NOT NULL,
    ubicacion              text        NOT NULL,
    moneda                 char(3)     NOT NULL
                                       REFERENCES plataforma.moneda(codigo),  -- RF-PRE-04
    estado                 text        NOT NULL DEFAULT 'ABIERTO'
                                       CHECK (estado IN ('ABIERTO','ACTIVO','CERRADO')), -- RN-03
    -- D-18 · Archivar es la operación de uso diario: reversible, disponible en
    -- cualquier estado, no borra nada, y saca al proyecto de la vista maestra.
    -- Es la respuesta a la licitación que no se ganó. Sin ella esos proyectos
    -- quedarían ABIERTOS para siempre, porque la transición ABIERTO → CERRADO
    -- no existe y no debe existir: CERRADO significa obra terminada, y usar ese
    -- estado para «licitación perdida» arruina cualquier métrica que después se
    -- saque del estado.
    archivado_en           timestamptz,
    -- GANCHO FASE 2 (D-17): el MVP presupuesta obra de construcción y nada
    -- más. Cuando se añadan interventoría, consultoría u otros servicios,
    -- basta con ampliar este CHECK: no hay datos que migrar porque toda fila
    -- existente ya dice CONSTRUCCION.
    --
    -- Qué gobernará el tipo cuando existan más de uno: el vocabulario de la
    -- interfaz, la clasificación que se sugiere por defecto al crear un
    -- capítulo y las validaciones de coherencia. NO cambia ninguna fórmula:
    -- el AIU se seguirá calculando sobre el costo directo, porque «directo»
    -- es relativo al objeto del contrato —en una interventoría el equipo
    -- profesional ES el costo directo de ese contrato—.
    tipo_proyecto          text        NOT NULL DEFAULT 'CONSTRUCCION'
                                       CHECK (tipo_proyecto IN ('CONSTRUCCION')),
    -- Los tres porcentajes del AIU son POR PRESUPUESTO, no una constante del
    -- sistema: varían con cada obra. Al crear el proyecto se copian de
    -- app.configuracion_empresa como punto de partida (RF-CFG-16) y quedan
    -- editables mientras el proyecto esté ABIERTO (RF-PRE-23).
    -- El DEFAULT es 0, no un valor «razonable» de 25: un AIU inventado por el
    -- sistema y no revisado por el ingeniero es peor que un AIU en cero, que
    -- salta a la vista. La interfaz avisa al activar con el AIU en cero
    -- (RF-PRE-35).
    aiu_administracion     app.porcentaje NOT NULL DEFAULT 0,
    aiu_imprevistos        app.porcentaje NOT NULL DEFAULT 0,
    aiu_utilidad           app.porcentaje NOT NULL DEFAULT 0,
    -- D-33 · IVA sobre la utilidad, con la tarifa general por defecto y
    -- editable mientras el proyecto esté ABIERTO, igual que el AIU. Viaja con
    -- el presupuesto: si mañana cambia la tarifa, las ofertas ya emitidas no
    -- se mueven.
    iva_utilidad_pct       app.porcentaje NOT NULL DEFAULT 19,
    -- D-42 · Cómo se estructura este presupuesto. Se elige al crearlo:
    --   ITEMS · capítulo → actividad. Dos niveles y nada más.
    --   WBS   · capítulo → subcapítulo → actividad, con la profundidad que
    --           haga falta, y con actividades colgando también del capítulo.
    -- No son dos modelos de datos: es el mismo árbol, y ITEMS solo prohíbe los
    -- subcapítulos. Así un presupuesto sencillo no obliga a inventar niveles y
    -- uno grande no se queda corto, sin partir el esquema en dos.
    modo_estructura        text        NOT NULL DEFAULT 'WBS'
                                       CHECK (modo_estructura IN ('ITEMS','WBS')),
    -- Los escribe EXCLUSIVAMENTE app.fn_recalcular_presupuesto (RNF-06, RNF-25).
    -- Ver el trigger tg_cabecera_presupuesto de la sección 8: cualquier otra
    -- escritura se rechaza, en cualquier estado.
    total_costo_directo    app.dinero  NOT NULL DEFAULT 0,
    total_costo_indirecto  app.dinero  NOT NULL DEFAULT 0,
    total_aiu              app.dinero  NOT NULL DEFAULT 0,
    total_iva              app.dinero  NOT NULL DEFAULT 0,        -- D-33
    valor_total            app.dinero  NOT NULL DEFAULT 0,
    duplicado_de_id        uuid,                                -- RF-PRE-27
    fecha_elaboracion      timestamptz NOT NULL DEFAULT now(),  -- no editable, RF-PRE-06
    fecha_modificacion     timestamptz NOT NULL DEFAULT now(),  -- RF-PRE-07
    activado_en            timestamptz,
    cerrado_en             timestamptz,
    creado_por             uuid,
    UNIQUE (tenant_id, codigo),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, duplicado_de_id)
        REFERENCES app.presupuesto(tenant_id, id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id, creado_por)
        REFERENCES app.usuario(tenant_id, id),
    CHECK (estado <> 'ACTIVO'  OR activado_en IS NOT NULL),
    CHECK (estado <> 'CERRADO' OR cerrado_en  IS NOT NULL),
    -- Los totales guardados también se defienden, no solo se calculan.
    CONSTRAINT ck_presupuesto_totales_no_negativos
        CHECK (total_costo_directo >= 0 AND total_costo_indirecto >= 0
           AND total_aiu >= 0 AND total_iva >= 0 AND valor_total >= 0)
);
COMMENT ON COLUMN app.presupuesto.archivado_en IS
  'No nulo ⇒ el presupuesto está archivado: se oculta de la vista maestra por '
  'defecto. Reversible, disponible en cualquier estado, no borra nada (D-18).';
CREATE INDEX ix_presupuesto_estado ON app.presupuesto (tenant_id, estado, fecha_modificacion DESC);
CREATE INDEX ix_presupuesto_nombre ON app.presupuesto (tenant_id, lower(nombre));   -- RF-PRE-02
CREATE INDEX ix_presupuesto_nombre_trgm ON app.presupuesto
    USING gin (tenant_id, nombre gin_trgm_ops);
-- D-18 · La vista maestra muestra por defecto solo los no archivados.
CREATE INDEX ix_presupuesto_activos ON app.presupuesto (tenant_id, estado)
    WHERE archivado_en IS NULL;

-- El dueño de una versión de ámbito PROYECTO (gancho de fase 2). Va aquí y no
-- en la tabla porque app.presupuesto se crea después de app.apu_version.
ALTER TABLE app.apu_version
    ADD CONSTRAINT fk_apu_version_presupuesto
    FOREIGN KEY (tenant_id, presupuesto_id)
    REFERENCES app.presupuesto(tenant_id, id) ON DELETE CASCADE;
CREATE INDEX ix_apu_version_presupuesto ON app.apu_version (tenant_id, presupuesto_id)
    WHERE presupuesto_id IS NOT NULL;

-- La versión vigente del catálogo nunca puede ser una versión de proyecto: el
-- día que exista el «APU del proyecto», un ajuste hecho en una obra no puede
-- convertirse en el precio que ven los demás proyectos.
CREATE OR REPLACE FUNCTION app.fn_vigente_es_maestro() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_ambito text;
BEGIN
    IF NEW.version_vigente_id IS NULL THEN RETURN NEW; END IF;
    SELECT ambito INTO v_ambito FROM app.apu_version WHERE id = NEW.version_vigente_id;
    IF v_ambito <> 'MAESTRO' THEN
        RAISE EXCEPTION
          'La versión vigente de «%» tiene que ser del catálogo maestro: una '
          'versión de proyecto no puede volverse el precio del catálogo.',
          NEW.nombre;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_vigente_es_maestro
    BEFORE INSERT OR UPDATE OF version_vigente_id ON app.apu
    FOR EACH ROW EXECUTE FUNCTION app.fn_vigente_es_maestro();

-- Árbol WBS de profundidad ilimitada (§10.1, RF-PRE-10..14).
CREATE TABLE app.wbs_nodo (
    id               uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id        uuid        NOT NULL,
    presupuesto_id   uuid        NOT NULL,
    padre_id         uuid,                                 -- NULL ⇒ capítulo raíz
    orden            integer     NOT NULL,
    nivel            smallint    NOT NULL CHECK (nivel >= 1),
    -- D-42 · El capítulo se numera «1.0» y los niveles inferiores «1.1»,
    -- «1.1.1». El cero del capítulo no es decoración: deja libre el 1.1 para
    -- su primer hijo, sea un subcapítulo o una actividad, y por eso capítulos
    -- y actividades pueden convivir bajo el mismo padre sin chocar. Lo deriva
    -- app.fn_renumerar_wbs del propio árbol; la aplicación no lo escribe.
    codigo_wbs       text        NOT NULL,                 -- '1.0', '1.2', '1.2.3' — RF-PRE-12
    nombre           text        NOT NULL,
    -- D-16: un capítulo es de costo DIRECTO (obra física) o INDIRECTO
    -- (topografía, dirección de obra, estudios, pólizas). Es obligatorio y no
    -- tiene valor por defecto: obligar a elegir evita que un capítulo de
    -- indirectos quede contado como obra por descuido.
    -- D-8: solo se define en el nivel 1; los subniveles la heredan.
    clasificacion    text        CHECK (clasificacion IN ('DIRECTO','INDIRECTO')),
    monto_acumulado  app.dinero  NOT NULL DEFAULT 0,       -- RF-PRE-21
    UNIQUE (tenant_id, id),
    -- Soporte de la llave que ata un ítem a un nodo de SU presupuesto.
    CONSTRAINT ux_wbs_presupuesto_id UNIQUE (presupuesto_id, id),
    -- Reordenar hermanos intercambia códigos; sin DEFERRABLE, el intercambio
    -- en una sola sentencia choca contra la llave.
    CONSTRAINT wbs_nodo_presupuesto_id_codigo_wbs_key
        UNIQUE (presupuesto_id, codigo_wbs) DEFERRABLE INITIALLY IMMEDIATE,
    FOREIGN KEY (tenant_id, presupuesto_id)
        REFERENCES app.presupuesto(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, padre_id)
        REFERENCES app.wbs_nodo(tenant_id, id) ON DELETE CASCADE,
    -- El padre tiene que ser del mismo presupuesto: la llave por inquilino no
    -- basta.
    CONSTRAINT fk_wbs_padre_mismo_presupuesto
        FOREIGN KEY (presupuesto_id, padre_id)
        REFERENCES app.wbs_nodo (presupuesto_id, id) ON DELETE CASCADE,
    -- Un nodo no puede colgarse de sí mismo. El recorrido recursivo del
    -- recálculo parte de las raíces, así que una rama que se autoreferencia
    -- queda desconectada y sus actividades DESAPARECEN del costo directo sin
    -- error ni aviso: sobre el presupuesto de referencia, un solo UPDATE
    -- llevaría el valor total de 179.588.000 a 103.178.000 y la oferta saldría
    -- más barata de lo que el ingeniero cree.
    CONSTRAINT ck_wbs_no_autopadre CHECK (padre_id IS DISTINCT FROM id),
    CONSTRAINT ck_wbs_monto_no_negativo CHECK (monto_acumulado >= 0),
    -- Restricciones nombradas (antes anónimas → «wbs_nodo_check1»): así la
    -- pantalla puede mostrar el texto que RNF-15 y 02 §2 prometen. Los mensajes
    -- legibles los da el trigger tg_wbs_clasificacion (sección 8).
    CONSTRAINT ck_wbs_raiz_es_nivel1     CHECK ((padre_id IS NULL) = (nivel = 1)),
    CONSTRAINT ck_wbs_clasif_solo_raiz   CHECK ((clasificacion IS NOT NULL) = (nivel = 1))
);
CREATE INDEX ix_wbs_padre ON app.wbs_nodo (presupuesto_id, padre_id, orden);

CREATE TABLE app.presupuesto_item (
    id                  uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id           uuid        NOT NULL,
    presupuesto_id      uuid        NOT NULL,
    wbs_nodo_id         uuid        NOT NULL,
    orden               integer     NOT NULL,
    apu_id              uuid        NOT NULL,
    -- Ancla inmutable: de aquí sale la composición exacta que usó este ítem.
    apu_version_id      uuid        NOT NULL,
    -- D-42 · Número de la actividad dentro del presupuesto: «1.1» si cuelga
    -- del capítulo 1.0, «1.1.1» si cuelga del subcapítulo 1.1. Comparte
    -- contador con los subcapítulos hermanos, así que nunca choca con ellos.
    -- Es lo que el cliente lee en la oferta —«el ítem 2.3»— y no reemplaza al
    -- código del APU (RF-PRE-16), que dice de qué análisis salió el precio y
    -- se repite si la misma actividad aparece en dos capítulos.
    -- Lo escribe app.fn_renumerar_wbs, no la aplicación.
    codigo_item         text,
    -- Snapshots: garantizan RNF-10 sin depender de bloqueos aplicativos.
    codigo_apu          text        NOT NULL,              -- RF-PRE-16
    descripcion         text        NOT NULL,
    unidad_simbolo      text        NOT NULL,
    precio_unitario     app.dinero  NOT NULL CHECK (precio_unitario >= 0),  -- RF-PRE-18
    cantidad            app.cantidad NOT NULL,
    costo_total         app.dinero  NOT NULL,
    UNIQUE (tenant_id, id),
    -- DEFERRABLE: reordenar hermanos intercambia valores de orden y no cabe
    -- en una sola sentencia si la unicidad se evalúa fila a fila.
    CONSTRAINT presupuesto_item_wbs_nodo_id_orden_key
        UNIQUE (wbs_nodo_id, orden) DEFERRABLE INITIALLY IMMEDIATE,
    -- Mismo motivo que en la EDT: renumerar intercambia códigos dentro de una
    -- sola sentencia. Los nulos no chocan entre sí, así que una actividad
    -- recién insertada puede esperar a la renumeración.
    CONSTRAINT presupuesto_item_presupuesto_id_codigo_item_key
        UNIQUE (presupuesto_id, codigo_item) DEFERRABLE INITIALLY IMMEDIATE,
    FOREIGN KEY (tenant_id, presupuesto_id)
        REFERENCES app.presupuesto(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, wbs_nodo_id)
        REFERENCES app.wbs_nodo(tenant_id, id) ON DELETE CASCADE,
    -- El ítem y su nodo de EDT tienen que ser del mismo presupuesto. Sin esta
    -- llave, mover una actividad de un presupuesto ACTIVO a uno ABIERTO haría
    -- perder 76.410.000 de la línea base del primero sin un solo error, y el
    -- ítem quedaría colgado de una estructura ajena.
    CONSTRAINT fk_item_wbs_mismo_presupuesto
        FOREIGN KEY (presupuesto_id, wbs_nodo_id)
        REFERENCES app.wbs_nodo (presupuesto_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, apu_id)
        REFERENCES app.apu(tenant_id, id) ON DELETE RESTRICT,          -- RN-10
    FOREIGN KEY (tenant_id, apu_version_id)
        REFERENCES app.apu_version(tenant_id, id) ON DELETE RESTRICT,
    -- El par apu_id / apu_version_id va atado: sin esto un ítem podría llevar
    -- el código de un APU y el precio de otro.
    CONSTRAINT fk_item_version_es_de_su_apu
        FOREIGN KEY (apu_id, apu_version_id) REFERENCES app.apu_version (apu_id, id),
    -- El costo total de la actividad cuadra con sus dos factores.
    CONSTRAINT ck_item_costo_total_cuadra
        CHECK (costo_total = round(cantidad * precio_unitario, 6))
);
CREATE INDEX ix_item_presupuesto ON app.presupuesto_item (presupuesto_id);
CREATE INDEX ix_item_apu_version ON app.presupuesto_item (tenant_id, apu_version_id); -- RF-APU-13

-- Fotografía completa del presupuesto. INMUTABLE (RF-VER-04, RNF-09).
CREATE TABLE app.presupuesto_version (
    id              uuid        PRIMARY KEY DEFAULT app.uuid_v7(),
    tenant_id       uuid        NOT NULL,
    presupuesto_id  uuid        NOT NULL,
    numero          integer     NOT NULL CHECK (numero > 0),
    tipo            text        NOT NULL CHECK (tipo IN ('AUTOMATICA','MANUAL')),
    disparador      text        CHECK (disparador IN
                                ('ABIERTO_A_ACTIVO','ACTIVO_A_CERRADO',
                                 'ACTIVO_A_ABIERTO','MANUAL')),   -- RF-VER-08
    motivo          text,                              -- obligatorio si MANUAL, RF-VER-03
    snapshot        jsonb       NOT NULL,              -- estructura fija en D-28
    valor_total     app.dinero  NOT NULL,
    creada_por      uuid,
    creada_en       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (presupuesto_id, numero),
    -- D-18 · Eliminar un presupuesto que nunca se activó se lleva sus versiones.
    -- Antes era RESTRICT, y eso hacía imposible el borrado que RF-SAD-13 y D-18
    -- prometen.
    FOREIGN KEY (tenant_id, presupuesto_id)
        REFERENCES app.presupuesto(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, creada_por) REFERENCES app.usuario(tenant_id, id),
    CHECK (tipo <> 'MANUAL' OR motivo IS NOT NULL),
    -- Una versión manual no puede llevar el disparador de una transición: sin
    -- esto se podía guardar a mano una versión con disparador ABIERTO_A_ACTIVO,
    -- que es como la interfaz reconoce la línea base contractual.
    CONSTRAINT ck_version_manual_disparador
        CHECK ((tipo = 'MANUAL') = (disparador = 'MANUAL'))
);
COMMENT ON COLUMN app.presupuesto_version.snapshot IS
  'Copia autosuficiente: exportar una versión (RF-VER-07) no debe requerir '
  'consultar ninguna otra tabla. La estructura está fijada en D-28, con un '
  'número de «schema» para poder evolucionarla. Dos reglas que no son obvias: '
  'se guarda el NOMBRE del usuario además de su identificador, y la razón '
  'social y el NIT de la empresa, porque reimprimir una oferta de hace dos años '
  'debe mostrar los datos de entonces; y todos los valores monetarios van como '
  'cadena, no como número JSON, porque un numeric(24,6) no cabe sin pérdida en '
  'el punto flotante de JavaScript.';


-- =============================================================================
--  6. TRAZABILIDAD                                                   (RF-HIS)
-- =============================================================================

-- El catálogo de tipos de evento es una TABLA, no texto libre ni un CHECK: con
-- texto libre se aceptaría un tipo inventado, y tabla en vez de CHECK por la
-- misma razón que plataforma.moneda: cuando la fase 2 traiga órdenes de compra
-- y vales de salida, dar de alta un tipo nuevo será un INSERT y no un ALTER.
CREATE TABLE app.tipo_evento (
    codigo               text     PRIMARY KEY,
    descripcion          text     NOT NULL,
    exige_justificacion  boolean  NOT NULL DEFAULT false,
    fase                 smallint NOT NULL DEFAULT 1
);
COMMENT ON TABLE app.tipo_evento IS
  'Catálogo de RF-HIS-03. Global, sin tenant_id.';

-- Historial de cambios. INMUTABLE (RF-HIS-01..05, RN-09, RNF-09, RNF-19).
CREATE TABLE app.evento_auditoria (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       uuid        NOT NULL,
    presupuesto_id  uuid,                          -- NULL en eventos no ligados a proyecto
    entidad         text        NOT NULL,          -- 'PRESUPUESTO','ITEM','APU','RECURSO',…
    entidad_id      uuid,
    tipo_evento     text        NOT NULL REFERENCES app.tipo_evento(codigo),
    descripcion     text        NOT NULL,
    valor_anterior  jsonb,
    valor_nuevo     jsonb,
    justificacion   text,                          -- obligatoria al reabrir, RN-03
    usuario_id      uuid,
    ocurrido_en     timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, presupuesto_id)
        REFERENCES app.presupuesto(tenant_id, id) ON DELETE CASCADE,   -- D-18
    FOREIGN KEY (tenant_id, usuario_id)
        REFERENCES app.usuario(tenant_id, id)
);
COMMENT ON TABLE app.evento_auditoria IS
  'Genérica por diseño: entidad + entidad_id absorben las transacciones de la '
  'fase 2 (órdenes de compra, vales de salida, otrosíes) sin migración.';
COMMENT ON COLUMN app.evento_auditoria.tipo_evento IS
  'Llave foránea contra app.tipo_evento, no texto libre. '
  'DECIDIDO (D-4, 12-sep-2026): ORDEN_DE_CAMBIO queda reservado para la fase 2; '
  'en el MVP no hay módulo que lo genere. La modificación de un proyecto activo '
  'se registra como REAPERTURA + los eventos de edición correspondientes.';
-- Filtros de RF-HIS-04
CREATE INDEX ix_evento_proyecto ON app.evento_auditoria (tenant_id, presupuesto_id, ocurrido_en DESC);
CREATE INDEX ix_evento_tipo     ON app.evento_auditoria (tenant_id, tipo_evento, ocurrido_en DESC);
CREATE INDEX ix_evento_usuario  ON app.evento_auditoria (tenant_id, usuario_id, ocurrido_en DESC);


-- =============================================================================
--  7. INMUTABILIDAD                                    (RN-04, RN-09, RNF-09)
-- =============================================================================

-- Las tablas de solo inserción admiten DELETE en exactamente dos situaciones,
-- las dos deliberadas y las dos marcadas con una variable de transacción:
--   (a) la purga de un inquilino que el superadministrador decidió eliminar
--       (RF-SAD-13, ver app.fn_eliminar_tenant);
--   (b) la cascada de un presupuesto que nunca se activó y ya desapareció
--       (D-18).
-- Sin (a), eliminar los datos de una prueba no convertida sería imposible: las
-- llaves RESTRICT y estos triggers lo rechazarían, y el único camino sería un
-- superusuario deshabilitando triggers, que es lo contrario de «una acción
-- manual del superadministrador desde su panel» (RF-SAD-13).

-- -----------------------------------------------------------------------------
--  D-37 · Las banderas de transacción no defienden nada por sí solas.
--
--  app.purga_tenant, app.recalculo_en_curso y
--  app.motivo_reapertura son variables de sesión, y CUALQUIER conexión puede
--  fijarlas: basta un SELECT set_config(...). Mientras los guardianes miraran
--  solo el valor de la bandera, el rol de la aplicación podía ponerla y
--  atravesar el congelamiento de la línea base, borrar un presupuesto ya
--  activado (D-18) o dejar a una empresa sin administrador (D-29). Comprobado
--  contra base real: con la bandera puesta, un UPDATE cambió cantidades de un
--  presupuesto ACTIVO y el total guardado quedó en la cifra anterior.
--
--  La bandera dice QUÉ operación está en curso; esta función comprueba QUIÉN la
--  puso. Solo vale dentro de una función interna —las SECURITY DEFINER cuyo
--  dueño es construsoft_owner o construsoft_super— o de la carga inicial, que
--  corre como superusuario. El rol de la aplicación nunca la satisface.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_bandera_interna(
    p_bandera text, p_valor text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_actual text;
BEGIN
    v_actual := NULLIF(current_setting(p_bandera, true), '');
    IF v_actual IS NULL THEN
        RETURN false;
    END IF;
    IF p_valor IS NOT NULL AND v_actual <> p_valor THEN
        RETURN false;
    END IF;
    -- current_user dentro de una SECURITY DEFINER es su DUEÑO, no quien llama:
    -- eso es exactamente lo que distingue a la función interna del rol de la
    -- aplicación que intenta imitarla.
    RETURN current_user IN ('construsoft_owner', 'construsoft_super')
        OR COALESCE((SELECT r.rolsuper FROM pg_roles r
                      WHERE r.rolname = current_user), false);
END $$;
COMMENT ON FUNCTION app.fn_bandera_interna(text, text) IS
  'D-37. Una bandera de transacción solo vale si la puso una función interna. '
  'Sin esta comprobación, el rol de la aplicación podía saltarse el '
  'congelamiento de la línea base fijando la variable él mismo.';

CREATE OR REPLACE FUNCTION app.fn_solo_insercion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF app.fn_bandera_interna('app.purga_tenant', OLD.tenant_id::text) THEN
            RETURN OLD;
        END IF;
        IF to_jsonb(OLD) ? 'presupuesto_id'
           AND to_jsonb(OLD)->>'presupuesto_id' IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM app.presupuesto p
                            WHERE p.id = (to_jsonb(OLD)->>'presupuesto_id')::uuid)
        THEN
            RETURN OLD;
        END IF;
    END IF;
    RAISE EXCEPTION
      'La tabla %.% es de solo inserción (RN-09 / RNF-09): % no está permitido.',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['apu_version','apu_version_recurso',
                             'presupuesto_version','evento_auditoria']
    LOOP
        EXECUTE format(
            'CREATE TRIGGER tg_inmutable_%1$s BEFORE UPDATE OR DELETE ON app.%1$I '
            'FOR EACH ROW EXECUTE FUNCTION app.fn_solo_insercion()', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
--  Las columnas «inmodificables» de RN-02, RF-REC-11, RF-APU-11 y RF-PRE-06 se
--  defienden aquí. Sin estos guardianes serían prosa: cualquier UPDATE sobre
--  recurso.codigo o sobre presupuesto.fecha_elaboracion las cambiaría.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_columnas_inmutables() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_col text; v_ant text; v_nue text;
BEGIN
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        v_ant := to_jsonb(OLD) ->> v_col;
        v_nue := to_jsonb(NEW) ->> v_col;
        IF v_ant IS DISTINCT FROM v_nue THEN
            RAISE EXCEPTION
              'La columna «%» de %.% no se puede modificar después de creada '
              '(RN-02, RF-REC-11, RF-APU-11, RF-PRE-06). Valor actual: %.',
              v_col, TG_TABLE_SCHEMA, TG_TABLE_NAME, v_ant;
        END IF;
    END LOOP;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_recurso_inmutable BEFORE UPDATE ON app.recurso
    FOR EACH ROW EXECUTE FUNCTION app.fn_columnas_inmutables('codigo','tenant_id','creado_en');
CREATE TRIGGER tg_apu_inmutable BEFORE UPDATE ON app.apu
    FOR EACH ROW EXECUTE FUNCTION app.fn_columnas_inmutables('codigo','tenant_id','creado_en');
CREATE TRIGGER tg_presupuesto_inmutable BEFORE UPDATE ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_columnas_inmutables('fecha_elaboracion');
CREATE TRIGGER tg_usuario_inmutable BEFORE UPDATE ON app.usuario
    FOR EACH ROW EXECUTE FUNCTION app.fn_columnas_inmutables('tenant_id','creado_en');
CREATE TRIGGER tg_rol_inmutable BEFORE UPDATE ON app.rol
    FOR EACH ROW EXECUTE FUNCTION app.fn_columnas_inmutables('tenant_id','creado_en');

-- -----------------------------------------------------------------------------
--  D-21 · Una versión de APU tiene líneas y cuadra con su costo directo.
--
--  El esquema obliga a insertar la cabecera ANTES que las líneas, porque
--  costo_directo no tiene DEFAULT y la tabla no admite UPDATE. En el momento
--  del INSERT de la cabecera todavía no hay líneas que contar, así que ningún
--  CHECK ni ningún trigger normal puede validarlo. La solución es un
--  CONSTRAINT TRIGGER diferido, que PostgreSQL evalúa al hacer COMMIT, cuando
--  la transacción ya insertó las dos cosas. No hay que cambiar el orden de
--  inserción ni la lógica del backend.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_version_apu_cuadra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_n integer; v_suma app.dinero;
BEGIN
    -- La versión pudo eliminarse en la misma transacción (fn_eliminar_apu sobre
    -- un APU recién creado): no hay nada que cuadrar.
    IF NOT EXISTS (SELECT 1 FROM app.apu_version WHERE id = NEW.id) THEN
        RETURN NULL;
    END IF;
    SELECT count(*), COALESCE(sum(subtotal), 0) INTO v_n, v_suma
      FROM app.apu_version_recurso WHERE apu_version_id = NEW.id;
    IF v_n = 0 THEN
        RAISE EXCEPTION
          'Un APU no se puede guardar sin recursos: la versión % de «%» no tiene '
          'ninguna línea (D-21).', NEW.numero, NEW.nombre;
    END IF;
    IF round(v_suma, 6) <> round(NEW.costo_directo, 6) THEN
        RAISE EXCEPTION
          'El costo directo de la versión (%) no coincide con la suma de sus '
          'líneas (%). El backend debe calcularlo antes de insertar la cabecera '
          '(D-21, RNF-06).', NEW.costo_directo, v_suma;
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tg_version_apu_cuadra
    AFTER INSERT ON app.apu_version
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_version_apu_cuadra();

-- -----------------------------------------------------------------------------
--  D-21 · Y un APU tampoco existe sin versión vigente.
--
--  La decisión decía «la versión vigente de un APU nunca queda nula después de
--  crearlo», pero nada lo comprobaba: una cabecera se podía confirmar sola y
--  quedaba un APU en el catálogo sin composición y sin costo, que la vista
--  maestra muestra vacío y que ningún presupuesto puede usar.
--
--  Diferido, porque la cabecera se inserta antes que su primera versión.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_apu_con_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Pudo eliminarse en la misma transacción (fn_eliminar_apu).
    IF NOT EXISTS (SELECT 1 FROM app.apu WHERE id = NEW.id) THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.apu
                    WHERE id = NEW.id AND version_vigente_id IS NOT NULL) THEN
        RAISE EXCEPTION
          'El APU «%» se guardó sin ninguna versión. Un APU no existe sin al '
          'menos una composición vigente (D-21, RF-APU-22).', NEW.nombre;
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tg_apu_con_version
    AFTER INSERT ON app.apu
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_apu_con_version();

-- -----------------------------------------------------------------------------
--  RF-PRE-16/18 · La actividad es fiel a la versión de APU que ancla.
--
--  El ítem guarda copia congelada del código, la unidad y el precio unitario de
--  su versión de APU (RNF-10). La base comprobaba que costo_total = cantidad ×
--  precio, pero no de dónde salía ese precio: aceptaba una actividad con precio
--  1 sobre un APU de 636.750 y el presupuesto entero salía mal sin que nada
--  fallara, porque el ítem cuadraba consigo mismo.
--
--  El precio unitario de una actividad es lo que se firma; la versión del APU es
--  la única prueba de cómo se formó. Que coincidan no es integridad referencial,
--  es la promesa del producto.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_item_fiel_a_su_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_costo app.dinero; v_simbolo text; v_codigo text;
BEGIN
    SELECT v.costo_directo, v.unidad_simbolo INTO v_costo, v_simbolo
      FROM app.apu_version v WHERE v.id = NEW.apu_version_id;
    SELECT a.codigo INTO v_codigo FROM app.apu a WHERE a.id = NEW.apu_id;

    IF NEW.precio_unitario <> v_costo THEN
        RAISE EXCEPTION
          'El precio unitario de «%» es % y el de la versión de APU que usa es '
          '%. El precio de una actividad lo pone el APU, no la mesa de trabajo '
          '(RF-PRE-18, RNF-06).', NEW.descripcion, NEW.precio_unitario, v_costo;
    END IF;
    IF NEW.codigo_apu IS DISTINCT FROM v_codigo THEN
        RAISE EXCEPTION
          'El código de la actividad tiene que ser el del APU que usa (%), no '
          '«%» (RF-PRE-16).', v_codigo, NEW.codigo_apu;
    END IF;
    IF NEW.unidad_simbolo IS DISTINCT FROM v_simbolo THEN
        RAISE EXCEPTION
          'La unidad de la actividad tiene que ser la de su versión de APU (%), '
          'no «%».', v_simbolo, NEW.unidad_simbolo;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_item_fiel_a_su_version
    BEFORE INSERT OR UPDATE OF apu_id, apu_version_id, codigo_apu,
                               unidad_simbolo, precio_unitario
    ON app.presupuesto_item
    FOR EACH ROW EXECUTE FUNCTION app.fn_item_fiel_a_su_version();

-- -----------------------------------------------------------------------------
--  La justificación de la reapertura es obligatoria en la base, no solo en el
--  backend: sin esto se aceptaría una REAPERTURA sin justificar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_evento_justificado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_exige boolean;
BEGIN
    SELECT exige_justificacion INTO v_exige
      FROM app.tipo_evento WHERE codigo = NEW.tipo_evento;
    IF v_exige AND (NEW.justificacion IS NULL OR btrim(NEW.justificacion) = '') THEN
        RAISE EXCEPTION
          'El evento «%» exige una justificación escrita (RN-03, RF-PRE-28, '
          'RF-VER-08).', NEW.tipo_evento;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_evento_justificado BEFORE INSERT ON app.evento_auditoria
    FOR EACH ROW EXECUTE FUNCTION app.fn_evento_justificado();


-- =============================================================================
--  8. CONGELAMIENTO DE LA LÍNEA BASE                          (RN-04, RF-PRE-25)
--
--  Decisión D-5: un proyecto ACTIVO es de solo lectura. La edición de un
--  proyecto activo pertenece al módulo de Control de Proyectos (fase 2). Para
--  modificar la línea base, el Administrador reabre el proyecto con
--  justificación (RF-PRE-28), edita en ABIERTO y vuelve a activar.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  La cabecera del presupuesto también se congela, no solo sus cifras.
--
--  Vigilar únicamente la columna estado dejaría abiertos, en ACTIVO y en
--  CERRADO, los tres porcentajes del AIU, el nombre, la ubicación y el código,
--  y permitiría escribir valor_total a mano: subir la administración de 10 a 30
--  sobre el presupuesto de referencia y recalcular llevaría la línea base de
--  179.588.000 a 200.686.000. La matriz de §15 del documento 01 y RNF-21
--  prometen que la base lo rechaza.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_cabecera_presupuesto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_recalculo boolean;
BEGIN
    v_recalculo := app.fn_bandera_interna('app.recalculo_en_curso', OLD.id::text);

    -- 1) Los totales son territorio exclusivo de fn_recalcular_presupuesto.
    IF NOT v_recalculo
       AND (NEW.total_costo_directo, NEW.total_costo_indirecto,
            NEW.total_aiu, NEW.total_iva, NEW.valor_total)
           IS DISTINCT FROM
           (OLD.total_costo_directo, OLD.total_costo_indirecto,
            OLD.total_aiu, OLD.total_iva, OLD.valor_total)
    THEN
        RAISE EXCEPTION
          'Los totales del presupuesto «%» los calcula el servidor: se escriben '
          'exclusivamente desde app.fn_recalcular_presupuesto (RNF-06, RNF-21). '
          'No se admite escribirlos directamente.', OLD.codigo;
    END IF;

    -- 2) Identidad y condiciones de la oferta: inmutables fuera de ABIERTO.
    IF OLD.estado <> 'ABIERTO'
       AND (NEW.codigo, NEW.nombre, NEW.ubicacion, NEW.moneda, NEW.tipo_proyecto,
            NEW.aiu_administracion, NEW.aiu_imprevistos, NEW.aiu_utilidad,
            NEW.iva_utilidad_pct, NEW.modo_estructura,
            NEW.fecha_elaboracion, NEW.duplicado_de_id, NEW.creado_por)
           IS DISTINCT FROM
           (OLD.codigo, OLD.nombre, OLD.ubicacion, OLD.moneda, OLD.tipo_proyecto,
            OLD.aiu_administracion, OLD.aiu_imprevistos, OLD.aiu_utilidad,
            OLD.iva_utilidad_pct, OLD.modo_estructura,
            OLD.fecha_elaboracion, OLD.duplicado_de_id, OLD.creado_por)
    THEN
        RAISE EXCEPTION
          'El presupuesto «%» está en estado %: su código, nombre, ubicación, '
          'moneda, porcentajes de AIU e IVA forman parte de la línea base y son '
          'de solo lectura (RN-04, RF-PRE-25). Para modificarlos, el '
          'Administrador debe reabrir el proyecto con justificación (RF-PRE-28).',
          OLD.codigo, OLD.estado;
    END IF;

    -- 3) El inquilino no cambia nunca (RN-01).
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'Un presupuesto no cambia de empresa (RN-01).';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER tg_cabecera_presupuesto
    BEFORE UPDATE ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_cabecera_presupuesto();

-- -----------------------------------------------------------------------------
--  Qué se puede escribir en cada estado, para la EDT y las actividades.
--
--  Fuera de ABIERTO no se escribe nada: ni capítulos, ni actividades, ni
--  cantidades. Sin el módulo de control de obra (D-43), un proyecto ACTIVO es
--  de solo lectura completa, y la única forma de tocarlo es reabrirlo con
--  justificación (RF-PRE-28).
--
--  · tenant_id y presupuesto_id están entre las columnas congeladas. Sin
--    ellos, un ítem podría mudarse a otro presupuesto y la línea base perdería
--    el costo sin evento ni error.
--  · La lectura del estado es FOR NO KEY UPDATE, no FOR SHARE: dos sesiones que
--    insertan actividades en el mismo presupuesto abierto tomaban FOR SHARE y
--    luego intentaban subir a FOR UPDATE en el trigger de recálculo, y se
--    bloqueaban mutuamente (deadlock 40P01). FOR NO KEY UPDATE serializa a los
--    escritores del mismo presupuesto, que es justo lo que se quiere, sin
--    bloquear lecturas por llave foránea. Sin ese bloqueo, además, un ítem
--    insertado mientras otra sesión activa el proyecto vería ABIERTO, entraría,
--    y la línea base recién congelada no lo contendría.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_linea_base_editable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_pid uuid;
BEGIN
    v_pid := COALESCE(NEW.presupuesto_id, OLD.presupuesto_id);

    IF app.fn_bandera_interna('app.purga_tenant',
                              COALESCE(NEW.tenant_id, OLD.tenant_id)::text) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT estado INTO v_estado
      FROM app.presupuesto WHERE id = v_pid FOR NO KEY UPDATE;

    -- El proyecto ya no existe: es el borrado en cascada del propio presupuesto.
    IF v_estado IS NULL OR v_estado = 'ABIERTO' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    RAISE EXCEPTION
      'El presupuesto está en estado %: la línea base es de solo lectura '
      '(RN-04, RF-PRE-25). Para modificarla, el Administrador debe reabrir el '
      'proyecto con justificación (RF-PRE-28).', v_estado;
END $$;

CREATE TRIGGER tg_linea_base_item BEFORE INSERT OR UPDATE OR DELETE
    ON app.presupuesto_item
    FOR EACH ROW EXECUTE FUNCTION app.fn_linea_base_editable();

CREATE TRIGGER tg_linea_base_wbs BEFORE INSERT OR UPDATE OR DELETE
    ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_linea_base_editable();


-- -----------------------------------------------------------------------------
--  Las versiones automaticas de las tres transiciones, y la justificacion de la
--  reapertura, las escribe la base.
--
--  RF-VER-01, RF-VER-02 y RF-VER-08 prometen una version guardada al activar,
--  al cerrar y al reabrir; RF-PRE-28 y RN-03 prometen que la reapertura deja
--  justificacion escrita en el historial; y RNF-21 dice que las reglas de
--  estado se hacen cumplir aqui, no en el backend. Sin esto, un UPDATE directo
--  sobre presupuesto.estado reabria el proyecto sin archivar la linea base y
--  sin dejar rastro: las tres promesas eran del backend, no de la base.
--
--  El motivo viaja en una variable local de la transaccion, el mismo patron que
--  app.purga_tenant usa para distinguir un DELETE deliberado. Ponerlo ahi y no
--  en la fila es lo que permite exigirlo desde un trigger, que no recibe
--  parametros.
--
--  Quien escribe la version y el evento se lee de app.usuario_id. Esa variable
--  se decidio para el control por proyecto de la fase 2; aqui gana su primer
--  uso real, y por eso la aplicacion tiene que fijarla siempre.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_usuario_actual() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.usuario_id', true), '')::uuid;
$$;
COMMENT ON FUNCTION app.fn_usuario_actual() IS
  'Usuario de la transaccion. La fija la aplicacion junto a app.tenant_id. '
  'La leen las versiones automaticas y los eventos de auditoria.';

-- -----------------------------------------------------------------------------
--  D-45 · El historial lo escribe la base, y solo la base.
--
--  RF-HIS-03 promete que quedan registrados el ítem agregado o eliminado, la
--  cantidad, el precio, el capítulo y el AIU. Hasta la auditoría del 24 de
--  septiembre de 2026 esos eventos dependían de que el backend se acordara de
--  insertarlos: crear un capítulo, agregar una actividad, cambiar una cantidad y
--  mover el AIU dejaban CERO filas en el historial. Y como la aplicación tenía
--  INSERT libre sobre evento_auditoria, también podía escribir un CAMBIO_ESTADO
--  a nombre de otro usuario. Un historial inalterable pero forjable no sirve el
--  día que se discuta quién cambió una cantidad, que es el único día que
--  importa. Hallazgo 4.
--
--  Ahora los escriben estos triggers, con el autor leído de app.usuario_id y no
--  recibido como parámetro, y la aplicación pierde el INSERT sobre la tabla
--  (§16.5). No queda ninguna puerta por la que el backend pueda escribir un
--  evento: los diez tipos que el MVP genera salen de aquí.
--
--  Dos exclusiones, las dos con bandera interna de D-37 —que solo obedece a las
--  funciones internas, nunca al rol de la aplicación—:
--    · la purga de un inquilino (RF-SAD-13), que borra todo y no es historia;
--    · la duplicación (D-19), donde escribir dos mil ITEM_AGREGADO por una copia
--      convierte el panel en ruido. La copia deja su PRESUPUESTO_DUPLICADO, que
--      es el hecho que ocurrió.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_evento_interno(
    p_tenant uuid, p_presupuesto uuid, p_entidad text, p_entidad_id uuid,
    p_tipo text, p_descripcion text,
    p_anterior jsonb DEFAULT NULL, p_nuevo jsonb DEFAULT NULL,
    p_justificacion text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
BEGIN
    -- La aplicación necesita EXECUTE porque los triggers de historia corren con
    -- SU rol —tienen que correr con el suyo, o las banderas internas de D-37
    -- dejarían de distinguirla—, así que la puerta se cierra por otro lado:
    -- pg_trigger_depth() vale cero cuando alguien llama a esta función desde
    -- fuera, y solo un trigger de este esquema la alcanza desde dentro.
    IF pg_trigger_depth() = 0 THEN
        RAISE EXCEPTION
          'El historial no se escribe a mano: lo escriben los triggers de este '
          'esquema (D-45). Haga la operación y el evento sale solo.';
    END IF;
    INSERT INTO app.evento_auditoria
        (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
         descripcion, valor_anterior, valor_nuevo, justificacion, usuario_id)
    VALUES (p_tenant, p_presupuesto, p_entidad, p_entidad_id, p_tipo,
            p_descripcion, p_anterior, p_nuevo, p_justificacion,
            app.fn_usuario_actual());
END $$;
COMMENT ON FUNCTION app.fn_evento_interno IS
  'Única puerta de escritura del historial (D-45). No recibe el autor: lo lee de '
  'app.usuario_id, así que nadie puede firmar un evento a nombre de otro. La '
  'llaman los triggers de este esquema; el rol de la aplicación no la ejecuta.';

CREATE OR REPLACE FUNCTION app.fn_historia_silenciada() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT app.fn_bandera_interna('app.purga_tenant')
        OR app.fn_bandera_interna('app.duplicando');
$$;

--  Actividades: agregada, eliminada, y los dos cambios que mueven el valor.
CREATE OR REPLACE FUNCTION app.fn_historia_item() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF app.fn_historia_silenciada() THEN RETURN NULL; END IF;

    IF TG_OP = 'INSERT' THEN
        PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.presupuesto_id, 'ITEM',
            NEW.id, 'ITEM_AGREGADO',
            format('Actividad «%s» agregada: %s %s a %s',
                   NEW.descripcion, NEW.cantidad, NEW.unidad_simbolo,
                   NEW.precio_unitario),
            NULL, to_jsonb(NEW));
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- Si el presupuesto entero se está borrando (D-18), sus eventos se van
        -- con él por la llave foránea: escribir uno aquí chocaría contra ella.
        IF NOT EXISTS (SELECT 1 FROM app.presupuesto WHERE id = OLD.presupuesto_id) THEN
            RETURN NULL;
        END IF;
        PERFORM app.fn_evento_interno(OLD.tenant_id, OLD.presupuesto_id, 'ITEM',
            OLD.id, 'ITEM_ELIMINADO',
            format('Actividad «%s» eliminada', OLD.descripcion),
            to_jsonb(OLD), NULL);
        RETURN NULL;
    END IF;

    IF NEW.cantidad IS DISTINCT FROM OLD.cantidad THEN
        PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.presupuesto_id, 'ITEM',
            NEW.id, 'CANTIDAD_MODIFICADA',
            format('Cantidad de «%s»: %s → %s %s',
                   NEW.descripcion, OLD.cantidad, NEW.cantidad, NEW.unidad_simbolo),
            jsonb_build_object('cantidad', OLD.cantidad::text),
            jsonb_build_object('cantidad', NEW.cantidad::text));
    END IF;
    IF NEW.precio_unitario IS DISTINCT FROM OLD.precio_unitario THEN
        PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.presupuesto_id, 'ITEM',
            NEW.id, 'PRECIO_MODIFICADO',
            format('Precio unitario de «%s»: %s → %s',
                   NEW.descripcion, OLD.precio_unitario, NEW.precio_unitario),
            jsonb_build_object('precio_unitario', OLD.precio_unitario::text,
                               'apu_version_id', OLD.apu_version_id),
            jsonb_build_object('precio_unitario', NEW.precio_unitario::text,
                               'apu_version_id', NEW.apu_version_id));
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_historia_item_ins AFTER INSERT ON app.presupuesto_item
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_item();
CREATE TRIGGER tg_historia_item_del AFTER DELETE ON app.presupuesto_item
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_item();
-- Por columnas, para que la renumeración (codigo_item, orden) y el recálculo no
-- ensucien el historial con cambios que el usuario no hizo.
CREATE TRIGGER tg_historia_item_upd
    AFTER UPDATE OF cantidad, precio_unitario ON app.presupuesto_item
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_item();

--  Capítulos y subcapítulos.
CREATE OR REPLACE FUNCTION app.fn_historia_capitulo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF app.fn_historia_silenciada() THEN RETURN NULL; END IF;

    IF TG_OP = 'INSERT' THEN
        PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.presupuesto_id,
            'CAPITULO', NEW.id, 'CAPITULO_AGREGADO',
            format('Capítulo «%s» agregado en el nivel %s', NEW.nombre, NEW.nivel),
            NULL, to_jsonb(NEW));
    ELSE
        IF NOT EXISTS (SELECT 1 FROM app.presupuesto WHERE id = OLD.presupuesto_id) THEN
            RETURN NULL;
        END IF;
        PERFORM app.fn_evento_interno(OLD.tenant_id, OLD.presupuesto_id,
            'CAPITULO', OLD.id, 'CAPITULO_ELIMINADO',
            format('Capítulo «%s» eliminado', OLD.nombre), to_jsonb(OLD), NULL);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_historia_capitulo_ins AFTER INSERT ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_capitulo();
CREATE TRIGGER tg_historia_capitulo_del AFTER DELETE ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_capitulo();

--  Cabecera del presupuesto: AIU, IVA, archivado y eliminación.
CREATE OR REPLACE FUNCTION app.fn_historia_presupuesto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_ant jsonb; v_nue jsonb;
BEGIN
    IF app.fn_historia_silenciada() THEN RETURN NULL; END IF;

    IF TG_OP = 'DELETE' THEN
        -- presupuesto_id va en NULO a propósito: con el id puesto, la llave
        -- foránea se llevaría por delante el evento que dice que el proyecto se
        -- borró, que es justo el que hay que conservar (D-18).
        PERFORM app.fn_evento_interno(OLD.tenant_id, NULL, 'PRESUPUESTO',
            OLD.id, 'PRESUPUESTO_ELIMINADO',
            format('Presupuesto «%s» (%s) eliminado', OLD.nombre, OLD.codigo),
            to_jsonb(OLD), NULL);
        RETURN NULL;
    END IF;

    IF (NEW.aiu_administracion, NEW.aiu_imprevistos, NEW.aiu_utilidad,
        NEW.iva_utilidad_pct)
       IS DISTINCT FROM
       (OLD.aiu_administracion, OLD.aiu_imprevistos, OLD.aiu_utilidad,
        OLD.iva_utilidad_pct) THEN
        v_ant := jsonb_build_object('a', OLD.aiu_administracion::text,
                                    'i', OLD.aiu_imprevistos::text,
                                    'u', OLD.aiu_utilidad::text,
                                    'iva', OLD.iva_utilidad_pct::text);
        v_nue := jsonb_build_object('a', NEW.aiu_administracion::text,
                                    'i', NEW.aiu_imprevistos::text,
                                    'u', NEW.aiu_utilidad::text,
                                    'iva', NEW.iva_utilidad_pct::text);
        PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.id, 'PRESUPUESTO',
            NEW.id, 'AIU_MODIFICADO',
            format('AIU %s/%s/%s e IVA %s%% sobre la utilidad',
                   NEW.aiu_administracion, NEW.aiu_imprevistos,
                   NEW.aiu_utilidad, NEW.iva_utilidad_pct),
            v_ant, v_nue);
    END IF;

    IF NEW.archivado_en IS DISTINCT FROM OLD.archivado_en THEN
        PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.id, 'PRESUPUESTO',
            NEW.id,
            CASE WHEN NEW.archivado_en IS NULL THEN 'PRESUPUESTO_DESARCHIVADO'
                 ELSE 'PRESUPUESTO_ARCHIVADO' END,
            CASE WHEN NEW.archivado_en IS NULL
                 THEN format('Presupuesto «%s» desarchivado', NEW.codigo)
                 ELSE format('Presupuesto «%s» archivado', NEW.codigo) END,
            NULL, NULL);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_historia_presupuesto_upd
    AFTER UPDATE OF aiu_administracion, aiu_imprevistos, aiu_utilidad,
                    iva_utilidad_pct, archivado_en ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_presupuesto();
CREATE TRIGGER tg_historia_presupuesto_del AFTER DELETE ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_presupuesto();

--  Precio de un recurso: es el evento que explica por qué un APU cambió de
--  versión, y el único del MVP que no cuelga de un proyecto.
CREATE OR REPLACE FUNCTION app.fn_historia_recurso() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF app.fn_historia_silenciada() THEN RETURN NULL; END IF;
    IF NEW.precio_base IS NOT DISTINCT FROM OLD.precio_base
       AND NEW.precio_total IS NOT DISTINCT FROM OLD.precio_total THEN
        RETURN NULL;
    END IF;
    PERFORM app.fn_evento_interno(NEW.tenant_id, NULL, 'RECURSO', NEW.id,
        'RECURSO_MODIFICADO',
        format('Precio de «%s»: %s → %s (con IVA: %s → %s)',
               NEW.nombre, OLD.precio_base, NEW.precio_base,
               OLD.precio_total, NEW.precio_total),
        jsonb_build_object('precio_base', OLD.precio_base::text,
                           'precio_total', OLD.precio_total::text),
        jsonb_build_object('precio_base', NEW.precio_base::text,
                           'precio_total', NEW.precio_total::text));
    RETURN NULL;
END $$;

CREATE TRIGGER tg_historia_recurso
    AFTER UPDATE OF precio_base, precio_total ON app.recurso
    FOR EACH ROW EXECUTE FUNCTION app.fn_historia_recurso();

-- La fotografia de D-28. Todo valor monetario va como cadena: un numeric de
-- veinticuatro digitos no cabe sin perdida en el numero de JavaScript, y este
-- es justo el archivo que no puede desviarse un centavo.
CREATE OR REPLACE FUNCTION app.fn_snapshot_presupuesto(
    p_presupuesto_id uuid, p_estado text, p_disparador text, p_motivo text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    -- schema 2 (D-28): la versión 1 no guardaba el id del capítulo ni el del
    -- ítem, solo su código. Bastaba para exportar el PDF de hoy y no bastaba
    -- para nada más: los códigos se renumeran en cada reapertura, así que el
    -- control de obra de la fase 2 no tendría con qué cruzar la línea base
    -- (esta fotografía) contra la ejecución (vales y cortes, anclados en
    -- presupuesto_item.id). Y las versiones son inmutables: las guardadas con el
    -- schema 1 no se pueden corregir nunca. Por eso entra hoy y no cuando haga
    -- falta. Hallazgo 7 de la auditoría del 24 de septiembre de 2026.
    SELECT jsonb_build_object(
      'schema', 2,
      'presupuesto', jsonb_build_object(
          'codigo', p.codigo, 'nombre', p.nombre, 'ubicacion', p.ubicacion,
          'moneda', p.moneda, 'estado', p_estado,
          'tipo_proyecto', p.tipo_proyecto,
          'modo_estructura', p.modo_estructura,              -- D-42
          'aiu', jsonb_build_object('a', p.aiu_administracion::text,
                                    'i', p.aiu_imprevistos::text,
                                    'u', p.aiu_utilidad::text),
          'iva_utilidad_pct', p.iva_utilidad_pct::text,          -- D-33
          'totales', jsonb_build_object(
              'costo_directo',   p.total_costo_directo::text,
              'costo_indirecto', p.total_costo_indirecto::text,
              'aiu',             p.total_aiu::text,
              'iva',             p.total_iva::text,
              'valor_total',     p.valor_total::text),
          'fecha_elaboracion', p.fecha_elaboracion),
      'empresa', (SELECT jsonb_build_object('razon_social', t.razon_social,
                                            'nit', t.nit)
                    FROM plataforma.tenant t WHERE t.id = p.tenant_id),
      'capitulos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'id', w.id,
                   'codigo_wbs', w.codigo_wbs,
                   'padre_codigo', (SELECT w2.codigo_wbs FROM app.wbs_nodo w2
                                     WHERE w2.id = w.padre_id),
                   'nivel', w.nivel, 'nombre', w.nombre,
                   'clasificacion', w.clasificacion,
                   'monto_acumulado', w.monto_acumulado::text,
                   'incidencia_pct', round(w.monto_acumulado * 100
                                     / NULLIF(p.total_costo_directo, 0), 2)::text)
                 -- Ordenar por el código como TEXTO pone el capítulo 10 entre
                 -- el 1 y el 2, y un presupuesto con diez capítulos o con
                 -- subcapítulos 1.1 a 1.12 es lo normal, no el caso raro. El
                 -- exportador lee este arreglo en orden, así que el orden es
                 -- parte de la fotografía: se compara como lista de enteros.
                 ORDER BY string_to_array(w.codigo_wbs, '.')::int[])
            FROM app.wbs_nodo w WHERE w.presupuesto_id = p.id), '[]'::jsonb),
      'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'id', i.id,
                   'wbs_nodo_id', i.wbs_nodo_id,
                   'codigo_item', i.codigo_item,                     -- D-42
                   'codigo_wbs_padre', (SELECT w3.codigo_wbs FROM app.wbs_nodo w3
                                         WHERE w3.id = i.wbs_nodo_id),
                   'codigo_apu', i.codigo_apu, 'descripcion', i.descripcion,
                   'unidad', i.unidad_simbolo,
                   'cantidad', i.cantidad::text,
                   'precio_unitario', i.precio_unitario::text,
                   'costo_total', i.costo_total::text,
                   'apu_version_id', i.apu_version_id)
                 -- Mismo criterio: por el número de la actividad leído como
                 -- lista de enteros, de modo que el 1.10 va después del 1.9.
                 ORDER BY string_to_array(i.codigo_item, '.')::int[], i.orden)
            FROM app.presupuesto_item i WHERE i.presupuesto_id = p.id), '[]'::jsonb),
      'generada', jsonb_build_object(
          'por_usuario_id', app.fn_usuario_actual(),
          'por_usuario_nombre', (SELECT u.nombre FROM app.usuario u
                                  WHERE u.id = app.fn_usuario_actual()),
          'en', now(), 'disparador', p_disparador, 'motivo', p_motivo))
      FROM app.presupuesto p WHERE p.id = p_presupuesto_id;
$$;
COMMENT ON FUNCTION app.fn_snapshot_presupuesto IS
  'Fotografia completa del presupuesto con la estructura fija de D-28. Exportar '
  'una version no debe requerir consultar ninguna otra tabla (RF-VER-04, 07).';

CREATE OR REPLACE FUNCTION app.fn_guardar_version(
    p_presupuesto_id uuid, p_tipo text, p_disparador text,
    p_motivo text, p_estado text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE v_id uuid; v_tenant uuid; v_num integer; v_total app.dinero;
        v_estado_actual text; v_disp text; v_estado text;
BEGIN
    -- Una versión AUTOMATICA solo la escribe la base dentro del trigger de
    -- transición (RF-VER-01/02/08); un llamador no puede forjar una línea base.
    IF p_tipo = 'AUTOMATICA' AND pg_trigger_depth() = 0 THEN
        RAISE EXCEPTION
          'Las versiones automáticas las escribe la base en las transiciones de '
          'estado, no un llamador externo (RF-VER-01/02/08).';
    END IF;

    SELECT p.tenant_id, p.valor_total, p.estado
      INTO v_tenant, v_total, v_estado_actual
      FROM app.presupuesto p WHERE p.id = p_presupuesto_id;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    -- Llamada directa (versión manual, RF-VER-03): la función es BYPASSRLS, así
    -- que comprueba a mano que el presupuesto sea del inquilino en contexto. Las
    -- llamadas internas (transiciones, pg_trigger_depth > 0) ya vienen acotadas.
    IF pg_trigger_depth() = 0 THEN
        PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');
    END IF;

    v_disp   := p_disparador;
    v_estado := p_estado;

    IF p_tipo = 'MANUAL' THEN
        -- Un presupuesto CERRADO no admite versiones manuales (§15 del doc 01).
        IF v_estado_actual = 'CERRADO' THEN
            RAISE EXCEPTION
              'Un presupuesto CERRADO no admite versiones manuales '
              '(§15 del documento 01).';
        END IF;
        IF btrim(COALESCE(p_motivo, '')) = '' THEN
            RAISE EXCEPTION
              'Guardar una versión manual exige escribir el motivo (RF-VER-03).';
        END IF;
        -- El disparador y el estado de la fotografía los pone la base, no el
        -- llamador: antes se aceptaba una versión MANUAL con disparador
        -- ABIERTO_A_ACTIVO y estado ACTIVO, y esa versión se hacía pasar por la
        -- línea base contractual en el historial y en la exportación.
        v_disp   := 'MANUAL';
        v_estado := v_estado_actual;
    END IF;

    SELECT COALESCE(max(numero), 0) + 1 INTO v_num
      FROM app.presupuesto_version WHERE presupuesto_id = p_presupuesto_id;

    INSERT INTO app.presupuesto_version
        (tenant_id, presupuesto_id, numero, tipo, disparador, motivo,
         snapshot, valor_total, creada_por)
    VALUES (v_tenant, p_presupuesto_id, v_num, p_tipo, v_disp, p_motivo,
            app.fn_snapshot_presupuesto(p_presupuesto_id, v_estado,
                                        v_disp, p_motivo),
            v_total, app.fn_usuario_actual())
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION app.fn_guardar_version IS
  'Numera y guarda una version. La usan el trigger de transicion (AUTOMATICA) y '
  'el guardado manual de RF-VER-03 (MANUAL, con motivo obligatorio).';

-- AFTER y no BEFORE: cuando corre, la fila ya cambio de estado y nada se ha
-- editado todavia, de modo que la fotografia es exactamente la linea base que
-- se esta archivando.
CREATE OR REPLACE FUNCTION app.fn_version_por_transicion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_disp text; v_estado text; v_motivo text; v_evento text;
BEGIN
    IF NEW.estado = OLD.estado THEN RETURN NULL; END IF;

    IF (OLD.estado, NEW.estado) = ('ABIERTO','ACTIVO') THEN
        v_disp := 'ABIERTO_A_ACTIVO'; v_estado := 'ACTIVO';
        v_evento := 'CAMBIO_ESTADO';
    ELSIF (OLD.estado, NEW.estado) = ('ACTIVO','CERRADO') THEN
        v_disp := 'ACTIVO_A_CERRADO'; v_estado := 'CERRADO';
        v_evento := 'CAMBIO_ESTADO';
    ELSIF (OLD.estado, NEW.estado) = ('ACTIVO','ABIERTO') THEN
        -- La version archiva la linea base tal como estaba: ACTIVO.
        v_disp := 'ACTIVO_A_ABIERTO'; v_estado := 'ACTIVO';
        v_evento := 'REAPERTURA';
        v_motivo := NULLIF(current_setting('app.motivo_reapertura', true), '');
    ELSE
        RETURN NULL;
    END IF;

    PERFORM app.fn_guardar_version(NEW.id, 'AUTOMATICA', v_disp, v_motivo, v_estado);

    PERFORM app.fn_evento_interno(NEW.tenant_id, NEW.id, 'PRESUPUESTO', NEW.id,
        v_evento, format('Cambio de estado de %s a %s', OLD.estado, NEW.estado),
        jsonb_build_object('estado', OLD.estado),
        jsonb_build_object('estado', NEW.estado), v_motivo);
    RETURN NULL;
END $$;

CREATE TRIGGER tg_version_por_transicion
    AFTER UPDATE OF estado ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_version_por_transicion();


-- -----------------------------------------------------------------------------
--  Ningún ciclo en el árbol de capítulos, y el nivel es el del padre más uno.
--  El CHECK ck_wbs_no_autopadre cubre el caso de un nodo que se cuelga de sí
--  mismo; este trigger cubre los ciclos de dos o más nodos, que el CHECK no
--  puede ver.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_wbs_sin_ciclos() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_actual uuid; v_nivel_padre smallint; v_saltos int := 0;
BEGIN
    IF NEW.padre_id IS NULL THEN
        IF NEW.nivel <> 1 THEN
            RAISE EXCEPTION 'Un capítulo raíz es siempre de nivel 1 (RF-PRE-10).';
        END IF;
        RETURN NEW;
    END IF;

    SELECT nivel INTO v_nivel_padre FROM app.wbs_nodo WHERE id = NEW.padre_id;
    IF v_nivel_padre IS NULL THEN
        RAISE EXCEPTION 'El capítulo padre no existe.';
    END IF;

    -- El ciclo se comprueba ANTES que el nivel: un nodo que se cuelga de sí
    -- mismo también descuadra el nivel, y el mensaje que el ingeniero necesita
    -- leer es el del ciclo, no el del nivel.
    v_actual := NEW.padre_id;
    WHILE v_actual IS NOT NULL LOOP
        IF v_actual = NEW.id THEN
            RAISE EXCEPTION
              'La operación deja un ciclo en la estructura de capítulos: «%» '
              'terminaría colgando de sí mismo. Una rama en ciclo desaparece '
              'del costo directo sin avisar (RF-PRE-10).', NEW.nombre;
        END IF;
        v_saltos := v_saltos + 1;
        IF v_saltos > 100 THEN
            RAISE EXCEPTION 'Estructura de capítulos demasiado profunda o en ciclo.';
        END IF;
        SELECT padre_id INTO v_actual FROM app.wbs_nodo WHERE id = v_actual;
    END LOOP;

    IF NEW.nivel <> v_nivel_padre + 1 THEN
        RAISE EXCEPTION
          'El nivel de «%» debe ser el de su capítulo padre más uno (% en vez '
          'de %) (RF-PRE-11).', NEW.nombre, NEW.nivel, v_nivel_padre + 1;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_wbs_sin_ciclos
    BEFORE INSERT OR UPDATE OF padre_id, nivel ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_wbs_sin_ciclos();

-- Mensajes legibles para las reglas de clasificación (RF-PRE-19/20, D-8, D-16).
-- Las restricciones ck_wbs_* siguen como red de seguridad; este trigger se
-- adelanta con el texto que la pantalla muestra tal cual (RNF-15, 02 §2).
CREATE OR REPLACE FUNCTION app.fn_wbs_clasificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.nivel = 1 AND NEW.clasificacion IS NULL THEN
        RAISE EXCEPTION
          'El capítulo raíz «%» debe clasificarse como DIRECTO o INDIRECTO '
          'antes de guardarlo (RF-PRE-19, D-16).', NEW.nombre;
    END IF;
    IF NEW.nivel > 1 AND NEW.clasificacion IS NOT NULL THEN
        RAISE EXCEPTION
          'La clasificación vive solo en el capítulo raíz; «%» la hereda de su '
          'capítulo de primer nivel, no se fija por separado (RF-PRE-20, D-8).',
          NEW.nombre;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_wbs_clasificacion
    BEFORE INSERT OR UPDATE OF clasificacion, nivel, padre_id ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_wbs_clasificacion();

-- -----------------------------------------------------------------------------
--  D-42 · El modo de estructura decide si hay subcapítulos.
--
--  En modo ITEMS el presupuesto tiene dos niveles —capítulo y actividad— y nada
--  más. En modo WBS la profundidad es libre y las actividades pueden colgar
--  tanto de un subcapítulo como del capítulo directamente.
--
--  Es una restricción del árbol, no un modelo de datos distinto: el mismo
--  esquema sirve para los dos y cambiar de modo no migra un solo dato.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_modo_estructura() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_modo text;
BEGIN
    SELECT modo_estructura INTO v_modo
      FROM app.presupuesto WHERE id = NEW.presupuesto_id;
    IF v_modo = 'ITEMS' AND NEW.nivel > 1 THEN
        RAISE EXCEPTION
          'Este presupuesto se estructura por ítems: los capítulos llevan '
          'actividades, no subcapítulos. Para abrir subcapítulos, cámbielo a '
          'estructura EDT mientras esté Abierto (RF-PRE-44).';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_modo_estructura
    BEFORE INSERT OR UPDATE OF padre_id, nivel ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_modo_estructura();

-- Pasar de EDT a ítems con subcapítulos ya creados dejaría actividades
-- colgando de niveles que ese modo no admite. El mensaje dice cuántos hay.
CREATE OR REPLACE FUNCTION app.fn_cambio_modo_estructura() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_sub integer;
BEGIN
    IF NEW.modo_estructura = 'ITEMS' AND OLD.modo_estructura = 'WBS' THEN
        SELECT count(*) INTO v_sub FROM app.wbs_nodo
         WHERE presupuesto_id = NEW.id AND nivel > 1;
        IF v_sub > 0 THEN
            RAISE EXCEPTION
              'El presupuesto tiene % subcapítulo(s): elimínelos o súbalos a '
              'capítulo antes de cambiarlo a estructura por ítems (RF-PRE-44).',
              v_sub;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_cambio_modo_estructura
    BEFORE UPDATE OF modo_estructura ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_cambio_modo_estructura();

-- -----------------------------------------------------------------------------
--  Transiciones válidas del ciclo de vida            (RN-03, RF-PRE-33, D-20)
--
--  ABIERTO ─▸ ACTIVO ─▸ CERRADO
--     ▲          │
--     └──────────┘   reapertura con justificación (RF-PRE-28)
--
--  CERRADO es terminal (RF-PRE-33): una obra cerrada que deba retomarse se
--  duplica, y el duplicado nace ABIERTO. Una licitación perdida NO se cierra:
--  se archiva (D-18, columna archivado_en).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_transicion_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_items integer;
BEGIN
    IF NEW.estado = OLD.estado THEN
        RETURN NEW;
    END IF;

    IF (OLD.estado, NEW.estado) NOT IN (
        ('ABIERTO','ACTIVO'),      -- aprobar y activar         RF-PRE-24
        ('ACTIVO','CERRADO'),      -- cerrar el proyecto        RF-PRE-26
        ('ACTIVO','ABIERTO')       -- reabrir con justificación RF-PRE-28
    ) THEN
        RAISE EXCEPTION
          'Transición de estado no permitida: % → %. El ciclo válido es '
          'ABIERTO → ACTIVO → CERRADO, con reapertura de ACTIVO a ABIERTO '
          '(RN-03, RF-PRE-33). Para retirar de la vista un presupuesto que no '
          'llegó a obra, archívelo (D-18).', OLD.estado, NEW.estado;
    END IF;

    IF (OLD.estado, NEW.estado) = ('ACTIVO','ABIERTO')
       AND NOT app.fn_bandera_interna('app.motivo_reapertura') THEN
        RAISE EXCEPTION
          'Reabrir % exige justificacion escrita (RF-PRE-28, RN-03). Use '
          'app.fn_reabrir_presupuesto(presupuesto, usuario, motivo): es el unico '
          'camino, y es lo que garantiza que la linea base quede archivada y el '
          'motivo en el historial.', NEW.codigo;
    END IF;

    -- D-20 · Dos errores distintos, dos mensajes distintos. El segundo es el
    -- caso de quien armó el árbol de capítulos y dejó todas las cantidades en
    -- cero. La validación vive aquí y no solo en la interfaz, como exige
    -- RNF-21: la operación debe rechazarse aunque la petición se construya a
    -- mano.
    IF NEW.estado = 'ACTIVO' THEN
        SELECT count(*) INTO v_items
          FROM app.presupuesto_item WHERE presupuesto_id = NEW.id;
        IF v_items = 0 THEN
            RAISE EXCEPTION
              'No se puede activar «%»: el presupuesto no tiene ninguna actividad '
              '(D-20).', NEW.codigo;
        END IF;
        IF NEW.valor_total <= 0 THEN
            RAISE EXCEPTION
              'No se puede activar «%»: el valor total es cero. Revise las '
              'cantidades de obra (D-20).', NEW.codigo;
        END IF;
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER tg_transicion_estado
    BEFORE UPDATE OF estado ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_transicion_estado();

-- -----------------------------------------------------------------------------
--  D-18 · Un presupuesto que alguna vez fue activado no se elimina nunca, por
--  ningún rol, ni siquiera el Administrador: su línea base es registro
--  contractual. Se archiva.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_borrar_solo_no_activado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF app.fn_bandera_interna('app.purga_tenant', OLD.tenant_id::text) THEN
        RETURN OLD;
    END IF;
    IF OLD.activado_en IS NOT NULL THEN
        RAISE EXCEPTION
          'El presupuesto «%» fue activado alguna vez, así que su línea base y su '
          'historial son registro contractual y no se pueden eliminar. Archívelo '
          'en su lugar (D-18).', OLD.codigo;
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER tg_borrar_solo_no_activado BEFORE DELETE ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_borrar_solo_no_activado();

-- -----------------------------------------------------------------------------
--  D-6 · Moneda única por empresa. Para habilitar multimoneda basta con
--  eliminar este trigger y añadir la tabla de tasas de cambio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_moneda_unica() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_base char(3);
BEGIN
    SELECT moneda_base INTO v_base FROM app.configuracion_empresa
     WHERE tenant_id = NEW.tenant_id;
    IF v_base IS NOT NULL AND NEW.moneda <> v_base THEN
        RAISE EXCEPTION
          'El MVP opera en una sola moneda por empresa (%). No hay conversión '
          'de divisas definida (D-6).', v_base;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_moneda_unica
    BEFORE INSERT OR UPDATE OF moneda ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_moneda_unica();

-- -----------------------------------------------------------------------------
--  RF-CFG-22: la moneda base solo se cambia mientras la empresa no tenga
--  recursos, APU ni presupuestos. Antes vivía solo en la prosa; sin esto se
--  dejaba el catálogo en una divisa y los presupuestos en otra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_moneda_solo_sin_datos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.moneda_base <> OLD.moneda_base AND (
         EXISTS (SELECT 1 FROM app.recurso     WHERE tenant_id = NEW.tenant_id) OR
         EXISTS (SELECT 1 FROM app.apu         WHERE tenant_id = NEW.tenant_id) OR
         EXISTS (SELECT 1 FROM app.presupuesto WHERE tenant_id = NEW.tenant_id)) THEN
        RAISE EXCEPTION
          'La moneda base solo se cambia mientras la empresa no tenga recursos, '
          'APU ni presupuestos registrados (RF-CFG-22).';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_moneda_solo_sin_datos
    BEFORE UPDATE OF moneda_base ON app.configuracion_empresa
    FOR EACH ROW EXECUTE FUNCTION app.fn_moneda_solo_sin_datos();

-- -----------------------------------------------------------------------------
--  D-31 / RF-CFG-24: renombrar una unidad siempre; cambiar la unidad de un
--  recurso o de un APU que ya está en uso, bloqueado. Ajustar el rendimiento
--  exigiría un factor de conversión que el sistema no tiene ni puede deducir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_unidad_bloqueada_en_uso() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_usos bigint;
BEGIN
    IF NEW.unidad_id = OLD.unidad_id THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'recurso' THEN
        SELECT count(DISTINCT v.apu_id) INTO v_usos
          FROM app.apu_version_recurso avr
          JOIN app.apu_version v ON v.id = avr.apu_version_id
         WHERE avr.recurso_id = OLD.id;
    ELSE
        SELECT count(*) INTO v_usos
          FROM app.presupuesto_item WHERE apu_id = OLD.id;
    END IF;
    IF v_usos > 0 THEN
        RAISE EXCEPTION
          '«%» está en uso en % %; su unidad no se cambia. Cree uno nuevo con la '
          'unidad correcta (D-31, RF-CFG-24).',
          OLD.nombre, v_usos,
          CASE TG_TABLE_NAME WHEN 'recurso' THEN 'APU' ELSE 'actividad(es)' END;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_recurso_unidad BEFORE UPDATE OF unidad_id ON app.recurso
    FOR EACH ROW EXECUTE FUNCTION app.fn_unidad_bloqueada_en_uso();
CREATE TRIGGER tg_apu_unidad BEFORE UPDATE OF unidad_id ON app.apu
    FOR EACH ROW EXECUTE FUNCTION app.fn_unidad_bloqueada_en_uso();


-- =============================================================================
--  9. PERMISOS Y LÍMITES DE PLAN
--
--  «El cambio de estado no es un permiso delegable» (RN-03) y «plan Personal:
--  máximo un asistente, sin roles personalizados» (RN-11) se defienden aquí.
--  Sin estos guardianes serían prosa: PRESUPUESTOS.ESTADO podría asignarse a un
--  rol ASISTENTE, y un inquilino del plan Personal podría crear roles
--  PERSONALIZADOS.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.fn_permiso_no_delegable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_tipo text;
BEGIN
    IF NEW.permiso_codigo NOT IN ('PRESUPUESTOS.ESTADO', 'USUARIOS.GESTIONAR') THEN
        RETURN NEW;
    END IF;
    SELECT tipo INTO v_tipo FROM app.rol WHERE id = NEW.rol_id;

    IF NEW.permiso_codigo = 'PRESUPUESTOS.ESTADO' AND v_tipo <> 'ADMIN' THEN
        RAISE EXCEPTION
          'Activar, cerrar y reabrir un proyecto es exclusivo del rol '
          'Administrador y no es un permiso delegable (RN-03, RF-PRE-24/28). El rol '
          'destino es de tipo %.', v_tipo;
    END IF;

    -- §9 del documento 01: el Asistente del plan Personal no gestiona usuarios.
    -- Era la única de las dos prohibiciones de ese rol que la base no defendía.
    IF NEW.permiso_codigo = 'USUARIOS.GESTIONAR' AND v_tipo = 'ASISTENTE' THEN
        RAISE EXCEPTION
          'El rol Asistente no gestiona usuarios (§9 del documento 01): ese '
          'permiso es del Administrador o de un rol personalizado del plan '
          'Empresarial.';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_permiso_no_delegable BEFORE INSERT OR UPDATE ON app.rol_permiso
    FOR EACH ROW EXECUTE FUNCTION app.fn_permiso_no_delegable();


-- -----------------------------------------------------------------------------
--  Ver es prerrequisito de cualquier otra accion de su modulo (RF-CFG-25).
--
--  Un rol que puede crear recursos pero no verlos describe algo que no existe:
--  toda accion se ejerce sobre una pantalla que primero hay que poder abrir.
--  Sin esta regla la matriz de permisos admite combinaciones que la interfaz
--  no sabe representar, y el servidor termina autorizando una operacion cuya
--  pantalla el usuario no puede cargar.
--
--  Se aplica solo a los modulos que tienen un permiso de consulta propio
--  (RECURSOS, APU y PRESUPUESTOS). CONFIG y USUARIOS no lo tienen:
--  CONFIG.SUSCRIPCION es consulta de una pestana concreta, no del modulo.
--
--  Diferido a propósito: se comprueba al confirmar la transaccion, no fila a
--  fila, para que el backend pueda insertar los permisos de un rol en
--  cualquier orden. Es la misma razon que en tg_version_apu_cuadra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_rol_permisos_coherentes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_rol uuid; v_modulos text;
BEGIN
    v_rol := COALESCE(NEW.rol_id, OLD.rol_id);
    IF NOT EXISTS (SELECT 1 FROM app.rol WHERE id = v_rol) THEN
        RETURN NULL;              -- el rol se esta eliminando en cascada
    END IF;

    SELECT string_agg(DISTINCT p.modulo, ', ') INTO v_modulos
      FROM app.rol_permiso rp
      JOIN app.permiso p ON p.codigo = rp.permiso_codigo
     WHERE rp.rol_id = v_rol
       AND EXISTS (SELECT 1 FROM app.permiso v WHERE v.codigo = p.modulo || '.VER')
       AND NOT EXISTS (SELECT 1 FROM app.rol_permiso r2
                        WHERE r2.rol_id = v_rol
                          AND r2.permiso_codigo = p.modulo || '.VER');

    IF v_modulos IS NOT NULL THEN
        RAISE EXCEPTION
          'El rol tiene acciones de % sin el permiso de consulta del modulo. '
          'Para marcar cualquier accion hay que marcar primero Ver (RF-CFG-25).',
          v_modulos;
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tg_rol_permisos_coherentes
    AFTER INSERT OR UPDATE OR DELETE ON app.rol_permiso
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_rol_permisos_coherentes();

-- Dos funciones y no una compartida: PL/pgSQL prepara cada expresión completa,
-- de modo que una sola función con ramas para app.rol y para app.usuario falla
-- al compilar NEW.estado sobre rol y NEW.tipo sobre usuario. Es la misma trampa
-- que documenta fn_linea_base_editable.
CREATE OR REPLACE FUNCTION app.fn_plan_admite_rol() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_personalizados boolean; v_plan text;
BEGIN
    IF NEW.tipo <> 'PERSONALIZADO' THEN
        RETURN NEW;
    END IF;
    SELECT p.roles_personalizados, p.codigo INTO v_personalizados, v_plan
      FROM plataforma.suscripcion s
      JOIN plataforma.plan p ON p.id = s.plan_id
     WHERE s.tenant_id = NEW.tenant_id AND s.estado IN ('EN_PRUEBA','ACTIVA');

    IF v_plan IS NULL THEN
        RETURN NEW;                      -- alta en curso: aún no hay suscripción
    END IF;
    IF NOT COALESCE(v_personalizados, false) THEN
        RAISE EXCEPTION
          'El plan % no admite roles personalizados (RN-11). Use los roles '
          'Administrador y Asistente, o cambie de plan.', v_plan;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.fn_plan_admite_usuario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_max integer; v_activos integer; v_plan text;
BEGIN
    IF NEW.estado = 'REVOCADO' THEN
        RETURN NEW;
    END IF;
    SELECT p.max_usuarios, p.codigo INTO v_max, v_plan
      FROM plataforma.suscripcion s
      JOIN plataforma.plan p ON p.id = s.plan_id
     WHERE s.tenant_id = NEW.tenant_id AND s.estado IN ('EN_PRUEBA','ACTIVA');

    IF v_plan IS NULL OR v_max IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO v_activos FROM app.usuario u
     WHERE u.tenant_id = NEW.tenant_id AND u.estado <> 'REVOCADO'
       AND u.id <> NEW.id;
    IF v_activos + 1 > v_max THEN
        RAISE EXCEPTION
          'El plan % admite % usuario(s) y la empresa ya tiene % sin revocar '
          '(RN-11, RF-SAD-06).', v_plan, v_max, v_activos;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_limites_plan_rol BEFORE INSERT OR UPDATE OF tipo ON app.rol
    FOR EACH ROW EXECUTE FUNCTION app.fn_plan_admite_rol();
CREATE TRIGGER tg_limites_plan_usuario BEFORE INSERT OR UPDATE OF estado ON app.usuario
    FOR EACH ROW EXECUTE FUNCTION app.fn_plan_admite_usuario();

-- -----------------------------------------------------------------------------
--  D-26 / RF-SAD-06: el downgrade de plan se bloquea hasta que la cuenta quepa
--  en el destino. Antes era «regla de backend»; el cambio de plan_id lo hace el
--  superadministrador (BYPASSRLS), por eso el filtro por tenant es explícito.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.fn_plan_cabe() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_max integer; v_pers boolean; v_usuarios bigint; v_roles bigint; v_cod text;
BEGIN
    IF NEW.plan_id = OLD.plan_id THEN RETURN NEW; END IF;
    SELECT max_usuarios, roles_personalizados, codigo
      INTO v_max, v_pers, v_cod FROM plataforma.plan WHERE id = NEW.plan_id;
    SELECT count(*) INTO v_usuarios
      FROM app.usuario WHERE tenant_id = NEW.tenant_id AND estado <> 'REVOCADO';
    SELECT count(*) INTO v_roles
      FROM app.rol WHERE tenant_id = NEW.tenant_id AND tipo = 'PERSONALIZADO';
    IF v_max IS NOT NULL AND v_usuarios > v_max THEN
        RAISE EXCEPTION
          'El plan % admite % usuario(s) y la empresa tiene % sin revocar. '
          'Revoque % antes de cambiar de plan (D-26, RF-SAD-06).',
          v_cod, v_max, v_usuarios, v_usuarios - v_max;
    END IF;
    IF NOT COALESCE(v_pers, false) AND v_roles > 0 THEN
        RAISE EXCEPTION
          'El plan % no admite roles personalizados y la empresa tiene %. '
          'Elimínelos antes de cambiar de plan (D-26).', v_cod, v_roles;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_plan_cabe BEFORE UPDATE OF plan_id ON plataforma.suscripcion
    FOR EACH ROW EXECUTE FUNCTION plataforma.fn_plan_cabe();

-- -----------------------------------------------------------------------------
--  D-29 · No se puede dejar a una empresa sin administrador.
--
--  Tres puertas, no una. Vigilar solo el UPDATE de app.usuario dejaría abiertas
--  las otras dos: el DELETE del usuario administrador, y el cambio de
--  app.rol.tipo de ADMIN a otra cosa, que deja al inquilino con cero
--  administradores sin tocar una sola fila de usuario.
--
--  El control real de la recuperación no es software: es el procedimiento de
--  verificación que soporte sigue antes de invocar RF-SAD-14. Quien logre
--  convencer a soporte por teléfono se queda con la cuenta completa de una
--  constructora, con su catálogo de precios y sus ofertas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_proteger_ultimo_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_otros integer; v_era_admin boolean;
BEGIN
    -- Purga deliberada del inquilino (RF-SAD-13): el borrado en cascada de
    -- fn_eliminar_tenant no debe chocar con esta protección, o la eliminación
    -- de una prueba no convertida es imposible. Solo la reconoce dentro de esa
    -- función (D-37): puesta por la aplicación, la bandera no vale.
    IF app.fn_bandera_interna('app.purga_tenant', OLD.tenant_id::text) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    v_era_admin := OLD.estado = 'ACTIVO'
                   AND EXISTS (SELECT 1 FROM app.rol r
                                WHERE r.id = OLD.rol_id AND r.tipo = 'ADMIN');
    IF NOT v_era_admin THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.estado = 'ACTIVO'
       AND EXISTS (SELECT 1 FROM app.rol r
                    WHERE r.id = NEW.rol_id AND r.tipo = 'ADMIN')
    THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_otros
      FROM app.usuario u JOIN app.rol r ON r.id = u.rol_id
     WHERE u.tenant_id = OLD.tenant_id
       AND u.id <> OLD.id
       AND u.estado = 'ACTIVO'
       AND r.tipo = 'ADMIN';

    IF v_otros = 0 THEN
        RAISE EXCEPTION
          '«%» es el único administrador activo de la empresa. Designe otro '
          'administrador antes de revocarle el acceso, cambiarle el rol o '
          'eliminarlo (D-29).', OLD.nombre;
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER tg_proteger_ultimo_admin
    BEFORE UPDATE OR DELETE ON app.usuario
    FOR EACH ROW EXECUTE FUNCTION app.fn_proteger_ultimo_admin();

CREATE OR REPLACE FUNCTION app.fn_proteger_rol_sistema() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Purga deliberada del inquilino (RF-SAD-13): deja pasar la cascada de
    -- fn_eliminar_tenant, que si no chocaba contra el rol Administrador de
    -- sistema y hacía imposible borrar cualquier inquilino (D-37).
    IF app.fn_bandera_interna('app.purga_tenant', OLD.tenant_id::text) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.es_sistema THEN
            RAISE EXCEPTION
              'El rol «%» es un rol del sistema y no se puede eliminar (RN-03, '
              'RN-11).', OLD.nombre;
        END IF;
        RETURN OLD;
    END IF;

    -- El tipo de un rol NO se cambia, y no solo el de los roles de sistema.
    -- Mientras la comprobación miró únicamente es_sistema, la aplicación podía
    -- crear un rol PERSONALIZADO y ascenderlo a ADMIN con un UPDATE de una
    -- línea; a partir de ahí, cualquiera con ese rol reabría o cerraba una línea
    -- base firmada, porque fn_exigir_admin decide por rol.tipo. La promesa de
    -- RF-PRE-28 —«la base lo hace cumplir por su cuenta»— la sostenía el
    -- backend, no la base. Hallazgo 2 de la auditoría del 24 de septiembre
    -- de 2026. Ser administrador se hereda del rol que la empresa recibió al
    -- nacer; no se fabrica.
    IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
        RAISE EXCEPTION
          'El tipo de un rol no se cambia después de creado: «%» es % y lo '
          'seguirá siendo (RN-03, D-44). Para dar acceso de administrador, '
          'asigne al usuario el rol Administrador de la empresa; para quitarle '
          'permisos a un rol personalizado, edite sus permisos.',
          OLD.nombre, OLD.tipo;
    END IF;
    IF NEW.es_sistema IS DISTINCT FROM OLD.es_sistema THEN
        RAISE EXCEPTION
          'La marca de rol de sistema del rol «%» no se puede cambiar '
          '(RN-03, D-44).', OLD.nombre;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_proteger_rol_sistema
    BEFORE UPDATE OR DELETE ON app.rol
    FOR EACH ROW EXECUTE FUNCTION app.fn_proteger_rol_sistema();

-- -----------------------------------------------------------------------------
--  D-44 · Los roles de sistema nacen con la empresa; nadie más los fabrica.
--
--  El otro camino del hallazgo 2 era crear el rol ADMIN directamente:
--  INSERT INTO app.rol (..., 'ADMIN') y listo, un administrador paralelo. Ahora
--  ADMIN y ASISTENTE solo los crea fn_alta_tenant, que corre como dueño de las
--  tablas; la aplicación crea roles PERSONALIZADO y nada más, que es
--  exactamente lo que el plan Empresarial ofrece (RN-11). Y el índice único deja
--  UNO de cada tipo por empresa, para que «el rol Administrador» siga siendo una
--  frase con referente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_rol_de_sistema_solo_interno() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.tipo IN ('ADMIN','ASISTENTE') OR NEW.es_sistema)
       AND current_user NOT IN ('construsoft_owner','construsoft_super')
       AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION
          'Los roles Administrador y Asistente los crea la base al dar de alta '
          'la empresa (D-44). La aplicación crea roles personalizados: use '
          'tipo = PERSONALIZADO y otorgue los permisos que correspondan.';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_rol_de_sistema_solo_interno
    BEFORE INSERT ON app.rol
    FOR EACH ROW EXECUTE FUNCTION app.fn_rol_de_sistema_solo_interno();

CREATE UNIQUE INDEX ux_rol_admin_unico
    ON app.rol (tenant_id) WHERE tipo = 'ADMIN';
CREATE UNIQUE INDEX ux_rol_asistente_unico
    ON app.rol (tenant_id) WHERE tipo = 'ASISTENTE';


-- =============================================================================
--  10. AISLAMIENTO MULTI-INQUILINO                           (RN-01, RNF-01)
--
--  La aplicación abre una transacción explícita y fija el contexto con:
--      SELECT set_config('app.tenant_id', $1, true);
--
--  NO uses «SET LOCAL app.tenant_id = $1»: no es SQL válido, porque SET no
--  admite parámetros vinculados —devuelve syntax error at or near "SET"—.
--  Quien siga esa instrucción literalmente acabará interpolando la cadena a
--  mano, que es inyección.
-- =============================================================================

-- El NULLIF no es cosmético. Con un agrupador de conexiones en modo
-- transacción, después de la primera transacción que fijó el contexto,
-- current_setting deja de devolver NULL y devuelve cadena vacía; ''::uuid
-- lanza «invalid input syntax for type uuid» y toda consulta sin contexto
-- terminaría en error 500 en lugar del «cero filas» que promete el diseño.
CREATE OR REPLACE FUNCTION app.fn_tenant_actual() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;
COMMENT ON FUNCTION app.fn_tenant_actual() IS
  'Contexto de inquilino de la transacción. Úsala siempre en lugar de '
  'current_setting directo: el NULLIF es lo que convierte un olvido del backend '
  'en cero filas y no en un error 500.';

-- -----------------------------------------------------------------------------
--  RN-01 · La segunda barrera del aislamiento: las funciones que reciben un id.
--
--  El aislamiento por filas protege las consultas, pero no protege a una
--  función SECURITY DEFINER cuyo dueño tiene BYPASSRLS y que recibe un
--  identificador cualquiera. Los UUID viajan en URL y en exportaciones, así que
--  «no lo va a adivinar» no es una defensa. Toda función de servicio que reciba
--  un id comprueba la empresa ANTES de hacer nada y responde siempre lo mismo
--  —«no existe en esta empresa»— sin revelar código, nombre ni estado: para una
--  empresa, las demás no existen.
--
--  El contexto vacío solo se tolera cuando la sesión es de superusuario, que es
--  como corren la carga inicial y las pruebas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_exigir_mismo_tenant(p_tenant uuid, p_que text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE v_ctx uuid;
BEGIN
    v_ctx := app.fn_tenant_actual();
    IF v_ctx IS NOT NULL THEN
        IF p_tenant IS DISTINCT FROM v_ctx THEN
            RAISE EXCEPTION '% no existe en esta empresa.', p_que;
        END IF;
        RETURN;
    END IF;
    IF COALESCE((SELECT r.rolsuper FROM pg_roles r
                  WHERE r.rolname = session_user), false) THEN
        RETURN;
    END IF;
    RAISE EXCEPTION '% no existe en esta empresa.', p_que;
END $$;
COMMENT ON FUNCTION app.fn_exigir_mismo_tenant(uuid, text) IS
  'Comprobación de empresa para las funciones de servicio que reciben un id '
  '(RN-01). Mensaje único y mudo: nunca revela nada de la otra empresa.';

-- El aislamiento no se aplica con un bucle de una sola pasada: cualquier tabla
-- creada después nacería sin política y sin FORCE, y nada lo detectaría. Es una
-- función que se invoca al final de este archivo y de CADA migración futura,
-- con una prueba que falla si alguna tabla quedó fuera (RNF-24).
-- -----------------------------------------------------------------------------
--  D-50 · Ninguna conexión debe poder vestirse de un rol con BYPASSRLS.
--
--  fn_verificar_rls comprueba que ninguna tabla quedó sin política. Esta
--  comprueba lo otro: que el modelo de privilegios no tenga una escalera. Un rol
--  de conexión que sea MIEMBRO de un rol con BYPASSRLS puede hacer SET ROLE y
--  salirse del aislamiento con dos líneas de SQL, y ninguna política lo impide
--  porque el aislamiento deja de aplicarse.
--
--  Se ejecuta DESPUÉS de crear los roles de conexión del despliegue (§16.8), no
--  al cargar el esquema, porque esos roles todavía no existen aquí. Debe
--  devolver cero filas, igual que su hermana.
--
--      SELECT * FROM app.fn_verificar_roles_login();
--
--  La excepción deliberada es superadmin_login: el panel necesita ver a todos
--  los inquilinos para las métricas agregadas (RF-SAD-02, RF-SAD-10), y lleva
--  BYPASSRLS como atributo propio. Si un día deja de necesitarlo, sale de aquí.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_verificar_roles_login()
RETURNS TABLE (rol_de_conexion name, puede_vestirse_de name, problema text)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE alcanzables AS (
        SELECT r.oid AS login_oid, r.rolname AS login, g.oid AS grupo_oid, g.rolname AS grupo
          FROM pg_roles r
          JOIN pg_auth_members m ON m.member = r.oid
          JOIN pg_roles g        ON g.oid    = m.roleid
         WHERE r.rolcanlogin
        UNION
        SELECT a.login_oid, a.login, g2.oid, g2.rolname
          FROM alcanzables a
          JOIN pg_auth_members m2 ON m2.member = a.grupo_oid
          JOIN pg_roles g2        ON g2.oid    = m2.roleid
    )
    SELECT a.login, a.grupo,
           'puede hacer SET ROLE a un rol con BYPASSRLS y salirse del aislamiento'
      FROM alcanzables a
      JOIN pg_roles g ON g.oid = a.grupo_oid
     WHERE g.rolbypassrls
       AND a.login <> 'superadmin_login'   -- excepción documentada
    UNION ALL
    SELECT r.rolname, r.rolname,
           'es superusuario: ninguna política lo detiene'
      FROM pg_roles r
     WHERE r.rolcanlogin AND r.rolsuper
       AND r.rolname NOT IN ('postgres')
     ORDER BY 1, 2;
$$;
COMMENT ON FUNCTION app.fn_verificar_roles_login() IS
  'D-50. Cero filas = ninguna conexión puede vestirse de un rol con BYPASSRLS. '
  'Se ejecuta después de crear los roles de conexión del despliegue.';

CREATE OR REPLACE FUNCTION app.fn_aplicar_rls() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0;
BEGIN
    FOR r IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                             AND a.attnum > 0 AND NOT a.attisdropped
         WHERE ns.nspname = 'app' AND c.relkind = 'r'
    LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', r.relname);
        EXECUTE format('ALTER TABLE app.%I FORCE  ROW LEVEL SECURITY', r.relname);
        EXECUTE format('DROP POLICY IF EXISTS p_aislamiento_tenant ON app.%I', r.relname);
        EXECUTE format($p$
            CREATE POLICY p_aislamiento_tenant ON app.%I
            USING      (tenant_id = app.fn_tenant_actual())
            WITH CHECK (tenant_id = app.fn_tenant_actual())
        $p$, r.relname);
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;
COMMENT ON FUNCTION app.fn_aplicar_rls() IS
  'Vuelve a aplicar el aislamiento a TODA tabla de app con tenant_id. Toda '
  'migración que cree una tabla de inquilino termina llamándola (RNF-24).';

CREATE OR REPLACE FUNCTION app.fn_verificar_rls()
RETURNS TABLE (tabla text, problema text) LANGUAGE sql STABLE AS $$
    -- (1) Tablas de inquilino (con tenant_id) sin aislamiento aplicado.
    SELECT c.relname::text,
           CASE WHEN NOT c.relrowsecurity      THEN 'sin ENABLE ROW LEVEL SECURITY'
                WHEN NOT c.relforcerowsecurity THEN 'sin FORCE ROW LEVEL SECURITY'
                ELSE 'sin política p_aislamiento_tenant' END
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped
     WHERE ns.nspname = 'app' AND c.relkind = 'r'
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
            OR NOT EXISTS (SELECT 1 FROM pg_policy p
                            WHERE p.polrelid = c.oid
                              AND p.polname = 'p_aislamiento_tenant'))
    UNION ALL
    -- (2) Tablas de app SIN tenant_id que no estén en la lista blanca de
    --     catálogos globales. Es lo que dejaba a token_recuperacion pasar
    --     inadvertida: el verificador solo miraba las tablas con tenant_id.
    SELECT c.relname::text,
           'tabla de app sin tenant_id y fuera de la lista de catálogos'
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'app' AND c.relkind = 'r'
       AND c.relname NOT IN ('permiso','tipo_evento')
       AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                          AND a.attnum > 0 AND NOT a.attisdropped);
$$;
COMMENT ON FUNCTION app.fn_verificar_rls() IS
  'Prueba automática de la fase 0 (RNF-24): debe devolver cero filas. Si '
  'devuelve alguna, una migración creó una tabla de inquilino sin aislamiento.';

-- -----------------------------------------------------------------------------
--  El esquema plataforma también lleva aislamiento, porque el rol de la
--  aplicación necesita leerlo para el login y la vigencia. Sin él, la razón
--  social, el NIT, el teléfono y los pagos de TODAS las constructoras quedarían
--  a un SELECT sin filtro de distancia, y RN-01 dice «por ninguna vía».
--
--  El superadministrador sigue viéndolo todo: se conecta con un rol BYPASSRLS,
--  que es para lo que existe (RF-SAD-02, RF-SAD-10).
-- -----------------------------------------------------------------------------
ALTER TABLE plataforma.tenant      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.tenant      FORCE  ROW LEVEL SECURITY;
CREATE POLICY p_tenant_propio ON plataforma.tenant
    USING (id = app.fn_tenant_actual()) WITH CHECK (id = app.fn_tenant_actual());

ALTER TABLE plataforma.suscripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.suscripcion FORCE  ROW LEVEL SECURITY;
CREATE POLICY p_suscripcion_propia ON plataforma.suscripcion
    USING (tenant_id = app.fn_tenant_actual())
    WITH CHECK (tenant_id = app.fn_tenant_actual());

ALTER TABLE plataforma.pago        ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.pago        FORCE  ROW LEVEL SECURITY;
CREATE POLICY p_pago_propio ON plataforma.pago
    USING (EXISTS (SELECT 1 FROM plataforma.suscripcion s
                    WHERE s.id = pago.suscripcion_id
                      AND s.tenant_id = app.fn_tenant_actual()));


-- =============================================================================
--  11. CÁLCULO FINANCIERO EN EL SERVIDOR                      (RNF-06, RN-16)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  Tres cosas que esta función hace, y que conviene no perder de vista:
--
--  · Comprueba el estado antes de escribir. No recalcula ni reescribe la línea
--    base de un proyecto ya activo.
--  · Escribe wbs_nodo.monto_acumulado, que RF-PRE-21 exige y que §5.2 del
--    documento 06 describe como «una consulta recursiva única».
--  · Compara las actividades que alcanzó el recorrido con el total. Si una rama
--    quedó desconectada del árbol, falla en vez de emitir una oferta más
--    barata. Es la tercera defensa contra los ciclos de la EDT, y la que
--    protege contra cualquier forma futura de desconectar una rama.
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER (dueño construsoft_owner): la dispara un trigger cuando la
-- aplicación cambia una actividad, pero el rol de la app no tiene UPDATE sobre
-- los totales ni sobre monto_acumulado (modelo P4). El dueño no es BYPASSRLS, así
-- que sigue sujeto al aislamiento por inquilino.
CREATE OR REPLACE FUNCTION app.fn_recalcular_presupuesto(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE
    v_estado text; v_codigo text; v_tenant uuid;
    v_cd app.dinero; v_ci app.dinero;
    v_a  app.dinero; v_i  app.dinero; v_u app.dinero; v_iva app.dinero;
    v_pa app.porcentaje; v_pi app.porcentaje; v_pu app.porcentaje;
    v_piva app.porcentaje;
    v_items_arbol bigint; v_items_total bigint;
BEGIN
    SELECT estado, codigo, tenant_id, aiu_administracion, aiu_imprevistos,
           aiu_utilidad, iva_utilidad_pct
      INTO v_estado, v_codigo, v_tenant, v_pa, v_pi, v_pu, v_piva
      FROM app.presupuesto WHERE id = p_id FOR UPDATE;

    IF v_estado IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    -- RN-01 · La función es SECURITY DEFINER de un rol con BYPASSRLS, así que
    -- ve todas las empresas. Sin esta línea, pasarle el UUID de un presupuesto
    -- ajeno lo recalculaba y el mensaje de estado devolvía su código.
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');
    IF v_estado <> 'ABIERTO' THEN
        RAISE EXCEPTION
          'El presupuesto «%» está en estado %: sus totales son la línea base y '
          'no se recalculan. Reabrir el proyecto con justificación es el único '
          'camino (RN-04, RF-PRE-28, RNF-21).', v_codigo, v_estado;
    END IF;

    -- La clasificación vive en el capítulo raíz y se hereda hacia abajo (D-8).
    WITH RECURSIVE arbol AS (
        SELECT n.id, n.clasificacion
          FROM app.wbs_nodo n
         WHERE n.presupuesto_id = p_id AND n.padre_id IS NULL
        UNION ALL
        SELECT h.id, a.clasificacion
          FROM app.wbs_nodo h JOIN arbol a ON h.padre_id = a.id
    )
    SELECT COALESCE(SUM(it.costo_total) FILTER (WHERE a.clasificacion = 'DIRECTO'),   0),
           COALESCE(SUM(it.costo_total) FILTER (WHERE a.clasificacion = 'INDIRECTO'), 0),
           count(*)
      INTO v_cd, v_ci, v_items_arbol
      FROM app.presupuesto_item it
      JOIN arbol a ON a.id = it.wbs_nodo_id
     WHERE it.presupuesto_id = p_id;

    SELECT count(*) INTO v_items_total
      FROM app.presupuesto_item WHERE presupuesto_id = p_id;

    IF v_items_arbol <> v_items_total THEN
        RAISE EXCEPTION
          'La estructura de capítulos de «%» está rota: el recorrido alcanza % '
          'de las % actividades. Las que faltan cuelgan de una rama desconectada '
          'del árbol y su costo no estaría en la oferta. Revise los capítulos '
          'antes de continuar.', v_codigo, v_items_arbol, v_items_total;
    END IF;

    -- RF-PRE-21: monto acumulado de cada capítulo, a cualquier profundidad, en
    -- una sola consulta recursiva (documento 06 §5.2).
    WITH RECURSIVE descendencia AS (
        SELECT n.id AS nodo, n.id AS bajo
          FROM app.wbs_nodo n WHERE n.presupuesto_id = p_id
        UNION ALL
        SELECT d.nodo, h.id
          FROM descendencia d
          JOIN app.wbs_nodo h ON h.padre_id = d.bajo
    ), montos AS (
        SELECT d.nodo, COALESCE(SUM(it.costo_total), 0) AS total
          FROM descendencia d
          LEFT JOIN app.presupuesto_item it ON it.wbs_nodo_id = d.bajo
         GROUP BY d.nodo
    )
    UPDATE app.wbs_nodo n
       SET monto_acumulado = m.total
      FROM montos m
     WHERE n.id = m.nodo AND n.monto_acumulado IS DISTINCT FROM m.total;

    -- ┌── BASE DEL AIU ─────────────────────────────────────────────────────┐
    -- │ D-3: los tres porcentajes se multiplican, cada uno por separado,   │
    -- │ sobre la base. El «U = A × %U» del documento fuente era un error.   │
    -- │                                                                     │
    -- │ D-16: la base es SOLO EL COSTO DIRECTO. Los capítulos indirectos   │
    -- │ NO entran: si el sueldo del director de obra ya está detallado como │
    -- │ actividad de un capítulo indirecto, aplicarle encima el porcentaje  │
    -- │ de Administración lo cobraría dos veces.                            │
    -- │                                                                     │
    -- │ El costo indirecto sí entra en el valor total, después del AIU:     │
    -- │   Valor Total = Costo Directo + Costo Indirecto + AIU + IVA(U)      │
    -- └─────────────────────────────────────────────────────────────────────┘
    v_a := v_cd * v_pa / 100;
    v_i := v_cd * v_pi / 100;
    v_u := v_cd * v_pu / 100;

    -- ┌── IVA (D-33) ───────────────────────────────────────────────────────┐
    -- │ El 19 % grava la UTILIDAD, no el costo directo ni el AIU completo.  │
    -- │ En un contrato de construcción la base gravable es la utilidad del  │
    -- │ constructor, y los materiales ya traen su propio IVA dentro del APU │
    -- │ (D-2): gravar otra vez el costo directo lo cobraría dos veces.      │
    -- │ El IVA no entra en la base del AIU ni en el denominador de la       │
    -- │ incidencia; se suma al final, como el costo indirecto.              │
    -- └─────────────────────────────────────────────────────────────────────┘
    v_iva := v_u * v_piva / 100;

    PERFORM set_config('app.recalculo_en_curso', p_id::text, true);
    UPDATE app.presupuesto
       SET total_costo_directo   = v_cd,
           total_costo_indirecto = v_ci,
           total_aiu             = v_a + v_i + v_u,
           total_iva             = v_iva,
           valor_total           = v_cd + v_ci + v_a + v_i + v_u + v_iva,
           fecha_modificacion    = now()
     WHERE id = p_id;
    PERFORM set_config('app.recalculo_en_curso', '', true);
END $$;

-- -----------------------------------------------------------------------------
--  El recálculo lo dispara la propia base, no el backend: si dependiera de que
--  la aplicación se acuerde de llamarlo, los totales guardados quedarían
--  obsoletos tras cualquier INSERT/UPDATE/DELETE de actividad. Se dispara POR
--  SENTENCIA y no por fila, así que una carga masiva de actividades debe
--  hacerse en una sola sentencia, no en un bucle de INSERT.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_disparar_recalculo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    -- La renumeración solo mueve códigos y posiciones: no cambia un peso, así
    -- que no tiene sentido recalcular el presupuesto entero detrás de ella.
    IF app.fn_bandera_interna('app.purga_tenant')
       OR app.fn_bandera_interna('app.renumerando') THEN
        RETURN NULL;
    END IF;
    FOR r IN
        SELECT DISTINCT p.id
          FROM app.presupuesto p
         WHERE p.estado = 'ABIERTO'
           AND p.id IN (SELECT presupuesto_id FROM afectados)
    LOOP
        PERFORM app.fn_recalcular_presupuesto(r.id);
    END LOOP;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_recalculo_item_ins AFTER INSERT ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_recalculo();
CREATE TRIGGER tg_recalculo_item_upd AFTER UPDATE ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_recalculo();
CREATE TRIGGER tg_recalculo_item_del AFTER DELETE ON app.presupuesto_item
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_recalculo();

-- -----------------------------------------------------------------------------
--  El recálculo también lo disparan los dos cambios de cabecera que mueven el
--  valor sin tocar ninguna actividad: los porcentajes de AIU (RF-PRE-23) y la
--  reclasificación o el movimiento de un capítulo (RF-PRE-19/20). Sin esto,
--  cambiar el AIU o reclasificar dejaba total_aiu y el costo directo obsoletos,
--  y el presupuesto se activaba guardando una línea base incoherente (RNF-25,
--  PROMPT §3.10). Solo en ABIERTO; en ACTIVO/CERRADO los totales son la línea
--  base y no se recalculan.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_recalculo_por_aiu() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado = 'ABIERTO' THEN
        PERFORM app.fn_recalcular_presupuesto(NEW.id);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_recalculo_aiu
    AFTER UPDATE OF aiu_administracion, aiu_imprevistos, aiu_utilidad,
                    iva_utilidad_pct
    ON app.presupuesto
    FOR EACH ROW EXECUTE FUNCTION app.fn_recalculo_por_aiu();

-- Por fila, no por sentencia: PostgreSQL no admite tablas de transición
-- (REFERENCING) junto con una lista de columnas (UPDATE OF ...), y la lista de
-- columnas es justo lo que evita la reentrada — fn_recalcular_presupuesto
-- escribe wbs_nodo.monto_acumulado, no padre_id ni clasificacion, así que este
-- trigger no se vuelve a disparar.
CREATE OR REPLACE FUNCTION app.fn_recalculo_por_wbs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_pid uuid; v_estado text;
BEGIN
    IF app.fn_bandera_interna('app.purga_tenant') THEN
        RETURN NULL;
    END IF;
    v_pid := COALESCE(NEW.presupuesto_id, OLD.presupuesto_id);
    -- Solo si el presupuesto sigue existiendo y está ABIERTO (en un borrado en
    -- cascada el presupuesto ya no está, y no hay nada que recalcular).
    SELECT estado INTO v_estado FROM app.presupuesto WHERE id = v_pid;
    IF v_estado = 'ABIERTO' THEN
        PERFORM app.fn_recalcular_presupuesto(v_pid);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_recalculo_wbs_upd
    AFTER UPDATE OF padre_id, clasificacion ON app.wbs_nodo
    FOR EACH ROW EXECUTE FUNCTION app.fn_recalculo_por_wbs();

-- El borrado SÍ es por sentencia, y esto no es una preferencia de estilo: es un
-- error que costó la primera pantalla del modo EDT. Borrar un capítulo con
-- subcapítulos es un DELETE en cascada, y un trigger FOR EACH ROW se dispara
-- con la cascada a medias —el capítulo ya no está, sus hijos todavía sí—, de
-- modo que fn_recalcular_presupuesto encontraba actividades colgando de una
-- rama sin raíz y abortaba con «la estructura está rota». No fallaba a veces:
-- no funcionaba nunca, bastaba un subcapítulo con una actividad. Por sentencia,
-- el recálculo corre cuando la cascada terminó y el árbol vuelve a ser un
-- árbol. Hallazgo 1 de la auditoría del 24 de septiembre de 2026.
CREATE TRIGGER tg_recalculo_wbs_del
    AFTER DELETE ON app.wbs_nodo
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_recalculo();


-- =============================================================================
--  13. FUNCIONES DE SERVICIO
--
--  Lo que el backend NO debe reimplementar. Cada una existe porque la
--  alternativa —dejarlo al código de la aplicación— ya falló una vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  D-24 · Correlativo de códigos por empresa.
--
--  El UPDATE ... RETURNING bloquea la fila, de modo que dos usuarios creando a
--  la vez no obtienen el mismo código. No se usa una SEQUENCE de PostgreSQL
--  porque los consecutivos deben ser por empresa, no globales.
--
--  El ancho de cuatro es un MÍNIMO, no un máximo, y por eso NO se usa lpad:
--  lpad en PostgreSQL no rellena, FIJA la longitud y recorta por la derecha.
--  Con ultimo = 10000 devolvería 'REC-1000', que ya se entregó cuando ultimo
--  valía 1000, y a partir de ahí todo INSERT chocaría contra
--  UNIQUE (tenant_id, codigo): el catálogo quedaría inservible al recurso
--  10.000.
--
--  Por qué no se usa prefijo por tipo de recurso: sería tentador usar MAT, EQ,
--  MO y AC. No se hace, porque el tipo de un recurso es editable y el código es
--  inmutable por RN-02, así que el día que alguien reclasifique un insumo
--  quedaría un MAT-0042 que es personal. Un código que miente es peor que un
--  código sin información.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_siguiente_codigo(
    p_tenant_id uuid, p_entidad text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_prefijo text; v_n bigint;
BEGIN
    UPDATE app.secuencia_codigo
       SET ultimo = ultimo + 1
     WHERE tenant_id = p_tenant_id AND entidad = p_entidad
    RETURNING prefijo, ultimo INTO v_prefijo, v_n;

    IF NOT FOUND THEN
        RAISE EXCEPTION
          'No existe el correlativo de % para esta empresa. Debe crearse en la '
          'transacción de alta del inquilino (D-24).', p_entidad;
    END IF;

    RETURN v_prefijo || '-' ||
           CASE WHEN v_n < 10000 THEN lpad(v_n::text, 4, '0') ELSE v_n::text END;
END $$;

-- -----------------------------------------------------------------------------
--  D-15 · Unidades de medida estándar al crear una empresa.
--
--  app.unidad_medida es por inquilino, así que no admite un INSERT de semilla:
--  las filas nacen cuando nace la empresa. Son los símbolos estándar de la
--  construcción en Colombia. Quedan editables: el usuario puede renombrarlas,
--  borrar las que no use y crear las suyas (RF-CFG-17..20), incluidas las de
--  otro sistema de medida.
--
--  El ON CONFLICT apunta al índice de unicidad insensible a mayúsculas (D-31).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_crear_unidades_estandar(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql AS $$
    WITH nuevas AS (
        INSERT INTO app.unidad_medida (tenant_id, simbolo, descripcion) VALUES
          (p_tenant_id, 'm',   'Metro'),
          (p_tenant_id, 'm²',  'Metro cuadrado'),
          (p_tenant_id, 'm³',  'Metro cúbico'),
          (p_tenant_id, 'Kg',  'Kilogramo'),
          (p_tenant_id, 'Und', 'Unidad'),
          (p_tenant_id, 'Hr',  'Hora'),
          (p_tenant_id, 'Jr',  'Jornal'),
          (p_tenant_id, 'Glb', 'Global'),
          (p_tenant_id, 'Gal', 'Galón'),
          (p_tenant_id, 'Lt',  'Litro'),
          (p_tenant_id, 'Ms',  'Mes'),
          (p_tenant_id, 'X',   'Todo costo')
        ON CONFLICT (tenant_id, lower(simbolo)) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::integer FROM nuevas;
$$;
COMMENT ON FUNCTION app.fn_crear_unidades_estandar(uuid) IS
  'Precarga las doce unidades estándar de una empresa nueva (D-15). '
  'Idempotente: volver a llamarla no duplica ni pisa lo que el usuario haya '
  'cambiado. Sin ellas el sistema arranca inservible, porque el formulario de '
  'recursos exige unidad de medida.';

CREATE OR REPLACE FUNCTION app.fn_crear_secuencias_estandar(p_tenant_id uuid)
RETURNS integer LANGUAGE sql AS $$
    WITH nuevas AS (
        INSERT INTO app.secuencia_codigo (tenant_id, entidad, prefijo) VALUES
          (p_tenant_id, 'RECURSO', 'REC'),
          (p_tenant_id, 'APU',     'APU')
        ON CONFLICT (tenant_id, entidad) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::integer FROM nuevas;
$$;

-- -----------------------------------------------------------------------------
--  Autenticación antes de que exista contexto de inquilino.
--
--  app.usuario tiene aislamiento forzado por tenant_id, pero al autenticar
--  todavía no se conoce la empresa: RF-AUT-04 dice que el correo identifica al
--  usuario sin selector. Una consulta directa por correo, con el rol de
--  aplicación, devuelve CERO FILAS.
--
--  Estas dos funciones son la única puerta. Son de superficie mínima: reciben
--  el dato exacto, devuelven como mucho una fila y solo las columnas que el
--  paso de autenticación necesita. No admiten comodines, así que no sirven para
--  enumerar usuarios.
--
--  El backend compara el hash, comprueba el estado y RECIÉN ENTONCES fija
--  app.tenant_id para el resto de la petición.
-- -----------------------------------------------------------------------------
GRANT SELECT ON app.usuario, app.token_recuperacion TO construsoft_auth;

CREATE OR REPLACE FUNCTION app.fn_autenticar(p_email citext)
RETURNS TABLE (usuario_id uuid, tenant_id uuid, rol_id uuid, nombre text,
               password_hash text, estado text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = app, plataforma, pg_temp AS $$
    SELECT u.id, u.tenant_id, u.rol_id, u.nombre,
           u.password_hash, u.estado
      FROM app.usuario u
     WHERE u.email = p_email;
$$;
ALTER FUNCTION app.fn_autenticar(citext) OWNER TO construsoft_auth;
COMMENT ON FUNCTION app.fn_autenticar(citext) IS
  'Único punto por el que se resuelve un correo a un usuario antes de que exista '
  'contexto de inquilino (RF-AUT-04).';

CREATE OR REPLACE FUNCTION app.fn_resolver_token(p_token_hash text)
RETURNS TABLE (token_id uuid, usuario_id uuid, tenant_id uuid,
               expira_en timestamptz, usado_en timestamptz, anulado_en timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = app, plataforma, pg_temp AS $$
    SELECT t.id, t.usuario_id, t.tenant_id, t.expira_en, t.usado_en, t.anulado_en
      FROM app.token_recuperacion t
     WHERE t.token_hash = p_token_hash;
$$;
ALTER FUNCTION app.fn_resolver_token(text) OWNER TO construsoft_auth;
COMMENT ON FUNCTION app.fn_resolver_token(text) IS
  'Resuelve un token de recuperación a su usuario e inquilino antes de que exista '
  'contexto (RF-AUT-06..09). Recibe el HASH del token, no el token.';

-- -----------------------------------------------------------------------------
--  D-46 · Quien autentica no es quien trabaja.
--
--  Estas dos funciones son SECURITY DEFINER de un dueño con BYPASSRLS, porque al
--  resolver un correo todavía no hay inquilino. Mientras cualquiera pudo
--  ejecutarlas, la consecuencia era esta: desde el contexto de la empresa B,
--  app.fn_autenticar('alguien@empresa-a.co') devolvía el nombre, el inquilino y
--  el HASH DE CONTRASEÑA de un usuario de A. Era la única vía por la que A
--  alcanzaba un dato de B dentro de este esquema, y bastaba conocer un correo.
--  Hallazgo 5 de la auditoría del 24 de septiembre de 2026.
--
--  El hash tiene que salir de la base: el backend lo compara con Argon2id, que
--  PostgreSQL no sabe calcular (documento 04). Lo que se cierra entonces no es
--  la salida del hash, sino QUIÉN puede pedirlo. A partir de aquí el paso de
--  autenticación es una conexión propia —auth_login, §16.8—, con estas dos
--  funciones y nada más: ni una tabla, ni una fila, ni otra función. La conexión
--  de la aplicación no las alcanza.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION app.fn_autenticar(citext)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.fn_resolver_token(text)    FROM PUBLIC;
-- El permiso va al rol SIN BYPASSRLS (D-50). Las funciones siguen corriendo con
-- los privilegios de su dueño, construsoft_auth, porque son SECURITY DEFINER:
-- ejecutarlas no exige ser él, y por eso nadie tiene que serlo.
GRANT  EXECUTE ON FUNCTION app.fn_autenticar(citext)      TO construsoft_autenticador;
GRANT  EXECUTE ON FUNCTION app.fn_resolver_token(text)    TO construsoft_autenticador;

-- -----------------------------------------------------------------------------
--  Dar de alta una empresa es una transacción, no un INSERT.
--
--  La transacción de registro fija app.tenant_id ANTES de insertar en app.*.
--  Con el aislamiento forzado, la creación de las unidades, la configuración,
--  el rol y el usuario falla si el contexto está vacío o es el de otro
--  inquilino, con «new row violates row-level security policy for table
--  unidad_medida»: el mismo arranque inservible que D-15 quiere evitar.
--
--  Crea también las filas de secuencia_codigo (D-24). Sin ellas, el primer
--  recurso de todo cliente nuevo falla.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_alta_tenant(
    p_razon_social text,
    p_nit          text,
    p_plan         text,
    p_admin_nombre text,
    p_admin_email  citext,
    p_admin_hash   text,
    p_email_recuperacion citext DEFAULT NULL)
-- D-51 · Devuelve los TRES identificadores que acaba de crear, y no solo el de
-- la empresa. Con RETURNS uuid, quien registraba se quedaba con el inquilino y sin
-- la identidad del administrador, que es justo lo que necesita para abrir la
-- primera sesión: tenía que salir a buscarla por el camino de autenticación, que
-- existe para resolver credenciales en el login y no para averiguar el id de un
-- usuario que uno mismo acaba de crear. La función lo sabe; ocultarlo obligaba a
-- todos sus llamadores a redescubrirlo.
RETURNS TABLE (id_tenant uuid, id_usuario uuid, id_rol_admin uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE v_tenant uuid; v_plan smallint; v_dias smallint; v_rol uuid;
        v_usuario uuid;
BEGIN
    SELECT id, dias_prueba INTO v_plan, v_dias
      FROM plataforma.plan WHERE codigo = p_plan AND activo;
    IF v_plan IS NULL THEN
        RAISE EXCEPTION 'El plan «%» no existe o no está activo.', p_plan;
    END IF;
    -- D-34 · Sin NIT no hay encabezado de PDF ni forma de facturar, y es la
    -- única barrera contra encadenar pruebas gratuitas (RF-AUT-16).
    IF btrim(COALESCE(p_nit, '')) = '' THEN
        RAISE EXCEPTION
          'El NIT de la empresa es obligatorio (D-34, RF-AUT-02). En el plan '
          'Personal es el NIT del RUT de la persona natural.';
    END IF;
    -- Quien registra elige su contraseña en el formulario: sin ella no puede
    -- nacer ACTIVO y la empresa quedaría sin administrador (D-35).
    IF p_admin_hash IS NULL THEN
        RAISE EXCEPTION
          'El usuario que registra la empresa llega con su contraseña ya '
          'elegida (D-35).';
    END IF;

    INSERT INTO plataforma.tenant (razon_social, nit, email_recuperacion)
         VALUES (p_razon_social, p_nit, p_email_recuperacion)
      RETURNING id INTO v_tenant;

    -- Sin esto, TODO lo que sigue choca contra la política de aislamiento.
    PERFORM set_config('app.tenant_id', v_tenant::text, true);

    INSERT INTO plataforma.suscripcion
           (tenant_id, plan_id, estado, fecha_inicio, fecha_vencimiento)
         VALUES (v_tenant, v_plan, 'EN_PRUEBA', current_date,
                 current_date + v_dias);

    INSERT INTO app.configuracion_empresa (tenant_id) VALUES (v_tenant);
    PERFORM app.fn_crear_unidades_estandar(v_tenant);
    PERFORM app.fn_crear_secuencias_estandar(v_tenant);

    INSERT INTO app.rol (tenant_id, nombre, tipo, es_sistema)
         VALUES (v_tenant, 'Administrador', 'ADMIN', true) RETURNING id INTO v_rol;
    INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo)
         SELECT v_tenant, v_rol, codigo FROM app.permiso;

    -- El rol Asistente nace aquí y no lo inserta el backend, por dos razones.
    -- La primera es que ADMIN y ASISTENTE son roles de SISTEMA y desde el
    -- hallazgo 2 de la auditoría la aplicación no puede crear ninguno de los
    -- dos: si el backend tuviera que insertarlo, habría que volver a abrirle esa
    -- puerta. La segunda es que sin él el plan Personal no tiene a quién asignar
    -- su único asistente (RN-11). Nace sin ningún permiso: los otorga el
    -- Administrador uno por uno, que es justo lo que dice §9 del documento 01.
    INSERT INTO app.rol (tenant_id, nombre, tipo, es_sistema)
         VALUES (v_tenant, 'Asistente', 'ASISTENTE', true);

    -- D-35 · ACTIVO, no PENDIENTE. PENDIENTE significa «invitado, aún sin
    -- consumir su enlace de activación» (D-7) y es para los usuarios que la
    -- empresa crea después. Quien registra la empresa ya eligió su contraseña
    -- en el formulario. Naciendo PENDIENTE, la empresa quedaba sin ningún
    -- administrador activo: no podía activar un presupuesto —fn_exigir_admin
    -- exige ACTIVO— y el primer inicio de sesión chocaba contra
    -- ck_usuario_primer_ingreso al escribir ultimo_acceso.
    INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
         VALUES (v_tenant, v_rol, p_admin_nombre, p_admin_email, p_admin_hash,
                 'ACTIVO')
      RETURNING id INTO v_usuario;

    PERFORM plataforma.fn_evento_plataforma(v_tenant, 'TENANT_CREADO',
        format('Empresa registrada en el plan %s', p_plan));

    RETURN QUERY SELECT v_tenant, v_usuario, v_rol;
END $$;
COMMENT ON FUNCTION app.fn_alta_tenant IS
  'Alta completa de una empresa en UNA transacción: inquilino, '
  'suscripción en prueba, configuración, las doce unidades estándar, los dos '
  'correlativos de código (D-24), el rol Administrador con todos los permisos y '
  'el usuario que se registró. Devuelve los tres identificadores creados, que es '
  'todo lo que hace falta para abrir la primera sesión sin volver a consultar.';
REVOKE EXECUTE ON FUNCTION
    app.fn_alta_tenant(text,text,text,text,citext,text,citext) FROM PUBLIC;

-- -----------------------------------------------------------------------------
--  Eliminar los datos de una prueba no convertida.
--
--  RF-SAD-13 y RNF-23 prometen que es «una acción manual del superadministrador
--  desde su panel». Sin esta función sería imposible: las llaves RESTRICT y los
--  triggers de inmutabilidad rechazan el borrado, y el único camino sería un
--  superusuario deshabilitando triggers.
--
--  Borra en orden de dependencia dentro de una sola transacción, marcada con
--  app.purga_tenant para que los guardianes de inmutabilidad sepan que este
--  DELETE sí es deliberado. Los RESTRICT que protegen el día a día (RF-REC-13,
--  RN-10) se quedan como están: solo esta función los sortea, y solo porque
--  borra a los hijos primero.
--
--  Es el ÚNICO camino por el que se borran datos de un cliente. Ningún proceso
--  automático la invoca.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_eliminar_tenant(
    p_tenant_id uuid, p_justificacion text,
    p_usuario_plataforma_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
BEGIN
    IF p_justificacion IS NULL OR btrim(p_justificacion) = '' THEN
        RAISE EXCEPTION
          'Eliminar los datos de una empresa exige una justificación escrita '
          '(RF-SAD-13, RNF-23).';
    END IF;

    -- §8 / D-14: quien pagó alguna vez conserva sus datos indefinidamente; una
    -- prueba no convertida solo se elimina a partir de los 10 días de vencida.
    -- Antes la promesa vivía solo en el procedimiento de soporte.
    IF EXISTS (SELECT 1 FROM plataforma.pago p
                JOIN plataforma.suscripcion s ON s.id = p.suscripcion_id
               WHERE s.tenant_id = p_tenant_id AND p.estado = 'EXITOSO')
       OR EXISTS (SELECT 1 FROM plataforma.suscripcion
                   WHERE tenant_id = p_tenant_id AND estado <> 'EN_PRUEBA') THEN
        RAISE EXCEPTION
          'La empresa pagó o dejó de estar en prueba: conserva sus datos '
          '(§8 del documento 01). Suspéndala, no la elimine.';
    END IF;
    IF EXISTS (SELECT 1 FROM plataforma.suscripcion
                WHERE tenant_id = p_tenant_id AND estado = 'EN_PRUEBA'
                  AND fecha_vencimiento + 10 > current_date) THEN
        RAISE EXCEPTION
          'La prueba no lleva 10 días vencida: aún no es eliminable (RF-SAD-13).';
    END IF;

    -- D-38 · El evento va ANTES del borrado, mientras la empresa todavía
    -- existe: fn_evento_plataforma copia su razón social y su NIT, y el
    -- ON DELETE SET NULL del tenant_id deja el registro en pie cuando la
    -- empresa desaparece. Sin esto, la justificación que RF-SAD-15 exige se
    -- perdía en el mismo acto de usarla.
    PERFORM plataforma.fn_evento_plataforma(
        p_tenant_id, 'TENANT_ELIMINADO',
        'Eliminación de los datos de la empresa (RF-SAD-15)',
        p_justificacion,
        jsonb_build_object(
          'presupuestos', (SELECT count(*) FROM app.presupuesto WHERE tenant_id = p_tenant_id),
          'recursos',     (SELECT count(*) FROM app.recurso     WHERE tenant_id = p_tenant_id),
          'apu',          (SELECT count(*) FROM app.apu         WHERE tenant_id = p_tenant_id)),
        p_usuario_plataforma_id);

    PERFORM set_config('app.tenant_id',    p_tenant_id::text, true);
    PERFORM set_config('app.purga_tenant', p_tenant_id::text, true);

    DELETE FROM app.evento_auditoria     WHERE tenant_id = p_tenant_id;
    DELETE FROM app.presupuesto_version  WHERE tenant_id = p_tenant_id;
    DELETE FROM app.presupuesto_item     WHERE tenant_id = p_tenant_id;
    DELETE FROM app.wbs_nodo             WHERE tenant_id = p_tenant_id;
    DELETE FROM app.presupuesto          WHERE tenant_id = p_tenant_id;

    UPDATE app.apu SET version_vigente_id = NULL WHERE tenant_id = p_tenant_id;
    DELETE FROM app.apu_version_recurso  WHERE tenant_id = p_tenant_id;
    DELETE FROM app.apu_version          WHERE tenant_id = p_tenant_id;
    DELETE FROM app.apu                  WHERE tenant_id = p_tenant_id;
    DELETE FROM app.recurso              WHERE tenant_id = p_tenant_id;

    DELETE FROM plataforma.pago
     WHERE suscripcion_id IN (SELECT id FROM plataforma.suscripcion
                               WHERE tenant_id = p_tenant_id);
    DELETE FROM plataforma.suscripcion   WHERE tenant_id = p_tenant_id;

    -- Cascada del propio inquilino: usuarios, roles, unidades, configuración
    -- y correlativos.
    DELETE FROM plataforma.tenant WHERE id = p_tenant_id;

    PERFORM set_config('app.purga_tenant', '', true);
END $$;
COMMENT ON FUNCTION app.fn_eliminar_tenant(uuid, text, uuid) IS
  'Acción manual y deliberada del superadministrador (RF-SAD-13, RNF-23). '
  'Es el ÚNICO camino por el que se borran datos de un cliente.';


-- -----------------------------------------------------------------------------
--  Reabrir un proyecto activo (RF-PRE-28, RN-03, D-5).
--
--  Es el UNICO camino. El trigger de transicion rechaza un UPDATE directo sobre
--  el estado, porque un UPDATE no puede traer la justificacion y sin ella la
--  reapertura no deja rastro: la linea base anterior se perderia y el historial
--  no podria responder quien la abrio ni por que.
-- -----------------------------------------------------------------------------
-- El cambio de estado es exclusivo del Administrador (RN-03). La comprobación se
-- hace sobre el usuario de la SESIÓN (app.usuario_id), no sobre un parámetro que
-- el llamador elija: antes fn_reabrir confiaba en un p_usuario_id que además
-- pisaba el autor de toda la transacción, y activar/cerrar no comprobaban nada.
CREATE OR REPLACE FUNCTION app.fn_exigir_admin(p_tenant uuid, p_accion text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.usuario u JOIN app.rol r ON r.id = u.rol_id
                    WHERE u.id = app.fn_usuario_actual()
                      AND u.tenant_id = p_tenant
                      AND u.estado = 'ACTIVO' AND r.tipo = 'ADMIN') THEN
        RAISE EXCEPTION
          '% un proyecto es exclusivo del rol Administrador y no es delegable '
          '(RN-03). Fije app.usuario_id con un administrador activo de la empresa.',
          p_accion;
    END IF;
END $$;

-- Las tres transiciones pasan por funciones SECURITY DEFINER de construsoft_owner,
-- porque el rol de la aplicación ya no tiene UPDATE sobre presupuesto.estado
-- (modelo P4). Cada una comprueba el rol antes de mover el estado; el resto de
-- la maquinaria (versión automática, evento, congelamiento) la disparan los
-- triggers de la sección 8.
CREATE OR REPLACE FUNCTION app.fn_activar_presupuesto(p_presupuesto_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE v_estado text; v_tenant uuid; v_codigo text;
BEGIN
    SELECT estado, tenant_id, codigo INTO v_estado, v_tenant, v_codigo
      FROM app.presupuesto WHERE id = p_presupuesto_id;
    IF v_estado IS NULL THEN RAISE EXCEPTION 'El presupuesto no existe en esta empresa.'; END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');   -- RN-01
    PERFORM app.fn_exigir_admin(v_tenant, 'Activar');
    -- Comprobar el estado de ORIGEN, no solo el destino. Sin esto, activar un
    -- presupuesto ya ACTIVO no cambiaba el estado —el guardián de transiciones
    -- no veía cambio y dejaba pasar el UPDATE—, pero sí reescribía activado_en:
    -- un doble clic movía la fecha de la línea base del contrato, sin versión
    -- nueva y sin evento. Hallazgo 6 de la auditoría del 24 de septiembre
    -- de 2026.
    IF v_estado <> 'ABIERTO' THEN
        RAISE EXCEPTION
          'Solo se activa un proyecto ABIERTO. El presupuesto «%» ya está en %: '
          'su fecha de activación es la de su línea base y no se reescribe '
          '(RN-04, D-5).', v_codigo, v_estado;
    END IF;
    UPDATE app.presupuesto SET estado = 'ACTIVO', activado_en = now()
     WHERE id = p_presupuesto_id;
END $$;

CREATE OR REPLACE FUNCTION app.fn_cerrar_presupuesto(p_presupuesto_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE v_estado text; v_tenant uuid; v_codigo text;
BEGIN
    SELECT estado, tenant_id, codigo INTO v_estado, v_tenant, v_codigo
      FROM app.presupuesto WHERE id = p_presupuesto_id;
    IF v_estado IS NULL THEN RAISE EXCEPTION 'El presupuesto no existe en esta empresa.'; END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');   -- RN-01
    PERFORM app.fn_exigir_admin(v_tenant, 'Cerrar');
    -- Mismo motivo que en fn_activar_presupuesto (hallazgo 6): cerrar dos veces
    -- reescribía cerrado_en. La fecha de cierre de una obra es un dato del
    -- contrato, no una marca de la última vez que alguien pulsó el botón.
    IF v_estado <> 'ACTIVO' THEN
        RAISE EXCEPTION
          'Solo se cierra un proyecto ACTIVO. El presupuesto «%» está en %: un '
          'proyecto Abierto se activa primero, y uno Cerrado ya lo está '
          '(RN-04, D-17).', v_codigo, v_estado;
    END IF;
    UPDATE app.presupuesto SET estado = 'CERRADO', cerrado_en = now()
     WHERE id = p_presupuesto_id;
END $$;

-- Reabrir: sin parámetro de usuario. Usa app.fn_usuario_actual() para el rol y
-- como autor de la versión y el evento (RF-PRE-28, RF-VER-08, D-5).
CREATE OR REPLACE FUNCTION app.fn_reabrir_presupuesto(
    p_presupuesto_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE v_estado text; v_codigo text; v_tenant uuid;
BEGIN
    IF btrim(COALESCE(p_motivo, '')) = '' THEN
        RAISE EXCEPTION 'Reabrir un proyecto exige una justificacion escrita (RF-PRE-28).';
    END IF;
    SELECT estado, codigo, tenant_id INTO v_estado, v_codigo, v_tenant
      FROM app.presupuesto WHERE id = p_presupuesto_id;
    IF v_estado IS NULL THEN RAISE EXCEPTION 'El presupuesto no existe en esta empresa.'; END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');   -- RN-01
    IF v_estado <> 'ACTIVO' THEN
        RAISE EXCEPTION 'Solo se reabre un proyecto ACTIVO. El presupuesto % esta en %.',
          v_codigo, v_estado;
    END IF;
    PERFORM app.fn_exigir_admin(v_tenant, 'Reabrir');
    PERFORM set_config('app.motivo_reapertura', p_motivo, true);
    UPDATE app.presupuesto SET estado = 'ABIERTO' WHERE id = p_presupuesto_id;
    PERFORM set_config('app.motivo_reapertura', '', true);
END $$;
COMMENT ON FUNCTION app.fn_reabrir_presupuesto(uuid, text) IS
  'Unico camino para reabrir un proyecto activo (RF-PRE-28). Comprueba el rol '
  'Administrador con app.fn_usuario_actual(), archiva la linea base como version '
  'automatica y deja el evento REAPERTURA con la justificacion, en una transaccion.';

-- -----------------------------------------------------------------------------
--  «Eliminar APU sin uso» y «eliminar recurso sin uso».
--
--  Aquí se define «sin uso», porque el permiso APU.ELIMINAR y la regla «un APU
--  no se puede eliminar si está vinculado a algún presupuesto» necesitan un
--  criterio exacto. Sin él, un APU no podría eliminarse nunca una vez tiene una
--  versión —que es siempre, porque costo_directo vive en la versión—: la llave
--  foránea lo retendría y el trigger impediría borrar la versión.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_eliminar_apu(p_apu_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_codigo text; v_tenant uuid; v_usos bigint;
BEGIN
    SELECT codigo, tenant_id INTO v_codigo, v_tenant
      FROM app.apu WHERE id = p_apu_id;
    IF v_codigo IS NULL THEN
        RAISE EXCEPTION 'El APU no existe en esta empresa.';
    END IF;

    -- La función es SECURITY DEFINER; sin este chequeo, un inquilino podía
    -- borrar un APU de otro pasando su UUID (los UUID viajan en URLs y
    -- exportaciones). Mismo texto que «no existe»: no revela nada (RN-01).
    IF v_tenant IS DISTINCT FROM app.fn_tenant_actual() THEN
        RAISE EXCEPTION 'El APU no existe en esta empresa.';
    END IF;

    SELECT count(*) INTO v_usos
      FROM app.presupuesto_item i WHERE i.apu_id = p_apu_id;
    IF v_usos > 0 THEN
        RAISE EXCEPTION
          'El APU «%» está usado en % actividad(es) de presupuestos y no se '
          'puede eliminar (RF-APU-14, RN-10). Si ya no debe usarse, márquelo '
          'como inactivo.', v_codigo, v_usos;
    END IF;

    PERFORM set_config('app.purga_tenant', v_tenant::text, true);
    UPDATE app.apu SET version_vigente_id = NULL WHERE id = p_apu_id;
    DELETE FROM app.apu_version_recurso
     WHERE apu_version_id IN (SELECT id FROM app.apu_version WHERE apu_id = p_apu_id);
    DELETE FROM app.apu_version WHERE apu_id = p_apu_id;
    DELETE FROM app.apu WHERE id = p_apu_id;
    PERFORM set_config('app.purga_tenant', '', true);
END $$;

CREATE OR REPLACE FUNCTION app.fn_eliminar_recurso(p_recurso_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_codigo text; v_tenant uuid; v_usos bigint;
BEGIN
    SELECT codigo, tenant_id INTO v_codigo, v_tenant
      FROM app.recurso WHERE id = p_recurso_id;
    IF v_codigo IS NULL THEN
        RAISE EXCEPTION 'El recurso no existe en esta empresa.';
    END IF;

    -- SECURITY DEFINER: mismo chequeo de inquilino que fn_eliminar_apu (RN-01).
    IF v_tenant IS DISTINCT FROM app.fn_tenant_actual() THEN
        RAISE EXCEPTION 'El recurso no existe en esta empresa.';
    END IF;
    SELECT count(DISTINCT v.apu_id) INTO v_usos
      FROM app.apu_version_recurso avr
      JOIN app.apu_version v ON v.id = avr.apu_version_id
     WHERE avr.recurso_id = p_recurso_id;
    IF v_usos > 0 THEN
        RAISE EXCEPTION
          'El recurso «%» interviene en % APU (incluidas versiones históricas) y '
          'no se puede eliminar (RF-REC-13, RN-10). Márquelo como inactivo para '
          'que deje de ofrecerse al armar APU nuevos.', v_codigo, v_usos;
    END IF;
    DELETE FROM app.recurso WHERE id = p_recurso_id;
END $$;
COMMENT ON FUNCTION app.fn_eliminar_recurso(uuid) IS
  'RF-REC-13. El mensaje explica que la retención alcanza también a versiones '
  'históricas ya sustituidas, y nombra la salida: la columna activo.';


-- =============================================================================
--  13.b  LAS OPERACIONES QUE MUEVEN VARIAS TABLAS A LA VEZ          (D-39)
--
--  Tres operaciones del MVP no son un INSERT: renumerar la EDT, duplicar un
--  presupuesto y crear una versión de APU con su propagación. Las tres tocan
--  varias tablas, las tres tienen que ser atómicas y en las tres un error se
--  traduce en una oferta equivocada. Vivían en el backend, que es el único
--  lugar donde la base no puede defenderlas.
--
--  Aquí no se gana rendimiento: se gana que la regla sea una sola, esté escrita
--  una vez y no dependa de que cada pantalla la recuerde.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  RF-PRE-12/14 · Renumerar la EDT.
--
--  codigo_wbs y nivel son datos derivados del árbol: el código de un nodo es el
--  de su padre más su posición entre hermanos. La base ya impedía el ciclo y el
--  nivel incoherente, pero el código lo escribía la aplicación, así que un
--  reordenamiento a medias dejaba capítulos numerados 1, 2, 2 sin que nada
--  fallara. Esta función los vuelve a derivar del árbol.
--
--  El orden se normaliza a 1..n entre hermanos, de modo que reordenar es mover
--  un «orden» y dejar que la base numere. Los hermanos se renumeran de una vez
--  y las llaves de unicidad se difieren: durante el intercambio hay códigos
--  repetidos, y esa es la razón por la que nacieron DEFERRABLE.
--
--  D-42 · Capítulos y actividades comparten contador dentro de su padre. El
--  capítulo se numera «1.0», y su primer hijo —subcapítulo o actividad— es el
--  «1.1». Por eso una actividad puede colgar del capítulo directamente sin
--  chocar con los subcapítulos, que es justo lo que el modo EDT tiene que
--  permitir:
--
--      1.0  CIMENTACIÓN              (capítulo)
--      1.1  Excavación manual        (actividad colgada del capítulo)
--      1.2  Concretos                (subcapítulo)
--      1.2.1  Concreto de zapatas    (actividad del subcapítulo)
--
--  En modo ITEMS el árbol solo tiene capítulos y actividades, así que la
--  numeración se queda en dos niveles: 1.0 y 1.1, 1.2, 1.3…
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_renumerar_wbs(p_presupuesto_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_estado text; v_n integer := 0; v_i integer; r record;
BEGIN
    SELECT tenant_id, estado INTO v_tenant, v_estado
      FROM app.presupuesto WHERE id = p_presupuesto_id FOR NO KEY UPDATE;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');
    IF v_estado <> 'ABIERTO' THEN
        RAISE EXCEPTION
          'El presupuesto está en estado %: su estructura es la línea base y no '
          'se renumera (RN-04, RF-PRE-32).', v_estado;
    END IF;

    SET CONSTRAINTS app.wbs_nodo_presupuesto_id_codigo_wbs_key,
                    app.presupuesto_item_presupuesto_id_codigo_item_key DEFERRED;

    -- Marca la renumeración en curso: sin ella, cada UPDATE de aquí dispararía
    -- otra renumeración y el recálculo entero del presupuesto.
    PERFORM set_config('app.renumerando', p_presupuesto_id::text, true);

    -- Capítulos y subcapítulos, de arriba hacia abajo: el padre ya tiene su
    -- nivel nuevo cuando se comprueba el del hijo (fn_wbs_sin_ciclos exige
    -- nivel = padre + 1).
    FOR r IN
        WITH RECURSIVE hijos AS (
            SELECT n.id, n.padre_id AS padre, true AS es_nodo, n.orden
              FROM app.wbs_nodo n WHERE n.presupuesto_id = p_presupuesto_id
            UNION ALL
            SELECT i.id, i.wbs_nodo_id, false, i.orden
              FROM app.presupuesto_item i WHERE i.presupuesto_id = p_presupuesto_id
        ), lugares AS (
            SELECT h.*, row_number() OVER (PARTITION BY h.padre
                        ORDER BY h.orden, h.es_nodo DESC, h.id) AS lugar
              FROM hijos h
        ), arbol AS (
            SELECT l.id, l.es_nodo, l.lugar::integer AS orden,
                   1::smallint AS nivel, l.lugar::text AS prefijo
              FROM lugares l WHERE l.padre IS NULL
            UNION ALL
            SELECT c.id, c.es_nodo, c.lugar::integer, (a.nivel + 1)::smallint,
                   a.prefijo || '.' || c.lugar
              FROM lugares c JOIN arbol a ON c.padre = a.id AND a.es_nodo
        )
        SELECT id, orden, nivel,
               CASE WHEN nivel = 1 THEN prefijo || '.0' ELSE prefijo END AS codigo
          FROM arbol WHERE es_nodo ORDER BY nivel, orden
    LOOP
        UPDATE app.wbs_nodo
           SET orden = r.orden, nivel = r.nivel, codigo_wbs = r.codigo
         WHERE id = r.id
           AND (orden, nivel, codigo_wbs) IS DISTINCT FROM (r.orden, r.nivel, r.codigo);
        IF FOUND THEN
            v_n := v_n + 1;
        END IF;
    END LOOP;

    -- Las actividades, en una sola sentencia.
    WITH RECURSIVE hijos AS (
        SELECT n.id, n.padre_id AS padre, true AS es_nodo, n.orden
          FROM app.wbs_nodo n WHERE n.presupuesto_id = p_presupuesto_id
        UNION ALL
        SELECT i.id, i.wbs_nodo_id, false, i.orden
          FROM app.presupuesto_item i WHERE i.presupuesto_id = p_presupuesto_id
    ), lugares AS (
        SELECT h.*, row_number() OVER (PARTITION BY h.padre
                    ORDER BY h.orden, h.es_nodo DESC, h.id) AS lugar
          FROM hijos h
    ), arbol AS (
        SELECT l.id, l.es_nodo, l.lugar::integer AS orden, l.lugar::text AS prefijo
          FROM lugares l WHERE l.padre IS NULL
        UNION ALL
        SELECT c.id, c.es_nodo, c.lugar::integer, a.prefijo || '.' || c.lugar
          FROM lugares c JOIN arbol a ON c.padre = a.id AND a.es_nodo
    )
    UPDATE app.presupuesto_item i
       SET orden = a.orden, codigo_item = a.prefijo
      FROM arbol a
     WHERE i.id = a.id AND NOT a.es_nodo
       AND (i.orden, i.codigo_item) IS DISTINCT FROM (a.orden, a.prefijo);
    GET DIAGNOSTICS v_i = ROW_COUNT;

    PERFORM set_config('app.renumerando', '', true);
    RETURN v_n + v_i;
END $$;
COMMENT ON FUNCTION app.fn_renumerar_wbs(uuid) IS
  'Deriva del árbol el código, el nivel y el orden de capítulos y actividades '
  '(RF-PRE-12/14, D-39, D-42). La disparan solos los cambios de estructura.';

-- -----------------------------------------------------------------------------
--  La renumeración no se pide: ocurre. Agregar, mover, reordenar o eliminar un
--  capítulo o una actividad deja la numeración al día sin que el backend tenga
--  que acordarse, igual que pasa con los totales.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_disparar_renumeracion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    IF app.fn_bandera_interna('app.renumerando')
       OR app.fn_bandera_interna('app.purga_tenant') THEN
        RETURN NULL;
    END IF;
    FOR r IN
        SELECT DISTINCT p.id
          FROM app.presupuesto p
         WHERE p.estado = 'ABIERTO'
           AND p.id IN (SELECT presupuesto_id FROM afectados)
    LOOP
        PERFORM app.fn_renumerar_wbs(r.id);
    END LOOP;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_renumerar_wbs_ins AFTER INSERT ON app.wbs_nodo
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_wbs_upd AFTER UPDATE ON app.wbs_nodo
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_wbs_del AFTER DELETE ON app.wbs_nodo
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_item_ins AFTER INSERT ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_item_upd AFTER UPDATE ON app.presupuesto_item
    REFERENCING NEW TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();
CREATE TRIGGER tg_renumerar_item_del AFTER DELETE ON app.presupuesto_item
    REFERENCING OLD TABLE AS afectados
    FOR EACH STATEMENT EXECUTE FUNCTION app.fn_disparar_renumeracion();

-- -----------------------------------------------------------------------------
--  D-47 · Buscar por nombre pasa por una función, no por la tabla.
--
--  RF-REC-03, RF-APU-02 y RF-PRE-02 piden búsqueda en tiempo real por nombre, y
--  el esquema trae seis índices para servirla: tres sobre lower(nombre) y tres
--  trigrama. La auditoría del 24 de septiembre de 2026 (hallazgo 8) midió que
--  NINGUNO se usaba, y no por un error de escritura: PostgreSQL no admite una
--  condición que no sea LEAKPROOF como condición de índice sobre una tabla con
--  políticas de seguridad, y ni ~~ (LIKE), ni ~~* (ILIKE), ni lower() lo son.
--  Bajo RLS, el plan quedaba así:
--
--      Bitmap Index Scan  Index Cond: (tenant_id = …)         ← solo el inquilino
--      Bitmap Heap Scan   Filter: (nombre ~~* '%pdr-60%')     ← 29.994 filas descartadas
--
--  Es decir: el índice acotaba la empresa y después leía el catálogo entero. Con
--  200 recursos no se nota; con 30.000 son 25 ms por tecla en la pantalla más
--  usada del sistema, y crece en línea recta. Los índices de igualdad (tipo,
--  estado, llaves) no tienen el problema, porque «=» sí es LEAKPROOF.
--
--  La salida no es marcar el catálogo de PostgreSQL como LEAKPROOF —eso es una
--  decisión global del servidor, no de este esquema— sino la misma de §16.2:
--  una función interna que filtra el inquilino ella misma. Sin políticas encima,
--  el planificador vuelve a usar el trigrama con las dos condiciones a la vez.
--
--  Devuelven identificadores y no filas, a propósito: la aplicación los une
--  contra la tabla, que sigue bajo RLS, y ese join va por la llave primaria. Así
--  la función no se convierte en una segunda definición de la tabla que haya que
--  mantener al día, y no puede filtrar una columna de más.
--
--  Sin contexto de inquilino no devuelven nada: no son una puerta trasera.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_buscar_recurso(
    p_texto text, p_tipo text DEFAULT NULL, p_limite integer DEFAULT 50)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid := app.fn_tenant_actual();
BEGIN
    IF v_tenant IS NULL OR btrim(COALESCE(p_texto, '')) = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT r.id FROM app.recurso r
         WHERE r.tenant_id = v_tenant
           AND r.nombre ILIKE '%' || p_texto || '%'
           AND (p_tipo IS NULL OR r.tipo = p_tipo)
         ORDER BY lower(r.nombre)
         LIMIT greatest(p_limite, 0);
END $$;

CREATE OR REPLACE FUNCTION app.fn_buscar_apu(
    p_texto text, p_limite integer DEFAULT 50)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid := app.fn_tenant_actual();
BEGIN
    IF v_tenant IS NULL OR btrim(COALESCE(p_texto, '')) = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT a.id FROM app.apu a
         WHERE a.tenant_id = v_tenant
           AND a.nombre ILIKE '%' || p_texto || '%'
         ORDER BY lower(a.nombre)
         LIMIT greatest(p_limite, 0);
END $$;

CREATE OR REPLACE FUNCTION app.fn_buscar_presupuesto(
    p_texto text, p_limite integer DEFAULT 50)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid := app.fn_tenant_actual();
BEGIN
    IF v_tenant IS NULL OR btrim(COALESCE(p_texto, '')) = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT p.id FROM app.presupuesto p
         WHERE p.tenant_id = v_tenant
           AND p.nombre ILIKE '%' || p_texto || '%'
         ORDER BY lower(p.nombre)
         LIMIT greatest(p_limite, 0);
END $$;

COMMENT ON FUNCTION app.fn_buscar_recurso(text,text,integer) IS
  'Búsqueda por nombre de RF-REC-03. Devuelve identificadores; la aplicación los '
  'une contra app.recurso, que sigue bajo RLS. Buscar con un LIKE directo sobre '
  'la tabla funciona pero no usa el índice trigrama (D-47).';
COMMENT ON FUNCTION app.fn_buscar_apu(text,integer) IS
  'Búsqueda por nombre de RF-APU-02, misma mecánica que fn_buscar_recurso (D-47).';
COMMENT ON FUNCTION app.fn_buscar_presupuesto(text,integer) IS
  'Búsqueda por nombre de RF-PRE-02, misma mecánica que fn_buscar_recurso (D-47).';

-- -----------------------------------------------------------------------------
--  RF-PRE-27 / D-19 · Duplicar un presupuesto.
--
--  Clona la EDT completa y sus actividades en estado ABIERTO. La copia toma
--  exactamente lo que tenía el original —la misma versión de cada APU, los
--  mismos precios, las mismas cantidades y los mismos porcentajes.
--
--  p_actualizar_apu es el «sí» del diálogo de D-19: reapunta cada actividad a la
--  versión vigente de su APU y recalcula. La lista de lo que cambiaría la da
--  app.fn_apu_desactualizados, para poder mostrar el valor total antes y después.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_apu_desactualizados(p_presupuesto_id uuid)
RETURNS TABLE (item_id uuid, apu_id uuid, codigo text, descripcion text,
               cantidad app.cantidad, precio_en_el_presupuesto app.dinero,
               precio_vigente app.dinero)
LANGUAGE sql STABLE AS $$
    SELECT i.id, i.apu_id, i.codigo_apu, i.descripcion, i.cantidad,
           i.precio_unitario, vv.costo_directo
      FROM app.presupuesto_item i
      JOIN app.apu a          ON a.id  = i.apu_id
      JOIN app.apu_version vv ON vv.id = a.version_vigente_id
     WHERE i.presupuesto_id = p_presupuesto_id
       AND i.apu_version_id <> a.version_vigente_id
     ORDER BY i.codigo_apu;
$$;
COMMENT ON FUNCTION app.fn_apu_desactualizados(uuid) IS
  'Actividades cuyo APU ya tiene una versión más nueva que la que usan. Es la '
  'lista que el diálogo de duplicación muestra antes de confirmar (D-19).';

CREATE OR REPLACE FUNCTION app.fn_duplicar_presupuesto(
    p_presupuesto_id uuid, p_codigo text, p_nombre text DEFAULT NULL,
    p_actualizar_apu boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_origen app.presupuesto; v_nuevo uuid;
        v_map jsonb; v_nivel smallint; v_max smallint;
BEGIN
    SELECT * INTO v_origen FROM app.presupuesto WHERE id = p_presupuesto_id;
    IF v_origen.id IS NULL THEN
        RAISE EXCEPTION 'El presupuesto no existe en esta empresa.';
    END IF;
    v_tenant := v_origen.tenant_id;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El presupuesto');
    IF btrim(COALESCE(p_codigo, '')) = '' THEN
        RAISE EXCEPTION 'La copia necesita su propio código de presupuesto (RF-PRE-27).';
    END IF;
    -- Silencia los eventos de edición mientras dura la copia (D-45): el hecho
    -- que ocurrió es «duplicó el presupuesto», no doscientas actividades
    -- agregadas una por una. La bandera solo la obedece fn_bandera_interna
    -- cuando la pone una función interna, y esta lo es.
    PERFORM set_config('app.duplicando', 'si', true);

    INSERT INTO app.presupuesto
        (tenant_id, codigo, nombre, ubicacion, moneda, tipo_proyecto,
         aiu_administracion, aiu_imprevistos, aiu_utilidad, iva_utilidad_pct,
         modo_estructura, duplicado_de_id, creado_por)
    VALUES (v_tenant, p_codigo, COALESCE(p_nombre, v_origen.nombre || ' (copia)'),
            v_origen.ubicacion, v_origen.moneda, v_origen.tipo_proyecto,
            v_origen.aiu_administracion, v_origen.aiu_imprevistos,
            v_origen.aiu_utilidad, v_origen.iva_utilidad_pct,
            v_origen.modo_estructura, v_origen.id, app.fn_usuario_actual())
    RETURNING id INTO v_nuevo;

    -- Identificadores nuevos calculados de una vez: el mapa viejo → nuevo es lo
    -- que permite reconstruir el árbol y colgar cada actividad de su capítulo.
    SELECT jsonb_object_agg(n.id::text, app.uuid_v7()::text)
      INTO v_map
      FROM app.wbs_nodo n WHERE n.presupuesto_id = p_presupuesto_id;

    IF v_map IS NOT NULL THEN
        SELECT max(nivel) INTO v_max FROM app.wbs_nodo
         WHERE presupuesto_id = p_presupuesto_id;
        -- Nivel por nivel, para que el padre exista cuando entra el hijo.
        FOR v_nivel IN 1..v_max LOOP
            INSERT INTO app.wbs_nodo
                (id, tenant_id, presupuesto_id, padre_id, orden, nivel,
                 codigo_wbs, nombre, clasificacion)
            SELECT (v_map->>n.id::text)::uuid, v_tenant, v_nuevo,
                   (v_map->>n.padre_id::text)::uuid, n.orden, n.nivel,
                   n.codigo_wbs, n.nombre, n.clasificacion
              FROM app.wbs_nodo n
             WHERE n.presupuesto_id = p_presupuesto_id AND n.nivel = v_nivel;
        END LOOP;

        -- Una sola sentencia: el recálculo se dispara por sentencia, no por fila.
        INSERT INTO app.presupuesto_item
            (tenant_id, presupuesto_id, wbs_nodo_id, orden, codigo_item,
             apu_id, apu_version_id,
             codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad,
             costo_total)
        SELECT v_tenant, v_nuevo, (v_map->>i.wbs_nodo_id::text)::uuid, i.orden,
               i.codigo_item,
               i.apu_id,
               CASE WHEN p_actualizar_apu THEN COALESCE(a.version_vigente_id, i.apu_version_id)
                    ELSE i.apu_version_id END,
               i.codigo_apu,
               CASE WHEN p_actualizar_apu THEN COALESCE(vv.nombre, i.descripcion)
                    ELSE i.descripcion END,
               CASE WHEN p_actualizar_apu THEN COALESCE(vv.unidad_simbolo, i.unidad_simbolo)
                    ELSE i.unidad_simbolo END,
               CASE WHEN p_actualizar_apu THEN COALESCE(vv.costo_directo, i.precio_unitario)
                    ELSE i.precio_unitario END,
               i.cantidad,
               round(i.cantidad * CASE WHEN p_actualizar_apu
                                       THEN COALESCE(vv.costo_directo, i.precio_unitario)
                                       ELSE i.precio_unitario END, 6)
          FROM app.presupuesto_item i
          JOIN app.apu a           ON a.id  = i.apu_id
          LEFT JOIN app.apu_version vv ON vv.id = a.version_vigente_id
         WHERE i.presupuesto_id = p_presupuesto_id;
    END IF;

    INSERT INTO app.evento_auditoria
        (tenant_id, presupuesto_id, entidad, entidad_id, tipo_evento,
         descripcion, valor_nuevo, usuario_id)
    VALUES (v_tenant, v_nuevo, 'PRESUPUESTO', v_nuevo, 'PRESUPUESTO_DUPLICADO',
            format('Duplicado de «%s»%s', v_origen.codigo,
                   CASE WHEN p_actualizar_apu
                        THEN ', con los APU actualizados a su versión vigente'
                        ELSE '' END),
            jsonb_build_object('duplicado_de', v_origen.codigo),
            app.fn_usuario_actual());

    PERFORM set_config('app.duplicando', '', true);
    RETURN v_nuevo;
END $$;
COMMENT ON FUNCTION app.fn_duplicar_presupuesto(uuid, text, text, boolean) IS
  'Clona la EDT completa en estado ABIERTO (RF-PRE-27, D-19). '
  'p_actualizar_apu reapunta las actividades a la versión vigente.';

-- -----------------------------------------------------------------------------
--  RF-APU-12..17 / D-21 / D-22 · Crear una versión de APU y propagarla.
--
--  Editar un APU no modifica nada: crea una versión nueva y la deja vigente. El
--  subtotal de cada línea y el costo directo los calcula AQUÍ la base, con el
--  precio vigente del recurso, y no el backend: es la fórmula más delicada del
--  sistema (D-1) y el sitio donde un error no falla, solo sale mal.
--
--  Las líneas llegan como un arreglo JSON de {recurso_id, cantidad,
--  rendimiento, desperdicio_pct}. Lo demás —código, nombre, tipo, unidad y
--  precio del recurso— lo copia la base del catálogo en ese instante, que es
--  justamente lo que congela la versión.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_nueva_version_apu(
    p_apu_id uuid, p_lineas jsonb, p_nombre text DEFAULT NULL,
    p_unidad_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_apu app.apu; v_tenant uuid; v_ver uuid; v_cd app.dinero;
        v_nombre text; v_unidad uuid; v_simbolo text; v_num integer;
        v_lineas integer; v_resueltas integer;
BEGIN
    SELECT * INTO v_apu FROM app.apu WHERE id = p_apu_id;
    IF v_apu.id IS NULL THEN
        RAISE EXCEPTION 'El APU no existe en esta empresa.';
    END IF;
    v_tenant := v_apu.tenant_id;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El APU');

    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array'
       OR jsonb_array_length(p_lineas) = 0 THEN
        RAISE EXCEPTION
          'Un APU no se puede guardar sin recursos: la composición llegó vacía '
          '(D-21, RF-APU-22).';
    END IF;

    SELECT count(*) INTO v_lineas FROM jsonb_array_elements(p_lineas);
    SELECT count(*) INTO v_resueltas
      FROM jsonb_array_elements(p_lineas) l
      JOIN app.recurso r ON r.id = (l->>'recurso_id')::uuid;
    IF v_lineas <> v_resueltas THEN
        RAISE EXCEPTION
          'Alguna línea apunta a un recurso que no existe en esta empresa.';
    END IF;

    v_nombre := COALESCE(p_nombre, v_apu.nombre);
    v_unidad := COALESCE(p_unidad_id, v_apu.unidad_id);
    SELECT simbolo INTO v_simbolo FROM app.unidad_medida WHERE id = v_unidad;
    IF v_simbolo IS NULL THEN
        RAISE EXCEPTION 'La unidad de medida no existe en esta empresa.';
    END IF;

    -- D-1 · subtotal = cantidad × rendimiento × (1 + desperdicio/100) × precio
    SELECT COALESCE(sum(round(
             (l->>'cantidad')::numeric * (l->>'rendimiento')::numeric
             * (1 + COALESCE((l->>'desperdicio_pct')::numeric, 0) / 100)
             * r.precio_total, 6)), 0)
      INTO v_cd
      FROM jsonb_array_elements(p_lineas) l
      JOIN app.recurso r ON r.id = (l->>'recurso_id')::uuid;

    SELECT COALESCE(max(numero), 0) + 1 INTO v_num
      FROM app.apu_version WHERE apu_id = p_apu_id;

    INSERT INTO app.apu_version
        (tenant_id, apu_id, numero, nombre, unidad_simbolo, costo_directo,
         motivo, creada_por)
    VALUES (v_tenant, p_apu_id, v_num, v_nombre, v_simbolo, v_cd,
            p_motivo, app.fn_usuario_actual())
    RETURNING id INTO v_ver;

    INSERT INTO app.apu_version_recurso
        (tenant_id, apu_version_id, orden, recurso_id, recurso_codigo,
         recurso_nombre, recurso_tipo, unidad_simbolo, precio_unitario,
         cantidad, rendimiento, desperdicio_pct, subtotal)
    SELECT v_tenant, v_ver, row_number() OVER (ORDER BY l.orden),
           r.id, r.codigo, r.nombre, r.tipo, um.simbolo, r.precio_total,
           -- RF-APU-19: cantidad y rendimiento valen 1 si no vienen. Sin el
           -- COALESCE, una línea sin ellos moría con «null value in column
           -- cantidad» en vez de aplicar el valor por defecto que el requisito
           -- promete. Menor de la auditoría del 24 de septiembre de 2026.
           COALESCE((l.linea->>'cantidad')::numeric, 1),
           COALESCE((l.linea->>'rendimiento')::numeric, 1),
           COALESCE((l.linea->>'desperdicio_pct')::numeric, 0),
           round(COALESCE((l.linea->>'cantidad')::numeric, 1)
                 * COALESCE((l.linea->>'rendimiento')::numeric, 1)
                 * (1 + COALESCE((l.linea->>'desperdicio_pct')::numeric, 0) / 100)
                 * r.precio_total, 6)
      FROM jsonb_array_elements(p_lineas) WITH ORDINALITY l(linea, orden)
      JOIN app.recurso r        ON r.id  = (l.linea->>'recurso_id')::uuid
      JOIN app.unidad_medida um ON um.id = r.unidad_id;

    UPDATE app.apu
       SET nombre = v_nombre, unidad_id = v_unidad, version_vigente_id = v_ver
     WHERE id = p_apu_id;

    INSERT INTO app.evento_auditoria
        (tenant_id, entidad, entidad_id, tipo_evento, descripcion,
         valor_anterior, valor_nuevo, usuario_id)
    VALUES (v_tenant, 'APU', p_apu_id, 'APU_VERSIONADO',
            format('Versión %s de «%s»', v_num, v_nombre),
            jsonb_build_object('version_anterior', v_apu.version_vigente_id),
            jsonb_build_object('version', v_ver, 'costo_directo', v_cd::text),
            app.fn_usuario_actual());

    RETURN v_ver;
END $$;
COMMENT ON FUNCTION app.fn_nueva_version_apu(uuid, jsonb, text, uuid, text) IS
  'Única puerta para versionar un APU (D-21, D-22). La base calcula los '
  'subtotales y el costo directo con el precio vigente del recurso (D-1, D-2).';

-- -----------------------------------------------------------------------------
--  D-22 · Propagar el cambio de precio de un recurso.
--
--  Editar un recurso crea una versión nueva de CADA APU que lo usa, y esas
--  versiones quedan vigentes siempre: el catálogo refleja el precio de hoy sin
--  excepción. La respuesta del usuario decide una sola cosa, y es el segundo
--  parámetro: qué presupuestos ABIERTOS se reapuntan a la versión nueva.
--
--  Los presupuestos activos y cerrados no entran nunca, ni aunque se pasen en
--  la lista: el trigger de línea base los rechaza y ese es el punto (D-5).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_propagar_recurso(
    p_recurso_id uuid, p_presupuestos uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_temp AS $$
DECLARE v_tenant uuid; v_codigo text; r record; v_ver uuid;
        v_lineas jsonb; v_n integer := 0; v_costo app.dinero;
BEGIN
    SELECT tenant_id, codigo INTO v_tenant, v_codigo
      FROM app.recurso WHERE id = p_recurso_id;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'El recurso no existe en esta empresa.';
    END IF;
    PERFORM app.fn_exigir_mismo_tenant(v_tenant, 'El recurso');

    FOR r IN
        SELECT a.id AS apu_id, a.version_vigente_id AS ver
          FROM app.apu a
          JOIN app.apu_version_recurso avr
            ON avr.apu_version_id = a.version_vigente_id
         WHERE a.tenant_id = v_tenant AND avr.recurso_id = p_recurso_id
         GROUP BY a.id, a.version_vigente_id
    LOOP
        SELECT jsonb_agg(jsonb_build_object(
                   'recurso_id',      avr.recurso_id,
                   'cantidad',        avr.cantidad,
                   'rendimiento',     avr.rendimiento,
                   'desperdicio_pct', avr.desperdicio_pct)
                 ORDER BY avr.orden)
          INTO v_lineas
          FROM app.apu_version_recurso avr WHERE avr.apu_version_id = r.ver;

        v_ver := app.fn_nueva_version_apu(
                   r.apu_id, v_lineas, NULL, NULL,
                   format('Cambio de precio del recurso %s (D-22)', v_codigo));
        v_n := v_n + 1;

        IF p_presupuestos IS NOT NULL AND array_length(p_presupuestos, 1) > 0 THEN
            SELECT costo_directo INTO v_costo FROM app.apu_version WHERE id = v_ver;
            UPDATE app.presupuesto_item i
               SET apu_version_id  = v_ver,
                   precio_unitario = v_costo,
                   costo_total     = round(i.cantidad * v_costo, 6)
             WHERE i.apu_id = r.apu_id
               AND i.presupuesto_id = ANY (p_presupuestos)
               AND EXISTS (SELECT 1 FROM app.presupuesto p
                            WHERE p.id = i.presupuesto_id AND p.estado = 'ABIERTO');
        END IF;
    END LOOP;

    RETURN v_n;
END $$;
COMMENT ON FUNCTION app.fn_propagar_recurso(uuid, uuid[]) IS
  'Versiona todos los APU que usan el recurso y reapunta solo los presupuestos '
  'ABIERTOS que se le pasen (D-22, RF-REC-12, RF-APU-15..17).';

-- -----------------------------------------------------------------------------
--  D-25 · Vigencia de la suscripción.
--
--  La vigencia incluye tenant.estado: sin él, una empresa suspendida por el
--  superadministrador seguiría dando «vigente». El backend consulta ESTA
--  función en cada petición (RN-18).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.fn_suscripcion_vigente(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(bool_or(
               t.estado = 'ACTIVO'
           AND s.estado IN ('EN_PRUEBA','ACTIVA')
           AND s.fecha_vencimiento >= current_date), false)
      FROM plataforma.tenant t
      LEFT JOIN plataforma.suscripcion s
             ON s.tenant_id = t.id AND s.estado IN ('EN_PRUEBA','ACTIVA')
     WHERE t.id = p_tenant_id;
$$;

-- -----------------------------------------------------------------------------
--  D-25 · Registro de un pago.
--
--  cubre_hasta = max(vencimiento anterior, hoy) + período. El máximo es lo que
--  devuelve el acceso: sumar sobre el vencimiento anterior dejaría bloqueada
--  DESPUÉS de pagar a una prueba vencida el 30-jun que paga treinta días el
--  15-sep, porque quedaría cubierta solo hasta el 30-jul.
--
--  Limpia además las dos marcas de aviso, sin lo cual el aviso del período
--  siguiente no se envía nunca.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.fn_registrar_pago(
    p_suscripcion_id uuid, p_fecha date, p_concepto text, p_monto numeric,
    p_metodo text, p_referencia text, p_periodo_meses smallint,
    p_registrado_por uuid, p_factura_numero text DEFAULT NULL,
    p_factura_cufe text DEFAULT NULL, p_factura_url text DEFAULT NULL,
    p_cubre_hasta date DEFAULT NULL, p_soporte_ruta text DEFAULT NULL)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, app, pg_temp AS $$
DECLARE v_anterior date; v_nueva date; v_tenant uuid;
BEGIN
    SELECT fecha_vencimiento, tenant_id INTO v_anterior, v_tenant
      FROM plataforma.suscripcion WHERE id = p_suscripcion_id FOR UPDATE;
    IF v_anterior IS NULL THEN
        RAISE EXCEPTION 'La suscripción % no existe.', p_suscripcion_id;
    END IF;
    IF p_cubre_hasta IS NULL AND p_periodo_meses IS NULL THEN
        RAISE EXCEPTION
          'El pago necesita el período que cubre o la fecha hasta la cual lo '
          'cubre (D-36).';
    END IF;
    IF p_registrado_por IS NULL THEN
        RAISE EXCEPTION
          'Un pago manual siempre tiene detrás a quien lo registró (D-36). Los '
          'pagos de pasarela entran por plataforma.fn_registrar_pago_pasarela.';
    END IF;

    -- D-36 · Manda la fecha que escribe el superadministrador; el cálculo de
    -- D-25 —max(vencimiento anterior, hoy) + período— queda como propuesta para
    -- cuando no la escriba. El máximo sigue importando: sumar sobre el
    -- vencimiento anterior dejaría bloqueado a quien paga con retraso.
    v_nueva := COALESCE(p_cubre_hasta,
                        (greatest(v_anterior, current_date)
                         + (p_periodo_meses || ' months')::interval)::date);

    IF v_nueva < current_date THEN
        RAISE EXCEPTION
          'La fecha de vencimiento (%) ya pasó: el pago no devolvería el acceso '
          '(D-36).', v_nueva;
    END IF;

    INSERT INTO plataforma.pago
        (suscripcion_id, fecha, concepto, monto, metodo, referencia, estado,
         origen, registrado_por, periodo_meses, cubre_hasta,
         factura_numero, factura_cufe, factura_url, soporte_ruta)
    VALUES (p_suscripcion_id, p_fecha, p_concepto, p_monto, p_metodo,
            p_referencia, 'EXITOSO', 'MANUAL', p_registrado_por,
            p_periodo_meses, v_nueva,
            p_factura_numero, p_factura_cufe, p_factura_url, p_soporte_ruta);

    UPDATE plataforma.suscripcion
       SET estado               = 'ACTIVA',
           fecha_vencimiento    = v_nueva,
           aviso_prueba_en      = NULL,
           aviso_vencimiento_en = NULL
     WHERE id = p_suscripcion_id;

    PERFORM plataforma.fn_evento_plataforma(v_tenant, 'PAGO_REGISTRADO',
        format('Pago de %s por %s; cubre hasta %s', p_monto, p_metodo, v_nueva),
        NULL,
        jsonb_build_object('referencia', p_referencia,
                           'soporte_ruta', p_soporte_ruta),
        p_registrado_por);

    RETURN v_nueva;
END $$;

-- -----------------------------------------------------------------------------
--  RF-CFG-21 · Marcar que el aviso ya salió.
--
--  Los dos avisos —fin de prueba a −2 días y vencimiento a −5— los manda un
--  planificador, y sin marcar el envío saldrían todos los días hasta el
--  vencimiento. Ningún rol puede escribir esas dos columnas: la suscripción es
--  territorio del superadministrador y ni él las tiene en su GRANT. Por eso la
--  marca entra por aquí.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.fn_marcar_aviso(
    p_suscripcion_id uuid, p_tipo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, app, pg_temp AS $$
BEGIN
    IF p_tipo NOT IN ('PRUEBA', 'VENCIMIENTO') THEN
        RAISE EXCEPTION 'Aviso desconocido: %. Use PRUEBA o VENCIMIENTO.', p_tipo;
    END IF;
    UPDATE plataforma.suscripcion
       SET aviso_prueba_en      = CASE WHEN p_tipo = 'PRUEBA'
                                       THEN now() ELSE aviso_prueba_en END,
           aviso_vencimiento_en = CASE WHEN p_tipo = 'VENCIMIENTO'
                                       THEN now() ELSE aviso_vencimiento_en END
     WHERE id = p_suscripcion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La suscripción % no existe.', p_suscripcion_id;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
--  RF-SAD-14 · Designar administrador (D-29).
--
--  La última capa de «una empresa nunca se queda sin administrador». El
--  superadministrador solo tiene SELECT sobre el esquema de los inquilinos, así
--  que sin esta función la promesa no era ejecutable: no podía tocar app.rol ni
--  app.usuario de la empresa afectada.
--
--  Exige justificación escrita, y el campo debe decir CÓMO se verificó la
--  identidad de quien lo pide, no solo que se verificó: esta es la puerta de
--  ingeniería social más grande del producto. Deja rastro en los dos
--  historiales, el de la empresa y el de la plataforma.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_designar_admin(
    p_tenant_id uuid, p_email citext, p_nombre text, p_justificacion text,
    p_usuario_plataforma_id uuid DEFAULT NULL, p_token_hash text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, plataforma, pg_temp AS $$
DECLARE v_rol uuid; v_usuario uuid; v_estado text; v_creado boolean := false;
BEGIN
    IF btrim(COALESCE(p_justificacion, '')) = '' THEN
        RAISE EXCEPTION
          'Designar administrador exige una justificación escrita que diga cómo '
          'se verificó la identidad de quien lo solicita (RF-SAD-14, D-29).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plataforma.tenant WHERE id = p_tenant_id) THEN
        RAISE EXCEPTION 'La empresa no existe.';
    END IF;

    SELECT id INTO v_rol
      FROM app.rol WHERE tenant_id = p_tenant_id AND tipo = 'ADMIN'
     ORDER BY es_sistema DESC, creado_en LIMIT 1;
    IF v_rol IS NULL THEN
        INSERT INTO app.rol (tenant_id, nombre, tipo, es_sistema)
             VALUES (p_tenant_id, 'Administrador', 'ADMIN', true)
          RETURNING id INTO v_rol;
        INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo)
             SELECT p_tenant_id, v_rol, codigo FROM app.permiso;
    END IF;

    SELECT id, estado INTO v_usuario, v_estado
      FROM app.usuario WHERE tenant_id = p_tenant_id AND email = p_email;

    IF v_usuario IS NULL THEN
        -- Usuario nuevo: nace PENDIENTE y fija su contraseña con el enlace de
        -- activación, como cualquier invitado (D-7).
        INSERT INTO app.usuario (tenant_id, rol_id, nombre, email)
             VALUES (p_tenant_id, v_rol, COALESCE(p_nombre, p_email::text), p_email)
          RETURNING id INTO v_usuario;
        v_creado := true;
    ELSE
        UPDATE app.usuario
           SET rol_id = v_rol,
               estado = CASE WHEN estado = 'REVOCADO' AND password_hash IS NOT NULL
                             THEN 'ACTIVO' ELSE estado END
         WHERE id = v_usuario;
    END IF;

    IF p_token_hash IS NOT NULL THEN
        INSERT INTO app.token_recuperacion
               (tenant_id, usuario_id, proposito, token_hash, expira_en)
        VALUES (p_tenant_id, v_usuario, 'ACTIVACION', p_token_hash,
                now() + interval '72 hours');
    END IF;

    INSERT INTO app.evento_auditoria
        (tenant_id, entidad, entidad_id, tipo_evento, descripcion, justificacion)
    VALUES (p_tenant_id, 'TENANT', p_tenant_id, 'ADMIN_RESTABLECIDO',
            format('Administrador designado por el superadministrador: %s%s',
                   p_email, CASE WHEN v_creado THEN ' (usuario nuevo)' ELSE '' END),
            p_justificacion);

    PERFORM plataforma.fn_evento_plataforma(p_tenant_id, 'ADMIN_DESIGNADO',
        format('Administrador designado: %s', p_email), p_justificacion,
        jsonb_build_object('usuario_id', v_usuario, 'usuario_nuevo', v_creado),
        p_usuario_plataforma_id);

    RETURN v_usuario;
END $$;
COMMENT ON FUNCTION plataforma.fn_registrar_pago IS
  'D-25/D-36: pago manual, con su soporte y con la fecha de vencimiento que '
  'fija el superadministrador. Si no la fija, propone max(vencimiento '
  'anterior, hoy) + período.';

-- -----------------------------------------------------------------------------
--  D-40 · El mismo pago, cuando lo confirma una pasarela.
--
--  El MVP cobra a mano y no tiene pasarela (D-13). Pero el día que entre —Wompi
--  u otra—, lo que llega es un webhook: sin persona detrás, repetido si la
--  pasarela reintenta, y con un cuerpo que conviene guardar entero.
--
--  Esta función es ese camino, y ya existe para que el día que se conecte la
--  pasarela no haya que tocar ni la tabla de pagos ni la de suscripciones. Es
--  idempotente por (pasarela, referencia): el tercer reintento del mismo
--  webhook devuelve la misma fecha y no suma un mes más.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.fn_registrar_pago_pasarela(
    p_suscripcion_id uuid, p_monto numeric, p_pasarela text,
    p_referencia text, p_estado_pasarela text, p_datos jsonb DEFAULT NULL,
    p_periodo_meses smallint DEFAULT NULL, p_cubre_hasta date DEFAULT NULL,
    p_concepto text DEFAULT 'Pago de suscripción', p_fecha date DEFAULT NULL)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plataforma, app, pg_temp AS $$
DECLARE v_anterior date; v_nueva date; v_tenant uuid; v_ya date;
BEGIN
    IF p_pasarela IS NULL OR p_referencia IS NULL THEN
        RAISE EXCEPTION
          'Un pago de pasarela necesita la pasarela y su referencia de '
          'transacción: son lo que lo hace irrepetible (D-40).';
    END IF;

    -- Reintento del mismo webhook: se responde lo mismo y no se cobra dos veces.
    SELECT cubre_hasta INTO v_ya FROM plataforma.pago
     WHERE pasarela = p_pasarela AND pasarela_referencia = p_referencia;
    IF FOUND THEN
        RETURN v_ya;
    END IF;

    SELECT fecha_vencimiento, tenant_id INTO v_anterior, v_tenant
      FROM plataforma.suscripcion WHERE id = p_suscripcion_id FOR UPDATE;
    IF v_anterior IS NULL THEN
        RAISE EXCEPTION 'La suscripción % no existe.', p_suscripcion_id;
    END IF;

    v_nueva := COALESCE(p_cubre_hasta,
                        (greatest(v_anterior, current_date)
                         + (COALESCE(p_periodo_meses,
                                     (SELECT periodo_meses FROM plataforma.plan pl
                                       JOIN plataforma.suscripcion s ON s.plan_id = pl.id
                                      WHERE s.id = p_suscripcion_id),
                                     1) || ' months')::interval)::date);

    INSERT INTO plataforma.pago
        (suscripcion_id, fecha, concepto, monto, metodo, referencia, estado,
         origen, pasarela, pasarela_referencia, pasarela_estado, pasarela_datos,
         periodo_meses, cubre_hasta)
    VALUES (p_suscripcion_id, COALESCE(p_fecha, current_date), p_concepto,
            p_monto, p_pasarela, p_referencia, 'EXITOSO',
            'PASARELA', p_pasarela, p_referencia, p_estado_pasarela, p_datos,
            p_periodo_meses, v_nueva);

    UPDATE plataforma.suscripcion
       SET estado               = 'ACTIVA',
           fecha_vencimiento    = v_nueva,
           aviso_prueba_en      = NULL,
           aviso_vencimiento_en = NULL
     WHERE id = p_suscripcion_id;

    PERFORM plataforma.fn_evento_plataforma(v_tenant, 'PAGO_REGISTRADO',
        format('Pago de %s confirmado por %s; cubre hasta %s',
               p_monto, p_pasarela, v_nueva),
        NULL,
        jsonb_build_object('referencia', p_referencia,
                           'estado_pasarela', p_estado_pasarela));

    RETURN v_nueva;
END $$;
COMMENT ON FUNCTION plataforma.fn_registrar_pago_pasarela IS
  'D-40. Camino de la pasarela, idempotente por (pasarela, referencia). No se '
  'usa en el MVP: existe para que conectarla no obligue a migrar pagos ni '
  'suscripciones con clientes vivos.';


-- =============================================================================
--  14. DATOS SEMILLA
-- =============================================================================

-- D-6 · El catálogo arranca con la única moneda que el sistema opera hoy.
-- Entrar a otro país es insertar una fila aquí y crear la empresa con esa
-- moneda base: no hay conversión de divisas ni la habrá mientras una empresa
-- opere en una sola (RN-14).
INSERT INTO plataforma.moneda (codigo, nombre, simbolo, decimales) VALUES
  ('COP', 'Peso colombiano', '$', 2);

INSERT INTO plataforma.plan (codigo, nombre, max_usuarios, roles_personalizados) VALUES
  ('PERSONAL',    'Plan Personal',    2,    false),   -- 1 ingeniero + 1 asistente, RN-11
  ('EMPRESARIAL', 'Plan Empresarial', NULL, true);    -- sin límite fijo

INSERT INTO app.permiso (codigo, modulo, accion, descripcion) VALUES
  ('RECURSOS.VER',          'RECURSOS',     'VER',            'Consultar el catálogo de recursos'),
  ('RECURSOS.CREAR',        'RECURSOS',     'CREAR',          'Crear recursos'),
  ('RECURSOS.EDITAR',       'RECURSOS',     'EDITAR',         'Editar recursos'),
  ('RECURSOS.ELIMINAR',     'RECURSOS',     'ELIMINAR',       'Eliminar recursos sin uso'),
  ('APU.VER',               'APU',          'VER',            'Consultar APU'),
  ('APU.CREAR',             'APU',          'CREAR',          'Crear APU'),
  ('APU.EDITAR',            'APU',          'EDITAR',         'Editar APU'),
  ('APU.ELIMINAR',          'APU',          'ELIMINAR',       'Eliminar APU sin uso'),
  ('PRESUPUESTOS.VER',      'PRESUPUESTOS', 'VER',            'Consultar presupuestos'),
  ('PRESUPUESTOS.CREAR',    'PRESUPUESTOS', 'CREAR',          'Crear presupuestos'),
  ('PRESUPUESTOS.EDITAR',   'PRESUPUESTOS', 'EDITAR',         'Editar la mesa de trabajo, archivar y desarchivar'),
  ('PRESUPUESTOS.EXPORTAR', 'PRESUPUESTOS', 'EXPORTAR',       'Exportar a PDF y Excel'),
  ('PRESUPUESTOS.DUPLICAR', 'PRESUPUESTOS', 'DUPLICAR',       'Duplicar presupuestos'),
  ('PRESUPUESTOS.ESTADO',   'PRESUPUESTOS', 'CAMBIAR_ESTADO', 'Activar, cerrar y reabrir — solo Administrador (RN-03)'),
  ('CONFIG.EMPRESA',        'CONFIG',       'EDITAR',         'Editar datos de empresa y logo'),
  ('CONFIG.PREFERENCIAS',   'CONFIG',       'EDITAR',         'Editar moneda, formatos, AIU y unidades'),
  ('CONFIG.SUSCRIPCION',    'CONFIG',       'VER',            'Consultar suscripción y facturación'),
  ('USUARIOS.GESTIONAR',    'USUARIOS',     'GESTIONAR',      'Crear usuarios y administrar roles');

-- Catálogo de tipos de evento (RF-HIS-03). Tabla y no CHECK: la fase 2 añade
-- los suyos con un INSERT.
INSERT INTO app.tipo_evento (codigo, descripcion, exige_justificacion) VALUES
  ('CAMBIO_ESTADO',           'Cambio de estado del presupuesto',            false),
  ('REAPERTURA',              'Reapertura de un proyecto activo',            true ),
  ('ITEM_AGREGADO',           'Actividad agregada',                          false),
  ('ITEM_ELIMINADO',          'Actividad eliminada',                         false),
  ('CANTIDAD_MODIFICADA',     'Cantidad de obra modificada',                 false),
  ('PRECIO_MODIFICADO',       'Precio unitario modificado',                  false),
  ('CAPITULO_AGREGADO',       'Capítulo agregado',                           false),
  ('CAPITULO_ELIMINADO',      'Capítulo eliminado',                          false),
  ('AIU_MODIFICADO',          'Porcentajes de AIU modificados',              false),
  ('PRESUPUESTO_ARCHIVADO',   'Presupuesto archivado (D-18)',                false),
  ('PRESUPUESTO_DESARCHIVADO','Presupuesto desarchivado (D-18)',             false),
  ('PRESUPUESTO_ELIMINADO',   'Presupuesto nunca activado, eliminado (D-18)', true ),
  ('PRESUPUESTO_DUPLICADO',   'Presupuesto duplicado (D-19)',                false),
  ('RECURSO_MODIFICADO',      'Recurso editado, con la versión de APU que generó', false),
  ('APU_VERSIONADO',          'Versión nueva de APU (D-22)',                 false),
  ('ADMIN_RESTABLECIDO',      'Administrador designado por el superadministrador (D-29)', true);


-- =============================================================================
--  15. CIERRE: APLICAR EL AISLAMIENTO Y COMPROBARLO
--
--  Toda migración futura que cree una tabla de inquilino termina exactamente
--  así. Es lo que impide que una tabla nueva nazca sin aislamiento.
-- =============================================================================

-- El DROP POLICY IF EXISTS de dentro avisa de cada política que todavía no
-- existe: en la primera ejecución son dieciséis avisos que no dicen nada.
SET client_min_messages = warning;
SELECT app.fn_aplicar_rls();
RESET client_min_messages;

DO $$
DECLARE v_faltan text;
BEGIN
    SELECT string_agg(tabla || ' (' || problema || ')', ', ')
      INTO v_faltan FROM app.fn_verificar_rls();
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION 'Tablas de inquilino sin aislamiento: %', v_faltan;
    END IF;
    RAISE NOTICE 'Aislamiento verificado: ninguna tabla de app quedó sin política.';
END $$;

-- =============================================================================
--  16. EL MODELO DE PRIVILEGIOS  (decisión P4)
--
--  Aquí se cierra de raíz que el rol de la aplicación pueda borrar historial,
--  escribir totales a mano, reabrir sin ser admin o ejecutar la eliminación de
--  inquilinos. La regla es privilegio mínimo, no banderas de sesión.
-- =============================================================================

-- construsoft_super hereda de construsoft_owner para poder escribir en sus
-- tablas desde las funciones de alta/eliminación de inquilino (y BYPASSRLS le
-- deja cruzar el contexto que esas operaciones necesitan).
GRANT construsoft_owner TO construsoft_super;

-- 16.1 · La propiedad de las tablas y vistas pasa a construsoft_owner (NOLOGIN,
--        no superusuario, no BYPASSRLS). Con FORCE ROW LEVEL SECURITY, el dueño
--        también queda sujeto al aislamiento, así que una función SECURITY
--        DEFINER suya no puede cruzar inquilinos: es lo que cierra el borrado
--        cruzado de APU y recurso.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT schemaname, tablename FROM pg_tables
              WHERE schemaname IN ('app','plataforma') LOOP
        EXECUTE format('ALTER TABLE %I.%I OWNER TO construsoft_owner', r.schemaname, r.tablename);
    END LOOP;
    FOR r IN SELECT sequence_schema AS schemaname, sequence_name AS tablename
               FROM information_schema.sequences
              WHERE sequence_schema IN ('app','plataforma') LOOP
        EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO construsoft_owner', r.schemaname, r.tablename);
    END LOOP;
    FOR r IN SELECT schemaname, viewname FROM pg_views
              WHERE schemaname IN ('app','plataforma') LOOP
        EXECUTE format('ALTER VIEW %I.%I OWNER TO construsoft_owner', r.schemaname, r.viewname);
        -- security_invoker: la vista aplica la RLS de QUIEN consulta, no la del
        -- dueño. Sin esto, una vista de un dueño BYPASSRLS filtraría todos los
        -- inquilinos; y una de un dueño sujeto a RLS no vería nada sin contexto.
        EXECUTE format('ALTER VIEW %I.%I SET (security_invoker = true)', r.schemaname, r.viewname);
    END LOOP;
END $$;

-- 16.2 · Funciones que escriben columnas o tablas vedadas al rol de la app y que
--        las dispara una operación ya filtrada por RLS (un INSERT/UPDATE del
--        propio inquilino) o que comprueban el inquilino por su cuenta. Son
--        SECURITY DEFINER de construsoft_super: escriben sin depender de que el
--        contexto de inquilino esté fijado (lo requiere la carga inicial y la
--        batería, que corren como superusuario). No leen datos ajenos: reciben
--        el id del presupuesto que la fila disparadora ya acotó al inquilino.
ALTER FUNCTION app.fn_evento_interno(uuid,uuid,text,uuid,text,text,jsonb,jsonb,text)
    OWNER TO construsoft_super;
-- Las tres de D-47: filtran el inquilino ellas mismas y no reciben ningún
-- identificador del cliente, solo un texto de búsqueda.
ALTER FUNCTION app.fn_buscar_recurso(text,text,integer)         OWNER TO construsoft_super;
ALTER FUNCTION app.fn_buscar_apu(text,integer)                  OWNER TO construsoft_super;
ALTER FUNCTION app.fn_buscar_presupuesto(text,integer)          OWNER TO construsoft_super;
ALTER FUNCTION app.fn_recalcular_presupuesto(uuid)              OWNER TO construsoft_super;
ALTER FUNCTION app.fn_guardar_version(uuid,text,text,text,text) OWNER TO construsoft_super;
ALTER FUNCTION app.fn_activar_presupuesto(uuid)                 OWNER TO construsoft_super;
ALTER FUNCTION app.fn_cerrar_presupuesto(uuid)                  OWNER TO construsoft_super;
ALTER FUNCTION app.fn_reabrir_presupuesto(uuid,text)           OWNER TO construsoft_super;
-- Auditoría de la plataforma y avisos (D-38, RF-CFG-21): escriben tablas que
-- ningún rol de conexión puede tocar, y corren sin contexto de inquilino.
ALTER FUNCTION plataforma.fn_evento_plataforma(uuid,text,text,text,jsonb,uuid)
    OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_auditar_tenant()                   OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_auditar_suscripcion()              OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_marcar_aviso(uuid,text)            OWNER TO construsoft_super;

-- 16.3 · Estas SÍ reciben un id arbitrario del cliente, así que su dueño es
--        construsoft_owner (NO BYPASSRLS): la RLS del propio dueño bloquea el
--        cruce de inquilinos, además del chequeo explícito que llevan dentro.
ALTER FUNCTION app.fn_eliminar_apu(uuid)                        OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_eliminar_recurso(uuid)                    OWNER TO construsoft_owner;
-- Las tres operaciones de D-39, por la misma razón: reciben identificadores que
-- llegan del cliente y escriben en varias tablas del inquilino.
ALTER FUNCTION app.fn_renumerar_wbs(uuid)                       OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_duplicar_presupuesto(uuid,text,text,boolean)
    OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_nueva_version_apu(uuid,jsonb,text,uuid,text)
    OWNER TO construsoft_owner;
ALTER FUNCTION app.fn_propagar_recurso(uuid,uuid[])             OWNER TO construsoft_owner;

-- 16.4 · Alta y eliminación de inquilino y registro de pago: cruzan inquilinos o
--        corren sin contexto, de construsoft_super (BYPASSRLS).
ALTER FUNCTION app.fn_alta_tenant(text,text,text,text,citext,text,citext) OWNER TO construsoft_super;
ALTER FUNCTION app.fn_eliminar_tenant(uuid,text,uuid)          OWNER TO construsoft_super;
ALTER FUNCTION app.fn_designar_admin(uuid,citext,text,text,uuid,text)
    OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_registrar_pago(uuid,date,text,numeric,text,text,smallint,uuid,text,text,text,date,text)
    OWNER TO construsoft_super;
ALTER FUNCTION plataforma.fn_registrar_pago_pasarela(uuid,numeric,text,text,text,jsonb,smallint,date,text,date)
    OWNER TO construsoft_super;

-- 16.5 · Privilegios de la aplicación (grupo construsoft_app). Privilegio
--        mínimo: SELECT amplio (la RLS filtra por inquilino); INSERT donde la
--        app crea filas; DELETE y UPDATE por columna donde corresponde; y NADA
--        sobre el estado, los totales ni las tablas inmutables.
GRANT SELECT ON ALL TABLES IN SCHEMA app TO construsoft_app;
GRANT SELECT ON plataforma.tenant, plataforma.suscripcion, plataforma.plan,
                plataforma.moneda, plataforma.pago TO construsoft_app;
-- El contador de app.uuid_v7() (D-48): sin USAGE, el DEFAULT de toda llave
-- primaria muere con «permission denied for sequence». No expone ningún dato:
-- es un número de 0 a 4.095 que da vueltas.
GRANT USAGE ON SEQUENCE app.seq_uuid_v7 TO construsoft_app;

-- app.evento_auditoria NO está en esta lista, y es deliberado (D-45): el
-- historial lo escriben los triggers de este esquema por app.fn_evento_interno.
-- Mientras la aplicación tuvo INSERT, podía firmar un CAMBIO_ESTADO a nombre de
-- cualquier usuario, y los eventos de edición que RF-HIS-03 promete no los
-- escribía nadie. Hallazgo 4 de la auditoría del 24 de septiembre de 2026.
GRANT INSERT ON app.recurso, app.apu, app.apu_version, app.apu_version_recurso,
                app.presupuesto, app.wbs_nodo, app.presupuesto_item,
                app.rol, app.rol_permiso,
                app.usuario, app.unidad_medida, app.token_recuperacion,
                app.configuracion_empresa TO construsoft_app;

-- DELETE solo donde el día a día lo permite; nunca sobre las cuatro inmutables
-- (apu_version, apu_version_recurso, presupuesto_version, evento_auditoria).
GRANT DELETE ON app.presupuesto, app.wbs_nodo, app.presupuesto_item,
                app.rol, app.rol_permiso, app.unidad_medida, app.recurso,
                app.token_recuperacion TO construsoft_app;

-- UPDATE por columna: ni estado, ni los totales, ni valor_total.
-- iva_utilidad_pct y modo_estructura faltaban en esta lista, y con ellos dos
-- requisitos que el resto del esquema ya sostenía: RF-PRE-23 (editar el IVA con
-- el proyecto Abierto, que tg_recalculo_aiu ya recalculaba) y RF-PRE-44 (cambiar
-- el modo de estructura mientras no haya subcapítulos, que tg_cambio_modo_
-- estructura ya vigilaba). Los triggers estaban escritos para columnas que la
-- aplicación no podía tocar. Hallazgo 3 de la auditoría del 24 de septiembre
-- de 2026. El congelamiento en ACTIVO las cubre igual: las dos están en la lista
-- de fn_cabecera_presupuesto.
GRANT UPDATE (codigo, nombre, ubicacion, aiu_administracion, aiu_imprevistos,
              aiu_utilidad, iva_utilidad_pct, modo_estructura,
              archivado_en, fecha_modificacion, duplicado_de_id)
    ON app.presupuesto TO construsoft_app;
-- del ítem: nunca su número, que lo deriva la renumeración.
GRANT UPDATE (wbs_nodo_id, orden, apu_id, apu_version_id, codigo_apu, descripcion,
              unidad_simbolo, precio_unitario, cantidad, costo_total)
    ON app.presupuesto_item TO construsoft_app;
-- del nodo: todo menos monto_acumulado (lo escribe el recálculo).
GRANT UPDATE (padre_id, orden, nivel, codigo_wbs, nombre, clasificacion)
    ON app.wbs_nodo TO construsoft_app;
-- tablas cuyos guardianes ya defienden las columnas inmutables por trigger.
GRANT UPDATE ON app.recurso, app.apu, app.rol, app.rol_permiso, app.usuario,
                app.unidad_medida, app.configuracion_empresa, app.secuencia_codigo,
                app.token_recuperacion TO construsoft_app;
-- plataforma: solo los datos de empresa que RF-CFG-04/05 dejan editar. Ni
-- estado del inquilino, ni suscripción, ni pagos, ni planes.
-- D-34 · El NIT entra en la lista: RF-CFG-04 lo muestra como dato editable de
-- la empresa y antes no había forma de corregirlo ni de agregarlo. Su unicidad
-- la sigue defendiendo ux_tenant_nit.
GRANT UPDATE (razon_social, nit, logo_ruta, direccion, telefono,
              email_recuperacion, acepto_terminos_en, version_terminos)
    ON plataforma.tenant TO construsoft_app;

-- 16.6 · EXECUTE. Las funciones peligrosas dejan de ser públicas; el resto sigue
--        disponible (las SECURITY DEFINER corren como su dueño, no como quien
--        llama, así que exponerlas no eleva privilegios). fn_alta_tenant ya se
--        revocó de PUBLIC en su definición.
REVOKE EXECUTE ON FUNCTION app.fn_eliminar_tenant(uuid,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.fn_designar_admin(uuid,citext,text,text,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plataforma.fn_registrar_pago(uuid,date,text,numeric,text,text,smallint,uuid,text,text,text,date,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plataforma.fn_registrar_pago_pasarela(uuid,numeric,text,text,text,jsonb,smallint,date,text,date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plataforma.fn_evento_plataforma(uuid,text,text,text,jsonb,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.fn_alta_tenant(text,text,text,text,citext,text,citext) TO construsoft_app;

-- Las funciones que la aplicación sí usa dejan de ser públicas y se conceden
-- por nombre: todas comprueban la empresa por su cuenta, pero una función de un
-- dueño con BYPASSRLS no tiene por qué estar al alcance de cualquier rol.
REVOKE EXECUTE ON FUNCTION
    app.fn_recalcular_presupuesto(uuid),
    app.fn_guardar_version(uuid,text,text,text,text),
    app.fn_activar_presupuesto(uuid),
    app.fn_cerrar_presupuesto(uuid),
    app.fn_reabrir_presupuesto(uuid,text),
    app.fn_renumerar_wbs(uuid),
    app.fn_duplicar_presupuesto(uuid,text,text,boolean),
    app.fn_nueva_version_apu(uuid,jsonb,text,uuid,text),
    app.fn_propagar_recurso(uuid,uuid[]),
    app.fn_eliminar_apu(uuid),
    app.fn_eliminar_recurso(uuid),
    app.fn_evento_interno(uuid,uuid,text,uuid,text,text,jsonb,jsonb,text),
    app.fn_buscar_recurso(text,text,integer),
    app.fn_buscar_apu(text,integer),
    app.fn_buscar_presupuesto(text,integer),
    plataforma.fn_marcar_aviso(uuid,text)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    app.fn_recalcular_presupuesto(uuid),
    app.fn_guardar_version(uuid,text,text,text,text),
    app.fn_activar_presupuesto(uuid),
    app.fn_cerrar_presupuesto(uuid),
    app.fn_reabrir_presupuesto(uuid,text),
    app.fn_renumerar_wbs(uuid),
    app.fn_duplicar_presupuesto(uuid,text,text,boolean),
    app.fn_nueva_version_apu(uuid,jsonb,text,uuid,text),
    app.fn_propagar_recurso(uuid,uuid[]),
    app.fn_eliminar_apu(uuid),
    app.fn_eliminar_recurso(uuid),
    -- No es una puerta para escribir el historial a mano: la función se niega
    -- fuera de un trigger (pg_trigger_depth). El permiso está aquí porque los
    -- triggers de historia corren con el rol de la aplicación, y tienen que
    -- correr con el suyo para que las banderas internas de D-37 sigan
    -- distinguiéndola de una función interna.
    app.fn_evento_interno(uuid,uuid,text,uuid,text,text,jsonb,jsonb,text),
    app.fn_buscar_recurso(text,text,integer),
    app.fn_buscar_apu(text,integer),
    app.fn_buscar_presupuesto(text,integer),
    plataforma.fn_marcar_aviso(uuid,text)
    TO construsoft_app;

-- Y a construsoft_owner, porque estas funciones también se llaman desde
-- dentro: el trigger de recálculo se dispara con las actividades que inserta
-- fn_duplicar_presupuesto, y fn_propagar_recurso versiona llamando a
-- fn_nueva_version_apu. Sin esto, duplicar un presupuesto muere con «permission
-- denied for function fn_recalcular_presupuesto». construsoft_super hereda de
-- owner, así que las transiciones de estado quedan cubiertas por la misma línea.
GRANT EXECUTE ON FUNCTION
    app.fn_recalcular_presupuesto(uuid),
    app.fn_guardar_version(uuid,text,text,text,text),
    app.fn_nueva_version_apu(uuid,jsonb,text,uuid,text),
    app.fn_evento_interno(uuid,uuid,text,uuid,text,text,jsonb,jsonb,text)
    TO construsoft_owner;

-- 16.7 · El panel del superadministrador (grupo construsoft_superadmin). El rol
--        de conexión del despliegue lo hereda y se crea con BYPASSRLS para las
--        métricas agregadas de todos los inquilinos (RF-SAD-02, RF-SAD-10).
GRANT SELECT ON ALL TABLES IN SCHEMA app TO construsoft_superadmin;
GRANT SELECT ON ALL TABLES IN SCHEMA plataforma TO construsoft_superadmin;
GRANT USAGE ON SEQUENCE app.seq_uuid_v7 TO construsoft_superadmin;
GRANT SELECT ON plataforma.usuario_plataforma TO construsoft_superadmin;
GRANT UPDATE (estado) ON plataforma.tenant TO construsoft_superadmin;               -- suspender/reactivar
GRANT UPDATE (plan_id, fecha_vencimiento, estado, cancelada_en, cancelada_motivo)
    ON plataforma.suscripcion TO construsoft_superadmin;                            -- RF-SAD-06
GRANT EXECUTE ON FUNCTION app.fn_eliminar_tenant(uuid,text,uuid) TO construsoft_superadmin;
GRANT EXECUTE ON FUNCTION plataforma.fn_registrar_pago(uuid,date,text,numeric,text,text,smallint,uuid,text,text,text,date,text) TO construsoft_superadmin;
-- El webhook de la pasarela (D-40) se atiende con el rol del panel, no con el
-- de la aplicación: quien confirma un pago no puede ser el mismo rol que
-- atiende a los inquilinos.
GRANT EXECUTE ON FUNCTION plataforma.fn_registrar_pago_pasarela(uuid,numeric,text,text,text,jsonb,smallint,date,text,date) TO construsoft_superadmin;
GRANT EXECUTE ON FUNCTION app.fn_alta_tenant(text,text,text,text,citext,text,citext) TO construsoft_superadmin;
-- RF-SAD-14 y RF-CFG-21: designar administrador y marcar los avisos enviados.
-- Sin estas dos concesiones el panel no podía hacer ni lo uno ni lo otro, por
-- más que el requisito lo prometiera: solo tenía SELECT sobre el esquema de los
-- inquilinos.
GRANT EXECUTE ON FUNCTION app.fn_designar_admin(uuid,citext,text,text,uuid,text)
    TO construsoft_superadmin;
GRANT EXECUTE ON FUNCTION plataforma.fn_marcar_aviso(uuid,text)
    TO construsoft_superadmin;

-- -----------------------------------------------------------------------------
--  16.8 · Lo único que decide el despliegue son los roles de CONEXIÓN (con
--         contraseña); heredan de los grupos de arriba y no son dueños de nada:
--
--      CREATE ROLE app_login LOGIN PASSWORD '...';
--      GRANT construsoft_app TO app_login;
--
--      CREATE ROLE superadmin_login LOGIN BYPASSRLS PASSWORD '...';
--      GRANT construsoft_superadmin TO superadmin_login;
--
--      CREATE ROLE auth_login LOGIN PASSWORD '...';
--      GRANT construsoft_autenticador TO auth_login;   -- NO construsoft_auth
--
--  La aplicación se conecta con app_login; el panel de superadministración con
--  superadmin_login; y SOLO el paso de autenticación —resolver un correo,
--  resolver un token de recuperación— con auth_login (D-46). Son tres
--  conexiones, no una con tres sombreros: si el backend usa app_login para
--  iniciar sesión, fn_autenticar le responde «permission denied», que es
--  exactamente lo que tiene que pasar.
--
--  Cuidado con la última línea, porque es una trampa que ya se cayó una vez:
--  auth_login es miembro de construsoft_autenticador y NUNCA de construsoft_auth.
--  Los dos nombres se parecen y el efecto es muy distinto. construsoft_auth lleva
--  BYPASSRLS, así que un miembro suyo puede hacer SET ROLE construsoft_auth y
--  leer la tabla de usuarios entera, con hashes, de todas las empresas. Y la
--  conexión de login es justo la que atiende peticiones sin autenticar: una
--  inyección ahí vacía la plataforma. construsoft_autenticador no lleva
--  BYPASSRLS y solo puede ejecutar las dos funciones; vestirse de él no da nada.
--
--  Las funciones siguen corriendo con los privilegios de construsoft_auth, que
--  es su dueño, porque son SECURITY DEFINER. Nadie necesita SER ese rol.
--
--  Comprobarlo después de crear los tres roles, y que devuelva cero filas:
--
--      SELECT * FROM app.fn_verificar_roles_login();
--
--  Ninguno de los tres es dueño de las tablas ni superusuario.
-- =============================================================================
--  Fin del esquema.
-- =============================================================================
