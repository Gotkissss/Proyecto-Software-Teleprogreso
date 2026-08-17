"""
Schemas de respuesta del modulo de Reportes — Teleprogreso S.A.
"""

from datetime import date

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
    jornadas_abiertas: int = 0
    minutos_trabajados: int = 0
    minutos_pausa: int = 0
    horas_trabajadas: str = "00:00"
    horas_pausa: str = "00:00"


class ReporteAsistenciaResponse(RangoReporte):
    """Reporte agregado de asistencia para el rango solicitado."""

    total_empleados: int = 0
    total_jornadas: int = 0
    total_minutos_trabajados: int = 0
    total_minutos_pausa: int = 0
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
