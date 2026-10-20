#!/usr/bin/env bash
# Rehace construsoft_test desde cero antes de cada corrida de pruebas.
#
# Antes, las pruebas de integración corrían contra la base de desarrollo:
# no había un estado de partida conocido y las empresas de prueba se
# acumulaban (hacían falta sufijos aleatorios para no chocar con un
# UNIQUE). Eso no era fricción, era el síntoma. Este script reconstruye
# construsoft_test —drop, create, cargar el esquema— así que cada corrida
# arranca en el mismo estado y los fixtures pueden usar valores fijos.
#
# Los roles de grupo (construsoft_app, construsoft_auth, ...) y los de
# conexión (app_login, auth_login, superadmin_login) son del CLÚSTER, no de
# esta base de datos: ya existen en el servidor y este script no los toca.
set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$DIR_SCRIPT/.." && pwd)"
# ESQUEMA se puede pasar desde afuera: el pre-commit carga el del índice, no
# el del árbol de trabajo, que puede traer cambios en curso de otro autor.
ESQUEMA="${ESQUEMA:-$RAIZ/docs/05 - construsoft_mvp_schema.sql}"
# Las migraciones van después del esquema (D-77). MIGRACIONES también se pasa
# desde afuera: el hook arma una carpeta con las del índice.
MIGRACIONES="${MIGRACIONES:-$RAIZ/docs/migraciones}"

# ARCHIVO_ENV es overridable (por ejemplo, para correr este mismo script
# contra un .env de verificación distinto sin tocar .env.test).
ARCHIVO_ENV="${ARCHIVO_ENV:-$RAIZ/.env.test}"

set -a
# shellcheck disable=SC1091
source "$ARCHIVO_ENV"
set +a

export PGPASSWORD="$TEST_SUPERUSER_PASSWORD"
# Sin esto, psql en Windows toma el codepage de la consola (WIN1252/850) como
# client_encoding, y el .sql —UTF-8, con tildes y rayas— revienta a mitad de
# archivo con "carácter... no tiene equivalente en la codificación". El
# esquema en sí no tiene ningún problema; es psql adivinando mal la
# codificación de entrada.
export PGCLIENTENCODING=UTF8
CONEXION=(-h "$TEST_SUPERUSER_HOST" -p "$TEST_SUPERUSER_PORT" -U "$TEST_SUPERUSER_USER")

recrear_base() {
    dropdb --if-exists "${CONEXION[@]}" "$TEST_SUPERUSER_DB"
    createdb -E UTF8 -T template0 "${CONEXION[@]}" "$TEST_SUPERUSER_DB"
    psql -v ON_ERROR_STOP=1 "${CONEXION[@]}" -d "$TEST_SUPERUSER_DB" -f "$ESQUEMA" > /dev/null
}

# La última migración, aplicada sobre una base que ya tiene una empresa.
#
# Una base vacía no ejercita el relleno de datos de las empresas existentes,
# y construsoft sí las tiene. La 0004 pasó todas las baterías y falló al
# aplicarla en construsoft (20 de octubre de 2026): el relleno dejaba eventos
# de disparadores diferidos pendientes y un ALTER TABLE posterior se negaba.
# Este pase lo habría detenido aquí. Las pruebas arrancan sin empresas y con
# valores fijos, así que la empresa sembrada no se queda: después de este
# pase la base se rehace limpia.
shopt -s nullglob
migraciones=()
for archivo in "$MIGRACIONES"/[0-9][0-9][0-9][0-9]-*.sql; do
    [[ "$archivo" == *.revertir.sql ]] || migraciones+=("$archivo")
done
shopt -u nullglob
if (( ${#migraciones[@]} > 0 )); then
    ultima="${migraciones[${#migraciones[@]}-1]}"
    echo "→ $(basename "$ultima") sobre una base con una empresa..."
    anteriores=$(mktemp -d)
    trap 'rm -rf "$anteriores"' EXIT
    for archivo in "${migraciones[@]}"; do
        [[ "$archivo" == "$ultima" ]] || cp "$archivo" "$anteriores/"
    done
    recrear_base
    bash "$DIR_SCRIPT/aplicar-migraciones.sh" "$anteriores" "$TEST_SUPERUSER_DB" "${CONEXION[@]}" > /dev/null
    # El hash es un valor de relleno: nadie ingresa con esta cuenta. Va por
    # stdin y no con -c: en Windows el argumento llega a psql en el codepage
    # de la consola, y las tildes revientan como UTF-8 inválido.
    psql -v ON_ERROR_STOP=1 "${CONEXION[@]}" -d "$TEST_SUPERUSER_DB" -q -At > /dev/null <<'SQL'
SELECT count(*) FROM app.fn_alta_tenant('Empresa anterior a la migración', '900000001',
       (SELECT codigo FROM plataforma.plan ORDER BY codigo LIMIT 1),
       'Administración', 'anterior@construsoft.test', 'sin-hash');
SQL
    if ! psql -v ON_ERROR_STOP=1 "${CONEXION[@]}" -d "$TEST_SUPERUSER_DB" -q -f "$ultima" > /dev/null; then
        echo "→ $(basename "$ultima") falla sobre una base que ya tiene una empresa." >&2
        echo "  Pasaría en una base vacía y fallaría en construsoft: el error está arriba." >&2
        exit 1
    fi
fi

echo "→ Recreando ${TEST_SUPERUSER_DB} en ${TEST_SUPERUSER_HOST}:${TEST_SUPERUSER_PORT}..."
recrear_base
bash "$DIR_SCRIPT/aplicar-migraciones.sh" "$MIGRACIONES" "$TEST_SUPERUSER_DB" "${CONEXION[@]}"

echo "→ ${TEST_SUPERUSER_DB} lista (esquema y migraciones cargados, cero tenants)."
