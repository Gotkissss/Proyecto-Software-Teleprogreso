"""Revocación de tokens, catálogo de pausas y unicidad de alertas.

Tres cambios que sacan estado de la memoria del proceso y lo llevan a la BD:

- `token_revocado`: el logout guardaba los tokens en un `set()` de Python, que
  se vaciaba en cada redeploy y no se compartía entre workers. Un usuario que
  cerraba sesión seguía teniendo un token utilizable.

- `tipo_pausa`: el catálogo estaba escrito a mano en el router de descanso.
  Cambiar la duración máxima de una pausa obligaba a tocar código y desplegar.

- Índice único sobre las alertas: la detección corre dentro de un GET, así que
  dos supervisores abriendo la pantalla a la vez podían insertar la misma
  alerta dos veces. El índice lo impide a nivel de base de datos.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Catálogo inicial: los mismos valores que estaban escritos en el router, para
# que la migración no cambie el comportamiento de la aplicación.
TIPOS_PAUSA_INICIALES = [
    ("almuerzo", "Pausa de Almuerzo", 60, 1),
    ("tecnica", "Pausa Técnica (Soporte)", 15, 2),
    ("personal", "Pausa Personal", 10, 3),
]


def upgrade() -> None:
    # ── Tokens revocados ─────────────────────────────────────────────────────
    op.create_table(
        "token_revocado",
        sa.Column("jti", sa.String(64), primary_key=True),
        sa.Column(
            "id_empleado",
            sa.Integer(),
            sa.ForeignKey("empleado.id_empleado", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("expira", sa.DateTime(), nullable=False),
        sa.Column(
            "fecha_revocacion",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # La purga de tokens ya expirados barre por esta columna.
    op.create_index("ix_token_revocado_expira", "token_revocado", ["expira"])

    # ── Catálogo de tipos de pausa ───────────────────────────────────────────
    tipo_pausa = op.create_table(
        "tipo_pausa",
        sa.Column("id_tipo_pausa", sa.String(20), primary_key=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("duracion_max_min", sa.Integer(), nullable=False),
        sa.Column("orden", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "activo", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.bulk_insert(
        tipo_pausa,
        [
            {
                "id_tipo_pausa": id_tipo,
                "label": label,
                "duracion_max_min": duracion,
                "orden": orden,
                "activo": True,
            }
            for id_tipo, label, duracion, orden in TIPOS_PAUSA_INICIALES
        ],
    )

    # ── Unicidad de alertas ──────────────────────────────────────────────────
    # La clave lógica es tipo + referencia + día. Se limpia primero cualquier
    # duplicado que ya se haya colado, conservando la fila más antigua: si el
    # índice se crea sobre datos sucios, la migración falla.
    op.execute(
        """
        DELETE FROM alerta a
         USING alerta b
         WHERE a.id_alerta > b.id_alerta
           AND a.tipo = b.tipo
           AND a.referencia IS NOT DISTINCT FROM b.referencia
           AND DATE(a.fecha) = DATE(b.fecha)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_alerta_tipo_referencia_dia
            ON alerta (tipo, referencia, (DATE(fecha)))
         WHERE referencia IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_alerta_tipo_referencia_dia")
    op.drop_table("tipo_pausa")
    op.drop_index("ix_token_revocado_expira", table_name="token_revocado")
    op.drop_table("token_revocado")
