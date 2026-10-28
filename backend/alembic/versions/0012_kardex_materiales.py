"""Kardex de materiales: el stock lo mueve el trabajo (HU-S10-07).

`material.cantidad_disponible` era un número que alguien editaba a mano en el
modal del inventario. Nadie lo bajaba al usar el material en una tarea, así que
la alerta de stock crítico vigilaba una cifra que no correspondía al almacén
real, y a la pregunta "¿a dónde se fueron las 40 rosetas?" no había nada que
responder: el campo solo guarda el último valor que alguien escribió.

Esta migración deja dos cosas:

1. `movimiento_material` — una fila por cada cambio del stock, con su tipo
   (entrada / consumo / ajuste), la cantidad, el **saldo resultante**, el
   motivo, la tarea si fue un consumo, quién lo hizo y cuándo. El saldo se
   guarda en la fila y no se recalcula sumando: así el kardex se puede leer sin
   recorrer la historia entera, y un descuadre entre el saldo de la última fila
   y `cantidad_disponible` es visible en una consulta.

2. `CHECK (cantidad_disponible >= 0)` en `material`. Es la última red: el
   servicio toma `SELECT … FOR UPDATE` sobre el material para que dos consumos
   simultáneos no se pisen, pero un INSERT/UPDATE hecho por fuera de la API no
   pasa por ese servicio, y un stock negativo no significa nada.

Antes de crear el CHECK hay que saber que los datos actuales lo cumplen; la
columna nació con `default=0` y los schemas ya exigían `ge=0`, pero una fila
puesta a mano podría tener cualquier cosa. El `upgrade` lo comprueba y dice qué
filas sobran en vez de fallar con un mensaje del motor.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Los tres motivos por los que el stock de un material cambia.
#
#   entrada  — llega material al almacén (compra, devolución).
#   consumo  — un técnico lo usó en una tarea. Lleva `id_tarea`.
#   ajuste   — corrección de inventario. Lleva motivo obligatorio, porque un
#              ajuste sin explicación es indistinguible de un error de captura.
TIPOS_MOVIMIENTO = ("entrada", "consumo", "ajuste")


def upgrade() -> None:
    conexion = op.get_bind()

    # ── Comprobación previa ─────────────────────────────────────────────────
    negativos = conexion.execute(
        sa.text(
            "SELECT id_activo, cantidad_disponible FROM material "
            "WHERE cantidad_disponible < 0 ORDER BY id_activo"
        )
    ).fetchall()
    if negativos:
        detalle = ", ".join(f"id_activo={i} ({c})" for i, c in negativos)
        raise RuntimeError(
            "No se puede crear el CHECK de cantidad_disponible >= 0: hay "
            f"materiales con stock negativo. Corrígelos primero: {detalle}."
        )

    op.create_table(
        "movimiento_material",
        sa.Column("id_movimiento", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "id_material",
            sa.Integer(),
            # El movimiento muere con su material: si se da de baja el activo,
            # su historia de stock no tiene a qué referirse.
            sa.ForeignKey("material.id_activo", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("cantidad", sa.Integer(), nullable=False),
        # Saldo que quedó DESPUÉS de aplicar este movimiento.
        sa.Column("saldo_resultante", sa.Integer(), nullable=False),
        sa.Column("motivo", sa.String(length=300), nullable=True),
        sa.Column(
            "id_tarea",
            sa.Integer(),
            # La tarea se borra y el movimiento se queda: el material se gastó
            # igual, y el saldo que dejó sigue siendo el de la fila siguiente.
            sa.ForeignKey("tarea.id_tarea", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "id_empleado",
            sa.Integer(),
            # Igual que arriba: quién lo hizo puede dejar la empresa, pero el
            # movimiento no se reescribe.
            sa.ForeignKey("empleado.id_empleado", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "fecha_hora",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Una cantidad de 0 no es un movimiento, y una negativa sería un
        # consumo escrito como entrada: el tipo es lo que da el signo.
        sa.CheckConstraint("cantidad > 0", name="ck_movimiento_cantidad_positiva"),
        sa.CheckConstraint(
            "saldo_resultante >= 0", name="ck_movimiento_saldo_no_negativo"
        ),
        sa.CheckConstraint(
            "tipo IN ('entrada', 'consumo', 'ajuste')",
            name="ck_movimiento_tipo",
        ),
        # NO hay CHECK de "un consumo nombra su tarea".
        #
        # Lo hubo, y se contradecía con la clave foránea: `id_tarea` es
        # ON DELETE SET NULL, así que borrar una tarea pone el campo en NULL y
        # el CHECK rechazaba ese mismo UPDATE. El resultado era que una tarea
        # con consumo registrado no se podía borrar nunca — ni desde el reset
        # del seed, ni en cascada.
        #
        # Las dos reglas no pueden ser verdad a la vez porque dicen cosas de
        # momentos distintos: "nace con tarea" es una regla de creación, y un
        # CHECK vigila la fila para siempre. Una vez borrada la tarea, el
        # movimiento legítimamente no tiene ninguna, y lo que importa —el
        # saldo que dejó— sigue intacto.
        #
        # La regla de creación la aplica `services/kardex.registrar_movimiento`
        # y la vigila `tests/test_kardex.py::
        # test_un_consumo_sin_tarea_se_rechaza`.
        # Un ajuste sin motivo sí es indistinguible de un error de captura, y
        # eso no cambia con el tiempo: el motivo se escribe una vez y se queda.
        sa.CheckConstraint(
            "(tipo <> 'ajuste') OR (motivo IS NOT NULL AND btrim(motivo) <> '')",
            name="ck_movimiento_ajuste_con_motivo",
        ),
    )

    # La consulta natural es "los movimientos de este material, el más reciente
    # primero": la pestaña del inventario y el kardex no piden otra cosa.
    op.create_index(
        "ix_movimiento_material_material_fecha",
        "movimiento_material",
        ["id_material", sa.text("fecha_hora DESC")],
    )
    # "¿qué material gastó esta tarea?" — lo pide el detalle de la tarea.
    op.create_index(
        "ix_movimiento_material_tarea",
        "movimiento_material",
        ["id_tarea"],
        postgresql_where=sa.text("id_tarea IS NOT NULL"),
    )

    op.create_check_constraint(
        "ck_material_cantidad_no_negativa",
        "material",
        "cantidad_disponible >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_material_cantidad_no_negativa", "material", type_="check"
    )
    op.drop_index("ix_movimiento_material_tarea", table_name="movimiento_material")
    op.drop_index(
        "ix_movimiento_material_material_fecha", table_name="movimiento_material"
    )
    op.drop_table("movimiento_material")
