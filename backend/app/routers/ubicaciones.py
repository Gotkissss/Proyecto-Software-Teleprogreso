# backend/app/routers/ubicaciones.py
"""
Router de Ubicaciones — Teleprogreso S.A. (SCRUM-215)
-----------------------------------------------------------------------------
Registra la posición que reporta el técnico mientras está en jornada.

Endpoint que se tiene:
  POST /ubicaciones = Guarda la posición actual del empleado autenticado

Este router solo escribe. La lectura del rastro de ubicaciones es un dato
sensible (dice dónde estuvo una persona y a qué hora), así que no se expone
aquí: cuando haga falta, irá en un endpoint aparte con control de rol propio.

El empleado dueño de la ubicación sale siempre del token, nunca del cuerpo de
la petición. Si se aceptara como parámetro, cualquier técnico podría sembrar
posiciones a nombre de un compañero y fabricarle una coartada.
-----------------------------------------------------------------------------
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado
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
    salida el lunes seguiría figurando en jornada el jueves, y este endpoint
    le aceptaría posiciones sin que hubiera abierto turno. Se aplica la misma
    regla que POST /asistencia/salida (es_del_turno_en_curso): vale la jornada
    de hoy, o la de ayer si el turno cruzó la medianoche.

    Se piden todas las filas en lugar de usar `scalar_one_or_none()`: ese
    método lanza MultipleResultsFound en cuanto hay dos jornadas abiertas —un
    doble clic en "Entrada" ya las crea— y el técnico se quedaría sin poder
    reportar su ubicación, con un 500 sin explicación.
    """
    result = await db.execute(
        select(Asistencia)
        .where(
            Asistencia.id_empleado == id_empleado,
            Asistencia.hora_salida.is_(None),
        )
        .order_by(Asistencia.fecha.desc(), Asistencia.hora_entrada.desc())
    )
    ahora = ahora_local()
    return next(
        (j for j in result.scalars().all() if es_del_turno_en_curso(j, ahora)),
        None,
    )


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
