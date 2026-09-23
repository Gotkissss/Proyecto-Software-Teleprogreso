# backend/tests/test_asistencia_entrada.py
"""
Pruebas de POST /asistencia/entrada frente a jornadas que quedaron abiertas.

La entrada tiene que decidir qué hacer con cada jornada sin salida del
empleado, y hay tres casos que se parecen mucho y piden respuestas opuestas:

  · la jornada de hoy sigue abierta          → se rechaza la entrada;
  · un turno nocturno de ayer sigue en curso → se rechaza la entrada;
  · una jornada vieja quedó olvidada         → se cierra y se deja entrar.

Antes el segundo caso caía en el tercero: marcar entrada a las 02:00 cerraba
el turno nocturno en curso a las 23:59:59 y el técnico perdía, sin ningún
aviso, las horas trabajadas después de medianoche.

El reloj se fija sobre el módulo del router porque el turno nocturno solo se
distingue de una jornada olvidada por la hora actual.
"""

from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.routers.asistencia as asistencia_router
from app.routers.asistencia import HORA_CIERRE_FORZADO, registrar_entrada

HOY = date(2026, 9, 23)
AYER = HOY - timedelta(days=1)


def _empleado():
    return SimpleNamespace(id_empleado=2, nombre="Juan", apellido="Pérez")


def _jornada(fecha, hora_entrada):
    return SimpleNamespace(
        id_asistencia=5,
        id_empleado=2,
        fecha=fecha,
        hora_entrada=hora_entrada,
        hora_salida=None,
    )


def _db(abiertas):
    """
    Sesión simulada: la primera consulta devuelve las jornadas abiertas y las
    siguientes (pausas de la jornada que se cierra) no traen nada.
    """
    jornadas = MagicMock()
    jornadas.scalars.return_value.all.return_value = abiertas

    sin_pausas = MagicMock()
    sin_pausas.scalars.return_value.all.return_value = []

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[jornadas, sin_pausas, sin_pausas])
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _fijar_reloj(monkeypatch, hora):
    monkeypatch.setattr(
        asistencia_router, "ahora_local", lambda: datetime.combine(HOY, hora)
    )


@pytest.mark.asyncio
async def test_rechaza_la_entrada_con_un_turno_nocturno_en_curso(monkeypatch):
    _fijar_reloj(monkeypatch, time(2, 0))
    nocturna = _jornada(AYER, time(22, 0))
    db = _db([nocturna])

    with pytest.raises(HTTPException) as error:
        await registrar_entrada(db, _empleado())

    assert error.value.status_code == 400
    assert "salida" in error.value.detail
    # Lo importante: el turno sigue abierto y no se creó otra jornada.
    assert nocturna.hora_salida is None
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_rechaza_la_entrada_si_la_jornada_de_hoy_sigue_abierta(monkeypatch):
    _fijar_reloj(monkeypatch, time(10, 0))
    db = _db([_jornada(HOY, time(8, 0))])

    with pytest.raises(HTTPException) as error:
        await registrar_entrada(db, _empleado())

    assert error.value.status_code == 400
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_cierra_la_salida_olvidada_de_ayer_y_deja_entrar(monkeypatch):
    """
    Entró ayer a las 09:00 y hoy llega a las 08:00. Por la hora podría parecer
    un turno nocturno, pero pasaron 23 horas: es una salida olvidada. Bloquear
    la entrada lo dejaría atrapado sin poder trabajar.
    """
    _fijar_reloj(monkeypatch, time(8, 0))
    olvidada = _jornada(AYER, time(9, 0))
    db = _db([olvidada])

    respuesta = await registrar_entrada(db, _empleado())

    assert olvidada.hora_salida == HORA_CIERRE_FORZADO
    db.add.assert_called_once()
    nueva = db.add.call_args.args[0]
    assert nueva.fecha == HOY
    assert nueva.hora_entrada == time(8, 0)
    assert respuesta["fecha"] == str(HOY)


@pytest.mark.asyncio
async def test_cierra_una_jornada_abandonada_hace_dias(monkeypatch):
    _fijar_reloj(monkeypatch, time(2, 0))
    abandonada = _jornada(HOY - timedelta(days=3), time(22, 0))
    db = _db([abandonada])

    await registrar_entrada(db, _empleado())

    assert abandonada.hora_salida == HORA_CIERRE_FORZADO
    db.add.assert_called_once()
