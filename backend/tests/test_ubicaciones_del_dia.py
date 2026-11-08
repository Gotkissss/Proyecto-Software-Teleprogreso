"""
Mapa del panel: ubicaciones de HOY (alcance=dia).
-----------------------------------------------------------------------------
El mapa del supervisor cruza posiciones con tareas abiertas, así que le sirve
"quién está en jornada ahora". El mapa del panel es otra cosa: una foto de
dónde anduvo el equipo hoy, a la mano, sin filtros.

Lo que se fija aquí:

  - El alcance `dia` suma a los que ya marcaron salida, en su último punto del
    día y con estado `fuera_de_jornada`.
  - Un técnico en jornada NO se duplica: su estado en vivo manda.
  - Quien no reportó hoy no aparece. Pintar su posición de ayer diría que está
    ahí, y mandar a alguien a ese punto es el error que esto evita.
  - El alcance por omisión sigue siendo el de antes, para que el mapa del
    supervisor no cambie de comportamiento.
  - Un técnico sigue sin poder consultarlo.

Se ejecutan con: pytest tests/test_ubicaciones_del_dia.py -v
"""

from datetime import datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects import postgresql

from app.core.deps import get_current_empleado
from app.core.exceptions import register_exception_handlers
from app.core.tiempo import hoy as hoy_local
from app.db.session import get_db
from app.routers import ubicaciones
from app.services.ubicaciones import obtener_ubicaciones_de_hoy

AHORA = datetime(2026, 9, 23, 16, 0)
HOY = AHORA.date()


def _tecnico(id_empleado=7, nombre="Ana", apellido="López"):
    return SimpleNamespace(id_empleado=id_empleado, nombre=nombre, apellido=apellido)


def _jornada(id_asistencia=10, fecha=HOY, hora_entrada=time(8, 0)):
    return SimpleNamespace(
        id_asistencia=id_asistencia, fecha=fecha, hora_entrada=hora_entrada
    )


def _resultado_filas(filas):
    r = MagicMock()
    r.all.return_value = list(filas)
    return r


def _resultado_escalares(valores):
    r = MagicMock()
    r.scalars.return_value.all.return_value = list(valores)
    return r


def _db(jornadas=(), en_jornada=(), pausas=(), con_tarea=(), del_dia=()):
    """
    Base de datos falsa con las consultas que hace la función, en orden:
    jornadas abiertas, últimas posiciones de esas jornadas, pausas abiertas,
    tareas en progreso y —la nueva— el último punto de hoy de cada técnico.

    La parte en vivo corta antes si no hay a quién mirar: sin jornadas abiertas
    no pregunta por posiciones, y sin posiciones no pregunta por pausas ni
    tareas. La lista de respuestas se arma con esos cortes, porque si no la
    consulta del día recibiría el resultado de otra.
    """
    respuestas = [_resultado_filas(jornadas)]
    if jornadas:
        respuestas.append(_resultado_filas(en_jornada))
        if en_jornada:
            respuestas.append(_resultado_escalares(pausas))
            respuestas.append(_resultado_escalares(con_tarea))
    respuestas.append(_resultado_filas(del_dia))

    db = MagicMock()
    db.execute = AsyncMock(side_effect=respuestas)
    return db


def _sql(db, indice):
    statement = db.execute.await_args_list[indice].args[0]
    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


# ─── El servicio ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_suma_a_los_que_ya_cerraron_su_jornada():
    """
    Ana sigue en la calle; Beto entregó y marcó salida al mediodía. Los dos
    salen en el mapa, pero no con el mismo estado.
    """
    db = _db(
        jornadas=[(_jornada(10), _tecnico(7, "Ana", "López"))],
        en_jornada=[(7, datetime(2026, 9, 23, 15, 45), 14.63, -90.50)],
        del_dia=[
            (7, datetime(2026, 9, 23, 15, 45), 14.63, -90.50, "Ana", "López"),
            (8, datetime(2026, 9, 23, 12, 10), 14.70, -90.44, "Beto", "Ruiz"),
        ],
    )

    resultado = await obtener_ubicaciones_de_hoy(db, AHORA)

    assert [(u.id_empleado, u.nombre, u.estado) for u in resultado] == [
        (7, "Ana López", "disponible"),
        (8, "Beto Ruiz", "fuera_de_jornada"),
    ]
    assert resultado[1].lat == 14.70
    assert resultado[1].fecha_hora_registro == datetime(2026, 9, 23, 12, 10)


@pytest.mark.asyncio
async def test_el_tecnico_en_jornada_no_se_duplica():
    """
    La consulta del día también devuelve a quien está en jornada. Si se
    añadiera otra vez, el mapa pintaría dos marcadores sobre el mismo técnico
    y uno de ellos diría que ya terminó.
    """
    db = _db(
        jornadas=[(_jornada(10), _tecnico(7))],
        en_jornada=[(7, datetime(2026, 9, 23, 15, 45), 14.63, -90.50)],
        con_tarea=[7],
        del_dia=[(7, datetime(2026, 9, 23, 15, 45), 14.63, -90.50, "Ana", "López")],
    )

    resultado = await obtener_ubicaciones_de_hoy(db, AHORA)

    assert len(resultado) == 1
    assert resultado[0].estado == "en_tarea"


@pytest.mark.asyncio
async def test_quien_no_reporto_hoy_no_aparece():
    """
    Sin punto de hoy no hay marcador. El corte por el inicio del día es lo que
    impide que salga su última posición de ayer.
    """
    db = _db(del_dia=[])

    resultado = await obtener_ubicaciones_de_hoy(db, AHORA)

    assert resultado == []

    # Sin nadie en jornada la función corta antes, así que la consulta del día
    # es la segunda que se ejecuta.
    sql = _sql(db, 1)
    assert "2026-09-23 00:00:00" in sql
    assert "empleado.rol = 'tecnico'" in sql
    assert "empleado.estado = 'activo'" in sql
    assert "DISTINCT ON (ubicacion_empleado.id_empleado)" in sql
    assert "fecha_hora_registro DESC" in sql


@pytest.mark.asyncio
async def test_un_tecnico_inactivo_no_aparece_aunque_tenga_puntos():
    """
    El filtro va en el SQL, no aquí: a quien está de baja no se lo pinta en el
    mapa ni se lo cuenta en el panel.
    """
    db = _db(del_dia=[])

    await obtener_ubicaciones_de_hoy(db, AHORA)

    assert "empleado.estado = 'activo'" in _sql(db, 1)


@pytest.mark.asyncio
async def test_van_ordenados_por_nombre():
    db = _db(
        del_dia=[
            (9, datetime(2026, 9, 23, 11, 0), 14.6, -90.5, "Zoila", "Mejía"),
            (8, datetime(2026, 9, 23, 12, 0), 14.7, -90.4, "Beto", "Ruiz"),
        ]
    )

    resultado = await obtener_ubicaciones_de_hoy(db, AHORA)

    assert [u.nombre for u in resultado] == ["Beto Ruiz", "Zoila Mejía"]


# ─── El endpoint ─────────────────────────────────────────────────────────────

def _app(db, empleado):
    aplicacion = FastAPI()
    aplicacion.include_router(ubicaciones.router)
    register_exception_handlers(aplicacion)

    async def _get_db():
        yield db

    async def _usuario():
        return empleado

    aplicacion.dependency_overrides[get_db] = _get_db
    aplicacion.dependency_overrides[get_current_empleado] = _usuario
    return aplicacion


async def _get(aplicacion, params=None):
    transport = ASGITransport(app=aplicacion)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/ubicaciones/tecnicos", params=params or {})


def _db_de_hoy(del_dia):
    """Como `_db`, pero con las fechas ancladas al día real: el router usa la
    hora del reloj y no la de AHORA."""
    return _db(del_dia=del_dia)


@pytest.mark.asyncio
async def test_el_endpoint_con_alcance_dia_devuelve_a_los_que_ya_salieron():
    hoy = hoy_local()
    db = _db_de_hoy(
        [(8, datetime.combine(hoy, time(12, 10)), 14.70, -90.44, "Beto", "Ruiz")]
    )
    empleado = SimpleNamespace(id_empleado=1, rol="supervisor", estado="activo")

    respuesta = await _get(_app(db, empleado), {"alcance": "dia"})

    assert respuesta.status_code == 200
    assert respuesta.json() == [
        {
            "id_empleado": 8,
            "nombre": "Beto Ruiz",
            "lat": 14.70,
            "lng": -90.44,
            "fecha_hora_registro": datetime.combine(hoy, time(12, 10)).isoformat(),
            "estado": "fuera_de_jornada",
        }
    ]


@pytest.mark.asyncio
async def test_el_alcance_por_omision_sigue_siendo_el_de_la_jornada():
    """
    El mapa del supervisor llama a esta ruta sin parámetros. Si el día pasara a
    ser el valor por omisión, le aparecerían marcadores de gente que ya se fue
    mezclados con las tareas abiertas del momento.
    """
    db = _db(jornadas=[])
    empleado = SimpleNamespace(id_empleado=1, rol="supervisor", estado="activo")

    respuesta = await _get(_app(db, empleado))

    assert respuesta.status_code == 200
    assert respuesta.json() == []
    # Una sola consulta: la de las jornadas abiertas. La del día no se hizo.
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_un_alcance_inventado_se_rechaza():
    db = _db()
    empleado = SimpleNamespace(id_empleado=1, rol="supervisor", estado="activo")

    respuesta = await _get(_app(db, empleado), {"alcance": "semana"})

    assert respuesta.status_code == 422
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_un_tecnico_tampoco_ve_el_mapa_del_dia():
    db = _db()
    empleado = SimpleNamespace(id_empleado=7, rol="tecnico", estado="activo")

    respuesta = await _get(_app(db, empleado), {"alcance": "dia"})

    assert respuesta.status_code == 403
    db.execute.assert_not_called()
