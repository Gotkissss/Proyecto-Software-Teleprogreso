"""
Pruebas del router y el servicio de agregacion de reportes.
"""

from datetime import date, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.reportes import _validar_rango, get_reporte_asistencia
from app.services.reportes import (
    consulta_asistencias_por_rango,
    consulta_tareas_completadas_por_rango,
    obtener_reporte_asistencia,
    obtener_reporte_productividad,
    obtener_reporte_tareas_completadas,
)

FECHA_INICIO = date(2026, 8, 1)
FECHA_FIN = date(2026, 8, 15)


def _descanso(inicio: time, fin: time):
    return SimpleNamespace(
        id_descanso=1,
        hora_inicio=inicio,
        hora_fin=fin,
    )


def _jornada(
    id_empleado: int,
    nombre: str,
    apellido: str,
    entrada: time,
    salida: time,
    descansos=None,
):
    return SimpleNamespace(
        id_asistencia=id_empleado,
        id_empleado=id_empleado,
        fecha=date(2026, 8, 10),
        hora_entrada=entrada,
        hora_salida=salida,
        descansos=descansos or [],
        empleado=SimpleNamespace(nombre=nombre, apellido=apellido),
    )


def _resultado_escalars(items):
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = items
    return resultado


def _resultado_filas(items):
    resultado = MagicMock()
    resultado.all.return_value = items
    return resultado


def test_consultas_base_aplican_el_rango_inclusivo():
    consulta_asistencias = str(
        consulta_asistencias_por_rango(FECHA_INICIO, FECHA_FIN).compile(
            compile_kwargs={"literal_binds": True}
        )
    )
    consulta_tareas = str(
        consulta_tareas_completadas_por_rango(FECHA_INICIO, FECHA_FIN).compile(
            compile_kwargs={"literal_binds": True}
        )
    )

    assert "asistencia.fecha >= '2026-08-01'" in consulta_asistencias
    assert "asistencia.fecha <= '2026-08-15'" in consulta_asistencias
    assert "tarea.estado_tarea = 'completado'" in consulta_tareas
    assert "tarea.fecha_completado >= '2026-08-01 00:00:00'" in consulta_tareas
    assert "tarea.fecha_completado <= '2026-08-15 23:59:59.999999'" in consulta_tareas


def test_consulta_asistencia_aplica_filtro_por_empleado():
    consulta = str(
        consulta_asistencias_por_rango(
            FECHA_INICIO,
            FECHA_FIN,
            id_empleado=7,
        ).compile(compile_kwargs={"literal_binds": True})
    )

    assert "asistencia.id_empleado = 7" in consulta


@pytest.mark.asyncio
async def test_reporte_asistencia_agrega_jornadas_y_pausas_por_empleado():
    jornadas = [
        _jornada(
            2,
            "Ana",
            "Lopez",
            time(8, 0),
            time(17, 0),
            [_descanso(time(12, 0), time(13, 0))],
        ),
        _jornada(2, "Ana", "Lopez", time(8, 0), time(12, 0)),
    ]
    db = MagicMock()
    db.execute = AsyncMock(return_value=_resultado_escalars(jornadas))

    reporte = await obtener_reporte_asistencia(db, FECHA_INICIO, FECHA_FIN)

    assert reporte.total_empleados == 1
    assert reporte.total_jornadas == 2
    assert reporte.total_minutos_trabajados == 720
    assert reporte.total_minutos_pausa == 60
    assert reporte.total_horas_trabajadas == "12:00"
    assert reporte.items[0].nombre_empleado == "Ana Lopez"
    assert reporte.items[0].jornadas == 2


@pytest.mark.asyncio
async def test_endpoint_asistencia_envia_filtro_al_servicio():
    db = MagicMock()
    gerente = SimpleNamespace(id_empleado=4, rol="gerente")
    respuesta_esperada = MagicMock()

    with patch(
        "app.routers.reportes.obtener_reporte_asistencia",
        new=AsyncMock(return_value=respuesta_esperada),
    ) as servicio:
        respuesta = await get_reporte_asistencia(
            db,
            gerente,
            FECHA_INICIO,
            FECHA_FIN,
            empleado=7,
        )

    assert respuesta is respuesta_esperada
    servicio.assert_awaited_once_with(
        db,
        FECHA_INICIO,
        FECHA_FIN,
        id_empleado=7,
    )


@pytest.mark.asyncio
async def test_reporte_tareas_cuenta_total_sin_duplicar_tareas_compartidas():
    filas = [
        SimpleNamespace(
            id_tarea=10,
            id_empleado=2,
            nombre="Ana",
            apellido="Lopez",
        ),
        SimpleNamespace(
            id_tarea=10,
            id_empleado=3,
            nombre="Luis",
            apellido="Perez",
        ),
        SimpleNamespace(
            id_tarea=11,
            id_empleado=2,
            nombre="Ana",
            apellido="Lopez",
        ),
        SimpleNamespace(
            id_tarea=12,
            id_empleado=None,
            nombre=None,
            apellido=None,
        ),
    ]
    db = MagicMock()
    db.execute = AsyncMock(return_value=_resultado_filas(filas))

    reporte = await obtener_reporte_tareas_completadas(
        db, FECHA_INICIO, FECHA_FIN
    )

    assert reporte.total_tareas_completadas == 3
    assert reporte.total_empleados == 2
    assert reporte.items[0].id_empleado == 2
    assert reporte.items[0].tareas_completadas == 2
    assert reporte.items[1].tareas_completadas == 1


@pytest.mark.asyncio
async def test_productividad_calcula_tareas_por_hora_trabajada():
    jornadas = [
        _jornada(2, "Ana", "Lopez", time(8, 0), time(12, 0)),
    ]
    tareas = [
        SimpleNamespace(
            id_tarea=10,
            id_empleado=2,
            nombre="Ana",
            apellido="Lopez",
        ),
        SimpleNamespace(
            id_tarea=11,
            id_empleado=2,
            nombre="Ana",
            apellido="Lopez",
        ),
    ]
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _resultado_escalars(jornadas),
            _resultado_filas(tareas),
        ]
    )

    reporte = await obtener_reporte_productividad(
        db, FECHA_INICIO, FECHA_FIN
    )

    assert reporte.total_minutos_trabajados == 240
    assert reporte.total_tareas_completadas == 2
    assert reporte.tareas_por_hora == 0.5
    assert reporte.items[0].horas_trabajadas == "04:00"
    assert reporte.items[0].tareas_por_hora == 0.5


def test_rango_invertido_se_rechaza():
    with pytest.raises(HTTPException) as error:
        _validar_rango(FECHA_FIN, FECHA_INICIO)

    assert error.value.status_code == 400


def test_rango_de_un_solo_dia_es_valido():
    _validar_rango(FECHA_INICIO, FECHA_INICIO)
