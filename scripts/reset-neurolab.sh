#!/usr/bin/env bash
# reset-neurolab.sh — Devuelve la app al estado de partida del experimento
# ---------------------------------------------------------------------------
# Equivalente de scripts/reset-neurolab.ps1 para quien corra la sesión desde
# bash (WSL, macOS, Linux). Ver ese archivo para el detalle.
#
#   ./scripts/reset-neurolab.sh
#
# ⚠️  BORRA todos los datos de operación y vuelve a sembrar el escenario del
# experimento. Se corre ENTRE participantes, nunca con una sesión en curso.
# ---------------------------------------------------------------------------
set -uo pipefail

# railway necesita correr desde la raíz del repo: ahí está el enlace al proyecto.
cd "$(dirname "$0")/.."

printf '\nReiniciando el escenario del NeuroLab...\n'
printf '(esto borra los datos de la sesión anterior)\n\n'

inicio=$SECONDS
railway ssh --service Backend "cd /app && python seed_neurolab.py --reset"
codigo=$?
transcurrido=$(( SECONDS - inicio ))

printf '\n'
if [ "$codigo" -eq 0 ]; then
    printf 'LISTO en %s s — la app ya puede recibir al siguiente participante.\n' "$transcurrido"
    printf 'Deja el navegador en la pantalla de inicio de sesión, con la sesión anterior cerrada.\n'
else
    printf 'EL RESET FALLÓ (código %s, %s s).\n' "$codigo" "$transcurrido"
    printf 'NO empieces la siguiente sesión sin revisarlo: el participante vería\n'
    printf 'los datos que dejó el anterior y su registro no sería comparable.\n\n'
    printf 'Qué revisar, en este orden:\n'
    printf '  1. railway whoami      (¿hay sesión abierta?)\n'
    printf '  2. railway status      (¿la carpeta está enlazada al proyecto teleprogreso?)\n'
    printf '  3. Si el escenario quedó a medias, el propio seed lo dice arriba:\n'
    printf '     vuelve a correr este script.\n'
fi
printf '\n'

exit "$codigo"
