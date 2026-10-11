"""Bitácora de auditoría append-only.

- Una fila por acción relevante: quién (id_actor, rol_actor), desde dónde
  (ip, request_id), qué (accion, entidad, id_entidad) y el detalle en
  `cambios` (JSONB).
- `hash` encadena cada fila con la anterior (`hash_anterior`): si alguien
  altera o borra una fila a mano, la cadena deja de cuadrar.
- Append-only a nivel de base: un trigger rechaza UPDATE y DELETE, también
  para el superusuario. TRUNCATE no se bloquea: es la operación deliberada
  que usa `seed.py --reset`.
- `id_actor` sin clave foránea a propósito: la bitácora tiene que sobrevivir
  a lo que le pase al empleado, y el rol se guarda como foto del momento en
  `rol_actor`. Es NULL en acciones sin sesión (p. ej. un login fallido).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bitacora_auditoria",
        sa.Column("id_bitacora", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "fecha_hora",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("id_actor", sa.Integer(), nullable=True),
        sa.Column("rol_actor", sa.String(20), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("accion", sa.String(50), nullable=False),
        sa.Column("entidad", sa.String(50), nullable=False),
        sa.Column("id_entidad", sa.Integer(), nullable=True),
        sa.Column("cambios", postgresql.JSONB(), nullable=True),
        # SHA-256 en hexadecimal. La primera fila no tiene anterior.
        sa.Column("hash_anterior", sa.CHAR(64), nullable=True),
        sa.Column("hash", sa.CHAR(64), nullable=False),
        sa.UniqueConstraint("hash", name="uq_bitacora_auditoria_hash"),
    )
    op.create_index(
        "ix_bitacora_auditoria_fecha_hora",
        "bitacora_auditoria",
        [sa.text("fecha_hora DESC")],
    )
    op.create_index(
        "ix_bitacora_auditoria_actor",
        "bitacora_auditoria",
        ["id_actor"],
    )
    op.create_index(
        "ix_bitacora_auditoria_entidad",
        "bitacora_auditoria",
        ["entidad", "id_entidad"],
    )

    op.execute(
        """
        CREATE FUNCTION bitacora_auditoria_inmutable() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'bitacora_auditoria es append-only: % no está permitido', TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_bitacora_auditoria_inmutable
        BEFORE UPDATE OR DELETE ON bitacora_auditoria
        FOR EACH ROW EXECUTE FUNCTION bitacora_auditoria_inmutable();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_bitacora_auditoria_inmutable ON bitacora_auditoria")
    op.execute("DROP FUNCTION IF EXISTS bitacora_auditoria_inmutable()")
    op.drop_index("ix_bitacora_auditoria_entidad", table_name="bitacora_auditoria")
    op.drop_index("ix_bitacora_auditoria_actor", table_name="bitacora_auditoria")
    op.drop_index("ix_bitacora_auditoria_fecha_hora", table_name="bitacora_auditoria")
    op.drop_table("bitacora_auditoria")