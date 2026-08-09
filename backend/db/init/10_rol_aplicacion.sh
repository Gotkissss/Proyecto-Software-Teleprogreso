#!/bin/bash
# =============================================================================
# 10_rol_aplicacion.sh — Rol de aplicación con privilegios mínimos
# -----------------------------------------------------------------------------
# La imagen oficial de Postgres ejecuta todo lo que haya en
# /docker-entrypoint-initdb.d/ la PRIMERA vez que se crea el volumen de datos.
#
# Qué hace:
#   1. Crea un rol de login para el backend que NO es superusuario, no puede
#      crear bases ni roles, y solo tiene permisos dentro de la base de la
#      aplicación. Si mañana se filtra la cadena de conexión del backend, el
#      atacante no puede leer otras bases, ni escribir en el sistema de
#      archivos del servidor (COPY ... TO PROGRAM), ni crear extensiones, ni
#      escalar a superusuario.
#   2. Le quita a PUBLIC (es decir, a cualquier rol que exista o llegue a
#      existir) el permiso de conectarse a la base y de crear objetos en ella.
#   3. Impide que ese rol se pasee por las bases `postgres` y `template1`.
#   4. Le pone un techo de conexiones y timeouts, para que un cliente colgado
#      no pueda agotar el pool ni dejar transacciones abiertas bloqueando
#      tablas indefinidamente.
#
# Es OPCIONAL y con fallback: si no se define APP_DB_USER en el .env, el script
# no hace nada y el backend sigue conectando con el usuario de siempre. Así
# actualizar el repo no rompe un entorno que ya está corriendo.
#
# ⚠️ Este script SOLO corre con un volumen de datos nuevo. Si tu base ya existe
# y quieres aplicar el rol mínimo sin borrar datos, usa:
#     backend/db/aplicar_rol_aplicacion.sql
# =============================================================================
set -euo pipefail

APP_DB_USER="${APP_DB_USER:-}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-}"

if [ -z "$APP_DB_USER" ] || [ "$APP_DB_USER" = "$POSTGRES_USER" ]; then
  echo "[hardening] APP_DB_USER no definido (o igual al superusuario):"
  echo "[hardening] se omite la creación del rol de privilegio mínimo."
  exit 0
fi

if [ -z "$APP_DB_PASSWORD" ]; then
  echo "[hardening] ERROR: APP_DB_USER está definido pero APP_DB_PASSWORD está vacío." >&2
  echo "[hardening] Define ambas variables en el .env o ninguna de las dos." >&2
  exit 1
fi

echo "[hardening] Creando rol de aplicación '$APP_DB_USER' sin privilegios de superusuario..."

# Las contraseñas se guardan como scram-sha-256 (ver password_encryption en
# docker-compose.yml), nunca como md5.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     --set=app_user="$APP_DB_USER" \
     --set=app_password="$APP_DB_PASSWORD" \
     --set=app_db="$POSTGRES_DB" <<-'EOSQL'
    -- Rol de login sin ningún atributo de administración.
    CREATE ROLE :"app_user"
        LOGIN
        PASSWORD :'app_password'
        NOSUPERUSER
        NOCREATEDB
        NOCREATEROLE
        NOREPLICATION
        NOBYPASSRLS
        CONNECTION LIMIT 40;

    -- Techo de tiempo por sentencia y por transacción ociosa: una consulta
    -- pesada o una transacción abandonada no puede tumbar la base.
    ALTER ROLE :"app_user" SET statement_timeout = '30s';
    ALTER ROLE :"app_user" SET idle_in_transaction_session_timeout = '60s';
    ALTER ROLE :"app_user" SET lock_timeout = '10s';

    -- Nadie más que el superusuario y el rol de la app puede conectarse.
    REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
    GRANT CONNECT, TEMPORARY ON DATABASE :"app_db" TO :"app_user";

    -- Permisos dentro del esquema de trabajo. El rol necesita CREATE porque
    -- es quien aplica las migraciones de Alembic; no necesita nada más.
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";

    -- Objetos que ya existan (extensiones instaladas antes que este script).
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"app_user";
EOSQL

# Las bases de servicio quedan fuera del alcance del rol de la aplicación: sin
# esto, la cadena de conexión del backend serviría para husmear `postgres` y
# `template1`.
for base in postgres template1; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
       --set=base="$base" <<-'EOSQL'
      REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
EOSQL
done

echo "[hardening] Rol '$APP_DB_USER' listo (sin superusuario, sin acceso a otras bases)."
