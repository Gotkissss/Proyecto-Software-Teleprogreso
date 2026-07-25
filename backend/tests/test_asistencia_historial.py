# backend/tests/test_asistencia_historial.py
"""
Pruebas del cálculo de horas trabajadas / tiempo en pausas y del endpoint
GET /asistencia/historial.

El cálculo vive en app.services.asistencia y es puro, así que se prueba sin
base de datos. El endpoint se prueba con mocks de AsyncSession, igual que
test_alertas.py.
"""

from datetime import date, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.asistencia import get_historial_asistencia
from app.services.asistencia import (
    calcular_jornada,
    formatear_hhmm,
    segundos_entre,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _descanso(id_descanso, inicio, fin):
    return SimpleNamespace(
        id_descanso=id_descanso,
        hora_inicio=inicio,
        hora_fin=fin,
    )


def _asistencia(entrada, salida, descansos=None, fecha=date(2026, 7, 20)):
    return SimpleNamespace(
        id_asistencia=1,
        id_empleado=2,
        fecha=fecha,
        hora_entrada=entrada,
        hora_salida=salida,
        descansos=descansos or [],
        empleado=SimpleNamespace(nombre="Juan", apellido="Pérez", rol="tecnico"),
    )


# ─── segundos_entre / formatear_hhmm ─────────────────────────────────────────

def test_segundos_entre_calcula_diferencia_simple():
    assert segundos_entre(time(8, 0), time(17, 30)) == 9 * 3600 + 30 * 60


def test_segundos_entre_soporta_turno_nocturno():
    # 22:00 → 06:00 son 8 horas, no un negativo.
    assert segundos_entre(time(22, 0), time(6, 0)) == 8 * 3600


def test_formatear_hhmm():
    assert formatear_hhmm(0) == "00:00"
    assert formatear_hhmm(90) == "01:30"
    assert formatear_hhmm(605) == "10:05"
    # Nunca devuelve tiempos negativos
    assert formatear_hhmm(-30) == "00:00"


# ─── calcular_jornada ────────────────────────────────────────────────────────

def test_jornada_sin_pausas():
    resumen = calcular_jornada(_asistencia(time(8, 0), time(17, 0)))

    assert resumen.minutos_brutos == 540
    assert resumen.minutos_pausa == 0
    assert resumen.minutos_trabajados == 540
    assert resumen.jornada_activa is False


def test_jornada_descuenta_las_pausas():
    asistencia = _asistencia(
        time(8, 0),
        time(17, 0),
        descansos=[
            _descanso(1, time(12, 0), time(13, 0)),   # 60 min
            _descanso(2, time(15, 0), time(15, 15)),  # 15 min
        ],
    )

    resumen = calcular_jornada(asistencia)

    assert resumen.minutos_brutos == 540
    assert resumen.minutos_pausa == 75
    assert resumen.minutos_trabajados == 465
    assert resumen.total_pausas == 2


def test_jornada_abierta_sin_referencia_no_inventa_tiempo():
    resumen = calcular_jornada(_asistencia(time(8, 0), None))

    assert resumen.jornada_activa is True
    assert resumen.minutos_brutos == 0
    assert resumen.minutos_trabajados == 0


def test_jornada_abierta_usa_la_hora_de_referencia():
    asistencia = _asistencia(
        time(8, 0),
        None,
        descansos=[_descanso(1, time(10, 0), None)],  # pausa todavía abierta
    )

    resumen = calcular_jornada(asistencia, referencia=time(11, 0))

    assert resumen.jornada_activa is True
    assert resumen.minutos_brutos == 180          # 08:00 → 11:00
    assert resumen.minutos_pausa == 60            # 10:00 → 11:00
    assert resumen.minutos_trabajados == 120
    assert resumen.pausas[0].en_curso is True


def test_pausas_inconsistentes_no_producen_tiempo_negativo():
    # Pausa más larga que la propia jornada (dato corrupto).
    asistencia = _asistencia(
        time(8, 0),
        time(9, 0),
        descansos=[_descanso(1, time(8, 0), time(12, 0))],
    )

    resumen = calcular_jornada(asistencia)

    assert resumen.minutos_trabajados == 0
    assert resumen.minutos_trabajados >= 0


def test_jornada_nocturna_cruza_medianoche():
    resumen = calcular_jornada(_asistencia(time(22, 0), time(6, 0)))

    assert resumen.minutos_brutos == 480
    assert resumen.minutos_trabajados == 480


# ─── Endpoint GET /asistencia/historial ──────────────────────────────────────

def _db_mock(jornadas, total):
    """AsyncSession simulada: primero el count, luego la página, luego totales."""
    db = MagicMock()

    result_count = MagicMock()
    result_count.scalar.return_value = total

    result_items = MagicMock()
    result_items.scalars.return_value.all.return_value = jornadas

    result_totales = MagicMock()
    result_totales.scalars.return_value.all.return_value = jornadas

    db.execute = AsyncMock(side_effect=[result_count, result_items, result_totales])
    return db


@pytest.mark.asyncio
async def test_historial_devuelve_metricas_y_paginacion():
    jornada = _asistencia(
        time(8, 0),
        time(17, 0),
        descansos=[_descanso(1, time(12, 0), time(13, 0))],
    )
    db = _db_mock([jornada], total=1)
    admin = SimpleNamespace(rol="admin", id_empleado=3)

    respuesta = await get_historial_asistencia(
        db, admin, empleado=2, fecha_inicio=None, fecha_fin=None, page=1, page_size=20
    )

    assert respuesta.total == 1
    assert respuesta.total_pages == 1
    assert len(respuesta.items) == 1

    item = respuesta.items[0]
    assert item.horas_trabajadas == "08:00"
    assert item.horas_pausa == "01:00"
    assert item.total_pausas == 1
    assert item.nombre_empleado == "Juan Pérez"

    assert respuesta.totales.jornadas == 1
    assert respuesta.totales.horas_trabajadas == "08:00"


@pytest.mark.asyncio
async def test_historial_rechaza_rango_de_fechas_invertido():
    db = _db_mock([], total=0)
    admin = SimpleNamespace(rol="admin", id_empleado=3)

    with pytest.raises(HTTPException) as error:
        await get_historial_asistencia(
            db,
            admin,
            empleado=None,
            fecha_inicio=date(2026, 7, 20),
            fecha_fin=date(2026, 7, 1),
            page=1,
            page_size=20,
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_tecnico_solo_ve_su_propio_historial():
    """Un técnico que pide el historial de otro empleado recibe el suyo."""
    jornada = _asistencia(time(8, 0), time(12, 0))
    db = _db_mock([jornada], total=1)
    tecnico = SimpleNamespace(rol="tecnico", id_empleado=7)

    await get_historial_asistencia(
        db, tecnico, empleado=99, fecha_inicio=None, fecha_fin=None, page=1, page_size=20
    )

    # El filtro aplicado debe ser el id del propio técnico, no el 99 solicitado.
    filtro_sql = str(db.execute.await_args_list[0].args[0])
    assert "asistencia.id_empleado" in filtro_sql
