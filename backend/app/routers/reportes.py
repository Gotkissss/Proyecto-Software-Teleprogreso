"""
Router de Reportes — Teleprogreso S.A.

Expone datos agregados por rango de fechas para gerencia. La exportacion de
estos datos se implementara por separado.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_gerente
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.reporte import (
    ReporteAsistenciaResponse,
    ReporteProductividadResponse,
    ReporteTareasCompletadasResponse,
)
from app.services.reportes import (
    obtener_reporte_asistencia,
    obtener_reporte_productividad,
    obtener_reporte_tareas_completadas,
)

router = APIRouter(prefix="/reportes", tags=["Reportes"])

FechaInicio = Annotated[
    date,
    Query(description="Fecha inicial del reporte (YYYY-MM-DD), inclusive."),
]
FechaFin = Annotated[
    date,
    Query(description="Fecha final del reporte (YYYY-MM-DD), inclusive."),
]


def _validar_rango(fecha_inicio: date, fecha_fin: date) -> None:
    if fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha de inicio no puede ser posterior a la fecha de fin.",
        )


@router.get(
    "/asistencia",
    response_model=ReporteAsistenciaResponse,
    summary="Reporte agregado de asistencia",
)
async def get_reporte_asistencia(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_gerente)],
    fecha_inicio: FechaInicio,
    fecha_fin: FechaFin,
    empleado: Annotated[
        int | None,
        Query(
            ge=1,
            description="ID del empleado a incluir en el reporte.",
        ),
    ] = None,
):
    """Devuelve jornadas y tiempo trabajado, con filtro opcional por empleado."""
    _validar_rango(fecha_inicio, fecha_fin)
    return await obtener_reporte_asistencia(
        db,
        fecha_inicio,
        fecha_fin,
        id_empleado=empleado,
    )


@router.get(
    "/tareas-completadas",
    response_model=ReporteTareasCompletadasResponse,
    summary="Reporte agregado de tareas completadas",
)
async def get_reporte_tareas_completadas(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_gerente)],
    fecha_inicio: FechaInicio,
    fecha_fin: FechaFin,
):
    """Devuelve las tareas completadas por empleado dentro del rango."""
    _validar_rango(fecha_inicio, fecha_fin)
    return await obtener_reporte_tareas_completadas(db, fecha_inicio, fecha_fin)


@router.get(
    "/productividad",
    response_model=ReporteProductividadResponse,
    summary="Reporte agregado de productividad",
)
async def get_reporte_productividad(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_gerente)],
    fecha_inicio: FechaInicio,
    fecha_fin: FechaFin,
):
    """Calcula tareas completadas por hora trabajada para cada empleado."""
    _validar_rango(fecha_inicio, fecha_fin)
    return await obtener_reporte_productividad(db, fecha_inicio, fecha_fin)
