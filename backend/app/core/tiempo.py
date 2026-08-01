# backend/app/core/tiempo.py
"""
Hora local de la operación — Teleprogreso S.A.
-----------------------------------------------------------------------------
El contenedor de Railway corre en UTC, pero la empresa opera en Guatemala
(UTC-6). Usar `datetime.now()` directamente mezcla dos relojes distintos y
produce fallos que solo aparecen a ciertas horas del día:

  - Una tarea cerrada a las 19:00 de Guatemala se guardaba con fecha del día
    SIGUIENTE (01:00 UTC). El historial la buscaba dentro del rango de "hoy"
    que manda el navegador (fecha de Guatemala) y no la encontraba: la
    pantalla de tareas realizadas salía vacía justo cuando más se usaba.
  - `date.today()` cambiaba de día a las 18:00 hora local, así que las
    métricas del panel y la ruta diaria se reiniciaban esa misma tarde.
  - Las horas de entrada y de pausa se mostraban 6 horas adelantadas.

Todo el código de negocio debe pedir la hora a este módulo en lugar de a
`datetime` directamente. La zona es configurable con la variable de entorno
`TIMEZONE` por si la operación cambia de país.
-----------------------------------------------------------------------------
"""

from datetime import date, datetime, time, timedelta, timezone, tzinfo

from app.core.config import settings

# Respaldo si la imagen no trae la base de datos de zonas horarias (las
# imágenes `-slim` de Python a veces vienen sin tzdata). -6 es Guatemala, que
# no aplica horario de verano, así que el offset fijo es exacto todo el año.
_OFFSET_RESPALDO = timezone(timedelta(hours=-6))


def _zona() -> tzinfo:
    """Zona horaria configurada, con respaldo a UTC-6 si no está disponible."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(settings.TIMEZONE)
    except Exception:
        # Ni se levanta una excepción ni se cae la app: una zona horaria mal
        # escrita en el .env no debe tumbar el servicio entero.
        return _OFFSET_RESPALDO


def ahora() -> datetime:
    """
    Fecha y hora actuales en la zona de la operación, **sin** tzinfo.

    Se devuelve naive a propósito: las columnas de la base de datos son
    `DateTime` y `Time` sin zona, así que mezclar valores aware y naive
    reventaría las comparaciones de SQLAlchemy. Lo que importa es que el
    valor guardado represente la hora local de Guatemala.
    """
    return datetime.now(_zona()).replace(tzinfo=None)


def hoy() -> date:
    """Fecha de hoy en la zona de la operación."""
    return ahora().date()


def hora_actual() -> time:
    """Hora del día en la zona de la operación."""
    return ahora().time()
