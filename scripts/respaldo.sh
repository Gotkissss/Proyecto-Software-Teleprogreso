#!/usr/bin/env bash
#
# scripts/respaldo.sh — atajo desde la raíz del repositorio.
#
# El script de verdad vive en `backend/scripts/respaldo.sh`, dentro del
# contexto con el que se construye la imagen del backend. Tiene que estar ahí
# porque en un despliegue como Railway la base no es alcanzable desde fuera:
# el respaldo solo se puede tomar desde un contenedor con esa imagen, y lo que
# no entra en la imagen no existe allí. Vivía en esta carpeta y nunca llegaba
# al contenedor, así que el servicio de respaldo diario que documenta el
# README fallaba con "No such file or directory".
#
# Este atajo existe para que `bash scripts/respaldo.sh ...` siga funcionando
# desde la raíz, que es como está escrito en el README, en SEGURIDAD.md y en
# el cron del servidor propio. Conserva el directorio de trabajo, así que
# `backups/` sigue quedando donde siempre.
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backend/scripts/respaldo.sh" "$@"
