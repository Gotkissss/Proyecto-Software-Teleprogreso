# backend/app/services/tareas.py
"""
Lógica de negocio y acceso a datos de tareas — Teleprogreso S.A.
-----------------------------------------------------------------------------
Centraliza las consultas, reglas y transformaciones del ciclo de vida de las
tareas. Los routers conservan únicamente el contrato HTTP, la validación de
entrada y las dependencias de autenticación/autorización.

Las transiciones simples de estado continúan siendo funciones puras para
poder probarlas sin PostgreSQL. Las operaciones asíncronas no hacen commit:
se ejecutan dentro de la transacción administrada por la dependencia de base
de datos.
-----------------------------------------------------------------------------
"""

from collections import OrderedDict
from datetime import date, datetime, time, timedelta
from typing import List, Optional

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, and_, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request, forbidden, not_found
from app.core.reglas import (
    ESTADOS_TAREA_ACTIVOS,
    ESTADOS_TAREA_CERRADOS,
    ESTADO_EMPLEADO_ACTIVO,
    LIMITE_TAREAS_ACTIVAS,
    ROL_TECNICO,
)

# Reloj de la operación (America/Guatemala). Con datetime.now() en un
# contenedor UTC, una tarea cerrada a las 19:00 hora local se guardaba con la
# fecha del día siguiente y desaparecía del historial diario.
from app.core.tiempo import ahora, hoy
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Incidencia, Tarea
from app.schemas.tarea import (
    DiaCompletadas,
    EvidenciaResumen,
    HistorialTareasResponse,
    TareaCompletadaResponse,
    TareaCreate,
    TareaMapaSupervisorResponse,
    TareaReasignar,
    TareaResponse,
    TareaRutaResponse,
    TareaUpdate,
    TareaUpdateEstado,
)


ESTADOS_ACTIVOS = ESTADOS_TAREA_ACTIVOS
ROLES_SUPERVISION = ("admin", "supervisor", "gerente")


def validar_tarea_abierta(tarea) -> None:
    """
    Exige que la tarea siga abierta para poder registrarle trabajo.

    Se aplica al registrar evidencias. Sin esto, una tarea cancelada seguía
    aceptando descripciones y fotos: el técnico que tuviera la pantalla ya
    cargada podía documentar —y dar por hecho— un trabajo que el supervisor
    acababa de anular, y la evidencia quedaba colgando de una tarea muerta.

    Para corregir una tarea ya cerrada hay que reabrirla primero; así queda
    constancia de que alguien decidió reabrirla.
    """
    if tarea.estado_tarea == "cancelado":
        raise bad_request(
            (
                "Esta tarea fue cancelada y ya no admite evidencias. "
                "Consulta con tu supervisor."
            )
        )

    if tarea.estado_tarea == "completado":
        raise bad_request(
            (
                "Esta tarea ya está completada y no admite evidencias nuevas. "
                "Si falta algo, pide a tu supervisor que la reabra."
            )
        )


def validar_cierre_permitido(tarea) -> None:
    """
    Comprueba que la tarea esté en un estado desde el que se pueda cerrar.

    Reglas:
      - 'cancelado'   → no se cierra: primero hay que reactivarla.
      - 'pendiente'   → no se cierra: una tarea que nunca se inició no puede
                        darse por terminada. Antes sí se podía, y quedaba una
                        tarea "completada" sin ninguna traza de cuándo empezó,
                        lo que descuadra cualquier medición de duración.
      - 'en_progreso' → caso normal.
      - 'completado'  → se acepta y no cambia nada: cerrar dos veces tiene que
                        ser inofensivo, porque el frontend reintenta el cierre
                        si la primera respuesta se pierde.

    Lanza un error 400 en los dos primeros casos.
    """
    if tarea.estado_tarea == "cancelado":
        raise bad_request("No se puede finalizar una tarea cancelada.")

    if tarea.estado_tarea == "pendiente":
        raise bad_request(
            (
                "La tarea todavía no se ha iniciado. Pulsa 'Iniciar tarea' "
                "antes de finalizarla."
            )
        )


def marcar_completada(tarea, *, momento: datetime | None = None) -> None:
    """
    Deja la tarea en estado 'completado' con su marca temporal de cierre.

    Es idempotente: si la tarea ya estaba completada se respeta la
    `fecha_completado` original, para que un reintento del técnico no mueva la
    tarea al día de hoy en el historial.

    `fecha_inicio` se rellena si venía vacía, porque una tarea cerrada sin
    fecha de inicio rompe los cálculos de duración del panel.
    """
    momento_cierre = momento or ahora()

    tarea.estado_tarea = "completado"

    if tarea.fecha_completado is None:
        tarea.fecha_completado = momento_cierre

    if tarea.fecha_inicio is None:
        tarea.fecha_inicio = momento_cierre.date()


def marcar_reabierta(tarea) -> None:
    """
    Limpia la marca de cierre cuando una tarea vuelve a un estado abierto.

    Sin esto, una tarea que el supervisor devuelve a 'pendiente' seguiría
    apareciendo en el historial de "hecho" de ese día.
    """
    tarea.fecha_completado = None


def es_de_hoy(momento: datetime | None, hoy_referencia: date | None = None) -> bool:
    """True si `momento` cae en el día indicado (hoy por defecto)."""
    if momento is None:
        return False
    return momento.date() == (hoy_referencia or hoy())


def _punto_servicio(lat: float, lng: float) -> str:
    """WKT para PostGIS; un POINT almacena longitud antes que latitud."""
    return f"SRID=4326;POINT({lng} {lat})"


async def _contar_tareas_activas(
    db: AsyncSession,
    id_empleado: int,
    excluir_tarea: Optional[int] = None,
) -> int:
    """Cuenta las tareas activas asignadas a un técnico."""
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


async def _obtener_tecnico_de_tarea(
    db: AsyncSession,
    id_tarea: int,
) -> Optional[dict]:
    """Devuelve los datos básicos del técnico asignado, o None."""
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
    """Cuenta las evidencias registradas en una tarea."""
    result = await db.execute(
        select(func.count())
        .select_from(Incidencia)
        .where(Incidencia.id_tarea == id_tarea)
    )
    return result.scalar() or 0


async def _buscar_tecnico_asignable(
    db: AsyncSession,
    id_empleado: int,
) -> Empleado:
    """Obtiene un técnico activo que puede recibir tareas."""
    result = await db.execute(
        select(Empleado).where(
            Empleado.id_empleado == id_empleado,
            Empleado.estado == ESTADO_EMPLEADO_ACTIVO,
            Empleado.rol == ROL_TECNICO,
        )
    )
    tecnico = result.scalar_one_or_none()

    if tecnico is None:
        raise not_found(
            (
                f"No se encontró ningún técnico activo con id={id_empleado}. "
                "Las tareas solo pueden asignarse a empleados con rol 'tecnico' "
                "y cuenta activa."
            )
        )

    return tecnico


async def _validar_limite_al_reabrir(
    db: AsyncSession,
    tarea: Tarea,
    nuevo_estado: str,
) -> None:
    """Impide que reabrir una tarea exceda la carga máxima del técnico."""
    if tarea.estado_tarea not in ESTADOS_TAREA_CERRADOS:
        return
    if nuevo_estado not in ESTADOS_TAREA_ACTIVOS:
        return

    asignado = await _obtener_tecnico_de_tarea(db, tarea.id_tarea)
    if asignado is None:
        return

    activas = await _contar_tareas_activas(
        db, asignado["id_empleado"], excluir_tarea=tarea.id_tarea
    )

    if activas >= LIMITE_TAREAS_ACTIVAS:
        raise bad_request(
            (
                f"No se puede reabrir la tarea: el técnico '{asignado['nombre']}' "
                f"ya tiene {activas} tareas activas y el límite es "
                f"{LIMITE_TAREAS_ACTIVAS}. Reasigna la tarea a otro técnico o "
                f"cierra alguna de las suyas primero."
            )
        )


async def _tarea_a_response(db: AsyncSession, tarea: Tarea) -> TareaResponse:
    """Construye la respuesta de una tarea con técnico e incidencias."""
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


async def listar_tareas(
    db: AsyncSession,
    current_user: Empleado,
    estado: Optional[str] = None,
    id_tecnico: Optional[int] = None,
    limite: int = 500,
) -> List[TareaResponse]:
    """Lista las tareas visibles para el empleado autenticado."""
    coord = cast(Tarea.coordenada_servicio, Geometry)
    lat_col = func.ST_Y(coord).label("lat")
    lng_col = func.ST_X(coord).label("lng")

    query = (
        select(Tarea, lat_col, lng_col)
        .options(selectinload(Tarea.empleados).selectinload(EmpleadoTarea.empleado))
    )

    if estado:
        query = query.where(Tarea.estado_tarea == estado)

    tecnico_filtrado = (
        id_tecnico
        if current_user.rol in ROLES_SUPERVISION
        else current_user.id_empleado
    )
    if tecnico_filtrado is not None:
        query = query.where(
            Tarea.id_tarea.in_(
                select(EmpleadoTarea.id_tarea).where(
                    EmpleadoTarea.id_empleado == tecnico_filtrado
                )
            )
        )

    query = query.order_by(Tarea.id_tarea.desc()).limit(limite)
    result = await db.execute(query)
    filas = result.all()
    ids = [tarea.id_tarea for tarea, _lat, _lng in filas]
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


def _filtro_mapa_del_dia(fecha: date, hoy_referencia: date):
    """Construye la condición SQL para las tareas visibles en un mapa diario."""
    inicio_dia = datetime.combine(fecha, time.min)
    fin_dia = inicio_dia + timedelta(days=1)
    cerradas_ese_dia = and_(
        Tarea.estado_tarea == "completado",
        Tarea.fecha_completado >= inicio_dia,
        Tarea.fecha_completado < fin_dia,
    )

    if fecha != hoy_referencia:
        return cerradas_ese_dia

    return or_(Tarea.estado_tarea.in_(ESTADOS_ACTIVOS), cerradas_ese_dia)


async def obtener_mi_ruta(
    db: AsyncSession,
    current_user: Empleado,
) -> List[TareaRutaResponse]:
    """Obtiene las tareas del mapa diario del empleado autenticado."""
    coord = cast(Tarea.coordenada_servicio, Geometry)
    lat_col = func.ST_Y(coord).label("lat")
    lng_col = func.ST_X(coord).label("lng")
    hoy_referencia = hoy()

    query = (
        select(Tarea, lat_col, lng_col)
        .join(EmpleadoTarea, EmpleadoTarea.id_tarea == Tarea.id_tarea)
        .where(
            EmpleadoTarea.id_empleado == current_user.id_empleado,
            _filtro_mapa_del_dia(hoy_referencia, hoy_referencia),
        )
        .order_by(Tarea.id_tarea)
    )
    result = await db.execute(query)

    return [
        TareaRutaResponse(
            id_tarea=tarea.id_tarea,
            titulo=tarea.titulo,
            descripcion=tarea.descripcion,
            direccion_servicio=tarea.direccion_servicio,
            estado_tarea=tarea.estado_tarea,
            prioridad=tarea.prioridad,
            fecha_completado=tarea.fecha_completado,
            lat=lat,
            lng=lng,
        )
        for tarea, lat, lng in result.all()
    ]


async def obtener_mapa_supervisor(
    db: AsyncSession,
    fecha: Optional[date] = None,
    id_tecnico: Optional[int] = None,
) -> List[TareaMapaSupervisorResponse]:
    """Obtiene las tareas del mapa de supervisión para una fecha."""
    fecha_filtro = fecha or hoy()
    coord = cast(Tarea.coordenada_servicio, Geometry)
    lat_col = func.ST_Y(coord).label("lat")
    lng_col = func.ST_X(coord).label("lng")

    query = (
        select(Tarea, lat_col, lng_col)
        .options(selectinload(Tarea.empleados).selectinload(EmpleadoTarea.empleado))
        .where(_filtro_mapa_del_dia(fecha_filtro, hoy()))
    )
    if id_tecnico is not None:
        query = query.where(
            Tarea.id_tarea.in_(
                select(EmpleadoTarea.id_tarea).where(
                    EmpleadoTarea.id_empleado == id_tecnico
                )
            )
        )

    result = await db.execute(query.order_by(Tarea.id_tarea))
    tareas_response = []
    for tarea, lat, lng in result.all():
        tecnico = None
        if tarea.empleados:
            emp = tarea.empleados[0].empleado
            tecnico = {
                "id_empleado": emp.id_empleado,
                "nombre": f"{emp.nombre} {emp.apellido}",
            }

        tareas_response.append(
            TareaMapaSupervisorResponse(
                id_tarea=tarea.id_tarea,
                titulo=tarea.titulo,
                descripcion=tarea.descripcion,
                direccion_servicio=tarea.direccion_servicio,
                estado_tarea=tarea.estado_tarea,
                prioridad=tarea.prioridad,
                fecha_completado=tarea.fecha_completado,
                lat=lat,
                lng=lng,
                tecnico=tecnico,
            )
        )

    return tareas_response


async def crear_tarea(db: AsyncSession, data: TareaCreate) -> TareaResponse:
    """Crea una tarea y, si corresponde, la asigna a un técnico."""
    if data.id_tecnico:
        tecnico = await _buscar_tecnico_asignable(db, data.id_tecnico)
        tareas_activas = await _contar_tareas_activas(db, data.id_tecnico)
        if tareas_activas >= LIMITE_TAREAS_ACTIVAS:
            raise bad_request(
                (
                    f"El técnico '{tecnico.nombre} {tecnico.apellido}' ya tiene "
                    f"{tareas_activas} tareas activas. "
                    f"El límite máximo es {LIMITE_TAREAS_ACTIVAS}. "
                    "Selecciona otro técnico disponible."
                )
            )

    nueva_tarea = Tarea(
        titulo=data.nombre,
        descripcion=data.descripcion,
        direccion_servicio=data.direccion,
        prioridad=(
            data.prioridad.value
            if hasattr(data.prioridad, "value")
            else (data.prioridad or "media")
        ),
        estado_tarea="pendiente",
        fecha_inicio=data.fecha_inicio,
        fecha_finalizacion=data.fecha_finalizacion,
        fecha_asignacion=hoy() if data.id_tecnico else None,
        coordenada_servicio=(
            _punto_servicio(data.lat, data.lng)
            if data.lat is not None
            else None
        ),
    )
    db.add(nueva_tarea)
    await db.flush()

    if data.id_tecnico:
        db.add(
            EmpleadoTarea(
                id_empleado=data.id_tecnico,
                id_tarea=nueva_tarea.id_tarea,
            )
        )
        await db.flush()

    return await _tarea_a_response(db, nueva_tarea)


async def editar_tarea(
    db: AsyncSession,
    id_tarea: int,
    data: TareaUpdate,
) -> TareaResponse:
    """Aplica una edición parcial a una tarea existente."""
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id_tarea))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise not_found(f"Tarea con id={id_tarea} no encontrada.")

    cambios = data.model_dump(exclude_unset=True)
    if not cambios:
        return await _tarea_a_response(db, tarea)

    nueva_inicio = cambios.get("fecha_inicio", tarea.fecha_inicio)
    nueva_fin = cambios.get("fecha_finalizacion", tarea.fecha_finalizacion)
    if nueva_inicio and nueva_fin and nueva_inicio > nueva_fin:
        raise bad_request(
            "La fecha de inicio no puede ser posterior a la fecha de finalización."
        )

    if "nombre" in cambios:
        titulo = (cambios["nombre"] or "").strip()
        if not titulo:
            raise bad_request("El título de la tarea no puede quedar vacío.")
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
    if "lat" in cambios:
        tarea.coordenada_servicio = (
            _punto_servicio(data.lat, data.lng)
            if data.lat is not None
            else None
        )

    if "estado" in cambios and cambios["estado"] is not None:
        nuevo_estado = data.estado.value
        await _validar_limite_al_reabrir(db, tarea, nuevo_estado)
        if nuevo_estado == "completado":
            marcar_completada(tarea)
        else:
            tarea.estado_tarea = nuevo_estado
            marcar_reabierta(tarea)
            if nuevo_estado == "en_progreso" and tarea.fecha_inicio is None:
                tarea.fecha_inicio = hoy()

    if "id_tecnico" in cambios:
        nuevo_tecnico = cambios["id_tecnico"]

        if tarea.estado_tarea in ESTADOS_TAREA_CERRADOS:
            raise bad_request(
                (
                    f"La tarea está en estado '{tarea.estado_tarea}' y ya no "
                    "puede cambiar de técnico: la evidencia registrada quedaría "
                    "atribuida a alguien que no hizo el trabajo. Reábrela "
                    "primero si necesitas reasignarla."
                )
            )

        if nuevo_tecnico is None:
            await db.execute(
                delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id_tarea)
            )
            tarea.fecha_asignacion = None
        else:
            tecnico = await _buscar_tecnico_asignable(db, nuevo_tecnico)
            asignado_actual = await _obtener_tecnico_de_tarea(db, id_tarea)
            ya_asignado = (
                asignado_actual is not None
                and asignado_actual["id_empleado"] == nuevo_tecnico
            )

            if not ya_asignado:
                tareas_activas = await _contar_tareas_activas(
                    db, nuevo_tecnico, excluir_tarea=id_tarea
                )
                if tareas_activas >= LIMITE_TAREAS_ACTIVAS:
                    raise bad_request(
                        (
                            f"El técnico '{tecnico.nombre} {tecnico.apellido}' ya tiene "
                            f"{tareas_activas} tareas activas. "
                            f"El límite máximo es {LIMITE_TAREAS_ACTIVAS}."
                        )
                    )

                await db.execute(
                    delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id_tarea)
                )
                db.add(
                    EmpleadoTarea(id_empleado=nuevo_tecnico, id_tarea=id_tarea)
                )
                tarea.fecha_asignacion = tarea.fecha_asignacion or hoy()

    await db.flush()
    return await _tarea_a_response(db, tarea)


async def actualizar_estado(
    db: AsyncSession,
    id_tarea: int,
    data: TareaUpdateEstado,
) -> TareaResponse:
    """Actualiza el estado de una tarea aplicando las reglas de reapertura."""
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id_tarea))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise not_found(f"Tarea con id={id_tarea} no encontrada.")

    nuevo_estado = data.estado.value
    await _validar_limite_al_reabrir(db, tarea, nuevo_estado)

    if nuevo_estado == "completado":
        marcar_completada(tarea)
    else:
        tarea.estado_tarea = nuevo_estado
        marcar_reabierta(tarea)
        if nuevo_estado == "en_progreso" and tarea.fecha_inicio is None:
            tarea.fecha_inicio = hoy()

    await db.flush()
    return await _tarea_a_response(db, tarea)


async def reasignar_tarea(
    db: AsyncSession,
    id_tarea: int,
    data: TareaReasignar,
) -> TareaResponse:
    """Reasigna una tarea abierta a un técnico con capacidad disponible."""
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id_tarea))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise not_found(f"Tarea con id={id_tarea} no encontrada.")

    if tarea.estado_tarea in ESTADOS_TAREA_CERRADOS:
        raise bad_request(
            (
                f"La tarea está en estado '{tarea.estado_tarea}' y ya no puede "
                "reasignarse. Reábrela primero si necesitas cambiar el técnico."
            )
        )

    tecnico = await _buscar_tecnico_asignable(db, data.id_tecnico)
    tareas_activas = await _contar_tareas_activas(
        db, data.id_tecnico, excluir_tarea=id_tarea
    )
    if tareas_activas >= LIMITE_TAREAS_ACTIVAS:
        raise bad_request(
            (
                f"El técnico '{tecnico.nombre} {tecnico.apellido}' ya tiene "
                f"{tareas_activas} tareas activas. "
                f"El límite máximo es {LIMITE_TAREAS_ACTIVAS}."
            )
        )

    await db.execute(
        delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == id_tarea)
    )
    db.add(
        EmpleadoTarea(
            id_empleado=data.id_tecnico,
            id_tarea=id_tarea,
        )
    )
    tarea.fecha_asignacion = tarea.fecha_asignacion or hoy()

    await db.flush()
    return await _tarea_a_response(db, tarea)


async def iniciar_tarea(
    db: AsyncSession,
    id_tarea: int,
    current_user: Empleado,
) -> dict:
    """Inicia de forma idempotente una tarea asignada."""
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id_tarea))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise not_found(f"Tarea con id={id_tarea} no encontrada.")

    if current_user.rol == "tecnico":
        result_asig = await db.execute(
            select(EmpleadoTarea).where(
                EmpleadoTarea.id_tarea == id_tarea,
                EmpleadoTarea.id_empleado == current_user.id_empleado,
            )
        )
        if not result_asig.scalar_one_or_none():
            raise forbidden(
                (
                    "No tienes permiso para iniciar esta tarea. "
                    "Solo el técnico asignado puede iniciarla."
                )
            )

    if tarea.estado_tarea == "completado":
        raise bad_request(
            "Esta tarea ya fue completada. No se puede volver a iniciar."
        )
    if tarea.estado_tarea == "cancelado":
        raise bad_request(
            "Esta tarea está cancelada. Pide a tu supervisor que la reactive."
        )

    ya_en_curso = tarea.estado_tarea == "en_progreso"
    if not ya_en_curso:
        tarea.estado_tarea = "en_progreso"
        if tarea.fecha_inicio is None:
            tarea.fecha_inicio = hoy()

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


async def finalizar_tarea(
    db: AsyncSession,
    id_tarea: int,
    current_user: Empleado,
) -> TareaResponse:
    """Finaliza una tarea en curso que ya cuenta con evidencia."""
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id_tarea))
    tarea = result.scalar_one_or_none()

    if not tarea:
        raise not_found(f"Tarea con id={id_tarea} no encontrada.")

    if current_user.rol == "tecnico":
        result_asig = await db.execute(
            select(EmpleadoTarea).where(
                EmpleadoTarea.id_tarea == id_tarea,
                EmpleadoTarea.id_empleado == current_user.id_empleado,
            )
        )
        if result_asig.scalar_one_or_none() is None:
            raise forbidden(
                (
                    "No tienes permiso para finalizar esta tarea. "
                    "Solo el técnico asignado puede cerrarla."
                )
            )

    validar_cierre_permitido(tarea)
    if await _contar_incidencias(db, id_tarea) == 0:
        raise bad_request(
            (
                "Registra la evidencia (descripción y foto) antes de finalizar "
                "la tarea."
            )
        )

    marcar_completada(tarea)
    await db.flush()
    return await _tarea_a_response(db, tarea)


async def obtener_tareas_completadas(
    db: AsyncSession,
    current_user: Empleado,
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    id_tecnico: Optional[int] = None,
) -> HistorialTareasResponse:
    """Obtiene el historial de tareas completadas agrupado por día."""
    hoy_referencia = hoy()
    hasta = fecha_hasta or hoy_referencia
    desde = fecha_desde or (hasta - timedelta(days=6))

    if desde > hasta:
        raise bad_request("La fecha inicial no puede ser posterior a la final.")

    id_empleado_filtro = (
        id_tecnico
        if current_user.rol in ROLES_SUPERVISION
        else current_user.id_empleado
    )
    momento_cierre = func.coalesce(
        Tarea.fecha_completado,
        cast(Tarea.fecha_inicio, DateTime),
    )
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
    dias: "OrderedDict[date, List[TareaCompletadaResponse]]" = OrderedDict()

    for tarea in tareas:
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
