# backend/tests/test_tareas_visibilidad.py
"""
Pruebas de visibilidad de GET /tareas.

El endpoint devolvía las tareas de toda la empresa a cualquier usuario
autenticado: el recorte por técnico lo aplicaba el cliente enviando
`id_tecnico`, así que un técnico que llamara a /tareas sin filtros leía el
trabajo de sus compañeros.

Aquí se fija la regla nueva:
  - admin / supervisor / gerente  → ven todo, y pueden filtrar por técnico
  - tecnico                       → solo ve lo suyo, ignore lo que pida

Como la sesión está mockeada, las aserciones se hacen sobre el SQL generado:
es la única forma de comprobar que el recorte viaja a la base de datos y no
se quedó en un `if` de Python.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.routers.tareas import get_tareas


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _db_sin_resultados():
    """AsyncSession simulada cuya consulta de tareas no devuelve filas."""
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = []

    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _empleado(rol, id_empleado):
    return SimpleNamespace(rol=rol, id_empleado=id_empleado)


def _sql_de(db):
    """SQL compilado, con los valores incrustados, de la última consulta."""
    statement = db.execute.await_args.args[0]
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


# ─── Técnico: siempre acotado a lo suyo ──────────────────────────────────────

@pytest.mark.asyncio
async def test_tecnico_solo_ve_sus_tareas():
    db = _db_sin_resultados()

    await get_tareas(db=db, current_user=_empleado("tecnico", 7))

    sql = _sql_de(db)
    assert "empleado_tarea" in sql
    assert "id_empleado = 7" in sql


@pytest.mark.asyncio
async def test_tecnico_no_puede_espiar_a_otro_tecnico():
    """Pedir id_tecnico ajeno no amplía lo que el técnico puede ver."""
    db = _db_sin_resultados()

    await get_tareas(db=db, current_user=_empleado("tecnico", 7), id_tecnico=99)

    sql = _sql_de(db)
    assert "id_empleado = 7" in sql
    assert "id_empleado = 99" not in sql


# ─── Roles de supervisión: ven todo ──────────────────────────────────────────

@pytest.mark.parametrize("rol", ["admin", "supervisor", "gerente"])
@pytest.mark.asyncio
async def test_supervision_ve_todas_las_tareas(rol):
    db = _db_sin_resultados()

    await get_tareas(db=db, current_user=_empleado(rol, 2))

    assert "empleado_tarea" not in _sql_de(db)


@pytest.mark.asyncio
async def test_supervisor_puede_filtrar_por_tecnico():
    db = _db_sin_resultados()

    await get_tareas(db=db, current_user=_empleado("supervisor", 2), id_tecnico=99)

    sql = _sql_de(db)
    assert "empleado_tarea" in sql
    assert "id_empleado = 99" in sql


# ─── Cota de resultados ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_consulta_siempre_lleva_limite():
    """Sin LIMIT la respuesta crecería con el histórico completo de tareas."""
    db = _db_sin_resultados()

    await get_tareas(db=db, current_user=_empleado("admin", 3))

    assert "LIMIT" in _sql_de(db).upper()
