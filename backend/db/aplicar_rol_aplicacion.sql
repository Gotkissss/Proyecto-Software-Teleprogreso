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
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";

-- ── 3. Permisos sobre lo que ya existe ───────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"app_user";

-- Alembic necesita poder ALTERar las tablas, y eso exige ser el propietario.
-- Se le transfieren solo las tablas/secuencias de la aplicación: las que
-- pertenecen a una extensión (PostGIS) se excluyen por el LEFT JOIN a
-- pg_depend y siguen siendo del superusuario.
SELECT format(
           CASE c.relkind
               WHEN 'S' THEN 'ALTER SEQUENCE public.%I OWNER TO %I'
               WHEN 'v' THEN 'ALTER VIEW public.%I OWNER TO %I'
               WHEN 'm' THEN 'ALTER MATERIALIZED VIEW public.%I OWNER TO %I'
               ELSE            'ALTER TABLE public.%I OWNER TO %I'
           END,
           c.relname,
           :'app_user'
       )
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  AND d.objid IS NULL
\gexec

-- ── 4. Objetos futuros ───────────────────────────────────────────────────────
-- Para que lo que cree el superusuario más adelante siga siendo accesible.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";

-- ── 5. Bases de servicio fuera de alcance ────────────────────────────────────
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;

\echo '[hardening] Rol de aplicación aplicado. Actualiza APP_DB_USER/APP_DB_PASSWORD en el .env y reinicia el backend.'
