"""Normaliza el vocabulario de estados de herramientas y vehículos.

Convivían tres valores para lo mismo:

- el seed escribía `asignada` (herramienta) y `asignado` (vehículo),
- los endpoints de asignación escriben `en_uso`,
- el frontend solo sabe traducir `disponible | en_uso | mantenimiento`.

Resultado: las herramientas y los carros sembrados salían con el badge sin
traducir, y al asignar uno desde la app el estado cambiaba a otra palabra, así
que parecía que la pantalla "no se actualizaba".

Esta migración deja `en_uso` como único valor para "asignado a alguien".
Los datos nuevos ya salen bien del seed corregido; esto arregla los que ya
están en entornos desplegados.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE herramienta SET estado = 'en_uso' WHERE estado = 'asignada'")
    op.execute(
        "UPDATE carro SET estado_vehiculo = 'en_uso' WHERE estado_vehiculo = 'asignado'"
    )


def downgrade() -> None:
    # No se puede distinguir qué filas eran 'asignada' antes de la migración:
    # revertir todas las 'en_uso' rompería las que se asignaron por la API.
    # Se deja como no-op a propósito.
    pass
