"""
Router de la bitácora de auditoría (HU-S9-03) — Teleprogreso S.A.

Solo admin. Gerente y supervisor reciben 403 (y ese 403 también queda en la
bitácora). La consulta y la exportación cuentan como lecturas sensibles: quién
revisó la bitácora queda registrado en ella.
"""
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import auditar_lectura, require_admin
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.auditoria import (
    BitacoraListResponse,
    CatalogosBitacoraResponse,
    VerificacionBitacoraResponse,
)
from app.services import auditoria as auditoria_service
from app.services.auditoria import FiltrosBitacora
from app.services.exportacion_reportes import MIME_XLSX

router = APIRouter(prefix="/auditoria", tags=["Auditoría"])


def filtros_bitacora(
    actor: Annotated[Optional[int], Query(ge=1, description="ID del empleado que actuó.")] = None,
    rol: Annotated[
        Optional[str],
        Query(max_length=20, description="Rol del actor en ese momento (incluye 'sistema')."),
    ] = None,
    accion: Annotated[Optional[str], Query(max_length=50)] = None,
    entidad: Annotated[Optional[str], Query(max_length=50)] = None,
    id_entidad: Annotated[Optional[int], Query(ge=1)] = None,
    request_id: Annotated[Optional[str], Query(max_length=64)] = None,
    fecha_inicio: Annotated[
        Optional[date], Query(description="Día inicial (YYYY-MM-DD, hora local), inclusive.")
    ] = None,
    fecha_fin: Annotated[
        Optional[date], Query(description="Día final (YYYY-MM-DD, hora local), inclusive.")
    ] = None,
) -> FiltrosBitacora:
    return FiltrosBitacora(
        id_actor=actor,
        rol_actor=rol,
        accion=accion,
        entidad=entidad,
        id_entidad=id_entidad,
        request_id=request_id,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )


@router.get(
    "",
    dependencies=[auditar_lectura("bitacora")],
    response_model=BitacoraListResponse,
    summary="Consultar la bitácora de auditoría",
    status_code=status.HTTP_200_OK,
)
async def get_bitacora(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin)],
    filtros: Annotated[FiltrosBitacora, Depends(filtros_bitacora)],
    page: int = Query(1, ge=1, description="Página solicitada (empieza en 1)."),
    page_size: int = Query(20, ge=1, le=100, description="Filas por página."),
):
    """
    Acciones registradas, de la más reciente a la más antigua, con filtros por
    actor, rol, acción, entidad, id de entidad, request_id y rango de días.
    Paginación con `page` y `page_size`, como `/asistencia/historial`.
    """
    total, total_pages, items = await auditoria_service.listar(db, filtros, page, page_size)
    return BitacoraListResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items,
    )


@router.get(
    "/catalogos",
    response_model=CatalogosBitacoraResponse,
    summary="Acciones, entidades y roles presentes en la bitácora",
)
async def get_catalogos(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin)],
):
    return await auditoria_service.catalogos(db)


@router.get(
    "/verificacion",
    response_model=VerificacionBitacoraResponse,
    summary="Verificar la cadena de hashes y la protección de la bitácora",
)
async def get_verificacion(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin)],
):
    """
    Recorre la cadena completa (en la base) y dice si está íntegra o en qué
    fila se rompió, y si la conexión del backend podría alterarla.
    """
    return await auditoria_service.verificar(db)


@router.get(
    "/exportar",
    dependencies=[auditar_lectura("bitacora")],
    response_class=Response,
    summary="Exportar la bitácora filtrada a Excel",
)
async def exportar_bitacora(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin)],
    filtros: Annotated[FiltrosBitacora, Depends(filtros_bitacora)],
):
    """Mismos filtros y mismo rol que `GET /auditoria`; todas las filas, no una página."""
    contenido = await auditoria_service.exportar(db, filtros)
    return Response(
        content=contenido,
        media_type=MIME_XLSX,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{auditoria_service.nombre_archivo(filtros)}"'
            ),
        },
    )
