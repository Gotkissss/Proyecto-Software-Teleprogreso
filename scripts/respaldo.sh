#!/usr/bin/env bash
#
# scripts/respaldo.sh — T3 del Sprint 10
# =============================================================================
# Copia de seguridad cifrada de la base de Teleprogreso, y su restauración.
#
# POR QUÉ EXISTE
# --------------
# Hasta este sprint no había ninguna. Todo el trabajo de seguridad del Sprint 9
# y del 10 va de que nadie pueda leer ni alterar los datos; esto va de lo otro,
# que es igual de definitivo y mucho más probable: un `DROP`, un `--reset`
# corrido en el entorno equivocado, un disco que se va. Una base cifrada y
# auditada que ya no existe no se recupera con permisos.
#
# El respaldo lo toma el PROPIETARIO del esquema y no el rol de la aplicación.
# El rol de la aplicación no puede leer `bitacora_auditoria` entera —es lo que
# la hace append-only de verdad—, así que un `pg_dump` hecho con él dejaría
# fuera justo la tabla que más importa conservar. Para eso está
# `DATABASE_URL_MIGRACIONES`.
#
# EL CIFRADO NO ES OPCIONAL
# -------------------------
# El volcado contiene la tabla de empleados (con sus hashes), el historial de
# ubicaciones de cada técnico —dónde estuvo y a qué hora— y la bitácora
# completa. Es, literalmente, todo lo que el resto del proyecto protege, en un
# archivo que se va a copiar a sitios con menos cuidado que la base: un disco
# externo, un correo, una carpeta compartida. Se cifra con GPG simétrico
# (AES-256) y la frase va en `RESPALDO_PASSPHRASE`, nunca en la línea de
# comandos (ahí la vería cualquiera con `ps`).
#
# USO
# ---
#   # Crear un respaldo
#   RESPALDO_PASSPHRASE='…' bash scripts/respaldo.sh crear
#
#   # Listar los que hay, con su tamaño y fecha
#   bash scripts/respaldo.sh listar
#
#   # Restaurar sobre una base VACÍA (no sobre la de producción)
#   RESPALDO_PASSPHRASE='…' bash scripts/respaldo.sh restaurar archivo.sql.gz.gpg \
#       'postgresql://usuario:clave@host:5432/base_destino'
#
#   # Prueba de restauración: crea una base temporal, restaura ahí, comprueba
#   # que las tablas y las filas cuadran, y la borra. Es lo que convierte
#   # "tenemos respaldos" en "tenemos respaldos que funcionan".
#   RESPALDO_PASSPHRASE='…' bash scripts/respaldo.sh probar archivo.sql.gz.gpg
#
# VARIABLES
# ---------
#   DATABASE_URL_MIGRACIONES  conexión del propietario (o DATABASE_URL_SYNC)
#   RESPALDO_PASSPHRASE       frase de cifrado (obligatoria salvo en `listar`)
#   RESPALDO_DIR              carpeta de salida (por omisión ./backups)
#   RESPALDO_RETENCION_DIAS   días que se conservan los archivos (por omisión 30)
#
# `backups/` está en .gitignore, igual que `*.sql.gz` y `*.dump`: un volcado
# commiteado por error es la forma más común de que se filtre una base entera.
# =============================================================================
set -euo pipefail

COMANDO="${1:-}"
RESPALDO_DIR="${RESPALDO_DIR:-backups}"
RETENCION_DIAS="${RESPALDO_RETENCION_DIAS:-30}"

# ── Utilidades ───────────────────────────────────────────────────────────────

rojo()  { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
verde() { printf '\033[0;32m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

abortar() {
  rojo "ERROR: $*"
  exit 1
}

exigir_programa() {
  command -v "$1" >/dev/null 2>&1 \
    || abortar "hace falta '$1' y no está instalado. $2"
}

url_base_de_datos() {
  # El propietario del esquema primero: es el único que puede volcar la
  # bitácora completa (ver el encabezado).
  local url="${DATABASE_URL_MIGRACIONES:-${DATABASE_URL_SYNC:-}}"
  [[ -n "$url" ]] \
    || abortar "define DATABASE_URL_MIGRACIONES (o DATABASE_URL_SYNC)."
  # asyncpg no lo entiende pg_dump: se normaliza el esquema de la URL.
  printf '%s' "${url/postgresql+asyncpg:/postgresql:}"
}

exigir_passphrase() {
  [[ -n "${RESPALDO_PASSPHRASE:-}" ]] || abortar \
    "define RESPALDO_PASSPHRASE. El volcado lleva los hashes de las
       contraseñas, el historial de ubicaciones de cada técnico y la bitácora
       completa: sin cifrar no se puede guardar en ninguna parte."
  # Una frase corta no cifra nada: GPG la estira, pero un diccionario la
  # encuentra igual, y aquí lo que está en juego es la base entera.
  (( ${#RESPALDO_PASSPHRASE} >= 16 )) || abortar \
    "RESPALDO_PASSPHRASE tiene ${#RESPALDO_PASSPHRASE} caracteres y hacen
       falta al menos 16."
}

# ── crear ────────────────────────────────────────────────────────────────────

crear() {
  exigir_programa pg_dump "Viene en postgresql-client."
  exigir_programa gpg "Instala gnupg."
  exigir_passphrase

  local url destino archivo
  url="$(url_base_de_datos)"
  mkdir -p "$RESPALDO_DIR"
  archivo="teleprogreso-$(date +%Y%m%d-%H%M%S).sql.gz.gpg"
  destino="$RESPALDO_DIR/$archivo"

  info "Volcando la base…"
  # Todo en una tubería y sin archivo intermedio: un .sql en claro en el disco,
  # aunque se borre después, es una copia sin cifrar de todo el proyecto.
  #
  # --no-owner y --no-privileges: el volcado se restaura en una base que puede
  # tener otros nombres de rol (una base de prueba, la laptop de alguien). Los
  # privilegios reales los vuelve a poner `aplicar_rol_aplicacion.py`.
  #
  # --clean --if-exists: restaurar sobre una base con restos no falla a mitad.
  if ! pg_dump "$url" \
      --format=plain \
      --no-owner \
      --no-privileges \
      --clean \
      --if-exists \
    | gzip -9 \
    | gpg --batch --yes --symmetric --cipher-algo AES256 \
          --passphrase-fd 3 --output "$destino" 3<<<"$RESPALDO_PASSPHRASE"
  then
    # Un archivo a medias es peor que ninguno: parece un respaldo y no lo es.
    rm -f "$destino"
    abortar "el volcado falló; no se dejó ningún archivo."
  fi

  local tamano
  tamano="$(du -h "$destino" | cut -f1)"
  verde "Respaldo creado: $destino ($tamano)"

  # Comprobación mínima en el acto: que el archivo se descifra y que su
  # contenido empieza como un volcado de Postgres. Sin esto, un respaldo
  # cifrado con una frase equivocada no se descubre hasta el día que hace
  # falta, que es el peor día posible.
  #
  # `sed -n '1,5p'` y no `head -5`: head cierra la tubería en cuanto tiene
  # sus cinco líneas, gzip muere con SIGPIPE y `pipefail` da la
  # verificación por fallida aunque el archivo esté perfecto. sed lee el
  # flujo completo (son kilobytes) y no cierra nada antes de tiempo.
  local cabecera
  cabecera="$(
    gpg --batch --quiet --decrypt --passphrase-fd 3 "$destino" \
        3<<<"$RESPALDO_PASSPHRASE" 2>/dev/null \
      | gzip -dc 2>/dev/null \
      | sed -n '1,5p'
  )" || cabecera=""

  if [[ "$cabecera" == *"PostgreSQL database dump"* ]]; then
    info "Verificado: se descifra y es un volcado de PostgreSQL."
  else
    rm -f "$destino"
    abortar "el archivo no se pudo volver a leer; se borró."
  fi

  purgar_viejos
}

purgar_viejos() {
  [[ -d "$RESPALDO_DIR" ]] || return 0
  local borrados
  borrados="$(find "$RESPALDO_DIR" -name 'teleprogreso-*.sql.gz.gpg' \
    -type f -mtime "+$RETENCION_DIAS" -print -delete | wc -l | tr -d ' ')"
  (( borrados > 0 )) \
    && info "Retirados $borrados respaldos con más de $RETENCION_DIAS días."
  return 0
}

# ── listar ───────────────────────────────────────────────────────────────────

listar() {
  if [[ ! -d "$RESPALDO_DIR" ]]; then
    info "No hay carpeta $RESPALDO_DIR todavía."
    return 0
  fi
  local encontrados=0
  while IFS= read -r archivo; do
    encontrados=1
    printf '  %s  %s\n' "$(du -h "$archivo" | cut -f1)" "$archivo"
  done < <(find "$RESPALDO_DIR" -name 'teleprogreso-*.sql.gz.gpg' -type f | sort)
  (( encontrados )) || info "No hay respaldos en $RESPALDO_DIR."
}

# ── restaurar ────────────────────────────────────────────────────────────────

restaurar() {
  local archivo="${1:-}" destino="${2:-}"
  [[ -n "$archivo" && -n "$destino" ]] || abortar \
    "uso: respaldo.sh restaurar <archivo.sql.gz.gpg> <url-de-destino>"
  [[ -f "$archivo" ]] || abortar "no existe el archivo '$archivo'."
  exigir_programa psql "Viene en postgresql-client."
  exigir_programa gpg "Instala gnupg."
  exigir_passphrase

  # La URL de destino se pide a mano, siempre, y no se toma de las variables
  # del entorno. Restaurar es destructivo (el volcado trae DROP ... IF EXISTS):
  # leer la URL del entorno sería leer la de producción.
  local url_actual
  url_actual="$(url_base_de_datos 2>/dev/null || true)"
  if [[ -n "$url_actual" && "$destino" == "$url_actual" ]]; then
    rojo "El destino es la MISMA base que DATABASE_URL_MIGRACIONES."
    rojo "El volcado empieza con DROP: esto borra lo que haya ahí ahora."
    read -r -p "  Escribe 'restaurar encima' para continuar: " confirmacion
    [[ "$confirmacion" == "restaurar encima" ]] || abortar "cancelado."
  fi

  info "Restaurando en $destino…"
  gpg --batch --quiet --decrypt --passphrase-fd 3 "$archivo" 3<<<"$RESPALDO_PASSPHRASE" \
    | gzip -dc \
    | psql "$destino" --quiet --set ON_ERROR_STOP=on --output /dev/null \
    || abortar "la restauración falló."
  verde "Restaurado."
  info "Si el destino es un despliegue, vuelve a aplicar el endurecimiento del"
  info "rol: python backend/db/aplicar_rol_aplicacion.py"
}

# ── probar ───────────────────────────────────────────────────────────────────
#
# Lo que convierte "tenemos respaldos" en "tenemos respaldos que funcionan".
# Un volcado que no se ha restaurado nunca es una suposición: puede estar
# truncado, cifrado con otra frase o faltarle una tabla, y nada de eso se nota
# hasta el día en que se necesita.

probar() {
  local archivo="${1:-}"
  [[ -n "$archivo" ]] || abortar "uso: respaldo.sh probar <archivo.sql.gz.gpg>"
  [[ -f "$archivo" ]] || abortar "no existe el archivo '$archivo'."
  exigir_programa psql "Viene en postgresql-client."
  exigir_passphrase

  local url base_prueba url_admin url_prueba
  url="$(url_base_de_datos)"
  base_prueba="restauracion_$(date +%s)"
  # Se conecta a `postgres` para poder crear y borrar la base de prueba.
  url_admin="${url%/*}/postgres"
  url_prueba="${url%/*}/$base_prueba"

  info "Creando la base temporal $base_prueba…"
  psql "$url_admin" --quiet -c "CREATE DATABASE $base_prueba" >/dev/null

  # trap: la base temporal se borra pase lo que pase, también si la
  # restauración falla a mitad o alguien corta con Ctrl-C.
  # shellcheck disable=SC2064
  trap "psql '$url_admin' --quiet -c 'DROP DATABASE IF EXISTS $base_prueba' >/dev/null 2>&1 || true" EXIT

  # PostGIS antes del volcado: las tablas con columnas `geography` no se pueden
  # crear sin la extensión, y el volcado no la trae (la crea la migración 0001
  # en la base real).
  psql "$url_prueba" --quiet -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null

  restaurar "$archivo" "$url_prueba"

  info "Comprobando lo restaurado…"
  local fallos=0

  # 1. Las tablas que tienen que estar. Si falta una, el volcado no sirve
  #    aunque el archivo se descifre sin problema.
  local esperadas=(
    empleado tarea incidencia activo material movimiento_material
    asistencia descanso ubicacion_empleado alerta bitacora_auditoria
    tipo_pausa alembic_version
  )
  for tabla in "${esperadas[@]}"; do
    if psql "$url_prueba" -tAc \
        "SELECT to_regclass('public.$tabla') IS NOT NULL" | grep -q '^t$'
    then
      info "  ✓ $tabla"
    else
      rojo "  ✗ falta la tabla $tabla"
      fallos=$((fallos + 1))
    fi
  done

  # 2. La bitácora es la razón de hacer el respaldo con el propietario: si
  #    sale vacía mientras la base de origen tiene filas, el volcado se hizo
  #    con el rol de la aplicación y le falta justo lo que no se puede
  #    reconstruir.
  local filas_origen filas_restauradas
  filas_origen="$(psql "$url" -tAc 'SELECT COUNT(*) FROM bitacora_auditoria')"
  filas_restauradas="$(psql "$url_prueba" -tAc 'SELECT COUNT(*) FROM bitacora_auditoria')"
  info "  bitácora: $filas_restauradas filas restauradas (origen: $filas_origen)"
  if (( filas_origen > 0 && filas_restauradas == 0 )); then
    rojo "  ✗ la bitácora llegó vacía: ¿el volcado se hizo con el rol de la app?"
    fallos=$((fallos + 1))
  fi

  # 3. La versión de migración, para saber a qué esquema corresponde el
  #    archivo. Restaurar en un código más nuevo exige `alembic upgrade head`.
  local revision
  revision="$(psql "$url_prueba" -tAc 'SELECT version_num FROM alembic_version' | tr -d ' ')"
  info "  esquema: migración $revision"

  # 4. Que la cadena de hashes de la bitácora siga cuadrando. Es la
  #    comprobación que de verdad dice que el respaldo es útil: una bitácora
  #    restaurada con la cadena rota no vale como evidencia de nada.
  if psql "$url_prueba" -tAc \
      "SELECT to_regprocedure('public.bitacora_auditoria_verificar()') IS NOT NULL" \
      | grep -q '^t$'
  then
    local motivo
    motivo="$(psql "$url_prueba" -tAc \
      'SELECT COALESCE(o_motivo, '"'"'ok'"'"') FROM bitacora_auditoria_verificar()' \
      | tr -d ' ' | head -1)"
    if [[ "$motivo" == "ok" || -z "$motivo" ]]; then
      info "  ✓ cadena de la bitácora íntegra tras restaurar"
    else
      rojo "  ✗ la cadena de la bitácora quedó rota: $motivo"
      fallos=$((fallos + 1))
    fi
  fi

  if (( fallos > 0 )); then
    abortar "la prueba de restauración encontró $fallos problemas."
  fi

  verde "Prueba de restauración correcta."
  info "Anota la fecha y el resultado en SEGURIDAD.md, sección «Copias de"
  info "seguridad»: un respaldo que nadie ha restaurado es una suposición."
}

# ── Reparto ──────────────────────────────────────────────────────────────────

case "$COMANDO" in
  crear)     crear ;;
  listar)    listar ;;
  restaurar) shift; restaurar "$@" ;;
  probar)    shift; probar "$@" ;;
  *)
    cat >&2 <<'AYUDA'
Uso: bash scripts/respaldo.sh <comando>

  crear                          Volcado cifrado en $RESPALDO_DIR (./backups)
  listar                         Respaldos disponibles, con tamaño
  restaurar <archivo> <url>      Restaura en la base que se indique
  probar <archivo>               Restaura en una base temporal, comprueba y borra

Variables: DATABASE_URL_MIGRACIONES, RESPALDO_PASSPHRASE, RESPALDO_DIR,
           RESPALDO_RETENCION_DIAS.
AYUDA
    exit 2
    ;;
esac
