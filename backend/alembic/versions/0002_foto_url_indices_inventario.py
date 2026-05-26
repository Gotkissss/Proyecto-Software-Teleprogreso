"""Agregar foto_url a activo y mejorar indices para endpoints de inventario

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-25
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Agregar columna foto_url a la tabla activo
    # Permite almacenar la URL o path de la imagen del activo
    op.add_column(
        "activo",
        sa.Column("foto_url", sa.String(500), nullable=True),
    )

    # Indice para buscar materiales bajo stock rapido
    # Optimiza la query: WHERE cantidad_disponible < stock_minimo
    op.create_index(
        "ix_material_stock",
        "material",
        ["cantidad_disponible", "stock_minimo"],
    )

    # Indice para buscar herramientas por estado
    op.create_index(
        "ix_herramienta_estado",
        "herramienta",
        ["estado"],
    )

    # Indice para buscar asignaciones de carros por empleado 
    op.create_index(
        "ix_empleado_carro_empleado",
        "empleado_carro",
        ["id_empleado"],
    )


def downgrade() -> None:
    op.drop_index("ix_empleado_carro_empleado", table_name="empleado_carro")
    op.drop_index("ix_herramienta_estado", table_name="herramienta")
    op.drop_index("ix_material_stock", table_name="material")
    op.drop_column("activo", "foto_url")