#!/usr/bin/env bash
# Prueba de humo de la imagen del backend (HU-S10-06).
#
#   - la imagen final no trae compilador;
#   - la aplicación corre como `app`, no como root, y no puede escribir su
#     propio código;
#   - con la carpeta de fotos en un volumen de root (como Railway), `app`
#     puede escribir en ella y en las subcarpetas que ya existían;
#   - uvicorn solo confía en los X-Forwarded-* de 127.0.0.1 salvo que
#     FORWARDED_ALLOW_IPS diga otra cosa.
#
# Uso, desde la raíz del repo:   scripts/verificar-imagen-backend.sh
# Termina con 0 si todo está bien y con 1 si algo falla. Lo corre el CI.
set -euo pipefail

IMAGEN="teleprogreso-backend-humo"
VOLUMEN="teleprogreso-backend-humo-static"
fallos=0

limpiar() { docker volume rm -f "$VOLUMEN" >/dev/null 2>&1 || true; }
trap limpiar EXIT

docker build ${DOCKER_BUILD_FLAGS:-} -q -t "$IMAGEN" backend >/dev/null

comprobar() { # comprobar <descripción> <comando que debe salir con 0>
  if eval "$2" >/dev/null 2>&1; then
    echo "  ok    $1"
  else
    echo "  FALLA $1"
    fallos=$((fallos + 1))
  fi
}

correr() { docker run --rm "$@"; }

comprobar "sin compilador en la imagen final" \
  "correr --entrypoint sh $IMAGEN -c '! command -v gcc'"
comprobar "la aplicación corre como app" \
  "[ \"\$(correr $IMAGEN id -un)\" = app ]"
comprobar "app no puede escribir el código" \
  "correr $IMAGEN sh -c '! touch /app/app/main.py'"
comprobar "app puede escribir en backend/static" \
  "correr $IMAGEN sh -c 'touch /app/static/prueba'"

limpiar
docker volume create "$VOLUMEN" >/dev/null
correr -v "$VOLUMEN:/datos" --entrypoint sh "$IMAGEN" \
  -c 'mkdir -p /datos/static/incidencias && touch /datos/static/incidencias/vieja.jpg'
comprobar "con un volumen de root, app escribe en la subcarpeta existente" \
  "correr -v $VOLUMEN:/datos -e STATIC_DIR=/datos/static $IMAGEN sh -c 'touch /datos/static/incidencias/nueva.jpg && [ \"\$(id -un)\" = app ]'"
comprobar "HOME apunta a la carpeta de app (asyncpg busca ahí sus certificados)" \
  "[ \"\$(correr $IMAGEN sh -c 'echo \$HOME')\" = /app ]"

comprobar "uvicorn confía solo en 127.0.0.1 por defecto" \
  "[ \"\$(correr $IMAGEN python -c 'import uvicorn.config as c; print(c.Config(app=None).forwarded_allow_ips)')\" = 127.0.0.1 ]"
comprobar "FORWARDED_ALLOW_IPS cambia en quién confía" \
  "[ \"\$(correr -e FORWARDED_ALLOW_IPS=10.0.0.1 $IMAGEN python -c 'import uvicorn.config as c; print(c.Config(app=None).forwarded_allow_ips)')\" = 10.0.0.1 ]"

if [ "$fallos" -gt 0 ]; then
  echo "${fallos} comprobación(es) fallaron."
  exit 1
fi
echo "Todo en orden."
