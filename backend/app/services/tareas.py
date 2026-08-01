# backend/app/services/tareas.py
"""
Transiciones de estado de una tarea — Teleprogreso S.A.
-----------------------------------------------------------------------------
El cierre de una tarea se dispara desde tres sitios distintos (el upload de la
foto de evidencia, el endpoint /finalizar del técnico y la edición manual del
supervisor). Cuando cada uno hacía su propia asignación de campos era fácil
que uno olvidara marcar `fecha_completado` y la tarea desapareciera del
historial diario.

Estas funciones son puras (no tocan la base de datos, solo mutan el objeto
ORM) para poder probarlas sin PostgreSQL.
-----------------------------------------------------------------------------
"""

from datetime import date, datetime

# Reloj de la operación (America/Guatemala). Con datetime.now() en un
# contenedor UTC, una tarea cerrada a las 19:00 hora local se guardaba con la
# fecha del día siguiente y desaparecía del historial diario.
from app.core.tiempo import ahora, hoy


def marcar_completada(tarea, *, momento: datetime | None = None) -> None:
    """
    Deja la tarea en estado 'completado' con su marca temporal de cierre.

    Es idempotente: si la tarea ya estaba completada se respeta la
    `fecha_completado` original, para que un reintento del técnico no mueva la
    tarea al día de hoy en el historial.

    `fecha_inicio` se rellena si venía vacía, porque una tarea cerrada sin
    fecha de inicio rompe los cálculos de duración del panel.
    """
    momento_cierre = momento or ahora()

    tarea.estado_tarea = "completado"

    if tarea.fecha_completado is None:
        tarea.fecha_completado = momento_cierre

    if tarea.fecha_inicio is None:
        tarea.fecha_inicio = momento_cierre.date()


def marcar_reabierta(tarea) -> None:
    """
    Limpia la marca de cierre cuando una tarea vuelve a un estado abierto.

    Sin esto, una tarea que el supervisor devuelve a 'pendiente' seguiría
    apareciendo en el historial de "hecho" de ese día.
    """
    tarea.fecha_completado = None


def es_de_hoy(momento: datetime | None, hoy_referencia: date | None = None) -> bool:
    """True si `momento` cae en el día indicado (hoy por defecto)."""
    if momento is None:
        return False
    return momento.date() == (hoy_referencia or hoy())
