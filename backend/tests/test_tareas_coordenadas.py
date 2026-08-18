# backend/tests/test_tareas_coordenadas.py
"""
Pruebas de la serialización de coordenadas en GET /tareas — SCRUM-159/184.

`coordenada_servicio` se guarda como un punto PostGIS (Geography). El
frontend no sabe leer WKB, así que el router lo descompone en dos números
antes de responder. Esa traducción es la que se fija aquí, porque falla en
silencio: si se cruzan lat y lng la respuesta sigue siendo válida y los
marcadores aparecen en el otro hemisferio.

La sesión está mockeada, así que las coordenadas se comprueban sobre la
respuesta y la forma de la consulta sobre el SQL generado.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.routers.tareas import get_tareas


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _tarea(id_tarea=1, **extra):
    """Fila de `tarea` con lo mínimo que TareaResponse necesita."""
    base = dict(
        id_tarea=id_tarea,
        titulo="Instalación fibra óptica",
        descripcion=None,
        direccion_servicio="Barrio El Centro, Fraijanes",
        estado_tarea="pendiente",
        prioridad="alta",
        fecha_inicio=date(2026, 8, 16),
        fecha_finalizacion=None,
        fecha_asignacion=None,
        fecha_completado=None,
        empleados=[],
    )
    base.update(extra)
    return SimpleNamespace(**base)


def _db_con_tareas(filas, incidencias=None):
    """
    AsyncSession simulada.

    `get_tareas` consulta dos veces cuando hay filas: primero las tareas y
    después el conteo de evidencias agrupado (para no hacer un COUNT por
    tarea). El mock devuelve una respuesta distinta en cada llamada.
    """
    resultado_tareas = MagicMock()
    resultado_tareas.all.return_value = filas

    resultado_incidencias = MagicMock()
    resultado_incidencias.all.return_value = incidencias or []

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[resultado_tareas, resultado_incidencias])
    return db


def _sql_de(db, indice=0):
    """SQL compilado de la consulta número `indice`."""
    statement = db.execute.await_args_list[indice].args[0]
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


def _supervisor(id_empleado=2):
    return SimpleNamespace(rol="supervisor", id_empleado=id_empleado)


# ─── Forma de la consulta ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_convierte_geography_a_geometry_antes_de_extraer():
    # ST_X/ST_Y no operan sobre Geography; sin el cast la consulta revienta.
    db = _db_con_tareas([])

    await get_tareas(db=db, current_user=_supervisor())

    assert "CAST(tarea.coordenada_servicio AS geometry" in _sql_de(db)


@pytest.mark.asyncio
async def test_lat_sale_de_ST_Y_y_lng_de_ST_X():
    """
    Con SRID 4326, ST_Y es latitud y ST_X es longitud.

    Se comparan posiciones en vez de usar regex: el CAST lleva comas y
    paréntesis dentro, y cualquier comodín termina cruzando de una columna a
    la otra dando un falso verde.
    """
    db = _db_con_tareas([])

    await get_tareas(db=db, current_user=_supervisor())

    sql = _sql_de(db)
    posicion_st_y = sql.index("ST_Y(")
    posicion_st_x = sql.index("ST_X(")
    posicion_lat = sql.index(" AS lat")
    posicion_lng = sql.index(" AS lng")

    assert posicion_st_y < posicion_lat < posicion_st_x < posicion_lng, (
        f"lat y lng están cruzadas en el SELECT: {sql}"
    )


# ─── Contenido de la respuesta ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_respuesta_lleva_las_coordenadas_ya_desglosadas():
    db = _db_con_tareas([(_tarea(), 14.4728, -90.4408)])

    tareas = await get_tareas(db=db, current_user=_supervisor())

    assert len(tareas) == 1
    assert tareas[0].lat == 14.4728
    assert tareas[0].lng == -90.4408


@pytest.mark.asyncio
async def test_las_coordenadas_caen_donde_corresponde_en_guatemala():
    """
    Guarda contra el cruce, ya no en el SQL sino en la respuesta.

    Fraijanes está en latitud ~14 N y longitud ~-90 O. Si lat y lng se
    intercambiaran, la tarea saldría con lat -90, que ni siquiera es una
    latitud válida.
    """
    db = _db_con_tareas([(_tarea(), 14.4728, -90.4408)])

    tarea = (await get_tareas(db=db, current_user=_supervisor()))[0]

    assert -90 <= tarea.lat <= 90
    assert -180 <= tarea.lng <= 180
    assert tarea.lat > 0, "Guatemala está en el hemisferio norte"
    assert tarea.lng < 0, "Guatemala está al oeste del meridiano de Greenwich"


@pytest.mark.asyncio
async def test_una_tarea_sin_ubicacion_responde_con_lat_y_lng_nulas():
    # La coordenada es opcional: las tareas anteriores a SCRUM-169 solo
    # tienen la dirección escrita. Deben viajar igual, con lat/lng en null.
    db = _db_con_tareas([(_tarea(id_tarea=9), None, None)])

    tarea = (await get_tareas(db=db, current_user=_supervisor()))[0]

    assert tarea.id_tarea == 9
    assert tarea.lat is None
    assert tarea.lng is None
    # El resto de la tarea sigue completo: sin ubicación no es sin datos.
    assert tarea.direccion_servicio == "Barrio El Centro, Fraijanes"


@pytest.mark.asyncio
async def test_convive_una_tarea_con_ubicacion_y_otra_sin_ella():
    db = _db_con_tareas([
        (_tarea(id_tarea=1), 14.4728, -90.4408),
        (_tarea(id_tarea=2), None, None),
    ])

    tareas = await get_tareas(db=db, current_user=_supervisor())

    assert [t.id_tarea for t in tareas] == [1, 2]
    assert tareas[0].lat == 14.4728
    assert tareas[1].lat is None
