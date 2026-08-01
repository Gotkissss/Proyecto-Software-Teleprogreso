# backend/tests/test_tiempo_local.py
"""
Pruebas del reloj de la operación.

Contexto: el contenedor de Railway corre en UTC y la empresa opera en
Guatemala (UTC-6). Usar `datetime.now()` directamente producía dos fallos que
solo se veían por la tarde:

  - Una tarea cerrada a las 19:00 hora local se guardaba con la fecha del día
    siguiente, y el historial —que pregunta por el rango de fechas del
    navegador— salía vacío.
  - `date.today()` cambiaba de día a las 18:00 locales, reiniciando las
    métricas del panel y la ruta diaria a media tarde.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.tiempo import _OFFSET_RESPALDO, ahora, hora_actual, hoy
from app.services.tareas import marcar_completada
from app.models.tarea import Tarea


# ─── El reloj local ──────────────────────────────────────────────────────────

def test_ahora_devuelve_un_datetime_naive():
    """
    Las columnas de la BD son DateTime/Time sin zona: devolver un datetime
    con tzinfo haría fallar las comparaciones de SQLAlchemy.
    """
    assert ahora().tzinfo is None


def test_la_hora_local_va_seis_horas_detras_de_utc():
    utc = datetime.now(timezone.utc).replace(tzinfo=None)
    diferencia = utc - ahora()

    # Guatemala no aplica horario de verano: son exactamente 6 horas.
    assert timedelta(hours=5, minutes=59) < diferencia < timedelta(hours=6, minutes=1)


def test_hoy_y_hora_actual_son_coherentes_con_ahora():
    momento = ahora()
    assert hoy() == momento.date()
    # Se comparan solo horas y minutos: entre ambas llamadas pasan microsegundos.
    assert hora_actual().hour == momento.hour


def test_el_respaldo_es_utc_menos_seis():
    """Si la imagen no trae tzdata, el offset fijo debe seguir siendo correcto."""
    assert _OFFSET_RESPALDO.utcoffset(None) == timedelta(hours=-6)


# ─── El efecto sobre el cierre de tareas ─────────────────────────────────────

def test_una_tarea_cerrada_de_noche_queda_en_el_dia_local():
    """
    Regresión del historial vacío: a las 19:00 de Guatemala son las 01:00 UTC
    del día siguiente. La tarea tiene que quedar registrada en el día que el
    técnico vivió, no en el del servidor.
    """
    tarea = Tarea(
        id_tarea=1,
        titulo="Instalación nocturna",
        estado_tarea="en_progreso",
        prioridad="alta",
    )

    marcar_completada(tarea)

    assert tarea.fecha_completado.date() == hoy()


def test_el_cierre_usa_el_mismo_dia_que_el_filtro_del_historial():
    """
    El frontend manda `fecha_hasta` = el día de hoy según el navegador
    (Guatemala) y el backend filtra con `< hasta + 1 día`. Si el cierre se
    guardara en UTC, la tarea de la tarde caería fuera del rango.
    """
    tarea = Tarea(
        id_tarea=2,
        titulo="Reparación de acometida",
        estado_tarea="en_progreso",
        prioridad="media",
    )
    marcar_completada(tarea)

    hasta: date = hoy()
    limite_superior = datetime.combine(hasta + timedelta(days=1), datetime.min.time())
    limite_inferior = datetime.combine(hasta - timedelta(days=6), datetime.min.time())

    assert limite_inferior <= tarea.fecha_completado < limite_superior
