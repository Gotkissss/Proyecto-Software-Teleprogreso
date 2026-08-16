"""
Router de Reportes — Teleprogreso S.A.

Expone datos agregados por rango de fechas para gerencia. La descarga Excel
tambien admite al supervisor para el acceso rapido desde su dashboard.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin_supervisor_gerente, require_gerente
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.reporte import (
    ReporteAsistenciaResponse,
    ReporteProductividadResponse,
    ReporteTareasCompletadasResponse,
)
from app.services.exportacion_reportes import (
    MIME_XLSX,
    TIPOS_REPORTES_EXPORTABLES,
    generar_excel_reporte,
    nombre_archivo_reporte,
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
TecnicoFiltro = Annotated[
    int | None,
    Query(
        ge=1,
        description="ID del técnico a incluir en el reporte.",
    ),
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
    tecnico: TecnicoFiltro = None,
):
    """Devuelve tareas completadas por técnico dentro del rango."""
    _validar_rango(fecha_inicio, fecha_fin)
    return await obtener_reporte_tareas_completadas(
        db,
        fecha_inicio,
        fecha_fin,
        id_tecnico=tecnico,
    )


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
    tecnico: TecnicoFiltro = None,
):
    """Calcula tareas por hora trabajada para cada técnico."""
    _validar_rango(fecha_inicio, fecha_fin)
    return await obtener_reporte_productividad(
        db,
        fecha_inicio,
        fecha_fin,
        id_tecnico=tecnico,
    )


@router.get(
    "/{tipo}/exportar",
    response_class=Response,
    summary="Exportar un reporte a Excel",
)
async def exportar_reporte(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[
        Empleado,
        Depends(require_admin_supervisor_gerente),
    ],
    tipo: str,
    fecha_inicio: FechaInicio,
    fecha_fin: FechaFin,
    empleado: Annotated[
        int | None,
        Query(
            ge=1,
            description="Filtro para el reporte de asistencia.",
        ),
    ] = None,
    tecnico: TecnicoFiltro = None,
):
    """Genera un archivo XLSX con los datos agregados del reporte solicitado."""
    if tipo not in TIPOS_REPORTES_EXPORTABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Tipo de reporte no válido. Valores permitidos: "
                f"{', '.join(TIPOS_REPORTES_EXPORTABLES)}."
            ),
        )

    _validar_rango(fecha_inicio, fecha_fin)

    if tipo == "asistencia":
        if tecnico is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "El reporte de asistencia usa el filtro 'empleado', "
                    "no 'tecnico'."
                ),
            )
        reporte = await obtener_reporte_asistencia(
            db,
            fecha_inicio,
            fecha_fin,
            id_empleado=empleado,
        )
    else:
        if empleado is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"El reporte '{tipo}' usa el filtro 'tecnico', "
                    "no 'empleado'."
                ),
            )

        if tipo == "tareas-completadas":
            reporte = await obtener_reporte_tareas_completadas(
                db,
                fecha_inicio,
                fecha_fin,
                id_tecnico=tecnico,
            )
        else:
            reporte = await obtener_reporte_productividad(
                db,
                fecha_inicio,
                fecha_fin,
                id_tecnico=tecnico,
            )

    contenido = generar_excel_reporte(tipo, reporte)
    nombre_archivo = nombre_archivo_reporte(tipo, fecha_inicio, fecha_fin)

    return Response(
        content=contenido,
        media_type=MIME_XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="{nombre_archivo}"',
        },
    )
