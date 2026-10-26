"""Kardex de materiales (HU-S10-07).

Hasta ahora `material.cantidad_disponible` solo cambiaba si un supervisor la
tecleaba en el modal de editar activo: no había consumo por tarea ni historial,
así que la alerta de stock crítico vigilaba números que nadie mantenía.

- `movimiento_material`: cada cambio del stock, con su tipo, la cantidad con
  signo (positiva entra, negativa sale), el saldo que dejó, el motivo, la tarea
  que lo consumió y quién lo hizo. Las reglas que la API ya aplica también las
  impone la base, para que un INSERT por fuera no pueda dejar un kardex
  incoherente:
    · la cantidad nunca es 0; una entrada siempre suma y un consumo siempre resta;
    · un consumo siempre es de una tarea y un ajuste siempre lleva motivo;
    · el saldo resultante nunca es negativo.
- `material.cantidad_disponible >= 0`: el stock no puede quedar negativo ni
  siquiera fuera de la API.

Borrar un material borra su kardex (ON DELETE CASCADE); la bitácora de
auditoría conserva igual el registro de cada movimiento.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "movimiento_material",
        sa.Column("id_movimiento", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "id_material",
            sa.Integer(),
            sa.ForeignKey("material.id_activo", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tipo", sa.String(20), nullable=False),
        sa.Column("cantidad", sa.Integer(), nullable=False),
        sa.Column("saldo_resultante", sa.Integer(), nullable=False),
        sa.Column("motivo", sa.String(255), nullable=True),
        sa.Column(
            "id_tarea",
            sa.Integer(),
            sa.ForeignKey("tarea.id_tarea", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "id_empleado",
            sa.Integer(),
            sa.ForeignKey("empleado.id_empleado", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("fecha_hora", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "tipo IN ('entrada', 'consumo', 'ajuste')", name="ck_movimiento_material_tipo"
        ),
        sa.CheckConstraint("cantidad <> 0", name="ck_movimiento_material_cantidad"),
        sa.CheckConstraint(
            "(tipo <> 'entrada' OR cantidad > 0) AND (tipo <> 'consumo' OR cantidad < 0)",
            name="ck_movimiento_material_signo",
        ),
        sa.CheckConstraint(
            "tipo <> 'consumo' OR id_tarea IS NOT NULL", name="ck_movimiento_material_consumo_tarea"
        ),
        sa.CheckConstraint(
            "tipo <> 'ajuste' OR motivo IS NOT NULL", name="ck_movimiento_material_ajuste_motivo"
        ),
        sa.CheckConstraint("saldo_resultante >= 0", name="ck_movimiento_material_saldo"),
    )
    op.create_index(
        "ix_movimiento_material_material_fecha",
        "movimiento_material",
        ["id_material", sa.text("fecha_hora DESC")],
    )
    op.create_index("ix_movimiento_material_tarea", "movimiento_material", ["id_tarea"])
    op.create_check_constraint(
        "ck_material_cantidad_no_negativa", "material", "cantidad_disponible >= 0"
    )


def downgrade() -> None:
    op.drop_constraint("ck_material_cantidad_no_negativa", "material", type_="check")
    op.drop_index("ix_movimiento_material_tarea", table_name="movimiento_material")
    op.drop_index("ix_movimiento_material_material_fecha", table_name="movimiento_material")
    op.drop_table("movimiento_material")
