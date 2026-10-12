"""Bitácora inmutable de verdad: cadena calculada en la base, purga con ancla.

La 0009 dejó la tabla, un trigger contra UPDATE/DELETE y el hash calculado en
Python. Eso tenía tres huecos:

1. El rol de la aplicación era el propietario de la tabla (las migraciones
   corrían con él), así que podía desactivar el trigger o hacer TRUNCATE.
2. El hash lo calculaba el propio backend: quien controlara el backend podía
   insertar filas con cualquier hash.
3. Verificar la cadena exigía traer cada fila a Python.

Lo que hace esta migración:

- `bitacora_auditoria_calcular_hash(fila, anterior)`: el contenido canónico de
  una fila (jsonb_build_array, fecha en UTC con microsegundos) y su SHA-256.
  Lo usan el trigger de inserción y la verificación, así que no pueden
  divergir.
- Trigger BEFORE INSERT `bitacora_auditoria_encadenar`: toma el candado de la
  cadena, reasigna el id DESPUÉS del candado (si no, dos inserciones
  concurrentes podrían quedar con el id en un orden y la cadena en otro), fija
  la hora con el reloj de la base y calcula hash_anterior y hash. Lo que mande
  la aplicación en esas columnas se ignora.
- UPDATE prohibido siempre. DELETE solo dentro de `bitacora_auditoria_purgar`
  (bandera de transacción + ser el propietario). TRUNCATE prohibido siempre,
  también para el propietario.
- `bitacora_ancla`: cada purga deja aquí el hash de la última fila borrada. La
  primera fila que sobrevive conserva su hash_anterior intacto y la
  verificación lo compara con el ancla: la cadena no se reescribe.
- `bitacora_auditoria_verificar()`: recorre la cadena en SQL y devuelve la
  primera fila rota y el motivo.
- `bitacora_auditoria_proteger()`: si quien migra es superusuario, se queda con
  la propiedad de las dos tablas y deja a cualquier otro rol solo con SELECT e
  INSERT (bitácora) y SELECT (anclas). La llaman esta migración y
  backend/db/aplicar_rol_aplicacion.sql.
- Re-encadena las filas que la 0009 hubiera dejado con el hash de Python.
  Antes comprueba esa cadena vieja con el algoritmo de la 0009 y deja el
  resultado como fila `reencadenar` en la propia bitácora: si alguien la
  hubiera alterado antes de esta migración, la evidencia no se pierde.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-12
"""
import hashlib
import json
from datetime import timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CALCULAR_HASH = """
CREATE OR REPLACE FUNCTION bitacora_auditoria_calcular_hash(
    fila bitacora_auditoria, anterior text
) RETURNS char(64)
LANGUAGE sql STABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        fila.id_bitacora,
        to_char(fila.fecha_hora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        fila.id_actor,
        fila.rol_actor,
        host(fila.ip),
        fila.request_id,
        fila.accion,
        fila.entidad,
        fila.id_entidad,
        fila.cambios,
        anterior
    )::text, 'UTF8')), 'hex')
$$;
"""

ENCADENAR = """
CREATE OR REPLACE FUNCTION bitacora_auditoria_encadenar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    anterior text;
BEGIN
    -- Hasta el commit nadie más inserta: la cadena queda en el orden del id.
    PERFORM pg_advisory_xact_lock(90009);
    NEW.id_bitacora := nextval(pg_get_serial_sequence('bitacora_auditoria', 'id_bitacora'));
    -- La hora la pone la base: una fila con fecha inventada podría adelantar
    -- la purga de todo lo anterior a ella.
    NEW.fecha_hora := clock_timestamp();

    SELECT b.hash INTO anterior
      FROM bitacora_auditoria b
     ORDER BY b.id_bitacora DESC
     LIMIT 1;
    IF NOT FOUND THEN
        -- Tabla vacía tras una purga total: se continúa desde el ancla.
        SELECT a.hash_ancla INTO anterior
          FROM bitacora_ancla a
         ORDER BY a.id_ancla DESC
         LIMIT 1;
    END IF;

    NEW.hash_anterior := anterior;
    NEW.hash := bitacora_auditoria_calcular_hash(NEW, anterior);
    RETURN NEW;
END;
$$;
"""

INMUTABLE = """
CREATE OR REPLACE FUNCTION bitacora_auditoria_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Única puerta para borrar: bitacora_auditoria_purgar(), que enciende la
    -- bandera solo dentro de su transacción. Además hay que ser el
    -- propietario: el rol de la aplicación no lo es.
    IF TG_OP = 'DELETE'
       AND TG_TABLE_NAME = 'bitacora_auditoria'
       AND current_setting('teleprogreso.purga_bitacora', true) = 'on'
       AND pg_has_role(
               current_user,
               (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID),
               'MEMBER'
           ) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% es append-only: % no está permitido', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
"""

PURGAR = """
CREATE OR REPLACE FUNCTION bitacora_auditoria_purgar(
    retencion_dias integer, p_request_id text DEFAULT NULL
) RETURNS TABLE (o_filas integer, o_hasta_id bigint)
LANGUAGE plpgsql AS $$
DECLARE
    limite timestamptz;
    corte bigint;
    ultimo_id bigint;
    ultimo_hash text;
BEGIN
    IF retencion_dias IS NULL OR retencion_dias < 1 THEN
        RAISE EXCEPTION 'La retención de la bitácora debe ser de al menos 1 día (llegó %).', retencion_dias;
    END IF;

    PERFORM pg_advisory_xact_lock(90009);
    limite := clock_timestamp() - make_interval(days => retencion_dias);

    -- Se borra solo un prefijo de la cadena: todo lo anterior a la primera
    -- fila que todavía está dentro de la retención.
    SELECT min(b.id_bitacora) INTO corte
      FROM bitacora_auditoria b
     WHERE b.fecha_hora >= limite;

    SELECT b.id_bitacora, b.hash INTO ultimo_id, ultimo_hash
      FROM bitacora_auditoria b
     WHERE corte IS NULL OR b.id_bitacora < corte
     ORDER BY b.id_bitacora DESC
     LIMIT 1;

    IF ultimo_id IS NULL THEN
        o_filas := 0;
        o_hasta_id := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    PERFORM set_config('teleprogreso.purga_bitacora', 'on', true);
    DELETE FROM bitacora_auditoria b WHERE b.id_bitacora <= ultimo_id;
    GET DIAGNOSTICS o_filas = ROW_COUNT;
    PERFORM set_config('teleprogreso.purga_bitacora', 'off', true);

    INSERT INTO bitacora_ancla (hasta_id_bitacora, filas_purgadas, retencion_dias, hash_ancla)
    VALUES (ultimo_id, o_filas, retencion_dias, ultimo_hash);

    -- La purga queda en la propia cadena.
    INSERT INTO bitacora_auditoria (rol_actor, request_id, accion, entidad, cambios)
    VALUES (
        'sistema', p_request_id, 'purgar', 'bitacora_auditoria',
        jsonb_build_object('filas', o_filas, 'hasta_id', ultimo_id, 'retencion_dias', retencion_dias)
    );

    o_hasta_id := ultimo_id;
    RETURN NEXT;
END;
$$;
"""

VERIFICAR = """
CREATE OR REPLACE FUNCTION bitacora_auditoria_verificar()
RETURNS TABLE (o_filas bigint, o_id_rota bigint, o_motivo text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    ancla text;
    total bigint;
BEGIN
    SELECT a.hash_ancla INTO ancla FROM bitacora_ancla a ORDER BY a.id_ancla DESC LIMIT 1;
    SELECT count(*) INTO total FROM bitacora_auditoria;

    RETURN QUERY
    WITH cadena AS (
        SELECT b.id_bitacora,
               b.hash,
               b.hash_anterior,
               bitacora_auditoria_calcular_hash(b, b.hash_anterior) AS recalculado,
               lag(b.hash) OVER (ORDER BY b.id_bitacora) AS previo,
               row_number() OVER (ORDER BY b.id_bitacora) AS n
          FROM bitacora_auditoria b
    ), rotas AS (
        SELECT c.id_bitacora,
               CASE
                   WHEN c.recalculado IS DISTINCT FROM c.hash THEN 'contenido_alterado'
                   WHEN c.n = 1 AND c.hash_anterior IS DISTINCT FROM ancla THEN 'inicio_sin_ancla'
                   WHEN c.n > 1 AND c.hash_anterior IS DISTINCT FROM c.previo THEN 'eslabon_roto'
               END AS motivo
          FROM cadena c
    )
    SELECT total, r.id_bitacora, r.motivo
      FROM rotas r
     WHERE r.motivo IS NOT NULL
     ORDER BY r.id_bitacora
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY SELECT total, NULL::bigint, NULL::text;
    END IF;
END;
$$;
"""

PROTEGER = """
CREATE OR REPLACE FUNCTION bitacora_auditoria_proteger() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    es_super boolean;
    tabla text;
    dueno_anterior name;
    rol record;
    secuencia text;
    funcion text;
    resultado text := 'protegida';
BEGIN
    SELECT r.rolsuper INTO es_super FROM pg_roles r WHERE r.rolname = current_user;

    FOREACH tabla IN ARRAY ARRAY['bitacora_auditoria', 'bitacora_ancla'] LOOP
        SELECT pg_get_userbyid(c.relowner) INTO dueno_anterior
          FROM pg_class c WHERE c.oid = tabla::regclass;
        secuencia := pg_get_serial_sequence(
            tabla, CASE tabla WHEN 'bitacora_auditoria' THEN 'id_bitacora' ELSE 'id_ancla' END);

        IF dueno_anterior <> current_user THEN
            IF es_super THEN
                -- ALTER TABLE ... OWNER también se lleva su secuencia.
                EXECUTE format('ALTER TABLE %I OWNER TO %I', tabla, current_user);
            ELSE
                resultado := format(
                    'sin_proteccion: %s pertenece a %s y quien migra (%s) no es superusuario',
                    tabla, dueno_anterior, current_user);
                CONTINUE;
            END IF;
        END IF;

        -- Cualquier otro rol con algún permiso conserva solo lo que la tabla
        -- admite: SELECT e INSERT en la bitácora, SELECT en las anclas. El
        -- propietario anterior (el rol de la app en instalaciones viejas)
        -- entra en la lista aunque ya no tenga permisos explícitos.
        FOR rol IN
            SELECT x.nombre, bool_or(x.lee) AS lee, bool_or(x.inserta) AS inserta
              FROM (
                    SELECT pg_get_userbyid(p.grantee) AS nombre,
                           p.privilege_type = 'SELECT' AS lee,
                           p.privilege_type = 'INSERT' AS inserta
                      FROM pg_class c, aclexplode(c.relacl) p
                     WHERE c.oid = tabla::regclass
                       AND p.grantee <> 0
                       AND p.grantee <> c.relowner
                    UNION ALL
                    SELECT dueno_anterior, true, true
                     WHERE dueno_anterior <> current_user
                   ) x
             GROUP BY x.nombre
        LOOP
            EXECUTE format('REVOKE ALL ON %I FROM %I', tabla, rol.nombre);
            EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %I', secuencia, rol.nombre);
            IF rol.lee THEN
                EXECUTE format('GRANT SELECT ON %I TO %I', tabla, rol.nombre);
            END IF;
            IF rol.inserta AND tabla = 'bitacora_auditoria' THEN
                EXECUTE format('GRANT INSERT ON %I TO %I', tabla, rol.nombre);
                EXECUTE format('GRANT USAGE ON SEQUENCE %s TO %I', secuencia, rol.nombre);
            END IF;
        END LOOP;

        EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabla);
    END LOOP;

    -- Quien lee la bitácora necesita las anclas para verificarla (y el
    -- trigger de inserción las lee si la tabla quedó vacía tras una purga).
    FOR rol IN
        SELECT DISTINCT pg_get_userbyid(p.grantee) AS nombre
          FROM pg_class c, aclexplode(c.relacl) p
         WHERE c.oid = 'bitacora_auditoria'::regclass
           AND p.grantee <> 0
           AND p.grantee <> c.relowner
           AND p.privilege_type = 'SELECT'
    LOOP
        EXECUTE format('GRANT SELECT ON bitacora_ancla TO %I', rol.nombre);
    END LOOP;

    -- Las funciones de los triggers también: quien fuera su dueño podría
    -- reemplazarlas por otras que dejen pasar un UPDATE.
    IF es_super THEN
        FOREACH funcion IN ARRAY ARRAY[
            'bitacora_auditoria_calcular_hash(bitacora_auditoria, text)',
            'bitacora_auditoria_encadenar()',
            'bitacora_auditoria_inmutable()',
            'bitacora_auditoria_purgar(integer, text)',
            'bitacora_auditoria_verificar()',
            'bitacora_auditoria_proteger()'
        ] LOOP
            EXECUTE format('ALTER FUNCTION %s OWNER TO %I', funcion, current_user);
        END LOOP;
    END IF;

    -- Solo el propietario purga y protege (el DELETE fallaría igual por
    -- permisos, pero así ni siquiera se puede intentar).
    FOREACH funcion IN ARRAY ARRAY[
        'bitacora_auditoria_purgar(integer, text)',
        'bitacora_auditoria_proteger()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', funcion);
        FOR rol IN
            SELECT DISTINCT pg_get_userbyid(p.grantee) AS nombre
              FROM pg_proc f, aclexplode(f.proacl) p
             WHERE f.oid = funcion::regprocedure
               AND p.grantee <> 0
               AND p.grantee <> f.proowner
        LOOP
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', funcion, rol.nombre);
        END LOOP;
    END LOOP;
    RETURN resultado;
END;
$$;
"""

TRIGGERS_ANCLA = """
CREATE TRIGGER trg_bitacora_ancla_inmutable
BEFORE UPDATE OR DELETE ON bitacora_ancla
FOR EACH ROW EXECUTE FUNCTION bitacora_auditoria_inmutable();

CREATE TRIGGER trg_bitacora_ancla_sin_truncate
BEFORE TRUNCATE ON bitacora_ancla
FOR EACH STATEMENT EXECUTE FUNCTION bitacora_auditoria_inmutable();
"""

TRIGGERS_BITACORA = """
CREATE TRIGGER trg_bitacora_auditoria_sin_truncate
BEFORE TRUNCATE ON bitacora_auditoria
FOR EACH STATEMENT EXECUTE FUNCTION bitacora_auditoria_inmutable();

CREATE TRIGGER trg_bitacora_auditoria_encadenar
BEFORE INSERT ON bitacora_auditoria
FOR EACH ROW EXECUTE FUNCTION bitacora_auditoria_encadenar();
"""

# Las filas que dejó la 0009 tienen el hash de Python; se recalculan con el de
# la base, en orden y sin tocar su contenido. Quien migra es el propietario,
# así que puede apagar el trigger solo para esto.
REENCADENAR = """
DO $$
DECLARE
    r bitacora_auditoria;
    previo text := NULL;
    nuevo text;
BEGIN
    ALTER TABLE bitacora_auditoria DISABLE TRIGGER trg_bitacora_auditoria_inmutable;
    FOR r IN SELECT * FROM bitacora_auditoria ORDER BY id_bitacora LOOP
        nuevo := bitacora_auditoria_calcular_hash(r, previo);
        UPDATE bitacora_auditoria
           SET hash_anterior = previo, hash = nuevo
         WHERE id_bitacora = r.id_bitacora;
        previo := nuevo;
    END LOOP;
    ALTER TABLE bitacora_auditoria ENABLE TRIGGER trg_bitacora_auditoria_inmutable;
END;
$$;
"""


def _hash_0009(anterior, fila) -> str:
    """Copia congelada del cálculo de services/bitacora.py en la 0009."""
    contenido = {
        "fecha_hora": fila.fecha_hora.astimezone(timezone.utc).isoformat(),
        "id_actor": fila.id_actor,
        "rol_actor": fila.rol_actor,
        "ip": str(fila.ip) if fila.ip is not None else None,
        "request_id": fila.request_id,
        "accion": fila.accion,
        "entidad": fila.entidad,
        "id_entidad": fila.id_entidad,
        "cambios": fila.cambios,
        "hash_anterior": anterior,
    }
    canonico = json.dumps(
        contenido, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False
    )
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def _revisar_cadena_0009(conexion) -> dict:
    filas = conexion.execute(
        sa.text("SELECT * FROM bitacora_auditoria ORDER BY id_bitacora")
    ).all()
    anterior = None
    for fila in filas:
        if fila.hash_anterior != anterior or fila.hash != _hash_0009(anterior, fila):
            return {"filas": len(filas), "cadena_anterior_integra": False,
                    "primera_rota": fila.id_bitacora}
        anterior = fila.hash
    return {"filas": len(filas), "cadena_anterior_integra": True, "primera_rota": None}


def upgrade() -> None:
    op.create_table(
        "bitacora_ancla",
        sa.Column("id_ancla", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "fecha_hora",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("hasta_id_bitacora", sa.BigInteger(), nullable=False),
        sa.Column("filas_purgadas", sa.Integer(), nullable=False),
        sa.Column("retencion_dias", sa.Integer(), nullable=False),
        sa.Column("hash_ancla", sa.CHAR(64), nullable=False),
    )

    op.execute(CALCULAR_HASH)
    op.execute(INMUTABLE)
    op.execute(ENCADENAR)
    op.execute(PURGAR)
    op.execute(VERIFICAR)
    op.execute(PROTEGER)

    # Propiedad y permisos antes de re-encadenar: si la 0009 la creó el rol de
    # la app, ahora pasa a quien migra (si puede) y el re-encadenado lo hace él.
    resultado = op.get_bind().execute(sa.text("SELECT bitacora_auditoria_proteger()")).scalar()
    if resultado != "protegida":
        print(f"[0010] AVISO: la bitácora no quedó protegida a nivel de base ({resultado}).")

    revision_0009 = _revisar_cadena_0009(op.get_bind())
    op.execute(REENCADENAR)
    op.execute(TRIGGERS_ANCLA)
    op.execute(TRIGGERS_BITACORA)

    if revision_0009["filas"]:
        if not revision_0009["cadena_anterior_integra"]:
            print(
                "[0010] AVISO: la cadena de la 0009 estaba rota desde la fila "
                f"{revision_0009['primera_rota']}; queda registrado en la bitácora."
            )
        op.get_bind().execute(
            sa.text(
                "INSERT INTO bitacora_auditoria (rol_actor, accion, entidad, cambios) "
                "VALUES ('sistema', 'reencadenar', 'bitacora_auditoria', CAST(:cambios AS jsonb))"
            ),
            {"cambios": json.dumps(revision_0009)},
        )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_bitacora_auditoria_encadenar ON bitacora_auditoria")
    op.execute("DROP TRIGGER IF EXISTS trg_bitacora_auditoria_sin_truncate ON bitacora_auditoria")
    op.execute("DROP FUNCTION IF EXISTS bitacora_auditoria_proteger()")
    op.execute("DROP FUNCTION IF EXISTS bitacora_auditoria_verificar()")
    op.execute("DROP FUNCTION IF EXISTS bitacora_auditoria_purgar(integer, text)")
    op.execute("DROP FUNCTION IF EXISTS bitacora_auditoria_encadenar()")
    op.execute("DROP FUNCTION IF EXISTS bitacora_auditoria_calcular_hash(bitacora_auditoria, text)")
    # bitacora_ancla arrastra sus dos triggers al borrarse.
    op.drop_table("bitacora_ancla")
    # Vuelve el trigger de la 0009 tal cual era.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION bitacora_auditoria_inmutable() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'bitacora_auditoria es append-only: % no está permitido', TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$;
        """
    )
