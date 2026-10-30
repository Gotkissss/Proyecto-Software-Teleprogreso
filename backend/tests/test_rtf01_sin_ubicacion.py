# backend/tests/test_rtf01_sin_ubicacion.py
"""
RTF-01 / R3-4 — una marca sin GPS explica por qué.

El informe: «La entrada se registra sin GPS ("Ubicación no disponible"); para
un control de personal de campo no se puede verificar el lugar.»

Lo que NO se cambió, a propósito: la marca sigue registrándose sin ubicación.
Exigir el GPS deja al técnico sin poder trabajar por un permiso denegado o un
sótano sin señal, y el informe pide «exigir ubicación O pedir justificación».
Se eligió la justificación.

Lo que se cambió: cuando la marca sale sin coordenada, el técnico puede decir
por qué, y ese texto queda guardado por marca (entrada y salida son dos) y
viaja en el historial para que el supervisor lo revise. Antes la fila decía
«Ubicación no disponible» y nada más: no había forma de distinguir «el GPS no
enganchó» de «marqué desde mi casa».
"""

from datetime import date, datetime, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

import app.routers.asistencia as asistencia_router
from app.routers.asistencia import registrar_entrada, registrar_salida
from app.schemas.ubicacion import MarcaAsistencia

HOY = date(2026, 10, 28)
SOTANO = MarcaAsistencia(motivo_sin_ubicacion="Sin señal, el nodo está en un sótano")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _empleado():
    return SimpleNamespace(
        id_empleado=2, nombre="Juan", apellido="Pérez", rol="tecnico"
    )


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


def _jornada_abierta():
    return SimpleNamespace(
        id_asistencia=5,
        id_empleado=2,
        fecha=HOY,
        hora_entrada=time(8, 0),
        hora_salida=None,
        coordenada_salida=None,
        motivo_sin_ubicacion_entrada=None,
        motivo_sin_ubicacion_salida=None,
    )


# ─── El cuerpo de la marca ───────────────────────────────────────────────────

def test_sin_coordenada_se_acepta_el_motivo():
    marca = MarcaAsistencia(motivo_sin_ubicacion="  GPS denegado  ")
    assert marca.coordenadas is None
    # Se recorta: un motivo de puros espacios no es un motivo.
    assert marca.motivo == "GPS denegado"


def test_un_motivo_en_blanco_es_lo_mismo_que_no_mandarlo():
    assert MarcaAsistencia(motivo_sin_ubicacion="   ").motivo is None
    assert MarcaAsistencia().motivo is None


def test_con_coordenada_no_se_admite_un_motivo():
    # Dejaría filas que se contradicen: hay ubicación y a la vez una excusa
    # por no tenerla. El supervisor no sabría cuál creer.
    with pytest.raises(ValidationError):
        MarcaAsistencia(lat=14.6, lng=-90.5, motivo_sin_ubicacion="GPS denegado")


def test_media_coordenada_se_rechaza():
    # Antes `lat` sin `lng` se guardaba como "sin ubicación" en silencio: un
    # error del cliente se perdía y la marca quedaba sin lugar.
    for mal in ({"lat": 14.6}, {"lng": -90.5}):
        with pytest.raises(ValidationError):
            MarcaAsistencia(**mal)


def test_el_motivo_tiene_tope_de_largo():
    with pytest.raises(ValidationError):
        MarcaAsistencia(motivo_sin_ubicacion="x" * 201)


def test_el_rango_de_las_coordenadas_sigue_validandose():
    with pytest.raises(ValidationError):
        MarcaAsistencia(lat=91, lng=0)
    with pytest.raises(ValidationError):
        MarcaAsistencia(lat=0, lng=181)


# ─── POST /asistencia/entrada ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_entrada_sin_gps_guarda_el_motivo(monkeypatch):
    _fijar_reloj(monkeypatch, time(7, 55))
    db = _db(_resultado([]))

    respuesta = await registrar_entrada(
        db=db, current_user=_empleado(), marca=SOTANO
    )

    nueva = db.add.call_args.args[0]
    assert nueva.coordenada_entrada is None
    assert nueva.motivo_sin_ubicacion_entrada == (
        "Sin señal, el nodo está en un sótano"
    )
    # La marca se registra igual: lo que cambia es que ya no es un hueco mudo.
    assert nueva.hora_entrada == time(7, 55)
    assert respuesta["ubicacion_registrada"] is False
    assert respuesta["motivo_sin_ubicacion"] == (
        "Sin señal, el nodo está en un sótano"
    )


@pytest.mark.asyncio
async def test_la_entrada_con_gps_no_guarda_motivo(monkeypatch):
    _fijar_reloj(monkeypatch, time(7, 55))
    db = _db(_resultado([]))

    await registrar_entrada(
        db=db,
        current_user=_empleado(),
        marca=MarcaAsistencia(lat=14.4653, lng=-90.4408),
    )

    nueva = db.add.call_args.args[0]
    assert nueva.coordenada_entrada == "SRID=4326;POINT(-90.4408 14.4653)"
    assert nueva.motivo_sin_ubicacion_entrada is None


@pytest.mark.asyncio
async def test_la_entrada_sin_cuerpo_sigue_funcionando(monkeypatch):
    """Los clientes viejos no mandan nada y tienen que poder marcar igual."""
    _fijar_reloj(monkeypatch, time(7, 55))
    db = _db(_resultado([]))

    respuesta = await registrar_entrada(db=db, current_user=_empleado())

    nueva = db.add.call_args.args[0]
    assert nueva.coordenada_entrada is None
    assert nueva.motivo_sin_ubicacion_entrada is None
    assert respuesta["ubicacion_registrada"] is False


# ─── POST /asistencia/salida ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_salida_sin_gps_guarda_su_propio_motivo(monkeypatch):
    _fijar_reloj(monkeypatch, time(17, 30))
    jornada = _jornada_abierta()
    jornada.motivo_sin_ubicacion_entrada = "GPS denegado al entrar"
    db = _db(_resultado([jornada]), _resultado([]), _resultado([]))

    respuesta = await registrar_salida(
        db=db, current_user=_empleado(), marca=SOTANO
    )

    # El motivo de la entrada no se pisa: son dos marcas distintas y el
    # supervisor necesita saber a cuál corresponde cada explicación.
    assert jornada.motivo_sin_ubicacion_entrada == "GPS denegado al entrar"
    assert jornada.motivo_sin_ubicacion_salida == (
        "Sin señal, el nodo está en un sótano"
    )
    assert respuesta["ubicacion_registrada"] is False


@pytest.mark.asyncio
async def test_la_salida_con_gps_no_escribe_motivo(monkeypatch):
    _fijar_reloj(monkeypatch, time(17, 30))
    jornada = _jornada_abierta()
    db = _db(_resultado([jornada]), _resultado([]), _resultado([]))

    await registrar_salida(
        db=db,
        current_user=_empleado(),
        marca=MarcaAsistencia(lat=14.4653, lng=-90.4408),
    )

    assert jornada.coordenada_salida == "SRID=4326;POINT(-90.4408 14.4653)"
    assert jornada.motivo_sin_ubicacion_salida is None
