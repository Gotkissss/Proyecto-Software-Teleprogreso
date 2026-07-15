# backend/app/routers/asistencia.py
"""
Router de Asistencia — Teleprogreso S.A.
----------------
Gestiona el registro de entrada/salida del empleado autenticado.

Todos los endpoints estan protegidos con JWT mediante la dependencia
get_current_empleado. El empleado solo puede registrar su propia asistencia.

Endpoints que se tieneen:
  POST /asistencia/entrada  = Registra la hora de entrada
  POST /asistencia/salida   = Registra la hora de salida
  GET  /asistencia/hoy      = Consulta la asistencia del día actual
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado
from app.db.session import get_db
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado

router = APIRouter(prefix="/asistencia", tags=["Asistencia"])



#-------- POST /asistencia/entrada-----------------

@router.post(
    "/entrada",
    summary="Registrar entrada",
    status_code=status.HTTP_201_CREATED,
)
async def registrar_entrada(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Registra la hora de entrada del empleado autenticado.

    - Solo el propio empleado puede registrar su entrada (el token lo identifica).
    - No permite registrar una segunda entrada si ya existe una jornada activa
      (sin hora de salida) para el día actual.
    - Requiere token JWT válido en el header Authorization: Bearer <token>.
    """
    # 1. Verificar si ya existe una jornada activa (entrada sin salida)
    result = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == current_user.id_empleado,
            Asistencia.hora_salida.is_(None),
        )
    )
    asistencia_activa = result.scalar_one_or_none()

    if asistencia_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe una jornada activa para este empleado. "
                   "Registra la salida antes de iniciar una nueva jornada.",
        )

    # 2. Capturar fecha y hora actuales
    now = datetime.now()

    # 3. Crear el registro de asistencia
    nueva_asistencia = Asistencia(
        id_empleado=current_user.id_empleado,
        fecha=now.date(),
        hora_entrada=now.time(),
        coordenada_entrada=None,  # GPS opcional pueda ser  para  sprint futuro
    )

    db.add(nueva_asistencia)
    await db.flush()  # Para obtener el id_asistencia generado

    return {
        "message": "Entrada registrada correctamente",
        "id_asistencia": nueva_asistencia.id_asistencia,
        "empleado": f"{current_user.nombre} {current_user.apellido}",
        "fecha": str(now.date()),
        "hora_entrada": str(now.time().strftime("%H:%M:%S")),
    }


#----------- POST /asistencia/salida--------------------

@router.post(
    "/salida",
    summary="Registrar salida",
    status_code=status.HTTP_200_OK,
)
async def registrar_salida(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Registra la hora de salida del empleado autenticado.

    - Busca la jornada activa (entrada sin salida) del empleado.
    - Si no existe jornada activa, retorna 400.
    - Requiere token JWT válido en el header Authorization: Bearer <token>.
    """
    # 1. Buscar la jornada activa del empleado
    result = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == current_user.id_empleado,
            Asistencia.hora_salida.is_(None),
        )
    )
    asistencia_activa = result.scalar_one_or_none()

    if not asistencia_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No existe una jornada activa. "
                   "Registra la entrada primero.",
        )

    # 2. Registrar la hora de salida
    now = datetime.now()
    asistencia_activa.hora_salida = now.time()

    return {
        "message": "Salida registrada correctamente",
        "id_asistencia": asistencia_activa.id_asistencia,
        "empleado": f"{current_user.nombre} {current_user.apellido}",
        "fecha": str(asistencia_activa.fecha),
        "hora_entrada": str(asistencia_activa.hora_entrada.strftime("%H:%M:%S")),
        "hora_salida": str(now.time().strftime("%H:%M:%S")),
    }



#----------- -------GET /asistencia/hoy-------------------- 

@router.get(
    "/hoy",
    summary="Consultar asistencia de hoy",
    status_code=status.HTTP_200_OK,
)
async def get_asistencia_hoy(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Retorna la asistencia del día actual del empleado autenticado.

    - Si no hay registro de entrada hoy, retorna 404.
    - Requiere token JWT válido en el header Authorization: Bearer <token>.
    """
    from datetime import date

    # Buscar asistencia del dia actual para el empleado autenticado
    result = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == current_user.id_empleado,
            Asistencia.fecha == date.today(),
        )
    )
    asistencia = result.scalar_one_or_none()

    if not asistencia:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró registro de asistencia para hoy.",
        )

    return {
        "id_asistencia": asistencia.id_asistencia,
        "empleado": f"{current_user.nombre} {current_user.apellido}",
        "fecha": str(asistencia.fecha),
        "hora_entrada": str(asistencia.hora_entrada.strftime("%H:%M:%S")) if asistencia.hora_entrada else None,
        "hora_salida": str(asistencia.hora_salida.strftime("%H:%M:%S")) if asistencia.hora_salida else None,
        "jornada_activa": asistencia.hora_salida is None,
    }