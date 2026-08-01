"""Fecha real de completado de tarea y tipo de pausa.

Añade dos columnas que faltaban para poder reconstruir el estado desde la BD:

- `tarea.fecha_completado`: momento exacto en que el técnico cerró la tarea.
  No se puede reutilizar `fecha_finalizacion`, que ya significa "fecha límite"
  (la usa el cálculo de tareas retrasadas en /metricas/supervisor). Sin esta
  columna no hay forma de listar "lo hecho por día".

- `descanso.tipo`: qué clase de pausa fue (almuerzo | tecnica | personal).
  Antes el tipo solo existía en el estado de React, así que al recargar la
  pantalla de Pausas se perdía y el técnico podía repetir la misma pausa.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tarea",
        sa.Column("fecha_completado", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "descanso",
        sa.Column("tipo", sa.String(20), nullable=True),
    )

    # Índice para el historial "tareas hechas por día": filtra por rango de
    # fechas sobre esta columna en cada carga de la pantalla.
    op.create_index(
        "ix_tarea_fecha_completado",
        "tarea",
        ["fecha_completado"],
    )

    # Backfill: las tareas que ya estaban completadas antes de esta migración
    # no tienen marca temporal. Se usa fecha_inicio como mejor aproximación
    # disponible para que no desaparezcan del historial.
    op.execute(
        """
        UPDATE tarea
           SET fecha_completado = fecha_inicio::timestamp
         WHERE estado_tarea = 'completado'
           AND fecha_completado IS NULL
           AND fecha_inicio IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_tarea_fecha_completado", table_name="tarea")
    op.drop_column("descanso", "tipo")
    op.drop_column("tarea", "fecha_completado")
