# backend/tests/test_tareas_mapa_supervisor.py
"""
Pruebas de GET /tareas/mapa-supervisor.

Cubre los filtros propios del endpoint (fecha e id_tecnico) y que el técnico
asignado viaje en la respuesta, que es lo que le permite al frontend agrupar
los marcadores del mapa por técnico.

Como la sesión está mockeada, el filtrado se comprueba sobre el SQL generado,
igual que en test_tareas_visibilidad.py.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.tiempo import hoy as hoy_local
from app.routers.tareas import get_mapa_supervisor


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _db_sin_resultados():
    """AsyncSession simulada cuya consulta no devuelve filas."""
    resultado = MagicMock()
    resultado.all.return_value = []

    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _db_con_fila(tarea, lat, lng):
    resultado = MagicMock()
    resultado.all.return_value = [(tarea, lat, lng)]

    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _sql_de(db):
    """SQL compilado, con los valores incrustados, de la última consulta."""
    statement = db.execute.await_args.args[0]
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


def _empleado(rol, id_empleado=2):
    return SimpleNamespace(rol=rol, id_empleado=id_empleado)


def _tarea(id_tarea, estado, tecnico=None):
    empleados = []
    if tecnico is not None:
        empleados = [SimpleNamespace(empleado=SimpleNamespace(**tecnico))]
    return SimpleNamespace(id_tarea=id_tarea, estado_tarea=estado, empleados=empleados)


# ─── Filtro de fecha ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sin_fecha_usa_hoy_local():
    db = _db_sin_resultados()

    await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert f"fecha_inicio = '{hoy_local()}'" in _sql_de(db)


@pytest.mark.asyncio
async def test_con_fecha_explicita_filtra_por_esa_fecha():
    db = _db_sin_resultados()

    await get_mapa_supervisor(
        db=db, _current_user=_empleado("supervisor"), fecha=date(2026, 1, 5)
    )

    assert "fecha_inicio = '2026-01-05'" in _sql_de(db)


# ─── Filtro por técnico ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sin_id_tecnico_no_filtra_por_tecnico():
    db = _db_sin_resultados()

    await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert "empleado_tarea" not in _sql_de(db)


@pytest.mark.asyncio
async def test_con_id_tecnico_filtra_por_ese_tecnico():
    db = _db_sin_resultados()

    await get_mapa_supervisor(
        db=db, _current_user=_empleado("supervisor"), id_tecnico=99
    )

    sql = _sql_de(db)
    assert "empleado_tarea" in sql
    assert "id_empleado = 99" in sql


# ─── Forma de la respuesta ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_incluye_tecnico_asignado_en_la_respuesta():
    tarea = _tarea(
        1, "pendiente", tecnico={"id_empleado": 7, "nombre": "Juan", "apellido": "Perez"}
    )
    db = _db_con_fila(tarea, 14.5, -90.5)

    respuesta = await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert len(respuesta) == 1
    item = respuesta[0]
    assert item.id_tarea == 1
    assert item.estado_tarea == "pendiente"
    assert item.lat == 14.5
    assert item.lng == -90.5
    assert item.tecnico.id_empleado == 7
    assert item.tecnico.nombre == "Juan Perez"


@pytest.mark.asyncio
async def test_tarea_sin_tecnico_asignado_devuelve_tecnico_none():
    tarea = _tarea(2, "pendiente")
    db = _db_con_fila(tarea, None, None)

    respuesta = await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert respuesta[0].tecnico is None
