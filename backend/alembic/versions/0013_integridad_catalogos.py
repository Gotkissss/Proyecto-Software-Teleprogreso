"""La base rechaza lo que no está en el catálogo (HU-S10-08).

Hasta ahora las listas blancas de roles, estados y prioridades vivían solo en
`app/core/reglas.py` y en los schemas de Pydantic. Eso cubre lo que entra por
la API, que es casi todo — pero no todo: el seed, las migraciones de datos, un
script de corrección y la consola de la base escriben directo. Un `estado_tarea`
mal escrito por ahí no revienta nada en el momento: la tarea simplemente deja
de aparecer en las pantallas que filtran por estado, y el reporte del gerente
la cuenta en ninguna columna.

Lo que añade esta migración:

1. **CHECK de catálogo** en `empleado.rol`, `empleado.estado`,
   `tarea.estado_tarea`, `tarea.prioridad`, `carro.estado_vehiculo` y
   `herramienta.estado`. Los valores son los de `core/reglas.py`; si allí se
   añade uno, aquí hace falta una migración.

2. **Un vehículo por técnico y un técnico por vehículo.** La clave primaria de
   `empleado_carro` es la pareja `(id_empleado, id_carro)`, así que la base
   permitía dos filas con el mismo empleado y vehículos distintos. Lo impedía
   solo `services/carros.asignar_tecnico`, con dos consultas previas: dos
   peticiones simultáneas las pasan las dos y el técnico acaba con dos
   vehículos. Dos índices únicos lo cierran de verdad.

3. **Clave foránea de `descanso.tipo` a `tipo_pausa`.** El catálogo de pausas
   es una tabla desde la migración 0005, pero la columna que lo referencia era
   texto suelto: una pausa con un tipo que no existe sale del historial sin
   etiqueta y sin duración máxima que comparar.

Antes de crear cada restricción se comprueba que los datos actuales la
cumplen, y si no, se aborta diciendo QUÉ filas sobran. Es deliberado: el
mensaje del motor ("violates check constraint") no dice cuáles son, y en un
despliegue donde la base no es alcanzable desde fuera averiguarlo cuesta más
que el arreglo. Con esto, un `alembic upgrade` que falle deja escrito en el log
del servicio exactamente qué corregir.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Los mismos valores que `app/core/reglas.py`. Se repiten aquí a propósito: una
# migración tiene que seguir aplicándose igual dentro de un año, y leer la
# constante del código la haría cambiar de significado cuando el código cambie.
CATALOGOS = [
    # (tabla, columna, valores, nombre de la restricción)
    ("empleado", "rol", ("admin", "supervisor", "tecnico", "gerente"), "ck_empleado_rol"),
    ("empleado", "estado", ("activo", "inactivo"), "ck_empleado_estado"),
    (
        "tarea",
        "estado_tarea",
        ("pendiente", "en_progreso", "completado", "cancelado"),
        "ck_tarea_estado",
    ),
    ("tarea", "prioridad", ("baja", "media", "alta", "urgente"), "ck_tarea_prioridad"),
    (
        "carro",
        "estado_vehiculo",
        ("disponible", "en_uso", "mantenimiento", "baja"),
        "ck_carro_estado",
    ),
    (
        "herramienta",
        "estado",
        ("disponible", "en_uso", "mantenimiento", "baja"),
        "ck_herramienta_estado",
    ),
]

INDICES_UNICOS = [
    # (nombre, tabla, columna, qué regla expresa)
    (
        "uq_empleado_carro_empleado",
        "empleado_carro",
        "id_empleado",
        "un técnico no puede tener dos vehículos a la vez",
    ),
    (
        "uq_empleado_carro_carro",
        "empleado_carro",
        "id_carro",
        "un vehículo no puede estar asignado a dos técnicos",
    ),
]


def _abortar(mensaje: str) -> None:
    raise RuntimeError(f"[migración 0013] {mensaje}")


def _comprobar_catalogo(conexion, tabla, columna, valores) -> None:
    """Aborta si alguna fila tiene un valor fuera del catálogo."""
    filas = conexion.execute(
        sa.text(
            f"SELECT DISTINCT {columna} AS valor, COUNT(*) AS filas "
            f"FROM {tabla} "
            f"WHERE {columna} IS NULL OR {columna} <> ALL(:validos) "
            f"GROUP BY {columna} ORDER BY filas DESC"
        ),
        {"validos": list(valores)},
    ).fetchall()
    if filas:
        detalle = ", ".join(f"{v!r} ({n} filas)" for v, n in filas)
        _abortar(
            f"{tabla}.{columna} tiene valores fuera del catálogo "
            f"({', '.join(valores)}): {detalle}. Corrígelos antes de migrar."
        )


def upgrade() -> None:
    conexion = op.get_bind()

    # ── 1. Catálogos ────────────────────────────────────────────────────────
    for tabla, columna, valores, nombre in CATALOGOS:
        _comprobar_catalogo(conexion, tabla, columna, valores)
        lista = ", ".join(f"'{v}'" for v in valores)
        op.create_check_constraint(nombre, tabla, f"{columna} IN ({lista})")

    # ── 2. Un vehículo por técnico, un técnico por vehículo ─────────────────
    for nombre, tabla, columna, regla in INDICES_UNICOS:
        duplicados = conexion.execute(
            sa.text(
                f"SELECT {columna} AS clave, COUNT(*) AS filas FROM {tabla} "
                f"GROUP BY {columna} HAVING COUNT(*) > 1 ORDER BY filas DESC"
            )
        ).fetchall()
        if duplicados:
            detalle = ", ".join(f"{columna}={c} ({n} filas)" for c, n in duplicados)
            _abortar(
                f"No se puede imponer que {regla}: ya hay duplicados en "
                f"{tabla}.{columna}: {detalle}. Libera las asignaciones de "
                "sobra antes de migrar."
            )
        op.create_index(nombre, tabla, [columna], unique=True)

    # ── 3. descanso.tipo → tipo_pausa ───────────────────────────────────────
    #
    # La columna es NULL-able y se queda así: un descanso antiguo sin tipo es
    # un dato incompleto, no uno inválido, y ponerle uno inventado para poder
    # crear la clave sería peor que dejarlo en NULL.
    huerfanos = conexion.execute(
        sa.text(
            "SELECT DISTINCT d.tipo AS valor, COUNT(*) AS filas "
            "FROM descanso d "
            "LEFT JOIN tipo_pausa tp ON tp.id_tipo_pausa = d.tipo "
            "WHERE d.tipo IS NOT NULL AND tp.id_tipo_pausa IS NULL "
            "GROUP BY d.tipo ORDER BY filas DESC"
        )
    ).fetchall()
    if huerfanos:
        detalle = ", ".join(f"{v!r} ({n} filas)" for v, n in huerfanos)
        _abortar(
            "descanso.tipo apunta a tipos de pausa que no existen en "
            f"tipo_pausa: {detalle}. Dales de alta en el catálogo (o pon esas "
            "filas en NULL) antes de migrar."
        )

    op.create_foreign_key(
        "fk_descanso_tipo_pausa",
        "descanso",
        "tipo_pausa",
        ["tipo"],
        ["id_tipo_pausa"],
        # RESTRICT y no CASCADE: retirar un tipo de pausa no puede borrar las
        # pausas que ya se tomaron con él. `tipo_pausa.activo` existe
        # justamente para dar de baja un tipo sin tocar el historial.
        ondelete="RESTRICT",
        onupdate="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_descanso_tipo_pausa", "descanso", type_="foreignkey")

    for nombre, tabla, _columna, _regla in INDICES_UNICOS:
        op.drop_index(nombre, table_name=tabla)

    for tabla, _columna, _valores, nombre in CATALOGOS:
        op.drop_constraint(nombre, tabla, type_="check")
