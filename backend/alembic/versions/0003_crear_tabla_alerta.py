"""Crear tabla alerta para alertas persistentes del sistema.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alerta",
        sa.Column(
            "id_alerta",
            sa.Integer(),
            primary_key=True,
            autoincrement=True,
        ),
        sa.Column("tipo", sa.String(50), nullable=False),
        sa.Column("severidad", sa.String(20), nullable=False),
        sa.Column(
            "estado",
            sa.String(20),
            nullable=False,
            server_default="pendiente",
        ),
        sa.Column("referencia", sa.String(255), nullable=True),
        sa.Column(
            "fecha",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("alerta")
