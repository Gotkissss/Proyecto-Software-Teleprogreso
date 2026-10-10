# backend/tests/test_tecnicos_disponibles_distancia.py
"""
Pruebas de la distancia por técnico en GET /empleados/tecnicos/disponibles.

El supervisor reasigna eligiendo a quién le queda más cerca el servicio, así
que el endpoint que llena ese selector publica los metros que separan a cada
técnico de la tarea. El cálculo es de PostGIS (`ST_Distance` sobre columnas
`geography`), de modo que lo que se puede comprobar sin base de datos es:

  - que la consulta pida la distancia desde la última posición de cada técnico,
  - que descarte las posiciones viejas,
  - y que la respuesta distinga "está a X metros" de "no hay ubicación
    reciente", que es lo que la pantalla necesita para no inventarse un dato.

La consulta vive en services/ubicaciones.py, con el resto de lo que lee esa
tabla; aquí se prueba a través del endpoint, que es como se usa.

La sesión está mockeada igual que en test_tareas_mapa_supervisor.py: se revisa
el SQL generado y la forma de la respuesta.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.core.exceptions import APIException
from app.core.reglas import HORAS_UBICACION_RECIENTE
from app.routers.metricas import get_tecnicos_disponibles
from app.core.reglas import HORAS_UBICACION_RECIENTE
from app.core.tiempo import ahora


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _resultado(*, scalars=None, filas=None, primera=...):
    """Resultado de `db.execute` con las respuestas que pida cada consulta."""
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = scalars or []
    resultado.all.return_value = filas or []
    resultado.first.return_value = None if primera is ... else primera
    return resultado


def _tecnico(id_empleado, nombre="Juan", apellido="Pérez"):
    return SimpleNamespace(
        id_empleado=id_empleado,
        nombre=nombre,
        apellido=apellido,
        correo=f"tecnico{id_empleado}@teleprogreso.com",
        telefono="5550-0000",
    )


def _ubicacion(id_empleado, metros, cuando=None):
    return SimpleNamespace(
        id_empleado=id_empleado,
        fecha_hora_registro=cuando or datetime(2026, 9, 29, 8, 40),
        metros=metros,
    )


def _db(tecnicos, *, tarea=..., ubicaciones=None, conteos=None):
    """
    Sesión simulada que responde a las consultas del endpoint en orden:
    técnicos → conteo de tareas → jornadas de hoy → tarea → ubicaciones.
    """
    respuestas = [
        _resultado(scalars=tecnicos),
        _resultado(filas=conteos or []),
        _resultado(filas=[]),
    ]
    if tarea is not ...:
        respuestas.append(_resultado(primera=tarea))
        respuestas.append(_resultado(filas=ubicaciones or []))

    db = MagicMock()
    db.execute = AsyncMock(side_effect=respuestas)
    return db


def _sql_de(db, indice):
    """SQL de la consulta número `indice`, compilado para PostgreSQL."""
    statement = db.execute.await_args_list[indice].args[0]
    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def _supervisor():
    return SimpleNamespace(rol="supervisor", id_empleado=2)


TAREA_CON_COORDENADA = SimpleNamespace(id_tarea=7, coordenada_servicio="POINT")
TAREA_SIN_COORDENADA = SimpleNamespace(id_tarea=7, coordenada_servicio=None)


# ─── Sin id_tarea: el endpoint se comporta como antes ────────────────────────

@pytest.mark.asyncio
async def test_sin_id_tarea_no_consulta_ubicaciones():
    db = _db([_tecnico(3)])

    respuesta = await get_tecnicos_disponibles(db=db, _current_user=_supervisor())

    # Técnicos, conteo de tareas y jornadas: ninguna consulta más.
    assert db.execute.await_count == 3
    assert respuesta[0]["distancia_m"] is None
    assert respuesta[0]["ubicacion_registrada_en"] is None


@pytest.mark.asyncio
async def test_sin_id_tarea_sigue_publicando_la_carga():
    """La distancia se suma a lo que ya había; no lo reemplaza."""
    db = _db(
        [_tecnico(3)],
        conteos=[SimpleNamespace(id_empleado=3, total=2)],
    )

    respuesta = await get_tecnicos_disponibles(db=db, _current_user=_supervisor())

    assert respuesta[0]["tareas_activas"] == 2
    assert respuesta[0]["disponible"] is True
    assert respuesta[0]["nombre_completo"] == "Juan Pérez"


# ─── Con id_tarea: la consulta de distancia ──────────────────────────────────

@pytest.mark.asyncio
async def test_la_distancia_la_calcula_postgis_contra_la_tarea():
    db = _db([_tecnico(3)], tarea=TAREA_CON_COORDENADA)

    await get_tecnicos_disponibles(db=db, _current_user=_supervisor(), id_tarea=7)

    sql = _sql_de(db, 4)

    assert "ST_Distance" in sql
    assert "ubicacion_empleado.coordenada" in sql
    # El punto de referencia sale de la tarea pedida, no de un valor fijo.
    assert "tarea.coordenada_servicio" in sql
    assert "tarea.id_tarea = 7" in sql


@pytest.mark.asyncio
async def test_solo_cuenta_la_ultima_posicion_de_cada_tecnico():
    """
    Un técnico reporta varias posiciones al día. Sin el DISTINCT ON saldría una
    fila por cada una y la pantalla mostraría la primera que llegara, que puede
    ser la de hace horas.
    """
    db = _db([_tecnico(3)], tarea=TAREA_CON_COORDENADA)

    await get_tecnicos_disponibles(db=db, _current_user=_supervisor(), id_tarea=7)

    sql = _sql_de(db, 4)

    assert "DISTINCT ON (ubicacion_empleado.id_empleado)" in sql
    assert "fecha_hora_registro DESC" in sql
    # Desempate por id, igual que en obtener_ultimas_ubicaciones: dos puntos
    # con la misma marca de tiempo si no dejarían el resultado al azar.
    assert "id_ubicacion DESC" in sql


@pytest.mark.asyncio
async def test_descarta_las_posiciones_viejas():
    db = _db([_tecnico(3)], tarea=TAREA_CON_COORDENADA)

    await get_tecnicos_disponibles(db=db, _current_user=_supervisor(), id_tarea=7)

    sql = _sql_de(db, 4)
    assert "fecha_hora_registro >=" in sql

    # El corte es la ventana de frescura de reglas.py, no un valor suelto.
    marca = sql.split("fecha_hora_registro >= ")[1].strip()[1:20]
    corte = datetime.fromisoformat(marca)
    # El router calcula el corte con la hora local de la operación (core/tiempo),
    # no con la del contenedor: comparar contra datetime.now() falla en CI (UTC)
    # por el desfase de 6 h de Guatemala.
    horas = (ahora() - corte).total_seconds() / 3600
    assert HORAS_UBICACION_RECIENTE - 1 < horas < HORAS_UBICACION_RECIENTE + 1


@pytest.mark.asyncio
async def test_solo_mide_a_los_tecnicos_de_la_lista():
    db = _db([_tecnico(3), _tecnico(4, "María", "López")], tarea=TAREA_CON_COORDENADA)

    await get_tecnicos_disponibles(db=db, _current_user=_supervisor(), id_tarea=7)

    assert "id_empleado IN (3, 4)" in _sql_de(db, 4)


# ─── Forma de la respuesta ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_devuelve_los_metros_y_de_cuando_es_la_posicion():
    momento = datetime(2026, 9, 29, 8, 40)
    db = _db(
        [_tecnico(3)],
        tarea=TAREA_CON_COORDENADA,
        ubicaciones=[_ubicacion(3, 1420.4567, momento)],
    )

    respuesta = await get_tecnicos_disponibles(
        db=db, _current_user=_supervisor(), id_tarea=7
    )

    assert respuesta[0]["distancia_m"] == 1420.5
    assert respuesta[0]["ubicacion_registrada_en"] == momento


@pytest.mark.asyncio
async def test_tecnico_sin_posicion_reciente_viaja_con_distancia_nula():
    """
    "Sin ubicación reciente" y "a 0 m" no son lo mismo: el null es lo que deja
    a la pantalla decirlo en lugar de colocar a ese técnico el primero de la
    lista al ordenar por cercanía.
    """
    db = _db(
        [_tecnico(3), _tecnico(4, "María", "López")],
        tarea=TAREA_CON_COORDENADA,
        ubicaciones=[_ubicacion(3, 800.0)],
    )

    respuesta = await get_tecnicos_disponibles(
        db=db, _current_user=_supervisor(), id_tarea=7
    )

    por_id = {tec["id_empleado"]: tec for tec in respuesta}
    assert por_id[3]["distancia_m"] == 800.0
    assert por_id[4]["distancia_m"] is None
    assert por_id[4]["ubicacion_registrada_en"] is None


@pytest.mark.asyncio
async def test_tarea_sin_coordenada_no_consulta_ubicaciones():
    """
    La ubicación exacta es opcional al crear la tarea; sin ella no hay
    distancia que calcular y no tiene sentido ir a la tabla de posiciones.
    """
    db = _db([_tecnico(3)], tarea=TAREA_SIN_COORDENADA)

    respuesta = await get_tecnicos_disponibles(
        db=db, _current_user=_supervisor(), id_tarea=7
    )

    assert db.execute.await_count == 4
    assert respuesta[0]["distancia_m"] is None


@pytest.mark.asyncio
async def test_tarea_inexistente_responde_404():
    db = _db([_tecnico(3)], tarea=None)

    with pytest.raises(APIException) as error:
        await get_tecnicos_disponibles(
            db=db, _current_user=_supervisor(), id_tarea=999
        )

    assert error.value.status_code == 404
