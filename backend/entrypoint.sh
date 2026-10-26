#!/bin/sh
# Arranque del contenedor del backend (HU-S10-06): nada de la aplicación corre
# como root.
#
# El contenedor empieza como root solo para una cosa: que la carpeta de las
# fotos (STATIC_DIR) sea del usuario `app`. En Railway esa carpeta es un
# volumen, y los volúmenes se montan con dueño root; con un `USER app` fijo en
# el Dockerfile las subidas fallarían. Se arregla el dueño únicamente si `app`
# no puede escribir ahí, y enseguida se baja a `app` con setpriv: migraciones,
# seed, purga y uvicorn corren todos sin privilegios.
#
# Si el contenedor ya arranca sin privilegios (otro orquestador, `user:` en
# compose), no hay nada que arreglar y se ejecuta el comando tal cual.
set -e

if [ "$(id -u)" = "0" ]; then
    carpeta="${STATIC_DIR:-/app/static}"
    mkdir -p "$carpeta"
    if ! setpriv --reuid=app --regid=app --init-groups test -w "$carpeta"; then
        chown -R app:app "$carpeta"
    fi
    # setpriv cambia el usuario pero no el entorno: con HOME=/root, asyncpg
    # busca certificados en /root/.postgresql y revienta por permisos.
    export HOME=/app
    exec setpriv --reuid=app --regid=app --init-groups "$@"
fi

exec "$@"
