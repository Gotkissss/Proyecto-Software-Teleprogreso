# backend/tests/test_asistencia_ubicacion.py
"""
Pruebas de HU-4: marcar entrada y salida deja constancia del lugar.

  1. La entrada y la salida guardan la coordenada cuando llega, y se registran
     igual cuando no llega (GPS denegado o sin señal): nunca se bloquea al
     técnico por no tener ubicación.
  2. El historial devuelve el lugar de cada marca, o None para que la UI la
     señale como "sin ubicación".
  3. `lat_lng_de` lee el punto guardado en el orden correcto. Igual que al
     escribir, invertir latitud y longitud no da error: solo pone la marca en
     otro continente.
"""

import struct
from datetime import date, datetime, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from geoalchemy2.elements import WKBElement

import app.routers.asistencia as asistencia_router
from app.core.geo import lat_lng_de
from app.routers.asistencia import (
    get_historial_asistencia,
    registrar_entrada,
    registrar_salida,
)
from app.schemas.ubicacion import UbicacionCreate

HOY = date(2026, 9, 23)
FRAIJANES = UbicacionCreate(lat=14.4653, lng=-90.4408)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _empleado():
    return SimpleNamespace(id_empleado=2, nombre="Juan", apellido="Pérez")


def _fijar_reloj(monkeypatch, hora):
    monkeypatch.setattr(
        asistencia_router, "ahora_local", lambda: datetime.combine(HOY, hora)
    )


def _resultado(filas):
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = filas
    return resultado


def _db(*resultados):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(resultados))
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _wkb_punto(lat, lng, *, big_endian=False, con_srid=False):
    """WKB de un POINT como lo devolvería ST_AsBinary / ST_AsEWKB."""
    orden = ">" if big_endian else "<"
    tipo = 1 | (0x20000000 if con_srid else 0)
    cabecera = bytes([0 if big_endian else 1]) + struct.pack(f"{orden}I", tipo)
    if con_srid:
        cabecera += struct.pack(f"{orden}I", 4326)
    # X = longitud, Y = latitud
    return cabecera + struct.pack(f"{orden}dd", lng, lat)


# ─── POST /asistencia/entrada ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_entrada_guarda_la_coordenada_recibida(monkeypatch):
    _fijar_reloj(monkeypatch, time(7, 55))
    db = _db(_resultado([]))

    respuesta = await registrar_entrada(
        db=db, current_user=_empleado(), ubicacion=FRAIJANES
    )

    nueva = db.add.call_args.args[0]
    # WKT escribe longitud primero.
    assert nueva.coordenada_entrada == "SRID=4326;POINT(-90.4408 14.4653)"
    assert respuesta["ubicacion_registrada"] is True


@pytest.mark.asyncio
async def test_la_entrada_sin_ubicacion_se_registra_igual(monkeypatch):
    """Sin GPS la marca no se bloquea: queda en null y se señala después."""
    _fijar_reloj(monkeypatch, time(7, 55))
    db = _db(_resultado([]))

    respuesta = await registrar_entrada(db=db, current_user=_empleado())

    nueva = db.add.call_args.args[0]
    assert nueva.coordenada_entrada is None
    assert nueva.hora_entrada == time(7, 55)
    assert respuesta["ubicacion_registrada"] is False


# ─── POST /asistencia/salida ──────────────────────────────────────────────────

def _jornada_abierta_de_hoy():
    return SimpleNamespace(
        id_asistencia=5,
        id_empleado=2,
        fecha=HOY,
        hora_entrada=time(8, 0),
        hora_salida=None,
        coordenada_salida=None,
    )


@pytest.mark.asyncio
async def test_la_salida_guarda_la_coordenada_recibida(monkeypatch):
    _fijar_reloj(monkeypatch, time(17, 5))
    jornada = _jornada_abierta_de_hoy()
    db = _db(_resultado([jornada]), _resultado([]))

    respuesta = await registrar_salida(
        db=db, current_user=_empleado(), ubicacion=FRAIJANES
    )

    assert jornada.hora_salida == time(17, 5)
    assert jornada.coordenada_salida == "SRID=4326;POINT(-90.4408 14.4653)"
    assert respuesta["ubicacion_registrada"] is True


@pytest.mark.asyncio
async def test_la_salida_sin_ubicacion_se_registra_igual(monkeypatch):
    _fijar_reloj(monkeypatch, time(17, 5))
    jornada = _jornada_abierta_de_hoy()
    db = _db(_resultado([jornada]), _resultado([]))

    respuesta = await registrar_salida(db=db, current_user=_empleado())

    assert jornada.hora_salida == time(17, 5)
    assert jornada.coordenada_salida is None
    assert respuesta["ubicacion_registrada"] is False


# ─── Validación del cuerpo (HTTP) ─────────────────────────────────────────────

async def _post(ruta, **kwargs):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core.deps import get_current_empleado
    from app.db.session import get_db

    app = FastAPI()
    app.include_router(asistencia_router.router)

    async def db_simulada():
        yield _db(_resultado([]), _resultado([]))

    async def usuario_simulado():
        return _empleado()

    app.dependency_overrides[get_db] = db_simulada
    app.dependency_overrides[get_current_empleado] = usuario_simulado

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(ruta, **kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize("ruta", ["/asistencia/entrada", "/asistencia/salida"])
@pytest.mark.parametrize(
    "cuerpo",
    [{"lat": 91, "lng": -90.44}, {"lat": 14.46, "lng": -181}, {"lat": 14.46}],
)
async def test_coordenadas_invalidas_devuelven_422(ruta, cuerpo):
    respuesta = await _post(ruta, json=cuerpo)

    assert respuesta.status_code == 422


@pytest.mark.asyncio
async def test_la_entrada_sin_cuerpo_sigue_funcionando_por_http(monkeypatch):
    """El cuerpo es opcional: el cliente viejo (sin ubicación) no se rompe."""
    _fijar_reloj(monkeypatch, time(7, 55))

    respuesta = await _post("/asistencia/entrada")

    assert respuesta.status_code == 201
    assert respuesta.json()["ubicacion_registrada"] is False


# ─── GET /asistencia/historial ────────────────────────────────────────────────

def _jornada_historial(id_asistencia, coordenada_entrada, coordenada_salida):
    return SimpleNamespace(
        id_asistencia=id_asistencia,
        id_empleado=2,
        fecha=date(2026, 7, 20),
        hora_entrada=time(8, 0),
        hora_salida=time(17, 0),
        descansos=[],
        empleado=SimpleNamespace(nombre="Juan", apellido="Pérez", rol="tecnico"),
        coordenada_entrada=coordenada_entrada,
        coordenada_salida=coordenada_salida,
    )


@pytest.mark.asyncio
async def test_el_historial_devuelve_el_lugar_o_none_si_no_hay():
    con_ubicacion = _jornada_historial(
        1,
        WKBElement(_wkb_punto(14.4744, -90.4425), srid=4326),
        WKBElement(_wkb_punto(14.4751, -90.4437), srid=4326),
    )
    sin_ubicacion = _jornada_historial(2, None, None)

    count = MagicMock()
    count.scalar.return_value = 2
    jornadas = [con_ubicacion, sin_ubicacion]
    db = _db(count, _resultado(jornadas), _resultado(jornadas))
    admin = SimpleNamespace(rol="admin", id_empleado=3)

    respuesta = await get_historial_asistencia(
        db, admin, empleado=None, fecha_inicio=None, fecha_fin=None, page=1, page_size=20
    )

    primera, segunda = respuesta.items
    assert (primera.lat_entrada, primera.lng_entrada) == (14.4744, -90.4425)
    assert (primera.lat_salida, primera.lng_salida) == (14.4751, -90.4437)
    assert segunda.lat_entrada is None and segunda.lng_entrada is None
    assert segunda.lat_salida is None and segunda.lng_salida is None


# ─── lat_lng_de ───────────────────────────────────────────────────────────────

def test_lee_un_punto_wkb_con_latitud_y_longitud_en_su_sitio():
    assert lat_lng_de(_wkb_punto(14.4653, -90.4408)) == (14.4653, -90.4408)


def test_lee_wkb_big_endian():
    assert lat_lng_de(_wkb_punto(14.4653, -90.4408, big_endian=True)) == (
        14.4653,
        -90.4408,
    )


def test_lee_ewkb_con_srid():
    assert lat_lng_de(_wkb_punto(14.4653, -90.4408, con_srid=True)) == (
        14.4653,
        -90.4408,
    )


def test_lee_un_WKBElement_y_texto_hexadecimal():
    wkb = _wkb_punto(14.4653, -90.4408)

    assert lat_lng_de(WKBElement(wkb, srid=4326)) == (14.4653, -90.4408)
    assert lat_lng_de(wkb.hex()) == (14.4653, -90.4408)


def test_sin_valor_o_si_no_es_un_punto_devuelve_none():
    linea = bytes([1]) + struct.pack("<I", 2) + b"\x00" * 16

    assert lat_lng_de(None) is None
    assert lat_lng_de(b"") is None
    assert lat_lng_de(linea) is None
