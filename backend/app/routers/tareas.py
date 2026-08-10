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

from collections import OrderedDict
from datetime import date, datetime, time, timedelta
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import DateTime, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from geoalchemy2 import Geometry

from app.core.deps import (
    get_current_empleado,
    require_roles,
    require_supervisor,
    require_tecnico,
)
from app.core.reglas import (
    ESTADOS_TAREA_ACTIVOS,
    ESTADOS_TAREA_CERRADOS,
    ESTADO_EMPLEADO_ACTIVO,
    LIMITE_TAREAS_ACTIVAS,
    ROL_TECNICO,
)
# Reloj de la operación (America/Guatemala). El contenedor corre en UTC:
# usar datetime.now() aquí desplazaba las fechas 6 horas.
from app.core.tiempo import ahora as ahora_local, hora_actual as hora_local, hoy as hoy_local
from app.db.session import get_db
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Incidencia, Tarea
from app.schemas.tarea import (
    DiaCompletadas,
    EvidenciaResumen,
    HistorialTareasResponse,
    TareaCompletadaResponse,
    TareaCreate,
    TareaReasignar,
    TareaResponse,
    TareaUpdate,
    TareaUpdateEstado,
)
from app.services.tareas import (
    marcar_completada,
    marcar_reabierta,
    validar_cierre_permitido,
)

router = APIRouter(prefix="/tareas", tags=["Tareas"])

# El límite de carga y los estados viven en app/core/reglas.py: antes estaban
# duplicados aquí, en metricas.py y en dos pantallas del frontend, y bastaba
# con cambiar uno para que el selector y el backend dejaran de coincidir.
ESTADOS_ACTIVOS = ESTADOS_TAREA_ACTIVOS

# Roles que ven el trabajo de todos los técnicos, no solo el propio.
ROLES_SUPERVISION = ("admin", "supervisor", "gerente")


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


async def _contar_incidencias(db: AsyncSession, id_tarea: int) -> int:
    """Número de evidencias registradas en la tarea."""
    result = await db.execute(
        select(func.count())
        .select_from(Incidencia)
        .where(Incidencia.id_tarea == id_tarea)
    )
    return result.scalar() or 0


async def _buscar_tecnico_asignable(db: AsyncSession, id_empleado: int) -> Empleado:
    """
    Devuelve el empleado si puede recibir tareas; lanza 404 si no.

    Comprueba TRES cosas: que exista, que su cuenta esté activa y que su rol
    sea 'tecnico'. Antes solo se miraba el estado, así que una tarea se podía
    asignar a un admin, a un supervisor o a un gerente aunque el mensaje de
    error hablara de "técnico activo". El selector del frontend ya solo ofrece
    técnicos, pero la regla tiene que vivir también aquí: una llamada directa
    a la API se saltaba el filtro de la pantalla.
    """
    result = await db.execute(
        select(Empleado).where(
            Empleado.id_empleado == id_empleado,
            Empleado.estado == ESTADO_EMPLEADO_ACTIVO,
            Empleado.rol == ROL_TECNICO,
        )
    )
    tecnico = result.scalar_one_or_none()

    if tecnico is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No se encontró ningún técnico activo con id={id_empleado}. "
                "Las tareas solo pueden asignarse a empleados con rol 'tecnico' "
                "y cuenta activa."
            ),
        )

    return tecnico


async def _validar_limite_al_reabrir(
    db: AsyncSession,
    tarea: Tarea,
    nuevo_estado: str,
) -> None:
    """
    Impide que reabrir una tarea cerrada deje al técnico por encima del límite.

    El tope de carga se validaba únicamente al asignar. Devolver una tarea
    'completado' o 'cancelado' a un estado activo no pasaba por ninguna
    comprobación, así que bastaba con reabrir tareas viejas para dejar a un
    técnico con muchas más tareas activas de las permitidas: el límite era
    real al asignar y decorativo después.

    No hace nada si la tarea ya estaba abierta o si no tiene técnico asignado.
    """
    if tarea.estado_tarea not in ESTADOS_TAREA_CERRADOS:
        return
    if nuevo_estado not in ESTADOS_TAREA_ACTIVOS:
        return

    asignado = await _obtener_tecnico_de_tarea(db, tarea.id_tarea)
    if asignado is None:
        return

    # Se excluye esta misma tarea del conteo: todavía figura como cerrada, así
    # que no consume cupo, pero sumarla dos veces daría un error engañoso.
    activas = await _contar_tareas_activas(
        db, asignado["id_empleado"], excluir_tarea=tarea.id_tarea
    )

    if activas >= LIMITE_TAREAS_ACTIVAS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No se puede reabrir la tarea: el técnico '{asignado['nombre']}' "
                f"ya tiene {activas} tareas activas y el límite es "
                f"{LIMITE_TAREAS_ACTIVAS}. Reasigna la tarea a otro técnico o "
                f"cierra alguna de las suyas primero."
            ),
        )


async def _tarea_a_response(db: AsyncSession, tarea: Tarea) -> TareaResponse:
    """
    Construye la respuesta de una tarea incluyendo su técnico asignado.

    Antes los endpoints devolvían el objeto ORM directamente y el campo
    `tecnico` siempre llegaba en null al frontend.
    """
    return TareaResponse(
        total_incidencias=await _contar_incidencias(db, tarea.id_tarea),
        id_tarea=tarea.id_tarea,
        titulo=tarea.titulo,
        descripcion=tarea.descripcion,
        direccion_servicio=tarea.direccion_servicio,
        estado_tarea=tarea.estado_tarea,
        prioridad=tarea.prioridad,
        fecha_inicio=tarea.fecha_inicio,
        fecha_finalizacion=tarea.fecha_finalizacion,
        fecha_asignacion=tarea.fecha_asignacion,
        fecha_completado=tarea.fecha_completado,
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
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
    # Estilo Annotated a propósito: con `estado: str = Query(None)` el valor
    # por defecto es el objeto Query, no None, y cualquier llamada directa a
    # la función (los tests, u otro router que la reutilice) acaba armando
    # filtros con basura porque un Query() siempre es truthy.
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
    # coordenada_servicio es Geography; ST_X/ST_Y solo operan sobre geometry,
    # por eso se castea. Con SRID 4326: ST_Y es latitud y ST_X es longitud.
    coord = cast(Tarea.coordenada_servicio, Geometry)
    lat_col = func.ST_Y(coord).label("lat")
    lng_col = func.ST_X(coord).label("lng")

    query = (
        select(Tarea, lat_col, lng_col)
        .options(selectinload(Tarea.empleados).selectinload(EmpleadoTarea.empleado))
    )

    if estado:
        query = query.where(Tarea.estado_tarea == estado)

    # Un técnico solo puede ver su propia carga de trabajo. Antes este endpoint
    # devolvía las tareas de toda la empresa a cualquier autenticado y el
    # recorte por técnico lo hacía el cliente, así que bastaba con llamar a
    # /tareas sin filtros para leer el trabajo de los demás.
    if current_user.rol in ROLES_SUPERVISION:
        tecnico_filtrado = id_tecnico
    else:
        tecnico_filtrado = current_user.id_empleado

    if tecnico_filtrado is not None:
        # El filtro se resuelve en SQL: antes se traían todas las tareas y se
        # descartaban en Python, lo que además rompía el límite de resultados.
        query = query.where(
            Tarea.id_tarea.in_(
                select(EmpleadoTarea.id_tarea).where(
                    EmpleadoTarea.id_empleado == tecnico_filtrado
                )
            )
        )

    # Cota superior explícita: la tabla solo crece y sin límite la respuesta
    # terminaría materializando el histórico completo en memoria.
    query = query.order_by(Tarea.id_tarea.desc()).limit(limite)

    result = await db.execute(query)
    filas = result.all()

    ids = [tarea.id_tarea for tarea, _lat, _lng in filas]

    # Conteo de evidencias en una sola consulta agrupada, para no lanzar un
    # COUNT por tarea (N+1) al construir la respuesta. Se restringe a las
    # tareas devueltas: agrupar sobre la tabla entera hacía trabajo de más.
    incidencias_por_tarea: dict[int, int] = {}

    if ids:
        result_incidencias = await db.execute(
            select(Incidencia.id_tarea, func.count(Incidencia.id_incidencia))
            .where(Incidencia.id_tarea.in_(ids))
            .group_by(Incidencia.id_tarea)
        )
        incidencias_por_tarea = dict(result_incidencias.all())

    tareas_response = []

    for tarea, lat, lng in filas:
        tecnico = None

        if tarea.empleados:
            emp = tarea.empleados[0].empleado
            tecnico = {
                "id_empleado": emp.id_empleado,
                "nombre": f"{emp.nombre} {emp.apellido}",
            }

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
                fecha_completado=tarea.fecha_completado,
                lat=lat,
                lng=lng,
                tecnico=tecnico,
                total_incidencias=incidencias_por_tarea.get(tarea.id_tarea, 0),
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
      LIMITE_TAREAS_ACTIVAS tareas en estado 'pendiente' o 'en_progreso'
      (el valor vive en app/core/reglas.py).
    - Si el límite se supera, se devuelve HTTP 400 con mensaje claro para
      que el frontend lo muestre al supervisor.

    Roles: admin, supervisor.
    """
    # ── Validación de límite de carga ──────────────────────────
    if tarea.id_tecnico:
        # Verificar que existe, está activo y es realmente un técnico.
        tecnico = await _buscar_tecnico_asignable(db, tarea.id_tecnico)

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
        fecha_asignacion=hoy_local() if tarea.id_tecnico else None,
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
    - Cambiar el técnico respeta el límite de LIMITE_TAREAS_ACTIVAS tareas
      activas, sin contar esta misma tarea.
    - Reabrir una tarea cerrada vuelve a comprobar ese mismo límite.
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
        nuevo_estado = data.estado.value
        # Reabrir una tarea cerrada devuelve carga al técnico: hay que volver a
        # comprobar su límite, igual que si se le asignara una tarea nueva.
        await _validar_limite_al_reabrir(db, tarea, nuevo_estado)
        if nuevo_estado == "completado":
            # Pasa por el helper compartido para que la tarea quede con
            # `fecha_completado` y aparezca en el historial diario.
            marcar_completada(tarea)
        else:
            tarea.estado_tarea = nuevo_estado
            # Reabrir una tarea borra la marca de cierre: si no, seguiría
            # contando como "hecha" ese día.
            marcar_reabierta(tarea)
            if nuevo_estado == "en_progreso" and tarea.fecha_inicio is None:
                tarea.fecha_inicio = hoy_local()

    # ── Reasignación de técnico ─────────────────────────────────────────────
    if "id_tecnico" in cambios:
        nuevo_tecnico = cambios["id_tecnico"]

        # Una tarea cerrada no cambia de técnico. `PATCH /tareas/{id}/reasignar`
        # ya lo impedía, pero este endpoint hacía exactamente lo mismo sin
        # ninguna comprobación: dos caminos para la misma acción y solo uno
        # vigilado.
        #
        # No es un detalle formal. Quién hizo el trabajo se deduce de quién
        # tiene la tarea asignada —la evidencia no guarda autor—, así que
        # cambiar el técnico de una tarea ya completada reescribe la historia:
        # el trabajo y las fotos que dejó una persona pasan a figurar a nombre
        # de otra, sin rastro de que hubo un cambio.
        #
        # Se mira el estado DESPUÉS de aplicar el cambio de estado de esta
        # misma petición, para que reabrir y reasignar en una sola operación
        # siga funcionando: ahí sí queda constancia de que se reabrió.
        if tarea.estado_tarea in ESTADOS_TAREA_CERRADOS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"La tarea está en estado '{tarea.estado_tarea}' y ya no "
                    "puede cambiar de técnico: la evidencia registrada quedaría "
                    "atribuida a alguien que no hizo el trabajo. Reábrela "
                    "primero si necesitas reasignarla."
                ),
            )

        if nuevo_tecnico is None:
            await db.execute(
                delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id)
            )
            tarea.fecha_asignacion = None
        else:
            tecnico = await _buscar_tecnico_asignable(db, nuevo_tecnico)

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
                tarea.fecha_asignacion = tarea.fecha_asignacion or hoy_local()

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

    nuevo_estado = data.estado.value

    # Sin esto, reabrir tareas cerradas era la forma de dejar a un técnico con
    # más tareas activas que el límite: el tope solo se miraba al asignar.
    await _validar_limite_al_reabrir(db, tarea, nuevo_estado)

    if nuevo_estado == "completado":
        marcar_completada(tarea)
    else:
        tarea.estado_tarea = nuevo_estado
        marcar_reabierta(tarea)
        if nuevo_estado == "en_progreso" and tarea.fecha_inicio is None:
            tarea.fecha_inicio = hoy_local()

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

    - Solo tareas abiertas: una tarea completada o cancelada ya no se mueve.
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

    # Una tarea cerrada no se reasigna: el trabajo ya se entregó y su
    # evidencia quedó ligada al técnico que la hizo. La UI ya las oculta de
    # la lista, pero la regla tiene que vivir también aquí.
    if tarea.estado_tarea in ("completado", "cancelado"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La tarea está en estado '{tarea.estado_tarea}' y ya no puede "
                f"reasignarse. Reábrela primero si necesitas cambiar el técnico."
            ),
        )

    # Verificar límite de carga del técnico destino
    tecnico = await _buscar_tecnico_asignable(db, data.id_tecnico)

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
    tarea.fecha_asignacion = tarea.fecha_asignacion or hoy_local()

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

    # El bloqueo se decide por el ESTADO, no por `fecha_inicio`.
    #
    # Antes se rechazaba la petición si `fecha_inicio` no era NULL, pero esa
    # columna es la fecha *programada* de la tarea: el supervisor la llena al
    # crearla desde "Nueva tarea". Resultado: toda tarea con fecha planificada
    # nacía imposible de iniciar y el técnico veía "La tarea ya fue iniciada
    # anteriormente" en la primera pulsación.
    if tarea.estado_tarea == "completado":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta tarea ya fue completada. No se puede volver a iniciar.",
        )

    if tarea.estado_tarea == "cancelado":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta tarea está cancelada. Pide a tu supervisor que la reactive.",
        )

    # Iniciar una tarea que ya está en curso es idempotente: si al técnico se
    # le fue la señal y reintenta, debe encontrarse la tarea abierta, no un
    # error.
    ya_en_curso = tarea.estado_tarea == "en_progreso"

    if not ya_en_curso:
        tarea.estado_tarea = "en_progreso"
        # Solo se sobreescribe si no había fecha planificada.
        if tarea.fecha_inicio is None:
            tarea.fecha_inicio = hoy_local()

    await db.flush()

    return {
        "message": (
            "La tarea ya estaba en curso"
            if ya_en_curso
            else "Tarea iniciada correctamente"
        ),
        "id_tarea": tarea.id_tarea,
        "titulo": tarea.titulo,
        "fecha_inicio": str(tarea.fecha_inicio) if tarea.fecha_inicio else None,
        "estado": tarea.estado_tarea,
    }


# ─── PATCH /tareas/{id}/finalizar ─────────────────────────────────────────────
# Acceso: técnico asignado, admin y supervisor.

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
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarea con id={id} no encontrada.",
        )

    if current_user.rol == "tecnico":
        result_asig = await db.execute(
            select(EmpleadoTarea).where(
                EmpleadoTarea.id_tarea == id,
                EmpleadoTarea.id_empleado == current_user.id_empleado,
            )
        )
        if result_asig.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para finalizar esta tarea. "
                       "Solo el técnico asignado puede cerrarla.",
            )

    # Mismas reglas de estado que el cierre vía evidencia (incidencias.py):
    # ni cancelada, ni pendiente (una tarea que nunca se inició no se termina).
    validar_cierre_permitido(tarea)

    # La evidencia es obligatoria (SCRUM-139): cerrar sin ella dejaría al
    # supervisor sin constancia de lo hecho.
    if await _contar_incidencias(db, id) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registra la evidencia (descripción y foto) antes de finalizar la tarea.",
        )

    marcar_completada(tarea)
    await db.flush()

    return await _tarea_a_response(db, tarea)


# ─── GET /tareas/completadas ──────────────────────────────────────────────────
# Acceso: cualquier empleado autenticado (el técnico solo ve las suyas).

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
    hoy = hoy_local()
    hasta = fecha_hasta or hoy
    desde = fecha_desde or (hasta - timedelta(days=6))

    if desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha inicial no puede ser posterior a la final.",
        )

    # Un técnico nunca ve el trabajo de otro, mande lo que mande en la query.
    if current_user.rol not in ROLES_SUPERVISION:
        id_empleado_filtro = current_user.id_empleado
    else:
        id_empleado_filtro = id_tecnico

    # Momento de cierre con respaldo: las tareas que se completaron antes de
    # que existiera la columna `fecha_completado` la tienen en NULL y, si se
    # exigiera, desaparecerían del historial. Para esas se cae a
    # `fecha_inicio`, que es lo más cercano que hay.
    momento_cierre = func.coalesce(
        Tarea.fecha_completado,
        cast(Tarea.fecha_inicio, DateTime),
    )

    # El límite superior es el inicio del día siguiente: `momento_cierre` es
    # un DateTime, así que comparar contra `hasta` a secas dejaría fuera todo
    # lo cerrado después de las 00:00:00 del último día del rango.
    query = (
        select(Tarea)
        .options(
            selectinload(Tarea.empleados).selectinload(EmpleadoTarea.empleado),
            selectinload(Tarea.incidencias),
        )
        .where(
            Tarea.estado_tarea == "completado",
            momento_cierre.isnot(None),
            momento_cierre >= datetime.combine(desde, time.min),
            momento_cierre < datetime.combine(hasta + timedelta(days=1), time.min),
        )
        .order_by(momento_cierre.desc())
    )

    if id_empleado_filtro is not None:
        query = query.join(
            EmpleadoTarea, EmpleadoTarea.id_tarea == Tarea.id_tarea
        ).where(EmpleadoTarea.id_empleado == id_empleado_filtro)

    result = await db.execute(query)
    tareas = result.scalars().unique().all()

    # Agrupación por día, preservando el orden descendente de la consulta.
    dias: "OrderedDict[date, List[TareaCompletadaResponse]]" = OrderedDict()

    for tarea in tareas:
        # Mismo respaldo que en la consulta: sin él, una tarea vieja sin
        # `fecha_completado` reventaría al pedirle `.date()`.
        cerrada_en = tarea.fecha_completado or (
            datetime.combine(tarea.fecha_inicio, time.min)
            if tarea.fecha_inicio
            else None
        )
        if cerrada_en is None:
            continue

        tecnico = None
        if tarea.empleados:
            emp = tarea.empleados[0].empleado
            tecnico = {
                "id_empleado": emp.id_empleado,
                "nombre": f"{emp.nombre} {emp.apellido}",
            }

        evidencias = sorted(
            tarea.incidencias, key=lambda i: i.fecha_reporte, reverse=True
        )

        item = TareaCompletadaResponse(
            id_tarea=tarea.id_tarea,
            titulo=tarea.titulo,
            descripcion=tarea.descripcion,
            direccion_servicio=tarea.direccion_servicio,
            estado_tarea=tarea.estado_tarea,
            prioridad=tarea.prioridad,
            fecha_inicio=tarea.fecha_inicio,
            fecha_finalizacion=tarea.fecha_finalizacion,
            fecha_asignacion=tarea.fecha_asignacion,
            fecha_completado=tarea.fecha_completado,
            tecnico=tecnico,
            total_incidencias=len(evidencias),
            evidencias=[
                EvidenciaResumen(
                    id_incidencia=e.id_incidencia,
                    descripcion=e.descripcion,
                    foto_evidencia=e.foto_evidencia,
                    fecha_reporte=e.fecha_reporte,
                )
                for e in evidencias
            ],
        )

        dias.setdefault(cerrada_en.date(), []).append(item)

    total = sum(len(items) for items in dias.values())

    return HistorialTareasResponse(
        total=total,
        desde=desde,
        hasta=hasta,
        dias=[
            DiaCompletadas(fecha=fecha, total=len(items), tareas=items)
            for fecha, items in dias.items()
        ],
    )