"""Las jornadas cerradas por el sistema no cuentan como trabajadas (RTF-01, R3-3).

Cuando un técnico olvida marcar salida, la jornada queda abierta y el siguiente
arranque la cierra a las 23:59:59 (`_cerrar_jornada_abandonada`). Eso es lo
correcto para no dejar una jornada abierta eternamente, pero el historial no
distinguía ese cierre de una salida real: una entrada a las 19:01 del 14/10
aparecía como `19:01–23:59 = 04:58` horas trabajadas.

El efecto no es cosmético. Esas horas entran en el historial de asistencia y en
los tres reportes del gerente, que es el propósito del sistema: el dato que
sostiene «cuánto trabajó esta persona» quedaba inflado por un olvido, y nadie
podía saber cuáles de las horas de un reporte eran reales.

`cierre_automatico` marca esas filas. Con ella puesta:

  - `calcular_jornada` no cuenta horas trabajadas (el `minutos_brutos` real no
    se conoce: lo único cierto es la hora de entrada);
  - el historial las muestra como «Sin salida» para que el supervisor las
    corrija;
  - los reportes las excluyen del total.

Nace en `false` para las filas que ya existen. No se puede adivinar
retroactivamente cuáles fueron cierres automáticos: la marca de las 23:59:59
es una pista, pero un turno nocturno que de verdad terminó a esa hora daría un
falso positivo, y reescribir horas ya reportadas con una heurística es peor que
dejarlas. El `upgrade` cuenta e informa las candidatas para que el supervisor
las revise a mano.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "asistencia",
        sa.Column(
            "cierre_automatico",
            sa.Boolean(),
            nullable=False,
            # server_default además del default del modelo: sin él, esta misma
            # sentencia no puede rellenar las filas que ya están en la tabla.
            server_default=sa.false(),
        ),
    )

    # Informativo, no destructivo: se dice cuántas filas PARECEN cierres
    # automáticos para que alguien las mire, sin tocarlas.
    candidatas = op.get_bind().execute(
        sa.text(
            "SELECT COUNT(*) FROM asistencia "
            "WHERE hora_salida = TIME '23:59:59'"
        )
    ).scalar()
    if candidatas:
        print(
            f"[migración 0014] {candidatas} jornadas tienen salida a las "
            "23:59:59 y podrían ser cierres automáticos anteriores a esta "
            "migración. Quedan como estaban: revísalas en el historial de "
            "asistencia, porque un turno nocturno real también termina a esa "
            "hora y marcarlas en bloque reescribiría horas ya reportadas."
        )


def downgrade() -> None:
    op.drop_column("asistencia", "cierre_automatico")
