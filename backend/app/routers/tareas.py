# backend/app/routers/tareas.py
"""
Router de Tareas — Teleprogreso S.A.
-------
Este archivo gestiona el ciclo de vida de las tareas/ordenes de servicio.

Se tiene el siguiente control de acceso por rol:
  - GET    /tareas/                   = admin, supervisor, gerente, tecnico (todos los autenticados)
  - POST   /tareas/                   = admin, supervisor  (solo pueden crear tareas con permisos)
  - PATCH  /tareas/{id}/estado        = admin, supervisor
  - PATCH  /tareas/{id}/reasignar     = admin, supervisor
  - PATCH  /tareas/{id}/iniciar       = tecnico, admin, supervisor (el asignado inicia su tarea)


Requiere token JWT valido en Authorization: Bearer <token>.
"""

from datetime import date
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    get_current_empleado,
    require_roles,
    require_supervisor,
    require_tecnico,
)
from app.db.session import get_db
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.schemas.tarea import (
    TareaCreate,
    TareaReasignar,
    TareaResponse,
    TareaUpdate,
    TareaUpdateEstado,
)

router = APIRouter(prefix="/tareas", tags=["Tareas"])

# Estados que cuentan como "tareas activas" para el límite de carga
ESTADOS_ACTIVOS = ("pendiente", "en_progreso")
LIMITE_TAREAS_ACTIVAS = 3


# ─── Utilidad interna ────────────────────────────────────────────────────────

async def _contar_tareas_activas(
    db: AsyncSession,
    id_empleado: int,
    excluir_tarea: Optional[int] = None,
) -> int:
    """
    Devuelve la cantidad de tareas activas (pendiente | en_progreso)
    asignadas al técnico indicado.

    `excluir_tarea` sirve al editar: si la tarea ya estaba asignada a ese
    técnico no debe contarse contra su propio límite, porque entonces guardar
    un cambio de título fallaría con "límite alcanzado".
    """
    query = (
        select(func.count())
        .select_from(EmpleadoTarea)
        .join(Tarea, Tarea.id_tarea == EmpleadoTarea.id_tarea)
        .where(
            EmpleadoTarea.id_empleado == id_empleado,
            Tarea.estado_tarea.in_(ESTADOS_ACTIVOS),
        )
    )
    if excluir_tarea is not None:
        query = query.where(EmpleadoTarea.id_tarea != excluir_tarea)

    result = await db.execute(query)
    return result.scalar() or 0


async def _obtener_tecnico_de_tarea(db: AsyncSession, id_tarea: int) -> Optional[dict]:
    """Devuelve {id_empleado, nombre} del técnico asignado, o None."""
    result = await db.execute(
        select(Empleado)
        .join(EmpleadoTarea, EmpleadoTarea.id_empleado == Empleado.id_empleado)
        .where(EmpleadoTarea.id_tarea == id_tarea)
        .limit(1)
    )
    empleado = result.scalar_one_or_none()
    if empleado is None:
        return None
    return {
        "id_empleado": empleado.id_empleado,
        "nombre": f"{empleado.nombre} {empleado.apellido}",
    }


async def _tarea_a_response(db: AsyncSession, tarea: Tarea) -> TareaResponse:
    """
    Construye la respuesta de una tarea incluyendo su técnico asignado.

    Antes los endpoints devolvían el objeto ORM directamente y el campo
    `tecnico` siempre llegaba en null al frontend.
    """
    return TareaResponse(
        id_tarea=tarea.id_tarea,
        titulo=tarea.titulo,
        descripcion=tarea.descripcion,
        direccion_servicio=tarea.direccion_servicio,
        estado_tarea=tarea.estado_tarea,
        prioridad=tarea.prioridad,
        fecha_inicio=tarea.fecha_inicio,
        fecha_finalizacion=tarea.fecha_finalizacion,
        fecha_asignacion=tarea.fecha_asignacion,
        tecnico=await _obtener_tecnico_de_tarea(db, tarea.id_tarea),
    )


# ─── GET /tareas/ ─────────────────────────────────────────────────────────────
# Acceso: cualquier empleado autenticado.

@router.get(
    "",  # sin "/" final → evita redirect 307 detrás de proxy HTTPS (mixed content)
    response_model=List[TareaResponse],
    summary="Listar tareas",
    status_code=status.HTTP_200_OK,
)
async def get_tareas(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
    estado: Optional[str] = Query(None),
    id_tecnico: Optional[int] = Query(None),
):
    query = (
        select(Tarea)
        .options(selectinload(Tarea.empleados).selectinload(EmpleadoTarea.empleado))
    )

    if estado:
        query = query.where(Tarea.estado_tarea == estado)

    result = await db.execute(query)
    tareas = result.scalars().all()

    tareas_response = []

    for tarea in tareas:
        tecnico = None

        if tarea.empleados:
            emp = tarea.empleados[0].empleado
            tecnico = {
                "id_empleado": emp.id_empleado,
                "nombre": f"{emp.nombre} {emp.apellido}",
            }

        if id_tecnico and (not tecnico or tecnico["id_empleado"] != id_tecnico):
            continue

        tareas_response.append(
            TareaResponse(
                id_tarea=tarea.id_tarea,
                titulo=tarea.titulo,
                descripcion=tarea.descripcion,
                direccion_servicio=tarea.direccion_servicio,
                estado_tarea=tarea.estado_tarea,
                prioridad=tarea.prioridad,
                fecha_inicio=tarea.fecha_inicio,
                fecha_finalizacion=tarea.fecha_finalizacion,
                fecha_asignacion=tarea.fecha_asignacion,
                tecnico=tecnico,
            )
        )

    return tareas_response


# ─── POST /tareas/ ────────────────────────────────────────────────────────────
# Acceso: admin y supervisor.

@router.post(
    "",  # sin "/" final → evita redirect 307 detrás de proxy HTTPS (mixed content)
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
      LIMITE_TAREAS_ACTIVAS (3) tareas en estado 'pendiente' o 'en_progreso'.
    - Si el límite se supera, se devuelve HTTP 400 con mensaje claro para
      que el frontend lo muestre al supervisor.

    Roles: admin, supervisor.
    """
    # ── Validación de límite de carga ──────────────────────────
    if tarea.id_tecnico:
        # Verificar que el técnico existe y es un técnico activo
        result_tec = await db.execute(
            select(Empleado).where(
                Empleado.id_empleado == tarea.id_tecnico,
                Empleado.estado == "activo",
            )
        )
        tecnico = result_tec.scalar_one_or_none()

        if not tecnico:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"No se encontró ningún técnico activo con id={tarea.id_tecnico}."
                ),
            )

        tareas_activas = await _contar_tareas_activas(db, tarea.id_tecnico)

        if tareas_activas >= LIMITE_TAREAS_ACTIVAS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"El técnico '{tecnico.nombre} {tecnico.apellido}' ya tiene "
                    f"{tareas_activas} tareas activas. "
                    f"El límite máximo es {LIMITE_TAREAS_ACTIVAS}. "
                    f"Selecciona otro técnico disponible."
                ),
            )

    # ── Crear la tarea ───────────────────────────────────────────────────────
    nueva_tarea = Tarea(
        titulo=tarea.nombre,
        descripcion=tarea.descripcion,
        direccion_servicio=tarea.direccion,
        prioridad=(
            tarea.prioridad.value
            if hasattr(tarea.prioridad, "value")
            else (tarea.prioridad or "media")
        ),
        estado_tarea="pendiente",
        fecha_inicio=tarea.fecha_inicio,
        fecha_finalizacion=tarea.fecha_finalizacion,
        fecha_asignacion=date.today() if tarea.id_tecnico else None,
    )

    db.add(nueva_tarea)
    await db.flush()  # Obtener id_tarea generado

    # ── Asignar técnico si se proveyó ────────────────────────────────────────
    if tarea.id_tecnico:
        asignacion = EmpleadoTarea(
            id_empleado=tarea.id_tecnico,
            id_tarea=nueva_tarea.id_tarea,
        )
        db.add(asignacion)
        await db.flush()

    return await _tarea_a_response(db, nueva_tarea)


# ─── PATCH /tareas/{id} ───────────────────────────────────────────────────────
# Acceso: admin y supervisor.

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
    estado, fecha_inicio, fecha_finalizacion e id_tecnico.

    Reglas de negocio:
    - Cambiar el técnico respeta el límite de LIMITE_TAREAS_ACTIVAS (3) tareas
      activas, sin contar esta misma tarea.
    - Enviar `id_tecnico: null` desasigna la tarea.
    - Al pasar a 'en_progreso' sin fecha_inicio se registra la fecha de hoy.

    Roles: admin, supervisor.
    """
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarea con id={id} no encontrada.",
        )

    # exclude_unset distingue "no me mandaron el campo" de "me lo mandaron
    # en null" (que sí es un cambio válido, p.e. para desasignar el técnico).
    cambios = data.model_dump(exclude_unset=True)

    if not cambios:
        return await _tarea_a_response(db, tarea)

    # ── Validación de fechas ────────────────────────────────────────────────
    nueva_inicio = cambios.get("fecha_inicio", tarea.fecha_inicio)
    nueva_fin = cambios.get("fecha_finalizacion", tarea.fecha_finalizacion)
    if nueva_inicio and nueva_fin and nueva_inicio > nueva_fin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha de inicio no puede ser posterior a la fecha de finalización.",
        )

    # ── Campos simples ──────────────────────────────────────────────────────
    if "nombre" in cambios:
        titulo = (cambios["nombre"] or "").strip()
        if not titulo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El título de la tarea no puede quedar vacío.",
            )
        tarea.titulo = titulo
    if "descripcion" in cambios:
        tarea.descripcion = cambios["descripcion"]
    if "direccion" in cambios:
        tarea.direccion_servicio = cambios["direccion"]
    if "prioridad" in cambios and cambios["prioridad"] is not None:
        tarea.prioridad = data.prioridad.value
    if "fecha_inicio" in cambios:
        tarea.fecha_inicio = cambios["fecha_inicio"]
    if "fecha_finalizacion" in cambios:
        tarea.fecha_finalizacion = cambios["fecha_finalizacion"]

    if "estado" in cambios and cambios["estado"] is not None:
        tarea.estado_tarea = data.estado.value
        if tarea.estado_tarea == "en_progreso" and tarea.fecha_inicio is None:
            tarea.fecha_inicio = date.today()

    # ── Reasignación de técnico ─────────────────────────────────────────────
    if "id_tecnico" in cambios:
        nuevo_tecnico = cambios["id_tecnico"]

        if nuevo_tecnico is None:
            await db.execute(
                delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id)
            )
            tarea.fecha_asignacion = None
        else:
            result_tec = await db.execute(
                select(Empleado).where(
                    Empleado.id_empleado == nuevo_tecnico,
                    Empleado.estado == "activo",
                )
            )
            tecnico = result_tec.scalar_one_or_none()

            if not tecnico:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No se encontró ningún técnico activo con id={nuevo_tecnico}.",
                )

            asignado_actual = await _obtener_tecnico_de_tarea(db, id)
            ya_asignado = (
                asignado_actual is not None
                and asignado_actual["id_empleado"] == nuevo_tecnico
            )

            if not ya_asignado:
                tareas_activas = await _contar_tareas_activas(
                    db, nuevo_tecnico, excluir_tarea=id
                )
                if tareas_activas >= LIMITE_TAREAS_ACTIVAS:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"El técnico '{tecnico.nombre} {tecnico.apellido}' ya tiene "
                            f"{tareas_activas} tareas activas. "
                            f"El límite máximo es {LIMITE_TAREAS_ACTIVAS}."
                        ),
                    )

                await db.execute(
                    delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id)
                )
                db.add(EmpleadoTarea(id_empleado=nuevo_tecnico, id_tarea=id))
                tarea.fecha_asignacion = tarea.fecha_asignacion or date.today()

    await db.flush()
    return await _tarea_a_response(db, tarea)


# ─── PATCH /tareas/{id}/estado ────────────────────────────────────────────────
# Acceso: admin y supervisor.

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
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarea con id={id} no encontrada.",
        )

    tarea.estado_tarea = data.estado.value
    if tarea.estado_tarea == "en_progreso" and tarea.fecha_inicio is None:
        tarea.fecha_inicio = date.today()

    await db.flush()
    return await _tarea_a_response(db, tarea)


# ─── PATCH /tareas/{id}/reasignar ─────────────────────────────────────────────
# Acceso: admin y supervisor.

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

    - Valida que el nuevo técnico no supere el límite de tareas activas.
    - Elimina todas las asignaciones previas de la tarea.
    - Crea una nueva asignación con el técnico indicado.
    """
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarea con id={id} no encontrada.",
        )

    # Verificar límite de carga del técnico destino
    result_tec = await db.execute(
        select(Empleado).where(
            Empleado.id_empleado == data.id_tecnico,
            Empleado.estado == "activo",
        )
    )
    tecnico = result_tec.scalar_one_or_none()

    if not tecnico:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún técnico activo con id={data.id_tecnico}.",
        )

    # Se excluye esta misma tarea: si ya estaba asignada al técnico destino no
    # debe contar contra su propio límite.
    tareas_activas = await _contar_tareas_activas(db, data.id_tecnico, excluir_tarea=id)

    if tareas_activas >= LIMITE_TAREAS_ACTIVAS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El técnico '{tecnico.nombre} {tecnico.apellido}' ya tiene "
                f"{tareas_activas} tareas activas. "
                f"El límite máximo es {LIMITE_TAREAS_ACTIVAS}."
            ),
        )

    # Eliminar asignaciones anteriores
    await db.execute(
        delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id)
    )

    # Crear nueva asignación
    nueva_asignacion = EmpleadoTarea(
        id_empleado=data.id_tecnico,
        id_tarea=id,
    )
    db.add(nueva_asignacion)
    tarea.fecha_asignacion = tarea.fecha_asignacion or date.today()

    await db.flush()
    return await _tarea_a_response(db, tarea)


# ─── PATCH /tareas/{id}/iniciar ───────────────────────────────────────────────
# Acceso: técnico asignado, admin y supervisor.

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
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarea con id={id} no encontrada.",
        )

    # Solo el técnico asignado puede iniciar (admin/supervisor se saltan esta validación)
    if current_user.rol == "tecnico":
        result_asig = await db.execute(
            select(EmpleadoTarea).where(
                EmpleadoTarea.id_tarea == id,
                EmpleadoTarea.id_empleado == current_user.id_empleado,
            )
        )
        asignacion = result_asig.scalar_one_or_none()

        if not asignacion:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para iniciar esta tarea. "
                       "Solo el técnico asignado puede iniciarla.",
            )

    if tarea.fecha_inicio is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La tarea ya fue iniciada anteriormente.",
        )

    tarea.fecha_inicio = date.today()
    tarea.estado_tarea = "en_progreso"

    return {
        "message": "Tarea iniciada correctamente",
        "id_tarea": tarea.id_tarea,
        "titulo": tarea.titulo,
        "fecha_inicio": str(tarea.fecha_inicio),
        "estado": tarea.estado_tarea,
    }