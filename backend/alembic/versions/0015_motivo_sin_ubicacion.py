"""Por qué una marca de asistencia quedó sin ubicación (RTF-01, R3-4).

La entrada y la salida se registran aunque el GPS falle. Eso es correcto y
deliberado: bloquearlas dejaría al técnico sin poder trabajar por un permiso
denegado o un sótano sin señal. Pero el resultado era una marca que decía
«Ubicación no disponible» y nada más, y en un sistema de control de personal de
campo eso es precisamente el dato que no se puede dejar en blanco: no hay forma
de distinguir «el GPS no enganchó» de «marqué desde mi casa».

`motivo_sin_ubicacion_entrada` y `..._salida` guardan lo que el técnico escribe
cuando esa marca sale sin coordenada. No la convierten en verificable —una
explicación no es una ubicación— pero dejan constancia de quién dijo qué, lo que
sí se puede revisar y contrastar.

Son dos columnas y no una porque la entrada y la salida son dos marcas
distintas: se puede entrar con GPS y salir sin él, o fallar las dos por motivos
diferentes. Con una sola columna el supervisor vería un motivo sin saber a cuál
de las dos marcas corresponde.

Son NULL-ables: las marcas anteriores a esta migración no lo tienen, y una marca
CON ubicación no necesita explicar nada.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for columna in ("motivo_sin_ubicacion_entrada", "motivo_sin_ubicacion_salida"):
        op.add_column(
            "asistencia",
            sa.Column(columna, sa.String(length=200), nullable=True),
        )

    # Informativo: cuántas marcas existentes quedaron sin explicación. No se
    # rellenan con nada —inventar un motivo sería peor que el hueco— pero
    # conviene que el número salga en el log del despliegue.
    sin_ubicacion = op.get_bind().execute(
        sa.text(
            "SELECT COUNT(*) FROM asistencia "
            "WHERE coordenada_entrada IS NULL OR "
            "(hora_salida IS NOT NULL AND coordenada_salida IS NULL)"
        )
    ).scalar()
    if sin_ubicacion:
        print(
            f"[migración 0015] {sin_ubicacion} jornadas tienen alguna marca sin "
            "ubicación y se quedan sin motivo: son anteriores a que el sistema "
            "lo pidiera."
        )


def downgrade() -> None:
    op.drop_column("asistencia", "motivo_sin_ubicacion_salida")
    op.drop_column("asistencia", "motivo_sin_ubicacion_entrada")
