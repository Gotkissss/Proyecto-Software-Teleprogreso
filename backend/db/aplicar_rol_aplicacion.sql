-- =============================================================================
-- aplicar_rol_aplicacion.sql — Rol de privilegio mínimo en una base YA EXISTENTE
-- -----------------------------------------------------------------------------
-- `backend/db/init/10_rol_aplicacion.sh` solo se ejecuta cuando el volumen de
-- Postgres se crea de cero. Si tu base ya tiene datos y no quieres borrarla,
-- aplica este script una sola vez, a mano, como superusuario.
--
-- Cómo ejecutarlo (sustituye los valores entre <>):
--
--   docker compose exec -T db psql -U <superusuario> -d <base> \
--       -v app_user=teleprogreso_app \
--       -v app_password='<contraseña larga y aleatoria>' \
--       -v app_db=<base> \
--       -f - < backend/db/aplicar_rol_aplicacion.sql
--
-- Después pon esos mismos valores en el .env como APP_DB_USER / APP_DB_PASSWORD
-- y reinicia el backend. A partir de ahí el backend deja de conectarse como
-- superusuario.
--
-- Desde la migración 0010 el rol de la app tampoco es propietario de nada:
-- las migraciones las aplica el superusuario (servicio `migraciones` de
-- docker-compose, o DATABASE_URL_MIGRACIONES en un despliegue de un solo
-- contenedor). Si una versión anterior de este script le transfirió las
-- tablas, este las devuelve a quien lo ejecuta y deja la bitácora de
-- auditoría en solo SELECT e INSERT para la app.
--
-- Es idempotente: se puede correr dos veces sin romper nada.
--
-- Nota técnica: no se usan bloques DO $$ ... $$ porque psql NO sustituye sus
-- variables (:'app_user') dentro de literales dollar-quoted. Se usa \gexec, que
-- ejecuta como SQL cada fila devuelta por la consulta anterior.
-- =============================================================================

\set ON_ERROR_STOP on

-- ── 1. El rol ────────────────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

ALTER ROLE :"app_user"
    LOGIN
    PASSWORD :'app_password'
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS
    CONNECTION LIMIT 40;

-- Techo de tiempo por sentencia y por transacción ociosa: una consulta pesada
-- o una transacción abandonada no puede tumbar la base.
ALTER ROLE :"app_user" SET statement_timeout = '30s';
ALTER ROLE :"app_user" SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE :"app_user" SET lock_timeout = '10s';

-- ── 2. Acceso a la base ──────────────────────────────────────────────────────
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"app_db" TO :"app_user";

REVOKE ALL ON SCHEMA public FROM PUBLIC;
-- Usar el esquema, no crear en él: las migraciones las aplica el propietario.
REVOKE CREATE ON SCHEMA public FROM :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";

-- ── 3. Propiedad: de vuelta a quien migra ────────────────────────────────────
-- Una versión anterior de este script le daba al rol de la app la propiedad
-- de todas las tablas para que Alembic pudiera ALTERarlas con él. Un
-- propietario puede desactivar triggers y vaciar tablas, así que la
-- bitácora de auditoría dejaba de ser inmutable. Lo que sea suyo vuelve al
-- usuario que ejecuta este script (el superusuario, que es quien migra).
SELECT format(
           CASE c.relkind
               WHEN 'S' THEN 'ALTER SEQUENCE public.%I OWNER TO CURRENT_USER'
               WHEN 'v' THEN 'ALTER VIEW public.%I OWNER TO CURRENT_USER'
               WHEN 'm' THEN 'ALTER MATERIALIZED VIEW public.%I OWNER TO CURRENT_USER'
               ELSE            'ALTER TABLE public.%I OWNER TO CURRENT_USER'
           END,
           c.relname
       )
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  AND pg_get_userbyid(c.relowner) = :'app_user'
  -- Las secuencias de una columna serial viajan con su tabla; cambiarles el
  -- dueño por separado es un error.
  AND NOT (c.relkind = 'S' AND EXISTS (
      SELECT 1 FROM pg_depend d
       WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')))
\gexec

-- ── 4. Permisos de datos sobre lo que ya existe ──────────────────────────────
-- Leer y escribir filas; nada de REFERENCES ni TRIGGER, que solo sirven para
-- cambiar el esquema. TRUNCATE lo usa `seed.py --reset`.
REVOKE REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
    ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"app_user";

-- ── 5. Objetos futuros ───────────────────────────────────────────────────────
-- Lo que creen las migraciones (como el superusuario) nace accesible para la app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE REFERENCES, TRIGGER ON TABLES FROM :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";

-- ── 6. Bitácora de auditoría ─────────────────────────────────────────────────
-- El GRANT de arriba le dio UPDATE/DELETE/TRUNCATE también sobre la bitácora:
-- bitacora_auditoria_proteger() (migración 0010) se queda con su propiedad y
-- deja a la app solo SELECT e INSERT. Si la 0010 todavía no se aplicó, la
-- función no existe y este paso se salta: la migración lo hará al correr.
SELECT 'SELECT bitacora_auditoria_proteger()'
WHERE to_regprocedure('public.bitacora_auditoria_proteger()') IS NOT NULL
\gexec

-- ── 7. Bases de servicio fuera de alcance ────────────────────────────────────
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;

\echo '[hardening] Rol de aplicación aplicado. Actualiza APP_DB_USER/APP_DB_PASSWORD en el .env y reinicia el backend.'
