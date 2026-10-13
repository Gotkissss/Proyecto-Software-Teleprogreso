"""
aplicar_rol_aplicacion.py — el mismo endurecimiento, donde no hay `psql`.

Para dejarlo en el repo como `backend/db/aplicar_rol_aplicacion.py`.

`aplicar_rol_aplicacion.sql` es el documento de referencia y se corre con psql.
En un despliegue plano (Railway y parecidos) eso no se puede: la base no es
alcanzable desde fuera de la red del proyecto, y la imagen del backend no trae
el cliente `psql` — solo psycopg2. Y el .sql necesita psql de verdad, porque
usa `\\gexec` para ejecutar las sentencias que el mismo genera.

Este archivo ejecuta LAS MISMAS sentencias, en el mismo orden, con psycopg2:

    railway ssh --service Backend "python db/aplicar_rol_aplicacion.py"

Es idempotente: correrlo dos veces no rompe nada.

Los dos archivos tienen que cambiar juntos. El .sql manda; este es su
traduccion.

Variables que lee del entorno:

    APP_DB_USER, APP_DB_PASSWORD   el rol a crear o actualizar
    DATABASE_URL_MIGRACIONES       conexion del propietario del esquema;
                                   si no esta, DATABASE_URL_SYNC
"""

import os
import sys

import psycopg2
from psycopg2 import sql
from sqlalchemy.engine import make_url


def conexion_de_administracion():
    """
    Conexion con la que se aplica todo: la del propietario del esquema.

    Se prefiere `DATABASE_URL_MIGRACIONES` porque, una vez aplicado esto, la
    de la app ya no tiene permiso para conceder nada. Correr el script por
    segunda vez con la URL de la app fallaria, y el mensaje de Postgres no
    diria por que.
    """
    url = make_url(
        os.environ.get("DATABASE_URL_MIGRACIONES")
        or os.environ["DATABASE_URL_SYNC"]
    )
    conexion = psycopg2.connect(
        dbname=url.database,
        user=url.username,
        password=url.password,
        host=url.host,
        port=url.port or 5432,
    )
    # DDL y GRANT fuera de una transaccion larga: si algo falla a mitad, lo
    # anterior ya quedo aplicado y volver a correrlo termina el trabajo.
    conexion.autocommit = True
    return conexion, url.database


def aplicar(cur, usuario: str, clave: str, base: str) -> None:
    ident = sql.Identifier
    rol = ident(usuario)

    def paso(texto):
        print(f"  {texto}")

    # -- 1. El rol ------------------------------------------------------------
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (usuario,))
    if cur.fetchone() is None:
        cur.execute(sql.SQL("CREATE ROLE {} LOGIN").format(rol))
        paso(f"rol «{usuario}» creado")
    else:
        paso(f"rol «{usuario}» ya existia: se le actualiza la contrasena")

    cur.execute(
        sql.SQL(
            "ALTER ROLE {} LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB "
            "NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40"
        ).format(rol),
        (clave,),
    )
    # Techo de tiempo por sentencia y por transaccion ociosa: una consulta
    # pesada o una transaccion abandonada no puede tumbar la base.
    for ajuste in (
        "statement_timeout = '30s'",
        "idle_in_transaction_session_timeout = '60s'",
        "lock_timeout = '10s'",
    ):
        cur.execute(sql.SQL("ALTER ROLE {} SET " + ajuste).format(rol))
    paso("sin superusuario, sin crear roles ni bases, con timeouts propios")

    # -- 2. Acceso a la base --------------------------------------------------
    cur.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(ident(base)))
    cur.execute(
        sql.SQL("GRANT CONNECT, TEMPORARY ON DATABASE {} TO {}").format(ident(base), rol)
    )
    cur.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
    cur.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(rol))
    cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(rol))
    paso("conecta y usa el esquema, pero no puede crear en el (no migra)")

    # -- 3. Propiedad: de vuelta a quien migra --------------------------------
    # Una version anterior del .sql le daba al rol de la app la propiedad de
    # todas las tablas para que Alembic pudiera ALTERarlas. Un propietario
    # puede desactivar triggers y vaciar tablas, asi que la bitacora dejaba de
    # ser inmutable.
    cur.execute(
        """
        SELECT c.relkind, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
           AND pg_get_userbyid(c.relowner) = %s
           -- Las secuencias de una columna serial viajan con su tabla;
           -- cambiarles el dueno por separado es un error.
           AND NOT (c.relkind = 'S' AND EXISTS (
                 SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass
                    AND d.objid = c.oid AND d.deptype IN ('a', 'i')))
        """,
        (usuario,),
    )
    plantillas = {
        "S": "ALTER SEQUENCE public.{} OWNER TO CURRENT_USER",
        "v": "ALTER VIEW public.{} OWNER TO CURRENT_USER",
        "m": "ALTER MATERIALIZED VIEW public.{} OWNER TO CURRENT_USER",
    }
    devueltos = cur.fetchall()
    for relkind, relname in devueltos:
        plantilla = plantillas.get(relkind, "ALTER TABLE public.{} OWNER TO CURRENT_USER")
        cur.execute(sql.SQL(plantilla).format(ident(relname)))
    paso(f"propiedad devuelta a quien migra: {len(devueltos)} objetos")

    # -- 4. Permisos de datos sobre lo que ya existe --------------------------
    cur.execute(
        sql.SQL("REVOKE REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM {}").format(rol)
    )
    cur.execute(
        sql.SQL(
            "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE "
            "ON ALL TABLES IN SCHEMA public TO {}"
        ).format(rol)
    )
    cur.execute(
        sql.SQL("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {}").format(rol)
    )
    cur.execute(sql.SQL("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {}").format(rol))
    paso("lee y escribe filas; nada que sirva para cambiar el esquema")

    # -- 5. Objetos futuros ---------------------------------------------------
    for sentencia in (
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE REFERENCES, TRIGGER ON TABLES FROM {}",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO {}",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {}",
    ):
        cur.execute(sql.SQL(sentencia).format(rol))
    paso("lo que creen las proximas migraciones nace accesible para la app")

    # -- 6. Bitacora de auditoria ---------------------------------------------
    # El GRANT de arriba le dio UPDATE/DELETE/TRUNCATE tambien sobre la
    # bitacora; esta funcion (migracion 0010) se queda con su propiedad y deja
    # a la app en SELECT e INSERT.
    cur.execute("SELECT to_regprocedure('public.bitacora_auditoria_proteger()') IS NOT NULL")
    if not cur.fetchone()[0]:
        raise SystemExit(
            "  ERROR: falta bitacora_auditoria_proteger(). Aplica las "
            "migraciones (al menos la 0010) antes de endurecer el rol."
        )
    cur.execute("SELECT bitacora_auditoria_proteger()")
    paso("bitacora de auditoria: la app queda en SELECT + INSERT")

    # -- 7. Bases de servicio fuera de alcance --------------------------------
    for otra in ("postgres", "template1"):
        try:
            cur.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(ident(otra)))
        except psycopg2.Error as error:
            # En un Postgres gestionado puede no existir o no ser nuestro.
            paso(f"(sin tocar la base «{otra}»: {str(error).strip()[:60]})")
    paso("bases de servicio fuera del alcance de PUBLIC")


def main() -> int:
    usuario = os.environ.get("APP_DB_USER")
    clave = os.environ.get("APP_DB_PASSWORD")
    if not usuario or not clave:
        print(
            "Faltan APP_DB_USER y APP_DB_PASSWORD en el entorno.\n"
            "Definelas donde corra esto (en Railway, variables del servicio) "
            "y vuelve a intentarlo.",
            file=sys.stderr,
        )
        return 1

    conexion, base = conexion_de_administracion()
    try:
        with conexion.cursor() as cur:
            aplicar(cur, usuario, clave, base)
    finally:
        conexion.close()

    print(
        "\nListo. Ahora apunta la aplicacion al rol nuevo y deja la conexion "
        "del propietario solo para migrar:\n"
        f"  DATABASE_URL              postgresql+asyncpg://{usuario}:<clave>@<host>/{base}\n"
        f"  DATABASE_URL_SYNC         postgresql://{usuario}:<clave>@<host>/{base}\n"
        "  DATABASE_URL_MIGRACIONES  la del propietario, tal como estaba\n"
        "Despues reinicia el servicio y comprueba GET /auditoria/verificacion: "
        "«protegida» tiene que pasar a true."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
