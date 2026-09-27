"""Eventos e índice por fecha para el recorrido de los técnicos (HU-5).

- `evento`: por qué se guardó el punto. 'periodico' es el reporte automático
  mientras la app está abierta; 'inicio_tarea' y 'fin_tarea' son los puntos
  que se registran al iniciar y al finalizar una tarea.
- `id_tarea`: la tarea de esos dos eventos. Si la tarea se borra, el punto se
  conserva (SET NULL): sigue siendo parte del recorrido del técnico.
- Índice (id_empleado, fecha_hora_registro): el recorrido se consulta por
  técnico y día; con el índice anterior (solo id_empleado) había que leer
  todo el historial del técnico para quedarse con un día.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ubicacion_empleado",
        sa.Column(
            "evento",
            sa.String(20),
            nullable=False,
            server_default="periodico",
        ),
    )
    op.add_column(
        "ubicacion_empleado",
        sa.Column(
            "id_tarea",
            sa.Integer(),
            sa.ForeignKey("tarea.id_tarea", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_ubicacion_empleado_fecha",
        "ubicacion_empleado",
        ["id_empleado", "fecha_hora_registro"],
    )


def downgrade() -> None:
    op.drop_index("ix_ubicacion_empleado_fecha", table_name="ubicacion_empleado")
    op.drop_column("ubicacion_empleado", "id_tarea")
    op.drop_column("ubicacion_empleado", "evento")
