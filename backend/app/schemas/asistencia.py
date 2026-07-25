# backend/app/schemas/asistencia.py
"""
Schemas del modulo de Asistencia — Teleprogreso S.A.
-----------------------------------------------------------------------------
Modelos de respuesta para el historial de jornadas (GET /asistencia/historial).

Cada jornada expone dos vistas de la misma informacion:
  - los minutos crudos (utiles para graficar o recalcular en el frontend)
  - una cadena "HH:MM" ya formateada (util para mostrar en tablas)

Se devuelven ambas para que la UI no tenga que duplicar la logica de formato
y para que cualquier reporte posterior (Excel, PDF) use los mismos numeros.
-----------------------------------------------------------------------------
"""

from datetime import date, time
from typing import List, Optional

from pydantic import BaseModel


class DescansoResumen(BaseModel):
    """Una pausa individual dentro de una jornada."""

    id_descanso: int
    hora_inicio: time
    hora_fin: Optional[time] = None
    minutos: int = 0
    # True mientras el empleado no haya finalizado la pausa.
    en_curso: bool = False

    class Config:
        from_attributes = True


class JornadaResponse(BaseModel):
    """Una jornada de asistencia con sus metricas ya calculadas."""

    id_asistencia: int
    id_empleado: int
    nombre_empleado: str
    rol: str
    fecha: date
    hora_entrada: Optional[time] = None
    hora_salida: Optional[time] = None
    jornada_activa: bool

    # Metricas (en minutos, redondeados hacia abajo)
    minutos_brutos: int = 0        # salida - entrada
    minutos_pausa: int = 0         # suma de todas las pausas
    minutos_trabajados: int = 0    # brutos - pausas (nunca negativo)

    # Mismas metricas formateadas como "HH:MM"
    horas_brutas: str = "00:00"
    horas_pausa: str = "00:00"
    horas_trabajadas: str = "00:00"

    total_pausas: int = 0
    descansos: List[DescansoResumen] = []


class HistorialTotales(BaseModel):
    """Totales acumulados de todo el rango consultado (no solo de la pagina)."""

    jornadas: int = 0
    jornadas_abiertas: int = 0
    minutos_trabajados: int = 0
    minutos_pausa: int = 0
    minutos_brutos: int = 0
    horas_trabajadas: str = "00:00"
    horas_pausa: str = "00:00"
    horas_brutas: str = "00:00"
    promedio_minutos_trabajados: int = 0


class HistorialAsistenciaResponse(BaseModel):
    """Respuesta paginada de GET /asistencia/historial."""

    total: int
    page: int
    page_size: int
    total_pages: int
    totales: HistorialTotales
    items: List[JornadaResponse]
