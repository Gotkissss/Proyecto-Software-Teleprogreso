# backend/app/routers/ubicaciones.py
"""
Router de Ubicaciones — Teleprogreso S.A. (SCRUM-215)
-----------------------------------------------------------------------------
Registra la posición que reporta el técnico mientras está en jornada.

Endpoints:
  POST /ubicaciones                          = Guarda la posición actual del empleado autenticado
  POST /ubicaciones/lote                     = Guarda puntos tomados sin conexión (HU-5)
  GET  /ubicaciones/tecnicos                 = Última posición de cada técnico en jornada
  GET  /ubicaciones/{id_empleado}/recorrido  = Recorrido de un técnico en un día (HU-5)

El rastro de ubicaciones es un dato sensible (dice dónde estuvo una persona y a
qué hora): las lecturas solo están abiertas a admin, supervisor y gerente.

El empleado dueño de la ubicación sale siempre del token, nunca del cuerpo de
la petición. Si se aceptara como parámetro, cualquier técnico podría sembrar
posiciones a nombre de un compañero y fabricarle una coartada.
-----------------------------------------------------------------------------
"""

from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.ubicacion import (
    RecorridoResponse,
    UbicacionCreate,
    UbicacionLoteCreate,
    UbicacionLoteResponse,
    UbicacionResponse,
    UbicacionTecnicoResponse,
)
from app.services.asistencia import es_del_turno_en_curso
from app.services.ubicaciones import (
    jornada_en_curso,
    obtener_recorrido,
    obtener_ultimas_ubicaciones,
    registrar_lote,
)

from app.core.deps import get_current_empleado, require_admin_supervisor_gerente
from app.core.exceptions import conflict
from app.core.geo import punto_wkt

# Reloj de la operación (America/Guatemala). El contenedor corre en UTC:
# usar datetime.now() aquí desplazaría las horas 6 posiciones.
from app.core.tiempo import ahora as ahora_local
from app.db.session import get_db
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado
from app.models.ubicacion import UbicacionEmpleado
from app.schemas.ubicacion import UbicacionCreate, UbicacionResponse
from app.services.asistencia import es_del_turno_en_curso

router = APIRouter(prefix="/ubicaciones", tags=["Ubicaciones"])


async def _jornada_en_curso(db: AsyncSession, id_empleado: int) -> Optional[Asistencia]:
    """
    Jornada del turno en marcha (entrada sin salida), o None.

    No basta con "cualquier jornada sin salida": un técnico que olvidó marcar
    salida el lunes seguiría figurando en jornada el jueves. Se aplica la
    regla es_del_turno_en_curso, compartida con la salida, las pausas y
    (desde HU-5) el bloqueo de tareas sin jornada: la consulta vive en
    services/ubicaciones.jornada_en_curso. La hora se toma aquí para que sea
    la del reloj de este router.
    """
    return await jornada_en_curso(db, id_empleado, ahora_local())


# ─── POST /ubicaciones ───────────────────────────────────────────────────────

@router.post(
    "",
    response_model=UbicacionResponse,
    summary="Reportar la ubicación actual del técnico",
    status_code=status.HTTP_201_CREATED,
)
async def registrar_ubicacion(
    data: UbicacionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Guarda la posición GPS del empleado autenticado como punto PostGIS.

    Reglas de negocio:
    - El empleado debe tener una jornada abierta (entrada sin salida). Fuera
      de jornada la empresa no tiene por qué saber dónde está.
    - La posición se atribuye siempre al dueño del token; el cuerpo de la
      petición no puede elegir a qué empleado pertenece.

    Errores que se pueden dar:
    - 401 si el token falta, está expirado o fue revocado.
    - 403 si la cuenta está inactiva.
    - 409 si no hay jornada abierta.
    - 422 si lat o lng faltan o caen fuera del rango válido.
    """
    # 1. Sin jornada del turno en curso no se guarda nada.
    #
    #    Responde 409 y no 400: el cuerpo que mandó el técnico está perfecto,
    #    lo que no encaja es el estado en que se encuentra su jornada. Esa
    #    diferencia le sirve al frontend para distinguir "corrige el dato" de
    #    "marca tu entrada primero".
    if await _jornada_en_curso(db, current_user.id_empleado) is None:
        raise conflict(
            "No tienes una jornada abierta. "
            "Registra tu entrada antes de reportar tu ubicación."
        )

    # 2. Crear el registro.
    #
    #    La hora se fija desde el código y no se deja al server_default NOW()
    #    de la tabla: ese NOW() lo resuelve PostgreSQL, que en Railway corre
    #    en UTC, y el rastro del día aparecería 6 horas adelantado frente al
    #    resto de registros (entradas, pausas, tareas), que sí guardan hora de
    #    Guatemala.
    ubicacion = UbicacionEmpleado(
        id_empleado=current_user.id_empleado,
        fecha_hora_registro=ahora_local(),
        coordenada=punto_wkt(data.lat, data.lng),
    )

    db.add(ubicacion)
    await db.flush()  # para obtener el id_ubicacion generado

    return UbicacionResponse(
        id_ubicacion=ubicacion.id_ubicacion,
        fecha_hora_registro=ubicacion.fecha_hora_registro,
    )

@router.get(
    "/tecnicos",
    response_model=list[UbicacionTecnicoResponse],
    summary="Última posición conocida de cada técnico en jornada",
)
async def listar_ubicaciones_tecnicos(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    return await obtener_ultimas_ubicaciones(db)


# ─── POST /ubicaciones/lote ──────────────────────────────────────────────────

@router.post(
    "/lote",
    response_model=UbicacionLoteResponse,
    summary="Guardar puntos tomados sin conexión",
    status_code=status.HTTP_200_OK,
)
async def registrar_ubicaciones_lote(
    data: UbicacionLoteCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Guarda los puntos que el técnico acumuló mientras no tenía señal (HU-5).

    Cada punto trae la hora real en que se tomó. Se descartan, sin fallar el
    envío completo, los que caen fuera de una jornada del técnico, los que
    tienen hora futura y los que ya estaban guardados (reintentos).

    Como en POST /ubicaciones, el dueño de los puntos sale del token.
    """
    guardados, descartados = await registrar_lote(db, current_user, data.puntos)
    await db.flush()
    return UbicacionLoteResponse(guardados=guardados, descartados=descartados)


# ─── GET /ubicaciones/{id_empleado}/recorrido ────────────────────────────────

@router.get(
    "/{id_empleado}/recorrido",
    response_model=RecorridoResponse,
    summary="Recorrido de un técnico en un día",
)
async def get_recorrido(
    id_empleado: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
    fecha: Annotated[
        Optional[date],
        Query(description="Día a consultar (YYYY-MM-DD). Por defecto, hoy."),
    ] = None,
):
    """
    Puntos del técnico en ese día, en orden cronológico y con su hora (HU-5):
    reportes periódicos, inicio y fin de tareas, y el lugar de la entrada y la
    salida. Cada punto indica si antes hubo un hueco sin datos.

    Si ese día no hay datos, `puntos` viene vacío (no es un error).

    Roles: admin, supervisor y gerente. 404 si el empleado no existe.
    """
    return await obtener_recorrido(db, id_empleado, fecha or ahora_local().date())

