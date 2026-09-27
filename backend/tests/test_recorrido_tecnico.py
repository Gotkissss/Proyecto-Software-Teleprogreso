# backend/tests/test_recorrido_tecnico.py
"""
Pruebas de HU-5: recorrido del día de un técnico.

  1. GET /ubicaciones/{id}/recorrido devuelve los puntos del día en orden,
     intercala la entrada y la salida de la jornada (HU-4), trae el título de
     las tareas y marca los huecos sin datos. Sin datos devuelve una lista
     vacía, y solo admin, supervisor y gerente pueden consultarlo.
  2. POST /ubicaciones/lote guarda los puntos tomados sin conexión con su hora
     real, y descarta los futuros, los fuera de jornada y los repetidos.
  3. El técnico no puede iniciar ni finalizar tareas, ni registrar evidencia,
     sin la jornada abierta (409); con ella, el lugar del inicio y del fin de
     la tarea queda en su recorrido.
"""

import struct
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from geoalchemy2.elements import WKBElement
from httpx import ASGITransport, AsyncClient

import app.services.ubicaciones as ubicaciones_service
from app.core.deps import get_current_empleado
from app.core.exceptions import register_exception_handlers
from app.core.reglas import (
    EVENTO_FIN_TAREA,
    EVENTO_INICIO_TAREA,
    MAX_PUNTOS_LOTE,
    MINUTOS_HUECO_RECORRIDO,
)
from app.db.session import get_db
from app.models.empleado import EmpleadoTarea
from app.models.tarea import Tarea
from app.models.ubicacion import UbicacionEmpleado
from app.routers import ubicaciones
from app.routers.incidencias import crear_incidencia
from app.routers.tareas import finalizar_tarea, iniciar_tarea
from app.schemas.incidencia import IncidenciaCreate
from app.schemas.ubicacion import PuntoLote, UbicacionCreate

HOY = date(2026, 9, 23)
AHORA = datetime.combine(HOY, time(12, 0))
LUGAR = UbicacionCreate(lat=14.4653, lng=-90.4408)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _tecnico(id_empleado=2, rol="tecnico"):
    return SimpleNamespace(
        id_empleado=id_empleado, rol=rol, nombre="Juan", apellido="Pérez", estado="activo"
    )


def _filas(filas):
    """Resultado cuyo `.all()` devuelve tuplas (consultas por columnas)."""
    resultado = MagicMock()
    resultado.all.return_value = filas
    return resultado


def _escalares(valores):
    """Resultado cuyo `.scalars().all()` devuelve objetos o valores sueltos."""
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = valores
    return resultado


def _db(*resultados, empleado=None):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(resultados))
    db.get = AsyncMock(return_value=empleado)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _wkb(lat, lng):
    return WKBElement(bytes([1]) + struct.pack("<I", 1) + struct.pack("<dd", lng, lat), srid=4326)


def _jornada(entrada, salida=None, fecha=HOY, coordenada_entrada=None, coordenada_salida=None):
    return SimpleNamespace(
        id_asistencia=5,
        id_empleado=2,
        fecha=fecha,
        hora_entrada=entrada,
        hora_salida=salida,
        coordenada_entrada=coordenada_entrada,
        coordenada_salida=coordenada_salida,
    )


def _a_las(hora, minuto=0):
    return datetime.combine(HOY, time(hora, minuto))


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    monkeypatch.setattr(ubicaciones_service, "ahora_local", lambda: AHORA)


# ─── GET /ubicaciones/{id}/recorrido ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_recorrido_sale_en_orden_con_entrada_salida_y_tareas():
    puntos = _filas([
        (_a_las(8, 5), 14.470, -90.440, "periodico", None, None),
        (_a_las(8, 20), 14.471, -90.441, "inicio_tarea", 7, "Instalación fibra"),
        (_a_las(9, 0), 14.472, -90.442, "fin_tarea", 7, "Instalación fibra"),
    ])
    jornadas = _escalares([
        _jornada(
            time(8, 0),
            time(17, 0),
            coordenada_entrada=_wkb(14.469, -90.439),
            coordenada_salida=_wkb(14.480, -90.450),
        )
    ])
    db = _db(puntos, jornadas, empleado=_tecnico())

    recorrido = await ubicaciones_service.obtener_recorrido(db, 2, HOY)

    assert recorrido.nombre == "Juan Pérez"
    assert [p.evento for p in recorrido.puntos] == [
        "entrada", "periodico", "inicio_tarea", "fin_tarea", "salida",
    ]
    assert recorrido.puntos[0].fecha_hora == _a_las(8, 0)
    assert (recorrido.puntos[0].lat, recorrido.puntos[0].lng) == (14.469, -90.439)
    assert recorrido.puntos[2].titulo_tarea == "Instalación fibra"
    assert recorrido.puntos[2].id_tarea == 7
    assert recorrido.puntos[-1].fecha_hora == _a_las(17, 0)


@pytest.mark.asyncio
async def test_marca_como_hueco_solo_lo_que_supera_el_umbral():
    limite = MINUTOS_HUECO_RECORRIDO
    puntos = _filas([
        (_a_las(8, 0), 14.47, -90.44, "periodico", None, None),
        (_a_las(8, 5), 14.47, -90.44, "periodico", None, None),               # 5 min
        (_a_las(8, 5 + limite), 14.47, -90.44, "periodico", None, None),       # justo el límite
        (_a_las(10, 0), 14.47, -90.44, "periodico", None, None),              # app cerrada
    ])
    db = _db(puntos, _escalares([]), empleado=_tecnico())

    recorrido = await ubicaciones_service.obtener_recorrido(db, 2, HOY)

    assert [p.tras_hueco for p in recorrido.puntos] == [False, False, False, True]
    assert recorrido.minutos_hueco == limite


@pytest.mark.asyncio
async def test_la_salida_de_un_turno_nocturno_cae_al_dia_siguiente():
    jornadas = _escalares([
        _jornada(time(22, 0), time(6, 0), coordenada_salida=_wkb(14.48, -90.45))
    ])
    db = _db(_filas([]), jornadas, empleado=_tecnico())

    recorrido = await ubicaciones_service.obtener_recorrido(db, 2, HOY)

    assert recorrido.puntos[0].evento == "salida"
    assert recorrido.puntos[0].fecha_hora == datetime.combine(HOY + timedelta(days=1), time(6, 0))


@pytest.mark.asyncio
async def test_un_dia_sin_datos_devuelve_la_lista_vacia():
    db = _db(_filas([]), _escalares([_jornada(time(8, 0))]), empleado=_tecnico())

    recorrido = await ubicaciones_service.obtener_recorrido(db, 2, HOY)

    assert recorrido.puntos == []


@pytest.mark.asyncio
async def test_empleado_inexistente_responde_404():
    db = _db(empleado=None)

    with pytest.raises(HTTPException) as error:
        await ubicaciones_service.obtener_recorrido(db, 99, HOY)

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_la_consulta_filtra_por_empleado_y_dia():
    db = _db(_filas([]), _escalares([]), empleado=_tecnico())

    await ubicaciones_service.obtener_recorrido(db, 2, HOY)

    sql = str(
        db.execute.await_args_list[0].args[0].compile(compile_kwargs={"literal_binds": True})
    )
    assert "ubicacion_empleado.id_empleado = 2" in sql
    assert f"fecha_hora_registro >= '{HOY}" in sql
    assert f"fecha_hora_registro < '{HOY + timedelta(days=1)}" in sql


async def _get_recorrido(usuario, db):
    app = FastAPI()
    app.include_router(ubicaciones.router)
    register_exception_handlers(app)

    async def db_simulada():
        yield db

    async def usuario_actual():
        return usuario

    app.dependency_overrides[get_db] = db_simulada
    app.dependency_overrides[get_current_empleado] = usuario_actual

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(f"/ubicaciones/2/recorrido?fecha={HOY}")


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["admin", "supervisor", "gerente"])
async def test_admin_supervisor_y_gerente_pueden_ver_el_recorrido(rol):
    db = _db(_filas([]), _escalares([]), empleado=_tecnico())

    respuesta = await _get_recorrido(_tecnico(id_empleado=9, rol=rol), db)

    assert respuesta.status_code == 200
    assert respuesta.json()["puntos"] == []


@pytest.mark.asyncio
async def test_un_tecnico_no_puede_ver_recorridos():
    """El rastro de una persona es dato sensible: ni siquiera el suyo propio."""
    db = _db(empleado=_tecnico())

    respuesta = await _get_recorrido(_tecnico(), db)

    assert respuesta.status_code == 403
    db.execute.assert_not_awaited()


# ─── POST /ubicaciones/lote ──────────────────────────────────────────────────

def _punto(momento, lat=14.47, lng=-90.44):
    return PuntoLote(lat=lat, lng=lng, fecha_hora=momento)


@pytest.mark.asyncio
async def test_el_lote_guarda_los_puntos_con_su_hora_real():
    jornadas = _escalares([_jornada(time(8, 0))])  # abierta desde las 8
    db = _db(jornadas, _escalares([]))

    guardados, descartados = await ubicaciones_service.registrar_lote(
        db, _tecnico(), [_punto(_a_las(9, 0)), _punto(_a_las(9, 2))]
    )

    assert (guardados, descartados) == (2, 0)
    guardado = db.add.call_args_list[0].args[0]
    assert isinstance(guardado, UbicacionEmpleado)
    assert guardado.fecha_hora_registro == _a_las(9, 0)
    assert guardado.coordenada == "SRID=4326;POINT(-90.44 14.47)"
    assert guardado.evento == "periodico"


@pytest.mark.asyncio
async def test_convierte_la_hora_del_telefono_a_hora_de_guatemala():
    db = _db(_escalares([_jornada(time(8, 0))]), _escalares([]))
    # 15:00 UTC son las 09:00 en Guatemala (UTC-6).
    en_utc = datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc)

    await ubicaciones_service.registrar_lote(db, _tecnico(), [_punto(en_utc)])

    assert db.add.call_args.args[0].fecha_hora_registro == _a_las(9, 0)


@pytest.mark.asyncio
async def test_descarta_puntos_futuros_y_fuera_de_jornada():
    jornadas = _escalares([_jornada(time(8, 0), time(11, 0))])
    db = _db(jornadas, _escalares([]))

    guardados, descartados = await ubicaciones_service.registrar_lote(
        db,
        _tecnico(),
        [
            _punto(_a_las(7, 30)),   # antes de la entrada
            _punto(_a_las(10, 0)),   # dentro de la jornada
            _punto(_a_las(11, 30)),  # después de la salida
            _punto(_a_las(15, 0)),   # en el futuro
        ],
    )

    assert (guardados, descartados) == (1, 3)
    assert db.add.call_args.args[0].fecha_hora_registro == _a_las(10, 0)


@pytest.mark.asyncio
async def test_no_duplica_puntos_ya_guardados_ni_repetidos_en_el_lote():
    """Si la respuesta de un envío se pierde, el teléfono reintenta el lote."""
    db = _db(_escalares([_jornada(time(8, 0))]), _escalares([_a_las(9, 0)]))

    guardados, descartados = await ubicaciones_service.registrar_lote(
        db,
        _tecnico(),
        [_punto(_a_las(9, 0)), _punto(_a_las(9, 5)), _punto(_a_las(9, 5))],
    )

    assert (guardados, descartados) == (1, 2)


@pytest.mark.asyncio
async def test_sin_jornada_no_guarda_nada():
    db = _db(_escalares([]))

    guardados, descartados = await ubicaciones_service.registrar_lote(
        db, _tecnico(), [_punto(_a_las(9, 0))]
    )

    assert (guardados, descartados) == (0, 1)
    db.add.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("cantidad", [0, MAX_PUNTOS_LOTE + 1])
async def test_el_lote_vacio_o_demasiado_grande_responde_422(cantidad):
    app = FastAPI()
    app.include_router(ubicaciones.router)

    async def db_simulada():
        yield _db()

    async def usuario_actual():
        return _tecnico()

    app.dependency_overrides[get_db] = db_simulada
    app.dependency_overrides[get_current_empleado] = usuario_actual
    cuerpo = {
        "puntos": [
            {"lat": 14.47, "lng": -90.44, "fecha_hora": "2026-09-23T15:00:00Z"}
        ] * cantidad
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        respuesta = await client.post("/ubicaciones/lote", json=cuerpo)

    assert respuesta.status_code == 422


# ─── Tareas: jornada obligatoria y puntos de inicio/fin ──────────────────────

def _res_tarea(valor):
    res = MagicMock()
    res.scalar_one_or_none.return_value = valor
    res.scalar.return_value = valor
    return res


def _sin_resultado():
    res = MagicMock()
    res.first.return_value = None
    return res


def _tarea(estado="pendiente"):
    return Tarea(
        id_tarea=1,
        titulo="Instalación fibra óptica",
        estado_tarea=estado,
        prioridad="alta",
        fecha_inicio=HOY if estado != "pendiente" else None,
    )


def _con_jornada(monkeypatch, jornada):
    monkeypatch.setattr(
        ubicaciones_service, "jornada_en_curso", AsyncMock(return_value=jornada)
    )


@pytest.mark.asyncio
async def test_el_tecnico_no_puede_iniciar_tareas_sin_jornada(monkeypatch):
    _con_jornada(monkeypatch, None)
    tarea = _tarea()
    db = _db(_res_tarea(tarea), _res_tarea(EmpleadoTarea(id_empleado=2, id_tarea=1)))

    with pytest.raises(HTTPException) as error:
        await iniciar_tarea(1, db, _tecnico(), LUGAR)

    assert error.value.status_code == 409
    assert "entrada" in error.value.detail
    assert tarea.estado_tarea == "pendiente"


@pytest.mark.asyncio
async def test_al_iniciar_guarda_el_lugar_en_el_recorrido(monkeypatch):
    _con_jornada(monkeypatch, _jornada(time(8, 0)))
    db = _db(_res_tarea(_tarea()), _res_tarea(EmpleadoTarea(id_empleado=2, id_tarea=1)))

    await iniciar_tarea(1, db, _tecnico(), LUGAR)

    punto = db.add.call_args.args[0]
    assert isinstance(punto, UbicacionEmpleado)
    assert punto.evento == EVENTO_INICIO_TAREA
    assert punto.id_tarea == 1
    assert punto.coordenada == "SRID=4326;POINT(-90.4408 14.4653)"
    assert punto.fecha_hora_registro == AHORA


@pytest.mark.asyncio
async def test_reintentar_el_inicio_no_duplica_el_punto(monkeypatch):
    _con_jornada(monkeypatch, _jornada(time(8, 0)))
    db = _db(
        _res_tarea(_tarea("en_progreso")),
        _res_tarea(EmpleadoTarea(id_empleado=2, id_tarea=1)),
    )

    await iniciar_tarea(1, db, _tecnico(), LUGAR)

    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_iniciar_sin_ubicacion_no_guarda_punto_pero_inicia(monkeypatch):
    _con_jornada(monkeypatch, _jornada(time(8, 0)))
    tarea = _tarea()
    db = _db(_res_tarea(tarea), _res_tarea(EmpleadoTarea(id_empleado=2, id_tarea=1)))

    await iniciar_tarea(1, db, _tecnico(), None)

    assert tarea.estado_tarea == "en_progreso"
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_el_supervisor_opera_tareas_sin_jornada_y_sin_dejar_rastro(monkeypatch):
    """Admin y supervisor no marcan jornada: no se les bloquea ni se les ubica."""
    consulta = AsyncMock(return_value=None)
    monkeypatch.setattr(ubicaciones_service, "jornada_en_curso", consulta)
    tarea = _tarea()
    db = _db(_res_tarea(tarea))

    await iniciar_tarea(1, db, _tecnico(id_empleado=9, rol="supervisor"), LUGAR)

    assert tarea.estado_tarea == "en_progreso"
    consulta.assert_not_awaited()
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_al_finalizar_guarda_el_lugar_una_sola_vez(monkeypatch):
    _con_jornada(monkeypatch, _jornada(time(8, 0)))
    db = _db(
        _res_tarea(_tarea("en_progreso")),                      # SELECT tarea
        _res_tarea(EmpleadoTarea(id_empleado=2, id_tarea=1)),   # asignación
        _res_tarea(1),                                           # hay evidencia
        _sin_resultado(),                                        # sin fin_tarea previo
        _res_tarea(1),                                           # COUNT en la respuesta
        _res_tarea(None),                                        # técnico de la respuesta
    )

    await finalizar_tarea(1, db, _tecnico(), LUGAR)

    punto = db.add.call_args.args[0]
    assert punto.evento == EVENTO_FIN_TAREA
    assert punto.id_tarea == 1


@pytest.mark.asyncio
async def test_un_cierre_repetido_no_duplica_el_punto_de_fin():
    ya_registrado = MagicMock()
    ya_registrado.first.return_value = (15,)
    db = _db(ya_registrado)

    guardado = await ubicaciones_service.registrar_evento_tarea(
        db, _tecnico(), EVENTO_FIN_TAREA, 1, LUGAR
    )

    assert guardado is False
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_el_tecnico_no_puede_finalizar_sin_jornada(monkeypatch):
    _con_jornada(monkeypatch, None)
    tarea = _tarea("en_progreso")
    db = _db(_res_tarea(tarea), _res_tarea(EmpleadoTarea(id_empleado=2, id_tarea=1)))

    with pytest.raises(HTTPException) as error:
        await finalizar_tarea(1, db, _tecnico(), LUGAR)

    assert error.value.status_code == 409
    assert tarea.estado_tarea == "en_progreso"


@pytest.mark.asyncio
async def test_el_tecnico_no_puede_registrar_evidencia_sin_jornada(monkeypatch):
    """
    La evidencia es el primer paso del cierre: la subida de la foto ya cierra
    la tarea, así que el bloqueo tiene que estar aquí y no solo en /finalizar.
    """
    _con_jornada(monkeypatch, None)
    tarea = _tarea("en_progreso")
    db = _db(_res_tarea(tarea), _res_tarea(SimpleNamespace()))

    with pytest.raises(HTTPException) as error:
        await crear_incidencia(
            1, IncidenciaCreate(descripcion="Trabajo realizado."), db, _tecnico()
        )

    assert error.value.status_code == 409
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_la_jornada_se_busca_con_la_regla_del_turno_en_curso():
    """Una salida olvidada de hace días no cuenta como jornada abierta."""
    abandonada = _jornada(time(8, 0), fecha=HOY - timedelta(days=3))
    db = _db(_escalares([abandonada]))

    assert await ubicaciones_service.jornada_en_curso(db, 2, AHORA) is None
