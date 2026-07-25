"""Endpoints para consultar y actualizar alertas persistentes."""

import logging
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin_supervisor_gerente, require_supervisor
from app.db.session import get_db
from app.models.alerta import Alerta
from app.models.empleado import Empleado
from app.schemas.alerta import AlertaResponse, AlertaUpdate
from app.services.alertas import generar_alertas

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alertas", tags=["Alertas"])


@router.get(
    "",
    response_model=List[AlertaResponse],
    summary="Listar alertas persistentes",
    status_code=status.HTTP_200_OK,
)
async def get_alertas(
    db: Annotated[AsyncSession, Depends(get_db)],
    # Lectura abierta a los tres roles administrativos: el gerente entra al
    # mismo panel que el supervisor y antes recibía 403 al abrir Alertas.
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
    tipo: Optional[str] = Query(None),
    severidad: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    generar: bool = Query(
        True,
        description="Si es false solo lista lo persistido, sin ejecutar la "
                    "detección. Lo usa el badge del layout para no escribir "
                    "en cada polling.",
    ),
):
    """Genera alertas nuevas y luego lista las persistidas."""
    # La generación request-driven reemplaza temporalmente a un scheduler
    # mientras el proyecto no tenga un worker de tareas programadas.
    #
    # Va dentro de un try/except a propósito: la detección escribe en la BD y
    # un fallo suyo (dato inconsistente, tabla nueva sin migrar, etc.) no debe
    # tumbar la pantalla de alertas. Si falla, se hace rollback del intento de
    # escritura y se devuelve igualmente lo que ya está persistido.
    if generar:
        try:
            await generar_alertas(db)
        except Exception:
            logger.exception("Fallo la generación automática de alertas")
            await db.rollback()

    query = select(Alerta).order_by(Alerta.fecha.desc())

    if tipo:
        query = query.where(Alerta.tipo == tipo)
    if severidad:
        query = query.where(Alerta.severidad == severidad)
    if estado:
        query = query.where(Alerta.estado == estado)

    result = await db.execute(query)
    return result.scalars().all()


@router.patch(
    "/{id}",
    response_model=AlertaResponse,
    summary="Atender o descartar una alerta",
    status_code=status.HTTP_200_OK,
)
async def update_alerta(
    id: int,
    data: AlertaUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """Actualiza el estado de una alerta persistente."""
    result = await db.execute(select(Alerta).where(Alerta.id_alerta == id))
    alerta = result.scalar_one_or_none()

    if alerta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alerta con id={id} no encontrada.",
        )

    alerta.estado = data.estado.value
    return alerta
