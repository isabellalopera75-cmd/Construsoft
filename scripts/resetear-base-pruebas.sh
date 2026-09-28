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
ESQUEMA="$RAIZ/docs/05 - construsoft_mvp_schema.sql"

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

echo "→ Recreando ${TEST_SUPERUSER_DB} en ${TEST_SUPERUSER_HOST}:${TEST_SUPERUSER_PORT}..."

dropdb --if-exists "${CONEXION[@]}" "$TEST_SUPERUSER_DB"
createdb -E UTF8 -T template0 "${CONEXION[@]}" "$TEST_SUPERUSER_DB"

psql -v ON_ERROR_STOP=1 "${CONEXION[@]}" -d "$TEST_SUPERUSER_DB" -f "$ESQUEMA" > /dev/null

echo "→ ${TEST_SUPERUSER_DB} lista (esquema cargado, cero tenants)."
