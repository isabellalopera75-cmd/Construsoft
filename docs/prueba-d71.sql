-- ============================================================================
--  PRUEBA DE D-71 · El logotipo, los comprobantes de pago y los nombres únicos
--
--      psql -U postgres -d construsoft -f "docs/prueba-d71.sql"
--
--  Se juzga sola, como prueba-d65-d68: cada caso deja lo que obtuvo y lo que
--  debía obtener, y al final LEVANTA UNA EXCEPCIÓN si alguno discrepa.
--
--  No deja nada: termina con ROLLBACK. Necesita una base RECIÉN CARGADA: da de
--  alta dos empresas con NIT fijo.
-- ============================================================================
SELECT current_setting('is_superuser') = 'on' AS es_superusuario \gset
\if :es_superusuario
\else
\echo ''
\echo '  DETENIDO. Esta prueba se ejecuta como SUPERUSUARIO.'
\echo ''
\set ON_ERROR_STOP on
DO $$ BEGIN
    RAISE EXCEPTION 'prueba-d71 se ejecuta como superusuario, y esta conexion no lo es.';
END $$;
\endif

\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE TEMP TABLE resultado (caso text, obtenido text, esperado text);
GRANT INSERT, SELECT ON resultado TO construsoft_app, construsoft_superadmin;

-- Corre una sentencia y devuelve el SQLSTATE en vez de estallar.
CREATE FUNCTION pg_temp.correr(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

SELECT id_tenant AS t_a, id_usuario AS u_a
  FROM app.fn_alta_tenant('Logo A SAS','901.771.001-1','EMPRESARIAL',
                          'Ana Admin','ana@d71.co','hash_A') \gset
SELECT id_tenant AS t_b, id_usuario AS u_b
  FROM app.fn_alta_tenant('Logo B SAS','901.771.002-2','EMPRESARIAL',
                          'Beto Admin','beto@d71.co','hash_B') \gset
INSERT INTO plataforma.usuario_plataforma (nombre, email, password_hash)
VALUES ('Soporte', 'soporte@d71.co', 'hash_P') RETURNING id AS sp \gset

-- Una imagen de prueba: los ocho bytes de firma de un PNG bastan, el CHECK
-- mide tamaño y tipo, no decodifica.
\set png '''\\x89504e470d0a1a0a'''

-- ============================================================================
--  app.logo · lo que la aplicación puede y no puede hacer
-- ============================================================================
SET ROLE construsoft_app;
SELECT set_config('app.tenant_id',  :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
INSERT INTO app.logo (tenant_id, sha256, tipo, contenido)
VALUES (:'t_b', repeat('b', 64), 'image/png', :png::bytea) RETURNING id AS logo_b \gset

SELECT set_config('app.tenant_id',  :'t_a', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_a', true) AS _ \gset x_
INSERT INTO app.logo (tenant_id, sha256, tipo, contenido)
VALUES (:'t_a', repeat('a', 64), 'image/png', :png::bytea) RETURNING id AS logo_a \gset

INSERT INTO resultado VALUES
  ('logo · poner el propio como vigente',
   pg_temp.correr(format('UPDATE plataforma.tenant SET logo_ruta = %L WHERE id = %L', :'logo_a', :'t_a')), 'OK'),
  ('logo · el de otra empresa no se puede señalar',
   pg_temp.correr(format('UPDATE plataforma.tenant SET logo_ruta = %L WHERE id = %L', :'logo_b', :'t_a')), 'P0001'),
  ('logo · una ruta que no es un id',
   pg_temp.correr(format('UPDATE plataforma.tenant SET logo_ruta = %L WHERE id = %L', 'logos/a.png', :'t_a')), 'P0001'),
  ('logo · quitarlo es dejar la ruta en nulo',
   pg_temp.correr(format('UPDATE plataforma.tenant SET logo_ruta = NULL WHERE id = %L', :'t_a')), 'OK'),
  ('logo · la misma imagen dos veces es la misma fila',
   pg_temp.correr(format('INSERT INTO app.logo (tenant_id, sha256, tipo, contenido) VALUES (%L, %L, %L, %L::bytea)',
                         :'t_a', repeat('a', 64), 'image/png', '\x89504e470d0a1a0a')), '23505'),
  ('logo · un SVG no entra',
   pg_temp.correr(format('INSERT INTO app.logo (tenant_id, sha256, tipo, contenido) VALUES (%L, %L, %L, %L::bytea)',
                         :'t_a', repeat('c', 64), 'image/svg+xml', '\x3c737667')), '23514'),
  ('logo · más de 1 MB no entra',
   pg_temp.correr(format('INSERT INTO app.logo (tenant_id, sha256, tipo, contenido) VALUES (%L, %L, %L, decode(repeat(%L, 1048577), %L))',
                         :'t_a', repeat('d', 64), 'image/png', '00', 'hex')), '23514'),
  ('logo · la aplicación no lo cambia',
   pg_temp.correr(format('UPDATE app.logo SET tipo = %L WHERE id = %L', 'image/jpeg', :'logo_a')), '42501'),
  ('logo · la aplicación no lo borra (D-64)',
   pg_temp.correr(format('DELETE FROM app.logo WHERE id = %L', :'logo_a')), '42501');

-- Aislamiento: desde A no se ve el logo de B.
INSERT INTO resultado
SELECT 'logo · desde A no se ve el de B', count(*)::text, '0'
  FROM app.logo WHERE id = :'logo_b';

-- ============================================================================
--  Nombres únicos de recurso y de APU
-- ============================================================================
SELECT id AS um FROM app.unidad_medida WHERE tenant_id = :'t_a' LIMIT 1 \gset
INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id,
                         precio_base, iva_pct, precio_total, via_captura)
VALUES (:'t_a','R1','Cemento gris','MATERIAL', :'um',1000,0,1000,'BASE');
INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id)
VALUES (:'t_a','A1','Muro en bloque', :'um');

INSERT INTO resultado VALUES
  ('nombre · recurso repetido con mayúsculas y espacios',
   pg_temp.correr(format('INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct, precio_total, via_captura) VALUES (%L,%L,%L,%L,%L,1,0,1,%L)',
                         :'t_a','R2','  CEMENTO GRIS ','MATERIAL', :'um','BASE')), '23505'),
  ('nombre · APU repetido con mayúsculas y espacios',
   pg_temp.correr(format('INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id) VALUES (%L,%L,%L,%L)',
                         :'t_a','A2',' muro EN bloque', :'um')), '23505');

-- El mismo nombre en otra empresa sí entra.
SELECT set_config('app.tenant_id',  :'t_b', true) AS _ \gset x_
SELECT set_config('app.usuario_id', :'u_b', true) AS _ \gset x_
SELECT id AS um_b FROM app.unidad_medida WHERE tenant_id = :'t_b' LIMIT 1 \gset
INSERT INTO resultado VALUES
  ('nombre · el mismo recurso en otra empresa',
   pg_temp.correr(format('INSERT INTO app.recurso (tenant_id, codigo, nombre, tipo, unidad_id, precio_base, iva_pct, precio_total, via_captura) VALUES (%L,%L,%L,%L,%L,1,0,1,%L)',
                         :'t_b','R1','Cemento gris','MATERIAL', :'um_b','BASE')), 'OK');

-- ============================================================================
--  plataforma.soporte_pago · solo el panel
-- ============================================================================
INSERT INTO resultado VALUES
  ('soporte · la aplicación no lo lee',
   pg_temp.correr('SELECT count(*) FROM plataforma.soporte_pago'), '42501');
RESET ROLE;

SET ROLE construsoft_superadmin;
INSERT INTO resultado VALUES
  ('soporte · el panel sube un PDF',
   pg_temp.correr(format('INSERT INTO plataforma.soporte_pago (sha256, tipo, contenido, subido_por) VALUES (%L,%L,%L::bytea,%L)',
                         repeat('e', 64), 'application/pdf', '\x255044462d', :'sp')), 'OK'),
  ('soporte · un ejecutable no entra',
   pg_temp.correr(format('INSERT INTO plataforma.soporte_pago (sha256, tipo, contenido, subido_por) VALUES (%L,%L,%L::bytea,%L)',
                         repeat('f', 64), 'application/octet-stream', '\x4d5a', :'sp')), '23514'),
  ('soporte · el panel no lo cambia',
   pg_temp.correr('UPDATE plataforma.soporte_pago SET tipo = ''image/png'''), '42501'),
  ('soporte · el panel no lo borra',
   pg_temp.correr('DELETE FROM plataforma.soporte_pago'), '42501'),
  ('soporte · el panel lo lee',
   pg_temp.correr('SELECT count(*) FROM plataforma.soporte_pago'), 'OK');
RESET ROLE;

-- ============================================================================
--  El veredicto
-- ============================================================================
\echo ''
\echo '=== Casos que NO dieron lo esperado (lo correcto es ninguno)'
SELECT caso, obtenido, esperado
  FROM resultado WHERE obtenido IS DISTINCT FROM esperado ORDER BY caso;

DO $$
DECLARE v_mal integer; v_total integer;
BEGIN
    SELECT count(*) FILTER (WHERE obtenido IS DISTINCT FROM esperado), count(*)
      INTO v_mal, v_total FROM resultado;
    IF v_mal > 0 THEN
        RAISE EXCEPTION
          '% de % casos de D-71 no dieron lo esperado. La tabla de arriba dice cuáles.',
          v_mal, v_total;
    END IF;
    RAISE NOTICE 'D-71 verificado: % casos, todos conformes.', v_total;
END $$;

ROLLBACK;
