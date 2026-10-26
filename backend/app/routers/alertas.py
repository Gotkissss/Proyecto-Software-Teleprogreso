"""Endpoints para consultar y actualizar alertas persistentes."""

import logging
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin_supervisor_gerente, require_supervisor
from app.core.reglas import ROL_ADMIN
from app.db.session import get_db
from app.models.alerta import Alerta
from app.models.empleado import Empleado
from app.schemas.alerta import AlertaResponse, AlertaUpdate
from app.services.alertas import (
    PREFIJO_SEGURIDAD,
    describir_referencias,
    es_alerta_seguridad,
    generar_alertas,
)
from app.services.alertas_seguridad import generar_alertas_seguridad
from app.services.bitacora import fallos_auditoria

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alertas", tags=["Alertas"])


@router.get(
    "",
    response_model=List[AlertaResponse],
    summary="Listar alertas persistentes",
    status_code=status.HTTP_200_OK,
)
async def get_alertas(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    # Lectura abierta a los tres roles administrativos: el gerente entra al
    # mismo panel que el supervisor y antes recibía 403 al abrir Alertas.
    current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
    tipo: Optional[str] = Query(None, max_length=50),
    severidad: Optional[str] = Query(None, max_length=20),
    estado: Optional[str] = Query(None, max_length=20),
    generar: bool = Query(
        True,
        description="Si es false solo lista lo persistido, sin ejecutar la "
                    "detección. Lo usa el badge del layout para no escribir "
                    "en cada polling.",
    ),
):
    """Genera alertas nuevas y luego lista las persistidas."""
    # Se lee antes de generar: si la generación falla y hace rollback, el
    # empleado queda expirado y leer su rol después intentaría recargarlo.
    es_admin = current_user.rol == ROL_ADMIN

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
        # HU-S10-05: las reglas de seguridad corren aparte para que un fallo
        # de unas no se lleve a las otras. Desde aquí, el proceso del backend,
        # se miran además el contador de fallos de auditoría y la conexión,
        # que el comando programado no puede ver. La cadena entera de la
        # bitácora no: recorrerla en cada visita a la pantalla es caro y ya la
        # revisa `mantenimiento.py alertas`.
        try:
            await generar_alertas_seguridad(
                db, fallos=fallos_auditoria(), revisar_conexion=True
            )
        except Exception:
            logger.exception("Fallo la generación de alertas de seguridad")
            await db.rollback()

    query = select(Alerta).order_by(Alerta.fecha.desc())

    # Las alertas de seguridad hablan de cuentas, IPs y la propia bitácora:
    # solo las ve el admin, igual que la bitácora.
    if not es_admin:
        query = query.where(~Alerta.tipo.startswith(PREFIJO_SEGURIDAD, autoescape=True))

    if tipo:
        query = query.where(Alerta.tipo == tipo)
    if severidad:
        query = query.where(Alerta.severidad == severidad)
    if estado:
        query = query.where(Alerta.estado == estado)

    result = await db.execute(query)
    alertas = result.scalars().all()

    # Se resuelve el nombre de lo referenciado para que la pantalla pueda
    # decir "Cambio de poste dañado" en lugar de "tarea #7".
    etiquetas = await describir_referencias(db, list(alertas))

    return [
        AlertaResponse(
            id_alerta=alerta.id_alerta,
            tipo=alerta.tipo,
            severidad=alerta.severidad,
            estado=alerta.estado,
            referencia=alerta.referencia,
            referencia_label=etiquetas.get(alerta.referencia or ""),
            fecha=alerta.fecha,
        )
        for alerta in alertas
    ]


@router.patch(
    "/{id}",
    response_model=AlertaResponse,
    summary="Atender o descartar una alerta",
    status_code=status.HTTP_200_OK,
)
async def update_alerta(
    id: int,
    data: AlertaUpdate,
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """Actualiza el estado de una alerta persistente."""
    result = await db.execute(select(Alerta).where(Alerta.id_alerta == id))
    alerta = result.scalar_one_or_none()

    # Para quien no es admin una alerta de seguridad no existe: 404 igual que
    # un id inventado, para no confirmar que hay una.
    if alerta is not None and es_alerta_seguridad(alerta.tipo) and current_user.rol != ROL_ADMIN:
        alerta = None

    if alerta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alerta con id={id} no encontrada.",
        )

    alerta.estado = data.estado.value

    # Se devuelve con la etiqueta ya resuelta: el frontend fusiona esta
    # respuesta en su lista y, sin ella, la tarjeta perdía el nombre y volvía
    # a mostrar el id crudo justo después de atender la alerta.
    etiquetas = await describir_referencias(db, [alerta])

    return AlertaResponse(
        id_alerta=alerta.id_alerta,
        tipo=alerta.tipo,
        severidad=alerta.severidad,
        estado=alerta.estado,
        referencia=alerta.referencia,
        referencia_label=etiquetas.get(alerta.referencia or ""),
        fecha=alerta.fecha,
    )
