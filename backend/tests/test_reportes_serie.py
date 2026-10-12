# backend/tests/test_reportes_serie.py
"""
Serie temporal de reportes — HU-S9-04, tarea 2.

GET /reportes/serie reparte horas trabajadas, tareas cerradas o minutos en
pausa por día o por semana, con 0 en los periodos sin datos y con la misma
aritmética que los reportes agregados.
"""
from datetime import date, datetime, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.reportes import get_reporte_serie
from app.services.reportes import obtener_serie, periodos_serie

LUNES = date(2026, 10, 5)


def _jornada(dia: date, entrada: time, salida: time, pausas=()):
    return SimpleNamespace(
        id_asistencia=hash((dia, entrada)),
        id_empleado=2,
        fecha=dia,
        hora_entrada=entrada,
        hora_salida=salida,
        descansos=[
            SimpleNamespace(id_descanso=i, hora_inicio=inicio, hora_fin=fin)
            for i, (inicio, fin) in enumerate(pausas)
        ],
        empleado=SimpleNamespace(nombre="Ana", apellido="Lopez"),
    )


def _db_jornadas(jornadas):
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = jornadas
    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _db_tareas(filas):
    resultado = MagicMock()
    resultado.all.return_value = filas
    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _tarea(id_tarea, cuando: datetime, id_empleado=2):
    return SimpleNamespace(
        id_tarea=id_tarea, fecha_completado=cuando, id_empleado=id_empleado,
        nombre="Ana", apellido="Lopez",
    )


# ─── Periodos ────────────────────────────────────────────────────────────────

def test_por_dia_hay_un_periodo_por_cada_dia_del_rango():
    periodos = periodos_serie(LUNES, date(2026, 10, 7), "dia")
    assert periodos == [
        (date(2026, 10, 5), date(2026, 10, 5)),
        (date(2026, 10, 6), date(2026, 10, 6)),
        (date(2026, 10, 7), date(2026, 10, 7)),
    ]


def test_por_semana_son_semanas_de_lunes_a_domingo_recortadas_al_rango():
    # Del miércoles 7 al martes 20: la primera y la última semana van recortadas.
    assert periodos_serie(date(2026, 10, 7), date(2026, 10, 20), "semana") == [
        (date(2026, 10, 7), date(2026, 10, 11)),
        (date(2026, 10, 12), date(2026, 10, 18)),
        (date(2026, 10, 19), date(2026, 10, 20)),
    ]


def test_un_solo_dia_es_una_sola_semana():
    assert periodos_serie(LUNES, LUNES, "semana") == [(LUNES, LUNES)]


# ─── Métricas ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_horas_por_dia_restan_pausas_y_dejan_en_cero_los_dias_sin_datos():
    db = _db_jornadas([
        _jornada(LUNES, time(8), time(17), [(time(12), time(13))]),  # 8 h
        _jornada(date(2026, 10, 7), time(8), time(12, 30)),           # 4.5 h
    ])

    serie = await obtener_serie(db, LUNES, date(2026, 10, 7), "horas", "dia")

    assert [p.valor for p in serie.puntos] == [8.0, 0.0, 4.5]
    assert serie.total == 12.5
    assert serie.unidad == "horas"


@pytest.mark.asyncio
async def test_pausas_suman_minutos_por_semana():
    db = _db_jornadas([
        _jornada(LUNES, time(8), time(17), [(time(10), time(10, 15)), (time(12), time(13))]),
        _jornada(date(2026, 10, 13), time(8), time(17), [(time(12), time(12, 30))]),
    ])

    serie = await obtener_serie(db, LUNES, date(2026, 10, 18), "pausas", "semana")

    assert [p.valor for p in serie.puntos] == [75.0, 30.0]
    assert serie.total == 105.0
    assert serie.unidad == "minutos"


@pytest.mark.asyncio
async def test_tareas_cuentan_una_vez_aunque_tengan_dos_tecnicos():
    db = _db_tareas([
        _tarea(10, datetime(2026, 10, 5, 9, 30), id_empleado=2),
        _tarea(10, datetime(2026, 10, 5, 9, 30), id_empleado=3),  # misma tarea
        _tarea(11, datetime(2026, 10, 6, 23, 59)),
        _tarea(12, datetime(2026, 10, 6, 0, 1)),
    ])

    serie = await obtener_serie(db, LUNES, date(2026, 10, 6), "tareas", "dia")

    assert [p.valor for p in serie.puntos] == [1.0, 2.0]
    assert serie.total == 3.0
    assert serie.unidad == "tareas"


@pytest.mark.asyncio
async def test_agrupar_por_semana_da_el_mismo_total_que_por_dia():
    jornadas = [
        _jornada(date(2026, 10, d), time(8), time(16), [(time(12), time(12, 45))])
        for d in (5, 9, 13, 16)
    ]
    por_dia = await obtener_serie(_db_jornadas(jornadas), LUNES, date(2026, 10, 18), "horas", "dia")
    por_semana = await obtener_serie(_db_jornadas(jornadas), LUNES, date(2026, 10, 18), "horas", "semana")

    assert len(por_dia.puntos) == 14 and len(por_semana.puntos) == 2
    assert por_dia.total == por_semana.total == sum(p.valor for p in por_semana.puntos)


@pytest.mark.asyncio
async def test_el_filtro_de_empleado_llega_a_la_consulta():
    db = _db_jornadas([])

    serie = await obtener_serie(db, LUNES, LUNES, "horas", "dia", id_empleado=7)

    consulta = str(db.execute.await_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "asistencia.id_empleado = 7" in consulta
    assert serie.id_empleado == 7


# ─── Endpoint ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rango_invertido_es_400():
    with pytest.raises(HTTPException) as error:
        await get_reporte_serie(MagicMock(), SimpleNamespace(rol="gerente"), "horas", date(2026, 10, 9), LUNES)
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_mas_de_un_anio_por_dia_es_400_pero_por_semana_no():
    inicio, fin = date(2025, 1, 1), date(2026, 3, 1)  # 425 días

    with pytest.raises(HTTPException) as error:
        await get_reporte_serie(MagicMock(), SimpleNamespace(rol="gerente"), "horas", inicio, fin, "dia")
    assert error.value.status_code == 400
    assert "agrupa por semana" in error.value.detail

    with patch("app.routers.reportes.obtener_serie", AsyncMock(return_value="serie")) as servicio:
        resultado = await get_reporte_serie(
            MagicMock(), SimpleNamespace(rol="gerente"), "tareas", inicio, fin, "semana", 4
        )
    assert resultado == "serie"
    assert servicio.await_args.args[1:] == (inicio, fin, "tareas", "semana")
    assert servicio.await_args.kwargs == {"id_empleado": 4}
