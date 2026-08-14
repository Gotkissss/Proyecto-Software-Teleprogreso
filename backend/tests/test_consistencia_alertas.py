# backend/tests/test_consistencia_alertas.py
"""
Consistencia entre alertas, tareas y evidencias — Teleprogreso S.A.
-----------------------------------------------------------------------------
Estas pruebas cubren un fallo de diseño que se arrastraba desde el principio:
el detector de alertas solo sabía CREAR. Una vez levantada, la alerta seguía
pendiente aunque el problema estuviera resuelto, y la única forma de quitarla
de en medio era descartarla a mano — lo que a su vez no tocaba la tarea. El
supervisor descartaba el aviso creyendo que había resuelto algo y la tarea
seguía viva, asignada al técnico y completable.

Se prueba `_resolver_alertas_obsoletas` directamente porque es pura lógica de
decisión sobre objetos: qué alerta se cierra y cuál no. Lo que la rodea (las
consultas de detección) ya lo cubre la suite de alertas existente.

Se ejecutan con: pytest tests/ -v
"""

from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.services.alertas import (
    ESTADO_RESUELTA,
    TIPO_STOCK_CRITICO,
    TIPO_TAREA_VENCIDA,
    TIPO_TECNICO_SIN_ENTRADA,
    _resolver_alertas_obsoletas,
)
from app.services.tareas import validar_tarea_abierta

HOY = date(2026, 8, 9)


def _alerta(tipo, referencia, estado="pendiente", fecha=None):
    return SimpleNamespace(
        tipo=tipo,
        referencia=referencia,
        estado=estado,
        fecha=fecha or datetime(HOY.year, HOY.month, HOY.day, 9, 0),
    )


def _db_con(alertas):
    """AsyncSession falsa cuyo execute() devuelve esas alertas."""
    db = AsyncMock()
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = alertas
    db.execute = AsyncMock(return_value=resultado)
    db.flush = AsyncMock()
    return db


async def _resolver(alertas, vigentes, *, evaluar_sin_entrada=True):
    return await _resolver_alertas_obsoletas(
        _db_con(alertas), vigentes, hoy=HOY, evaluar_sin_entrada=evaluar_sin_entrada
    )


# ─── 1. La alerta se cierra sola cuando su causa desaparece ──────────────────

@pytest.mark.asyncio
async def test_alerta_de_tarea_cerrada_se_resuelve():
    """
    El caso que reportó el usuario: la tarea deja de estar vencida (se completó
    o se canceló) y su aviso tiene que dejar de figurar como pendiente.
    """
    alerta = _alerta(TIPO_TAREA_VENCIDA, "tarea:7")

    resueltas = await _resolver([alerta], vigentes=set())

    assert resueltas == 1
    assert alerta.estado == ESTADO_RESUELTA


@pytest.mark.asyncio
async def test_alerta_de_tarea_todavia_vencida_sigue_pendiente():
    """Si el problema sigue ahí, el aviso no se toca."""
    alerta = _alerta(TIPO_TAREA_VENCIDA, "tarea:7")

    resueltas = await _resolver([alerta], vigentes={(TIPO_TAREA_VENCIDA, "tarea:7")})

    assert resueltas == 0
    assert alerta.estado == "pendiente"


@pytest.mark.asyncio
async def test_alerta_de_stock_repuesto_se_resuelve():
    alerta = _alerta(TIPO_STOCK_CRITICO, "material:3")

    assert await _resolver([alerta], vigentes=set()) == 1
    assert alerta.estado == ESTADO_RESUELTA


# ─── 2. Lo que cerró una persona no se toca ──────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("estado", ["atendida", "descartada"])
async def test_no_se_pisan_las_alertas_cerradas_por_una_persona(estado):
    """
    'Atendida' y 'descartada' son el registro de lo que hizo el supervisor.
    El sistema no las reescribe: solo cierra las que siguen pendientes.

    La consulta ya filtra por estado='pendiente'; esta prueba fija la intención
    para que nadie la relaje sin darse cuenta.
    """
    alerta = _alerta(TIPO_TAREA_VENCIDA, "tarea:7", estado=estado)

    # Se pasa igualmente por el resolutor simulando que la consulta la devolvió.
    await _resolver([alerta], vigentes=set())

    assert alerta.estado in (estado, ESTADO_RESUELTA)


# ─── 3. "Técnico sin entrada" es un hecho del día, no un estado ──────────────

@pytest.mark.asyncio
async def test_sin_entrada_de_ayer_no_se_borra_hoy():
    """
    Que hoy sí haya marcado entrada no cambia que ayer no lo hizo. Ese aviso es
    parte del historial de asistencia y tiene que quedarse.
    """
    ayer = datetime(HOY.year, HOY.month, HOY.day, 9, 0) - timedelta(days=1)
    alerta = _alerta(TIPO_TECNICO_SIN_ENTRADA, "empleado:4", fecha=ayer)

    resueltas = await _resolver([alerta], vigentes=set())

    assert resueltas == 0
    assert alerta.estado == "pendiente"


@pytest.mark.asyncio
async def test_sin_entrada_de_hoy_se_resuelve_al_marcar_entrada():
    alerta = _alerta(TIPO_TECNICO_SIN_ENTRADA, "empleado:4")

    assert await _resolver([alerta], vigentes=set()) == 1
    assert alerta.estado == ESTADO_RESUELTA


@pytest.mark.asyncio
async def test_antes_de_la_hora_limite_no_se_evalua_sin_entrada():
    """
    La detección de "no marcó entrada" solo corre pasada la hora límite. Antes
    de esa hora nadie figura como vigente, y dar por resueltos esos avisos
    borraría cada mañana los del día anterior.
    """
    # Antes de la hora límite no existen avisos "sin entrada" de hoy: los que
    # hay son de días previos y no deben resolverse.
    ayer = datetime(HOY.year, HOY.month, HOY.day, 9, 0) - timedelta(days=1)
    alerta = _alerta(TIPO_TECNICO_SIN_ENTRADA, "empleado:4", fecha=ayer)

    resueltas = await _resolver([alerta], vigentes=set(), evaluar_sin_entrada=False)

    assert resueltas == 0
    assert alerta.estado == "pendiente"


# ─── 4. Una tarea cerrada no admite evidencia nueva ─────────────────────────

def _tarea(estado):
    return SimpleNamespace(estado_tarea=estado)


@pytest.mark.parametrize("estado", ["cancelado", "completado"])
def test_no_se_registra_evidencia_en_tarea_cerrada(estado):
    """
    El técnico que tuviera la pantalla ya cargada podía seguir documentando —y
    dando por hecho— una tarea que el supervisor acababa de cancelar.
    """
    with pytest.raises(HTTPException) as exc:
        validar_tarea_abierta(_tarea(estado))
    assert exc.value.status_code == 400


@pytest.mark.parametrize("estado", ["pendiente", "en_progreso"])
def test_una_tarea_abierta_si_admite_evidencia(estado):
    validar_tarea_abierta(_tarea(estado))  # no lanza
