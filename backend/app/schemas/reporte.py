"""
Schemas de respuesta del modulo de Reportes — Teleprogreso S.A.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class RangoReporte(BaseModel):
    """Rango inclusivo utilizado para generar un reporte."""

    fecha_inicio: date
    fecha_fin: date


class AsistenciaEmpleado(BaseModel):
    """Totales de asistencia acumulados para un empleado."""

    id_empleado: int
    nombre_empleado: str
    jornadas: int = 0
    # Jornadas que en el rango quedaron con entrada pero sin salida marcada.
    jornadas_abiertas: int = 0
    minutos_trabajados: int = 0
    minutos_pausa: int = 0
    # Cuantas pausas tomo en total, no solo cuanto tiempo estuvo en ellas.
    descansos: int = 0
    horas_trabajadas: str = "00:00"
    horas_pausa: str = "00:00"


class ReporteAsistenciaResponse(RangoReporte):
    """Reporte agregado de asistencia para el rango solicitado."""

    total_empleados: int = 0
    total_jornadas: int = 0
    total_jornadas_abiertas: int = 0
    total_minutos_trabajados: int = 0
    total_minutos_pausa: int = 0
    total_descansos: int = 0
    total_horas_trabajadas: str = "00:00"
    total_horas_pausa: str = "00:00"
    items: list[AsistenciaEmpleado] = Field(default_factory=list)


class TareasCompletadasEmpleado(BaseModel):
    """Cantidad de tareas completadas por un empleado."""

    id_empleado: int
    nombre_empleado: str
    tareas_completadas: int = 0


class ReporteTareasCompletadasResponse(RangoReporte):
    """Reporte agregado de tareas completadas para el rango solicitado."""

    total_empleados: int = 0
    total_tareas_completadas: int = 0
    items: list[TareasCompletadasEmpleado] = Field(default_factory=list)


class ProductividadEmpleado(BaseModel):
    """Productividad de un empleado basada en tareas por hora trabajada."""

    id_empleado: int
    nombre_empleado: str
    jornadas: int = 0
    minutos_trabajados: int = 0
    horas_trabajadas: str = "00:00"
    tareas_completadas: int = 0
    tareas_por_hora: float = 0.0


class ReporteProductividadResponse(RangoReporte):
    """Reporte de productividad por empleado para el rango solicitado."""

    total_empleados: int = 0
    total_jornadas: int = 0
    total_minutos_trabajados: int = 0
    total_horas_trabajadas: str = "00:00"
    total_tareas_completadas: int = 0
    tareas_por_hora: float = 0.0
    items: list[ProductividadEmpleado] = Field(default_factory=list)


# ─── Resumen operativo ───────────────────────────────────────────────────────
# Los tres reportes anteriores contestan una pregunta cada uno, y para armar
# la foto de un empleado habia que descargar los tres y cruzarlos a mano. Este
# junta en una sola fila lo que se pregunta de una persona en un periodo:
# cuanto trabajo, cuanto descanso y cuanto cerro.

class ResumenEmpleado(BaseModel):
    """Todo lo que el rango dice de un empleado, en una sola fila."""

    id_empleado: int
    nombre_empleado: str
    jornadas: int = 0
    jornadas_abiertas: int = 0
    minutos_trabajados: int = 0
    horas_trabajadas: str = "00:00"
    descansos: int = 0
    minutos_descanso: int = 0
    horas_descanso: str = "00:00"
    tareas_completadas: int = 0
    tareas_por_hora: float = 0.0


class ReporteResumenResponse(RangoReporte):
    """Resumen operativo por empleado para el rango solicitado."""

    total_empleados: int = 0
    total_jornadas: int = 0
    total_jornadas_abiertas: int = 0
    total_minutos_trabajados: int = 0
    total_horas_trabajadas: str = "00:00"
    total_descansos: int = 0
    total_minutos_descanso: int = 0
    total_horas_descanso: str = "00:00"
    total_tareas_completadas: int = 0
    tareas_por_hora: float = 0.0
    items: list[ResumenEmpleado] = Field(default_factory=list)


# ─── Serie temporal (HU-S9-04) ───────────────────────────────────────────────
# Los cuatro reportes anteriores agregan sobre todo el rango: dicen cuánto,
# no cómo evolucionó. La serie reparte una métrica por día o por semana.

class PuntoSerie(BaseModel):
    """Un periodo de la serie: sus días (inclusivos) y el valor de la métrica."""

    inicio: date
    fin: date
    valor: float = 0.0


class ReporteSerieResponse(RangoReporte):
    """
    Evolución de una métrica en el rango.

    - `horas`: horas efectivamente trabajadas (sin pausas), por fecha de jornada.
    - `tareas`: tareas cerradas, por día de cierre (cada tarea cuenta una vez).
    - `pausas`: minutos en pausa, por fecha de jornada.
    """

    metrica: Literal["horas", "tareas", "pausas"]
    agrupar: Literal["dia", "semana"]
    unidad: Literal["horas", "tareas", "minutos"]
    id_empleado: int | None = None
    total: float = 0.0
    puntos: list[PuntoSerie] = Field(default_factory=list)
