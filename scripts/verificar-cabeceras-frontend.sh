#!/usr/bin/env bash
# Prueba de humo de la imagen de producción del frontend (HU-S10-06).
#
# Construye la imagen, la arranca y comprueba con curl lo que tiene que
# cumplir el despliegue:
#   - las cabeceras de seguridad en la página, en /assets y en sw.js (nginx no
#     hereda add_header entre bloques: es fácil perderlas en uno);
#   - que la CSP deja llamar a la API configurada;
#   - que lo que decide la versión de la PWA no se guarda en caché y /assets sí;
#   - que el contenedor no corre como root.
#
# Uso, desde la raíz del repo:   scripts/verificar-cabeceras-frontend.sh
# Termina con 0 si todo está bien y con 1 en el primer fallo. Lo corre el CI.
set -euo pipefail

IMAGEN="teleprogreso-frontend-humo"
CONTENEDOR="teleprogreso-frontend-humo"
PUERTO="${PUERTO:-18080}"
API="https://api.ejemplo.test"
BASE="http://127.0.0.1:${PUERTO}"
fallos=0

limpiar() { docker rm -f "$CONTENEDOR" >/dev/null 2>&1 || true; }
trap limpiar EXIT

docker build ${DOCKER_BUILD_FLAGS:-} -q --target production -t "$IMAGEN" frontend >/dev/null
limpiar
docker run -d --name "$CONTENEDOR" -p "127.0.0.1:${PUERTO}:8080" -e "VITE_API_URL=${API}/" "$IMAGEN" >/dev/null

for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$BASE/" 2>/dev/null && break
  sleep 1
done

cabeceras() { curl -fsS -D - -o /dev/null "$1" | tr -d '\r'; }

exigir() { # exigir <ruta> <texto que debe aparecer en las cabeceras>
  if cabeceras "$BASE$1" | grep -qiF -- "$2"; then
    echo "  ok    $1  ${2}"
  else
    echo "  FALLA $1  falta: ${2}"
    fallos=$((fallos + 1))
  fi
}

ASSET="/assets/$(docker exec "$CONTENEDOR" ls /usr/share/nginx/html/assets | grep '\.js$' | head -1)"

echo "Cabeceras de seguridad:"
for ruta in / /index.html /ruta/de/la/spa "$ASSET" /sw.js; do
  exigir "$ruta" "content-security-policy: default-src 'self'"
  exigir "$ruta" "strict-transport-security: max-age=31536000"
  exigir "$ruta" "x-content-type-options: nosniff"
  exigir "$ruta" "x-frame-options: DENY"
  exigir "$ruta" "referrer-policy: strict-origin-when-cross-origin"
  exigir "$ruta" "permissions-policy: geolocation=(self)"
done

echo "CSP con el origen de la API (sin la barra final):"
exigir / "connect-src 'self' ${API} https://nominatim.openstreetmap.org"

echo "Caché:"
exigir / "cache-control: no-cache"
exigir /sw.js "cache-control: no-cache"
exigir "$ASSET" "cache-control: public, immutable"

echo "Usuario del contenedor:"
uid="$(docker exec "$CONTENEDOR" id -u)"
if [ "$uid" = "0" ]; then
  echo "  FALLA corre como root"
  fallos=$((fallos + 1))
else
  echo "  ok    uid ${uid}"
fi
if docker exec "$CONTENEDOR" ps -o user,args | grep "nginx: master" | grep -q '^root'; then
  echo "  FALLA el proceso maestro de nginx corre como root"
  fallos=$((fallos + 1))
fi

if [ "$fallos" -gt 0 ]; then
  echo "${fallos} comprobación(es) fallaron."
  exit 1
fi
echo "Todo en orden."
