# backend/tests/test_tareas_mapa_supervisor.py
"""
Pruebas de GET /tareas/mapa-supervisor.

Cubre los filtros propios del endpoint (fecha e id_tecnico) y que el técnico
asignado viaje en la respuesta, que es lo que le permite al frontend agrupar
los marcadores del mapa por técnico.

Lo que se fija sobre el recorte por fecha:
  - En la vista de HOY entra TODO el trabajo abierto del equipo, tenga la
    fecha planificada que tenga. Antes se comparaba `fecha_inicio = fecha` y en
    "pendiente" salían dos tareas de seis: las vencidas y las programadas para
    otro día se caían del mapa.
  - Una tarea completada se pinta solo el día en que se cerró
    (`fecha_completado`), no todos los días de su rango de planificación.

Como la sesión está mockeada, el filtrado se comprueba sobre el SQL generado,
igual que en test_tareas_visibilidad.py.
"""

from datetime import date, timedelta
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


def _tarea(id_tarea, estado, tecnico=None, **campos):
    empleados = []
    if tecnico is not None:
        empleados = [SimpleNamespace(empleado=SimpleNamespace(**tecnico))]
    return SimpleNamespace(
        id_tarea=id_tarea,
        titulo=campos.get("titulo", f"Tarea {id_tarea}"),
        descripcion=campos.get("descripcion"),
        direccion_servicio=campos.get("direccion_servicio"),
        estado_tarea=estado,
        prioridad=campos.get("prioridad", "media"),
        fecha_completado=campos.get("fecha_completado"),
        empleados=empleados,
    )


# ─── Filtro de fecha ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sin_fecha_usa_hoy_local():
    db = _db_sin_resultados()

    await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    sql = _sql_de(db)

    assert f"fecha_completado >= '{hoy_local()}" in sql
    assert f"fecha_completado < '{hoy_local() + timedelta(days=1)}" in sql


@pytest.mark.asyncio
async def test_hoy_muestra_todo_el_trabajo_abierto():
    """
    Sin esto vuelve el bug que reportó el admin: en "pendiente" salían dos
    tareas porque el resto tenía la fecha planificada en otro día.
    """
    db = _db_sin_resultados()

    await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    sql = _sql_de(db)

    assert "estado_tarea IN ('pendiente', 'en_progreso')" in sql
    # El recorte del mapa ya no depende de la fecha planificada. (`fecha_inicio`
    # sigue apareciendo en el SELECT, porque se trae la fila entera; lo que
    # importa es que no forme parte del WHERE.)
    assert "fecha_inicio" not in sql.split("WHERE", 1)[1]


@pytest.mark.asyncio
async def test_con_fecha_explicita_filtra_por_el_cierre_de_ese_dia():
    db = _db_sin_resultados()

    await get_mapa_supervisor(
        db=db, _current_user=_empleado("supervisor"), fecha=date(2026, 1, 5)
    )

    sql = _sql_de(db)

    assert "fecha_completado >= '2026-01-05" in sql
    assert "fecha_completado < '2026-01-06" in sql


@pytest.mark.asyncio
async def test_un_dia_pasado_solo_muestra_lo_que_se_cerro_ese_dia():
    """
    En un día que no es hoy el mapa es un histórico: el trabajo que sigue
    abierto es del presente y pintarlo ahí daría una foto falsa de ese día.
    """
    db = _db_sin_resultados()

    await get_mapa_supervisor(
        db=db, _current_user=_empleado("supervisor"), fecha=date(2026, 1, 5)
    )

    sql = _sql_de(db)

    assert "IN ('pendiente', 'en_progreso')" not in sql
    assert "estado_tarea = 'completado'" in sql


@pytest.mark.asyncio
async def test_las_canceladas_no_entran_al_mapa():
    db = _db_sin_resultados()

    await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert "cancelado" not in _sql_de(db)


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
async def test_la_tarea_trae_lo_que_el_popup_del_mapa_necesita():
    """
    El popup del marcador del supervisor muestra título, dirección y
    prioridad además del técnico. Sin estos campos la pantalla tendría que
    pedir aparte la lista completa de tareas solo para rellenarlo.
    """
    tarea = _tarea(
        3,
        "pendiente",
        titulo="Cambio de poste dañado",
        direccion_servicio="Callejón San José, Fraijanes",
        prioridad="urgente",
    )
    db = _db_con_fila(tarea, 14.47, -90.44)

    respuesta = await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert respuesta[0].titulo == "Cambio de poste dañado"
    assert respuesta[0].direccion_servicio == "Callejón San José, Fraijanes"
    assert respuesta[0].prioridad == "urgente"


@pytest.mark.asyncio
async def test_tarea_sin_tecnico_asignado_devuelve_tecnico_none():
    tarea = _tarea(2, "pendiente")
    db = _db_con_fila(tarea, None, None)

    respuesta = await get_mapa_supervisor(db=db, _current_user=_empleado("supervisor"))

    assert respuesta[0].tecnico is None
