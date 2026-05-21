"""Agregar columna foto_url a la tabla activo

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-20

Historia: SCRUM-95
-------------------
Se agrega la columna `foto_url` (VARCHAR(500), nullable) a la tabla `activo`
para almacenar la ruta/URL de la imagen asociada al activo. La columna es
nullable porque los activos ya existentes en la BD no tienen imagen, y la
carga de imagen (SCRUM-98) ocurre en un paso posterior al alta del activo.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "activo",
        sa.Column("foto_url", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activo", "foto_url")
