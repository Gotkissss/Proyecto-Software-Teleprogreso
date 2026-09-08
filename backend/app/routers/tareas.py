# backend/app/routers/tareas.py
"""
Router de Tareas — Teleprogreso S.A.
-------
Este archivo define el contrato HTTP del ciclo de vida de las tareas/órdenes
de servicio. Las consultas y reglas de negocio viven en app/services/tareas.py.

Se tiene el siguiente control de acceso por rol:
  - GET    /tareas/                   = todos los autenticados
  - GET    /tareas/mapa-supervisor    = admin, supervisor, gerente
  - POST   /tareas/                   = admin, supervisor
  - PATCH  /tareas/{id}/estado        = admin, supervisor
  - PATCH  /tareas/{id}/reasignar     = admin, supervisor
  - PATCH  /tareas/{id}/iniciar       = tecnico, admin, supervisor

Requiere token JWT válido en Authorization: Bearer <token>.
"""

from datetime import date
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_current_empleado,
    require_admin_supervisor_gerente,
    require_supervisor,
    require_tecnico,
)
from app.core.reglas import ESTADOS_TAREA_ACTIVOS, LIMITE_TAREAS_ACTIVAS
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.tarea import (
    HistorialTareasResponse,
    TareaCreate,
    TareaMapaSupervisorResponse,
    TareaReasignar,
    TareaResponse,
    TareaRutaResponse,
    TareaUpdate,
    TareaUpdateEstado,
)
from app.services import tareas as tareas_service

router = APIRouter(prefix="/tareas", tags=["Tareas"])

# Se conservan como referencias del router para compatibilidad con los módulos
# que verifican que las reglas compartidas provengan de app/core/reglas.py.
ESTADOS_ACTIVOS = ESTADOS_TAREA_ACTIVOS


@router.get(
    "",
    response_model=List[TareaResponse],
    summary="Listar tareas",
    status_code=status.HTTP_200_OK,
)
async def get_tareas(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
    estado: Annotated[Optional[str], Query()] = None,
    id_tecnico: Annotated[Optional[int], Query()] = None,
    limite: Annotated[
        int,
        Query(
            ge=1,
            le=2000,
            description="Máximo de tareas devueltas, de la más reciente hacia atrás.",
        ),
    ] = 500,
):
    return await tareas_service.listar_tareas(
        db,
        current_user,
        estado=estado,
        id_tecnico=id_tecnico,
        limite=limite,
    )


@router.get(
    "/mi-ruta",
    response_model=List[TareaRutaResponse],
    summary="Ruta diaria del técnico: tareas de hoy con coordenadas para el mapa",
    status_code=status.HTTP_200_OK,
)
async def get_mi_ruta(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Devuelve las tareas del técnico autenticado que corresponden al mapa de
    HOY, con sus coordenadas (lat/lng) y los datos que el popup del marcador
    necesita.

    Qué entra y qué no lo decide `_filtro_mapa_del_dia`: todo lo que sigue
    abierto, más lo que el técnico cerró hoy. Una tarea completada ayer ya no
    aparece — vive en el historial, no en el mapa del día.

    "Hoy" se calcula con la hora de Guatemala (hoy_local), no en UTC.
    """
    return await tareas_service.obtener_mi_ruta(db, current_user)


@router.get(
    "/mapa-supervisor",
    response_model=List[TareaMapaSupervisorResponse],
    summary="Mapa de tareas de un dia, con tecnico asignado, para el supervisor",
    status_code=status.HTTP_200_OK,
)
async def get_mapa_supervisor(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
    fecha: Annotated[Optional[date], Query()] = None,
    id_tecnico: Annotated[Optional[int], Query()] = None,
):
    """
    Devuelve las tareas que corresponden al mapa de una fecha (hoy en hora de
    Guatemala por defecto), con sus coordenadas y el técnico asignado, para que
    el supervisor las pinte agrupadas por técnico.

    Filtros:
    - fecha: qué día se está mirando. En el día de HOY entra todo el trabajo
      abierto del equipo —sin importar si su fecha planificada ya venció o
      todavía no llega— más lo que se cerró hoy. En un día pasado entra solo lo
      que se cerró ese día. El detalle está en `_filtro_mapa_del_dia`.
    - id_tecnico: si se envía, solo devuelve las tareas de ese técnico.

    Roles: admin | supervisor | gerente.
    """
    return await tareas_service.obtener_mapa_supervisor(
        db,
        fecha=fecha,
        id_tecnico=id_tecnico,
    )


@router.post(
    "",
    response_model=TareaResponse,
    summary="Crear nueva tarea",
    status_code=status.HTTP_201_CREATED,
)
async def create_tarea(
    tarea: TareaCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Crea una nueva tarea y opcionalmente la asigna a un técnico.

    Reglas de negocio (Historia 5):
    - Si se indica id_tecnico, se verifica que ese técnico tenga menos de
      LIMITE_TAREAS_ACTIVAS tareas en estado 'pendiente' o 'en_progreso'
      (el valor vive en app/core/reglas.py).
    - Si el límite se supera, se devuelve HTTP 400 con mensaje claro para
      que el frontend lo muestre al supervisor.
    - Si se envía ubicación, lat y lng deben formar una coordenada válida.

    Roles: admin, supervisor.
    """
    return await tareas_service.crear_tarea(db, tarea)


@router.patch(
    "/{id}",
    response_model=TareaResponse,
    summary="Editar una tarea existente",
    status_code=status.HTTP_200_OK,
)
async def update_tarea(
    id: int,
    data: TareaUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Edición parcial de una tarea ya creada. Solo se modifican los campos
    enviados en el body.

    Campos editables: nombre (título), descripción, dirección, prioridad,
    estado, fecha_inicio, fecha_finalizacion, id_tecnico, lat y lng.

    Reglas de negocio:
    - Cambiar el técnico respeta el límite de LIMITE_TAREAS_ACTIVAS tareas
      activas, sin contar esta misma tarea.
    - Reabrir una tarea cerrada vuelve a comprobar ese mismo límite.
    - Enviar `id_tecnico: null` desasigna la tarea.
    - Enviar `lat` y `lng` actualiza la ubicación; ambos en null la elimina.
    - Al pasar a 'en_progreso' sin fecha_inicio se registra la fecha de hoy.

    Roles: admin, supervisor.
    """
    return await tareas_service.editar_tarea(db, id, data)


@router.patch(
    "/{id}/estado",
    response_model=TareaResponse,
    summary="Actualizar estado de una tarea",
    status_code=status.HTTP_200_OK,
)
async def update_estado(
    id: int,
    data: TareaUpdateEstado,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Cambia el estado de una tarea existente.

    - Solo roles admin y supervisor pueden actualizar el estado.
    - Estados válidos: pendiente, en_progreso, completado, cancelado.
    """
    return await tareas_service.actualizar_estado(db, id, data)


@router.patch(
    "/{id}/reasignar",
    response_model=TareaResponse,
    summary="Reasignar tarea a otro técnico",
    status_code=status.HTTP_200_OK,
)
async def reasignar_tarea(
    id: int,
    data: TareaReasignar,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Reasigna una tarea a un técnico diferente.

    - Solo tareas abiertas: una tarea completada o cancelada ya no se mueve.
    - Valida que el nuevo técnico no supere el límite de tareas activas.
    - Elimina todas las asignaciones previas de la tarea.
    - Crea una nueva asignación con el técnico indicado.
    """
    return await tareas_service.reasignar_tarea(db, id, data)


@router.patch(
    "/{id}/iniciar",
    summary="Iniciar una tarea asignada",
    status_code=status.HTTP_200_OK,
)
async def iniciar_tarea(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(require_tecnico)],
):
    """
    Marca el inicio de una tarea por parte del técnico asignado.

    - Solo el técnico asignado a la tarea puede iniciarla (o admin/supervisor).
    - Verifica que el empleado autenticado esté asignado a la tarea.
    - Registra la fecha de inicio actual.
    """
    return await tareas_service.iniciar_tarea(db, id, current_user)


@router.patch(
    "/{id}/finalizar",
    response_model=TareaResponse,
    summary="Finalizar una tarea asignada (técnico)",
    status_code=status.HTTP_200_OK,
)
async def finalizar_tarea(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(require_tecnico)],
):
    """
    Cierra una tarea y deja marcado el momento exacto del cierre.

    Existe como endpoint propio porque el cierre venía viajando como un flag
    dentro del upload multipart de la foto de evidencia: si ese flag se perdía
    (proxy, reintento, timeout de la subida) la evidencia quedaba guardada
    pero la tarea seguía "en progreso" en el panel del supervisor. Ahora el
    frontend confirma el cierre con esta llamada, que es idempotente.

    Reglas:
    - Solo el técnico asignado puede finalizar (admin/supervisor pasan igual).
    - Requiere al menos una evidencia registrada en la tarea.
    - La tarea debe estar en curso: una 'pendiente' hay que iniciarla primero.
    - Una tarea cancelada no puede completarse.

    Roles: técnico asignado, admin, supervisor.
    """
    return await tareas_service.finalizar_tarea(db, id, current_user)


@router.get(
    "/completadas",
    response_model=HistorialTareasResponse,
    summary="Historial de tareas completadas, agrupado por día",
    status_code=status.HTTP_200_OK,
)
async def get_tareas_completadas(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
    fecha_desde: Optional[date] = Query(
        None, description="Fecha mínima (YYYY-MM-DD). Por defecto, hace 7 días."
    ),
    fecha_hasta: Optional[date] = Query(
        None, description="Fecha máxima (YYYY-MM-DD). Por defecto, hoy."
    ),
    id_tecnico: Optional[int] = Query(
        None,
        description="Filtrar por técnico. Los técnicos solo pueden verse a sí mismos.",
    ),
):
    """
    Devuelve lo que realmente se cerró en un rango de fechas, agrupado por día
    y con las evidencias de cada tarea incluidas.

    El corte por día se hace sobre `fecha_completado` (el momento real del
    cierre), no sobre `fecha_finalizacion`, que es la fecha límite pactada.

    Control de acceso:
    - admin, supervisor y gerente ven el historial de todos los técnicos.
    - un técnico solo ve sus propias tareas, aunque mande otro `id_tecnico`.
    """
    return await tareas_service.obtener_tareas_completadas(
        db,
        current_user,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        id_tecnico=id_tecnico,
    )
