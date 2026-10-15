#!/usr/bin/env bash
# Aplica, en orden de número, todas las migraciones de una carpeta a una base
# RECIÉN cargada con el 05 (D-77, CONTRATO §18.1), y anota la huella de cada
# una. Lo usa resetear-base-pruebas.sh; el hook le pasa la carpeta armada con
# las migraciones del índice, no las del árbol.
#
#   aplicar-migraciones.sh <carpeta> <base> [argumentos de conexión de psql…]
#
# Para una base que ya tiene datos está npm run migrar, que además compara las
# huellas de las aplicadas y se detiene si alguna cambió. La huella es la misma
# que calcula src/dueno/migraciones.ts: sha256 sin los \r de Windows.
set -euo pipefail

CARPETA="$1"
BASE="$2"
shift 2
CONEXION=("$@")

shopt -s nullglob
archivos=("$CARPETA"/[0-9][0-9][0-9][0-9]-*.sql)
for archivo in "${archivos[@]}"; do
    nombre="$(basename "$archivo")"
    [[ "$nombre" == *.revertir.sql ]] && continue
    numero=$((10#${nombre:0:4}))
    psql -v ON_ERROR_STOP=1 "${CONEXION[@]}" -d "$BASE" -f "$archivo" > /dev/null
    sha=$(tr -d '\r' < "$archivo" | sha256sum | cut -d' ' -f1)
    psql -v ON_ERROR_STOP=1 "${CONEXION[@]}" -d "$BASE" -q \
         -c "UPDATE plataforma.migracion SET sha256 = '$sha' WHERE numero = $numero"
    echo "  migración $nombre aplicada"
done
