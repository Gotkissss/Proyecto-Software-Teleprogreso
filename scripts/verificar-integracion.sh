#!/usr/bin/env bash
#
# scripts/verificar-integracion.sh — SCRUM-185
# =============================================================================
# Verificación de integración de la API sobre un stack levantado con Docker
# Compose: comprueba que el seed corrió, que los endpoints nuevos del sprint
# responden con datos reales y que los tres reportes se descargan como Excel
# válido.
#
# Cubre la mitad automatizable de SCRUM-185. La otra mitad —ver el mapa en un
# teléfono y en escritorio— es visual y va en la lista de al lado; este script
# no la sustituye.
#
# USO
# ---
#   bash scripts/verificar-integracion.sh                # sobre el stack actual
#   bash scripts/verificar-integracion.sh --desde-cero   # borra volúmenes y resiembra
#
# ⚠️  --desde-cero ejecuta `docker compose down -v`: BORRA la base de datos
#     local. Sin ese flag el script no destruye nada.
# =============================================================================

set -uo pipefail

API="${API:-http://127.0.0.1:8000}"
WEB="${WEB:-http://127.0.0.1:5173}"
DESCARGAS="${DESCARGAS:-./.verificacion}"

DESDE_CERO=0
[ "${1:-}" = "--desde-cero" ] && DESDE_CERO=1

# Colores solo si la salida es una terminal.
if [ -t 1 ]; then
  ROJO=$'\033[31m'; VERDE=$'\033[32m'; AMARILLO=$'\033[33m'; GRIS=$'\033[90m'; FIN=$'\033[0m'
else
  ROJO=''; VERDE=''; AMARILLO=''; GRIS=''; FIN=''
fi

OK=0
FALLOS=0

paso()   { printf '\n%s── %s %s\n' "$AMARILLO" "$1" "$FIN"; }
pasa()   { OK=$((OK+1));         printf '  %s✓%s %s\n' "$VERDE" "$FIN" "$1"; }
falla()  { FALLOS=$((FALLOS+1)); printf '  %s✗%s %s\n' "$ROJO" "$FIN" "$1"; }
nota()   { printf '    %s%s%s\n' "$GRIS" "$1" "$FIN"; }

# afirmar <descripción> <condición-ya-evaluada:0|1> [detalle]
afirmar() {
  if [ "$2" -eq 0 ]; then pasa "$1"; else falla "$1"; [ -n "${3:-}" ] && nota "$3"; fi
}

# Extrae un campo string de una respuesta JSON sin depender de jq.
campo_texto() { grep -oE "\"$2\": ?\"[^\"]*\"" <<<"$1" | head -1 | sed -E 's/.*: ?"(.*)"/\1/'; }
# Extrae un campo numérico (entero o decimal).
campo_num()   { grep -oE "\"$2\": ?-?[0-9]+(\.[0-9]+)?" <<<"$1" | head -1 | sed -E 's/.*: ?//'; }

# =============================================================================
paso "0. Preflight"

if ! command -v docker >/dev/null 2>&1; then
  falla "docker no está en el PATH"
  echo "Levanta el stack antes de correr este script." && exit 1
fi
pasa "docker disponible"

if ! command -v curl >/dev/null 2>&1; then
  falla "curl no está en el PATH" && exit 1
fi
pasa "curl disponible"

mkdir -p "$DESCARGAS"

# =============================================================================
if [ "$DESDE_CERO" -eq 1 ]; then
  paso "1. Stack desde cero (docker compose down -v && up --build)"
  nota "Esto borra la base de datos local."
  docker compose down -v          >/dev/null 2>&1
  docker compose up --build -d    || { falla "el stack no levantó"; exit 1; }
  pasa "contenedores construidos y arrancados"
else
  paso "1. Stack existente"
  nota "Sin --desde-cero: se usa lo que ya esté corriendo."
fi

# =============================================================================
paso "2. Backend en pie"

INTENTOS=60
until curl -fsS "$API/health" >/dev/null 2>&1; do
  INTENTOS=$((INTENTOS-1))
  if [ "$INTENTOS" -le 0 ]; then
    falla "el backend no respondió en /health tras 60 intentos"
    nota "Revisa: docker compose logs backend"
    exit 1
  fi
  sleep 2
done
pasa "GET /health responde"

# =============================================================================
paso "3. El seed sembró el histórico (SCRUM-180)"

LOGS="$(docker compose logs backend 2>/dev/null | tail -n 200)"

grep -q "tareas completadas en las últimas" <<<"$LOGS"
afirmar "el seed generó el histórico de tareas" $? \
  "No aparece la línea del histórico. Si la BD ya tenía datos, el seed se omite: usa --desde-cero."

grep -q "jornadas con" <<<"$LOGS"
afirmar "el seed generó el historial de asistencia" $?

# =============================================================================
paso "4. Autenticación de los tres roles"

login() {
  curl -fsS -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"correo\":\"$1\",\"contrasena\":\"$2\"}" 2>/dev/null
}

RESP_GERENTE="$(login gerente@teleprogreso.com 'Gerente1234!')"
TOKEN_GERENTE="$(campo_texto "$RESP_GERENTE" access_token)"
[ -n "$TOKEN_GERENTE" ]
afirmar "login como gerente" $?

RESP_SUPER="$(login supervisor@teleprogreso.com 'Super1234!')"
TOKEN_SUPER="$(campo_texto "$RESP_SUPER" access_token)"
[ -n "$TOKEN_SUPER" ]
afirmar "login como supervisor" $?

RESP_TEC="$(login tecnico@teleprogreso.com 'Tecnico1234!')"
TOKEN_TEC="$(campo_texto "$RESP_TEC" access_token)"
[ -n "$TOKEN_TEC" ]
afirmar "login como técnico" $?

if [ -z "$TOKEN_GERENTE" ] || [ -z "$TOKEN_SUPER" ] || [ -z "$TOKEN_TEC" ]; then
  falla "sin tokens no se puede seguir"
  exit 1
fi

api_get() { curl -sS -H "Authorization: Bearer $2" "$API$1"; }
api_code() { curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $2" "$API$1"; }

# =============================================================================
paso "5. Mapa del técnico — GET /tareas/mi-ruta (SCRUM-160)"

RUTA="$(api_get "/tareas/mi-ruta" "$TOKEN_TEC")"

grep -q '^\[' <<<"$RUTA"
afirmar "devuelve una lista JSON" $? "$RUTA"

grep -q '"lat"' <<<"$RUTA"
afirmar "las paradas traen lat/lng" $? \
  "Si la lista está vacía, el técnico no tiene tareas con fecha_inicio = hoy."

# =============================================================================
paso "6. Mapa del supervisor — GET /tareas/mapa-supervisor (SCRUM-166)"

MAPA="$(api_get "/tareas/mapa-supervisor" "$TOKEN_SUPER")"
grep -q '^\[' <<<"$MAPA"
afirmar "responde al supervisor" $? "$MAPA"

CODIGO_TEC="$(api_code "/tareas/mapa-supervisor" "$TOKEN_TEC")"
[ "$CODIGO_TEC" = "403" ]
afirmar "un técnico recibe 403" $? "Se esperaba 403 y llegó $CODIGO_TEC"

# =============================================================================
paso "7. Los tres reportes traen datos reales (SCRUM-175/176/177)"

HOY="$(date +%F)"
HACE_60="$(date -d '60 days ago' +%F 2>/dev/null || date -v-60d +%F)"
RANGO="fecha_inicio=$HACE_60&fecha_fin=$HOY"

# --- Asistencia ---
ASIS="$(api_get "/reportes/asistencia?$RANGO" "$TOKEN_GERENTE")"
JORNADAS="$(campo_num "$ASIS" total_jornadas)"
[ -n "$JORNADAS" ] && [ "$JORNADAS" -gt 0 ] 2>/dev/null
afirmar "asistencia: $JORNADAS jornadas en 60 días" $? "$ASIS"

# --- Tareas completadas ---
TAREAS="$(api_get "/reportes/tareas-completadas?$RANGO" "$TOKEN_GERENTE")"
COMPLETADAS="$(campo_num "$TAREAS" total_tareas_completadas)"
[ -n "$COMPLETADAS" ] && [ "$COMPLETADAS" -gt 0 ] 2>/dev/null
afirmar "tareas completadas: $COMPLETADAS en 60 días" $? \
  "Si sale 0, las tareas no tienen fecha_completado — es justo el Jbug de SCRUM-180."

# --- Productividad ---
PROD="$(api_get "/reportes/productividad?$RANGO" "$TOKEN_GERENTE")"
POR_HORA="$(campo_num "$PROD" tareas_por_hora)"
[ -n "$POR_HORA" ] && [ "$(awk -v v="$POR_HORA" 'BEGIN{print (v>0)?0:1}')" -eq 0 ]
afirmar "productividad: $POR_HORA tareas/hora" $? "$PROD"

# El supervisor NO debe leer los reportes en JSON (solo exportarlos).
CODIGO_SUPER="$(api_code "/reportes/asistencia?$RANGO" "$TOKEN_SUPER")"
[ "$CODIGO_SUPER" = "403" ]
afirmar "el supervisor recibe 403 en el JSON de reportes" $? \
  "Se esperaba 403 y llegó $CODIGO_SUPER"

# =============================================================================
paso "8. Descarga de los tres Excel (SCRUM-177/178)"

descargar_excel() {
  local tipo="$1" token="$2" destino="$DESCARGAS/$1.xlsx"

  curl -sS -o "$destino" -H "Authorization: Bearer $token" \
    "$API/reportes/$tipo/exportar?$RANGO" 2>/dev/null

  # Un .xlsx es un ZIP: tiene que empezar con la firma "PK".
  if [ "$(head -c 2 "$destino" 2>/dev/null)" != "PK" ]; then
    falla "$tipo.xlsx no es un Excel válido"
    nota "Contenido recibido: $(head -c 120 "$destino" 2>/dev/null)"
    return
  fi

  local tam
  tam="$(wc -c <"$destino" | tr -d ' ')"
  if [ "$tam" -lt 3000 ]; then
    falla "$tipo.xlsx pesa solo $tam bytes (¿libro vacío?)"
    return
  fi

  pasa "$tipo.xlsx descargado ($tam bytes)"
}

descargar_excel asistencia         "$TOKEN_GERENTE"
descargar_excel tareas-completadas "$TOKEN_GERENTE"
descargar_excel productividad      "$TOKEN_GERENTE"

# El botón del dashboard del supervisor usa esta misma ruta: debe funcionarle.
CODIGO_EXPORT="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN_SUPER" \
  "$API/reportes/asistencia/exportar?$RANGO")"
[ "$CODIGO_EXPORT" = "200" ]
afirmar "el supervisor SÍ puede exportar (botón del dashboard)" $? \
  "Se esperaba 200 y llegó $CODIGO_EXPORT"

# =============================================================================
paso "9. Frontend servido"

CODIGO_WEB="$(curl -sS -o /dev/null -w '%{http_code}' "$WEB" 2>/dev/null)"
[ "$CODIGO_WEB" = "200" ]
afirmar "el frontend responde en $WEB" $? "Llegó $CODIGO_WEB"

# =============================================================================
printf '\n%s\n' "══════════════════════════════════════════════════════"
if [ "$FALLOS" -eq 0 ]; then
  printf '  %s%d comprobaciones OK, 0 fallos%s\n' "$VERDE" "$OK" "$FIN"
  printf '  Excel descargados en: %s\n' "$DESCARGAS"
  printf '  Falta la parte visual: ver VERIFICACION-SCRUM-185.md\n'
  printf '%s\n' "══════════════════════════════════════════════════════"
  exit 0
else
  printf '  %s%d fallos%s (%d OK)\n' "$ROJO" "$FALLOS" "$FIN" "$OK"
  printf '%s\n' "══════════════════════════════════════════════════════"
  exit 1
fi
