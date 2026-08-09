# backend/tests/test_reglas_negocio.py
"""
Pruebas de las reglas de negocio corregidas — Teleprogreso S.A.
-----------------------------------------------------------------------------
Cada bloque corresponde a un fallo encontrado en la revisión previa a la
auditoría. Están escritas para que, si alguien vuelve a quitar la validación,
la suite lo diga en vez de que lo descubra el auditor.

Se ejecutan con: pytest tests/ -v
"""

from datetime import date, time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.reglas import (
    ESTADOS_HERRAMIENTA,
    ESTADOS_VEHICULO,
    LIMITE_TAREAS_ACTIVAS,
)
from app.schemas.activo import ActivoUpdateRequest, CarroCreate, MaterialCreate
from app.services.asistencia import calcular_jornada
from app.services.tareas import validar_cierre_permitido


# ─── 1. Política de carga de trabajo ─────────────────────────────────────────

def test_limite_de_tareas_es_cinco():
    """El tope acordado con la operación. Si cambia, que sea a propósito."""
    assert LIMITE_TAREAS_ACTIVAS == 5


def test_el_limite_no_esta_duplicado_en_los_routers():
    """
    tareas.py y metricas.py tenían cada uno su propia copia del número y se
    desincronizaron. Ahora los dos deben apuntar a la misma constante.
    """
    from app.routers import metricas, tareas

    assert tareas.LIMITE_TAREAS_ACTIVAS == LIMITE_TAREAS_ACTIVAS
    assert tareas.ESTADOS_ACTIVOS == metricas.ESTADOS_ACTIVOS


# ─── 2. Cierre de tareas ─────────────────────────────────────────────────────

def _tarea(estado: str):
    return SimpleNamespace(estado_tarea=estado, fecha_completado=None, fecha_inicio=None)


def test_no_se_finaliza_una_tarea_pendiente():
    """Una tarea que nunca se inició no puede darse por terminada."""
    with pytest.raises(HTTPException) as exc:
        validar_cierre_permitido(_tarea("pendiente"))
    assert exc.value.status_code == 400


def test_no_se_finaliza_una_tarea_cancelada():
    with pytest.raises(HTTPException) as exc:
        validar_cierre_permitido(_tarea("cancelado"))
    assert exc.value.status_code == 400


def test_se_finaliza_una_tarea_en_progreso():
    validar_cierre_permitido(_tarea("en_progreso"))  # no lanza


def test_cerrar_dos_veces_es_inofensivo():
    """
    El frontend reintenta el cierre si la primera respuesta se pierde; volver a
    cerrar una tarea ya completada no puede ser un error.
    """
    validar_cierre_permitido(_tarea("completado"))  # no lanza


# ─── 3. Inventario: estados y cantidades ─────────────────────────────────────

@pytest.mark.parametrize("estado", ["libre", "asignada", "ROTO", "", "cualquier cosa"])
def test_estado_de_herramienta_invalido_se_rechaza(estado):
    """
    Era texto libre. Con un estado inventado se podía dejar el inventario en
    un estado que ningún endpoint sabe interpretar.
    """
    with pytest.raises(ValidationError):
        ActivoUpdateRequest(estado=estado)


@pytest.mark.parametrize("estado", ESTADOS_HERRAMIENTA)
def test_estados_de_herramienta_validos_se_aceptan(estado):
    assert ActivoUpdateRequest(estado=estado).estado == estado


@pytest.mark.parametrize("estado", ESTADOS_VEHICULO)
def test_estados_de_vehiculo_validos_se_aceptan(estado):
    assert ActivoUpdateRequest(estado_vehiculo=estado).estado_vehiculo == estado


def test_estado_de_vehiculo_invalido_se_rechaza():
    with pytest.raises(ValidationError):
        ActivoUpdateRequest(estado_vehiculo="prestado")


def test_estado_se_normaliza_a_minusculas():
    assert ActivoUpdateRequest(estado="DISPONIBLE").estado == "disponible"


@pytest.mark.parametrize("campo", ["cantidad_disponible", "stock_minimo"])
def test_stock_negativo_se_rechaza(campo):
    """Se podía dejar un material en -500 unidades."""
    with pytest.raises(ValidationError):
        ActivoUpdateRequest(**{campo: -1})
    with pytest.raises(ValidationError):
        MaterialCreate(nombre_activo="Cable", **{campo: -1})


def test_stock_cero_es_valido():
    """Cero es legítimo: significa agotado, no un dato inválido."""
    assert MaterialCreate(nombre_activo="Cable", cantidad_disponible=0).cantidad_disponible == 0


def test_capacidad_negativa_se_rechaza():
    with pytest.raises(ValidationError):
        CarroCreate(nombre_activo="Camioneta", placa="P-123", capacidad=-2)


# ─── 4. Cálculo de la jornada ────────────────────────────────────────────────
#
# El endpoint de salida ahora cierra también las pausas abiertas. Estas pruebas
# fijan el comportamiento del cálculo para que el arreglo tenga sentido.

def _jornada(entrada, salida=None):
    return SimpleNamespace(hora_entrada=entrada, hora_salida=salida)


def _pausa(inicio, fin=None, id_descanso=1):
    return SimpleNamespace(id_descanso=id_descanso, hora_inicio=inicio, hora_fin=fin)


def test_jornada_simple_descuenta_la_pausa():
    resumen = calcular_jornada(
        _jornada(time(8, 0), time(17, 0)),
        [_pausa(time(12, 0), time(13, 0))],
    )
    assert resumen.minutos_brutos == 9 * 60
    assert resumen.minutos_pausa == 60
    assert resumen.minutos_trabajados == 8 * 60


def test_pausa_cerrada_junto_con_la_jornada_no_desborda():
    """
    Una pausa cerrada a la misma hora que la salida dura desde su inicio hasta
    esa hora. Es lo que hace ahora el endpoint de salida con las pausas que
    quedaron en curso.
    """
    resumen = calcular_jornada(
        _jornada(time(8, 0), time(17, 0)),
        [_pausa(time(16, 0), time(17, 0))],
    )
    assert resumen.minutos_pausa == 60
    assert resumen.minutos_trabajados == 8 * 60


def test_turno_nocturno_no_da_tiempo_negativo():
    """Entrada 22:00, salida 02:00 → 4 horas, no -20."""
    resumen = calcular_jornada(_jornada(time(22, 0), time(2, 0)))
    assert resumen.minutos_brutos == 4 * 60
    assert resumen.minutos_trabajados == 4 * 60


def test_jornada_abierta_sin_referencia_no_inventa_tiempo():
    resumen = calcular_jornada(_jornada(time(8, 0), None))
    assert resumen.minutos_brutos == 0
    assert resumen.jornada_activa is True


def test_las_pausas_nunca_superan_la_jornada():
    """Con datos inconsistentes el resultado se recorta, nunca es negativo."""
    resumen = calcular_jornada(
        _jornada(time(8, 0), time(9, 0)),
        [_pausa(time(8, 0), time(15, 0))],
    )
    assert resumen.minutos_trabajados == 0
    assert resumen.minutos_trabajados >= 0


# ─── 5. La autoría del trabajo no se puede reescribir ────────────────────────
#
# La evidencia no guarda quién la registró: se deduce de quién tiene la tarea
# asignada. Eso funciona mientras el técnico de una tarea cerrada no pueda
# cambiar — si cambia, el trabajo de una persona pasa a figurar a nombre de
# otra sin ningún rastro.

def test_los_dos_caminos_de_reasignacion_usan_la_misma_regla():
    """
    `PATCH /tareas/{id}` y `PATCH /tareas/{id}/reasignar` hacen lo mismo. El
    segundo bloqueaba las tareas cerradas y el primero no, así que bastaba con
    usar el otro endpoint para saltarse la regla.
    """
    import inspect

    from app.routers import tareas

    fuente_patch = inspect.getsource(tareas.update_tarea)
    fuente_reasignar = inspect.getsource(tareas.reasignar_tarea)

    # Ambos consultan los estados cerrados antes de tocar la asignación.
    assert "ESTADOS_TAREA_CERRADOS" in fuente_patch
    assert "completado" in fuente_reasignar or "ESTADOS_TAREA_CERRADOS" in fuente_reasignar
