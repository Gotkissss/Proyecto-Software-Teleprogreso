"""Cambio obligatorio de contraseña (HU-S10-01).

`empleado.debe_cambiar_contrasena` marca las cuentas cuya contraseña no eligió
su dueño: la puso un admin al crearlas o al restablecerla, o el despliegue en
el administrador inicial. Mientras esté en true, `get_current_empleado` solo
deja pasar las rutas de /auth que sirven para cambiarla.

Nace en false para las filas que ya existen y para las que inserta el seed
sin mencionarla: las cuentas de demostración tienen que seguir entrando
directo.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "empleado",
        sa.Column(
            "debe_cambiar_contrasena",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("empleado", "debe_cambiar_contrasena")
