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
from app.services.ubicaciones import obtener_ultimas_ubicaciones

AHORA = datetime(2026, 9, 23, 10, 0)
HOY = AHORA.date()
AYER = HOY - timedelta(days=1)


def _tecnico(id_empleado=7, nombre="Ana", apellido="López"):
    return SimpleNamespace(id_empleado=id_empleado, nombre=nombre, apellido=apellido)


def _jornada(id_asistencia=10, fecha=HOY, hora_entrada=time(8, 0)):
    return SimpleNamespace(id_asistencia=id_asistencia, fecha=fecha, hora_entrada=hora_entrada)


def _db(jornadas=(), ubicaciones=(), pausas=(), con_tarea=()):
    r_jornadas = MagicMock()
    r_jornadas.all.return_value = list(jornadas)
    r_ubicaciones = MagicMock()
    r_ubicaciones.all.return_value = list(ubicaciones)
    r_pausas = MagicMock()
    r_pausas.scalars.return_value.all.return_value = list(pausas)
    r_tareas = MagicMock()
    r_tareas.scalars.return_value.all.return_value = list(con_tarea)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[r_jornadas, r_ubicaciones, r_pausas, r_tareas])
    return db


def _sql(db, indice):
    statement = db.execute.await_args_list[indice].args[0]
    return str(
        statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )


@pytest.mark.asyncio
async def test_devuelve_la_ultima_posicion_de_cada_tecnico_en_jornada():
    db = _db(
        jornadas=[(_jornada(10), _tecnico(7, "Ana", "López")), (_jornada(11), _tecnico(8, "Beto", "Ruiz"))],
        ubicaciones=[
            (7, datetime(2026, 9, 23, 9, 45), 14.63, -90.50),
            (8, datetime(2026, 9, 23, 9, 50), 14.64, -90.51),
        ],
    )

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert [(u.id_empleado, u.nombre, u.lat, u.lng, u.estado) for u in resultado] == [
        (7, "Ana López", 14.63, -90.50, "disponible"),
        (8, "Beto Ruiz", 14.64, -90.51, "disponible"),
    ]
    assert resultado[0].fecha_hora_registro == datetime(2026, 9, 23, 9, 45)


@pytest.mark.asyncio
async def test_estado_en_tarea_si_tiene_una_tarea_en_progreso():
    db = _db(
        jornadas=[(_jornada(10), _tecnico(7))],
        ubicaciones=[(7, datetime(2026, 9, 23, 9, 45), 14.63, -90.50)],
        con_tarea=[7],
    )

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert resultado[0].estado == "en_tarea"


@pytest.mark.asyncio
async def test_la_pausa_abierta_manda_sobre_la_tarea_en_progreso():
    db = _db(
        jornadas=[(_jornada(10), _tecnico(7))],
        ubicaciones=[(7, datetime(2026, 9, 23, 9, 45), 14.63, -90.50)],
        pausas=[10],
        con_tarea=[7],
    )

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert resultado[0].estado == "en_pausa"


@pytest.mark.asyncio
async def test_sin_tecnicos_en_jornada_devuelve_lista_vacia():
    db = _db()

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert resultado == []
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_jornada_abandonada_no_cuenta_como_en_jornada():
    olvidada = _jornada(10, fecha=AYER, hora_entrada=time(8, 0))
    db = _db(
        jornadas=[(olvidada, _tecnico(7))],
        ubicaciones=[(7, datetime(2026, 9, 22, 9, 0), 14.63, -90.50)],
    )

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert resultado == []


@pytest.mark.asyncio
async def test_ignora_ubicaciones_anteriores_a_la_entrada_de_la_jornada():
    db = _db(
        jornadas=[(_jornada(10, hora_entrada=time(8, 0)), _tecnico(7))],
        ubicaciones=[(7, datetime(2026, 9, 22, 17, 0), 14.63, -90.50)],
    )

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert resultado == []


@pytest.mark.asyncio
async def test_tecnico_con_dos_jornadas_abiertas_aparece_una_sola_vez():
    db = _db(
        jornadas=[
            (_jornada(11, hora_entrada=time(9, 0)), _tecnico(7)),
            (_jornada(10, hora_entrada=time(8, 0)), _tecnico(7)),
        ],
        ubicaciones=[(7, datetime(2026, 9, 23, 9, 45), 14.63, -90.50)],
    )

    resultado = await obtener_ultimas_ubicaciones(db, AHORA)

    assert len(resultado) == 1


@pytest.mark.asyncio
async def test_consultas_filtran_por_rol_jornada_abierta_y_ultima_lectura():
    db = _db(
        jornadas=[(_jornada(10), _tecnico(7))],
        ubicaciones=[(7, datetime(2026, 9, 23, 9, 45), 14.63, -90.50)],
    )

    await obtener_ultimas_ubicaciones(db, AHORA)

    jornadas_sql = _sql(db, 0)
    assert "asistencia.hora_salida IS NULL" in jornadas_sql
    assert "empleado.rol = 'tecnico'" in jornadas_sql
    assert "empleado.estado = 'activo'" in jornadas_sql

    ubicaciones_sql = _sql(db, 1)
    assert "DISTINCT ON (ubicacion_empleado.id_empleado)" in ubicaciones_sql
    assert "fecha_hora_registro DESC" in ubicaciones_sql


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


async def _get(aplicacion):
    transport = ASGITransport(app=aplicacion)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/ubicaciones/tecnicos")


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["supervisor", "admin", "gerente"])
async def test_roles_administrativos_pueden_consultar(rol):
    # Aquí no se le pasa `ahora` al servicio (el router usa la hora real), así
    # que la jornada se ancla al día de hoy en vez de a AHORA/HOY (fijos en
    # 2026-09-23): con una fecha fija esta prueba dejaba de pasar apenas
    # cambiaba el día en que se corría.
    hoy = hoy_local()
    db = _db(
        jornadas=[(_jornada(10, fecha=hoy), _tecnico(7))],
        ubicaciones=[(7, datetime.combine(hoy, time(9, 45)), 14.63, -90.50)],
    )
    empleado = SimpleNamespace(id_empleado=1, rol=rol, estado="activo")

    respuesta = await _get(_app(db, empleado))

    assert respuesta.status_code == 200
    assert respuesta.json()[0]["id_empleado"] == 7


@pytest.mark.asyncio
async def test_un_tecnico_no_puede_ver_las_ubicaciones_del_equipo():
    db = _db()
    empleado = SimpleNamespace(id_empleado=7, rol="tecnico", estado="activo")

    respuesta = await _get(_app(db, empleado))

    assert respuesta.status_code == 403
    db.execute.assert_not_called()


def test_sin_token_responde_401(test_client):
    assert test_client.get("/ubicaciones/tecnicos").status_code == 401