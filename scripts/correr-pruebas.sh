#!/usr/bin/env bash
# Expande el glob aquí y no en el shell que invoque npm: cmd.exe no lo
# expande, y el soporte propio de globs de node --test solo existe desde
# Node 21. Así la corrida no depende ni del shell ni de la versión.
set -euo pipefail
shopt -s globstar nullglob
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

archivos=(src/**/*.test.ts)

# La guarda importa más que la expansión. Sin ella, una corrida que no
# encuentra ninguna prueba se ve idéntica a una con todo en verde, y en
# este proyecto eso significa afirmar un aislamiento que nadie verificó.
if (( ${#archivos[@]} == 0 )); then
    echo "No se encontró ningún archivo *.test.ts bajo src/." >&2
    exit 1
fi

echo "→ ${#archivos[@]} archivos de prueba"
exec node --env-file=.env.test --import tsx --test "${archivos[@]}"
