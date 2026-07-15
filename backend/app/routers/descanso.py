# backend/app/routers/descanso.py
"""
Router de Descanso — Teleprogreso S.A.
--------------
Gestiona el registro de inicio y fin de descanso del empleado autenticado.

Todos los endpoints estan protegidos con JWT mediante get_current_empleado.
El empleado solo puede registrar su propio descanso.

Endpoints:
  POST /descanso/iniciar   = Registra el inicio de un descanso
  POST /descanso/finalizar = Registra el fin del descanso activo
  GET  /descanso/activo    = Consulta si hay un descanso activo ahora mismo
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado
from app.db.session import get_db
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado

router = APIRouter(prefix="/descanso", tags=["Descanso"])


# GET /descanso/tipos
# Configuración estática de los tipos de pausa según normativa de Teleprogreso S.A.
# No requiere autenticación — son datos de configuración pública del sistema.

@router.get(
    "/tipos",
    summary="Listar tipos de pausa disponibles",
    status_code=status.HTTP_200_OK,
)
async def get_tipos_pausa():
    """
    Retorna la lista de tipos de pausa permitidos según la normativa operativa.
    Estos valores son estáticos: no vienen de la BD.

    Campos:
      - id:              identificador interno usado al iniciar la pausa
      - label:           nombre visible en la UI
      - duracion_max_min: duración máxima permitida en minutos
    """
    return [
        {"id": "almuerzo", "label": "Pausa de Almuerzo",        "duracion_max_min": 60},
        {"id": "tecnica",  "label": "Pausa Técnica (Soporte)",  "duracion_max_min": 15},
        {"id": "personal", "label": "Pausa Personal",            "duracion_max_min": 10},
    ]




# POST /descanso/iniciar
# Registra el inicio de un descanso para el empleado autenticado, siempre que tenga una jornada activa y no haya otro descanso en curso.


@router.post(
    "/iniciar",
    summary="Iniciar descanso",
    status_code=status.HTTP_201_CREATED,
)
async def iniciar_descanso(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Registra el inicio de un descanso para el empleado autenticado.

    Reglas de negocio:
    - El empleado debe tener una jornada activa (entrada sin salida).
    - No puede iniciar un descanso si ya tiene uno activo (sin hora_fin).
    - Requiere token JWT válido en Authorization: Bearer <token>.

    Errores que se pueden dar:
    - 400 si no hay jornada activa.
    - 400 si ya hay un descanso en curso.
    - 401 si el token es invalido o expirado.
    - 403 si la cuenta está inactiva.
    """
    # 1. Verificar que el empleado tenga una jornada activa
    result_jornada = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == current_user.id_empleado,
            Asistencia.hora_salida.is_(None),
        )
    )
    jornada_activa = result_jornada.scalar_one_or_none()

    if not jornada_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No tienes una jornada activa. "
                "Registra tu entrada antes de iniciar un descanso."
            ),
        )

    # 2. Verificar que no haya ya un descanso en curso (sin hora_fin)
    result_descanso = await db.execute(
        select(Descanso).where(
            Descanso.id_asistencia == jornada_activa.id_asistencia,
            Descanso.hora_fin.is_(None),
        )
    )
    descanso_activo = result_descanso.scalar_one_or_none()

    if descanso_activo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Ya tienes un descanso en curso. "
                "Finaliza el descanso actual antes de iniciar uno nuevo."
            ),
        )

    # 3. Crear el nuevo descanso
    now = datetime.now()
    nuevo_descanso = Descanso(
        id_asistencia=jornada_activa.id_asistencia,
        hora_inicio=now.time(),
    )

    db.add(nuevo_descanso)
    await db.flush()  # obtener id_descanso generado

    return {
        "message": "Descanso iniciado correctamente",
        "id_descanso": nuevo_descanso.id_descanso,
        "id_asistencia": jornada_activa.id_asistencia,
        "empleado": f"{current_user.nombre} {current_user.apellido}",
        "hora_inicio": now.time().strftime("%H:%M:%S"),
    }



# POST /descanso/finalizar 
# lo que hace es buscar el descanso activo del empleado autenticado y registrar la hora de fin

@router.post(
    "/finalizar",
    summary="Finalizar descanso activo",
    status_code=status.HTTP_200_OK,
)
async def finalizar_descanso(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Registra el fin del descanso activo del empleado autenticado.

    Reglas de negocio:
    - El empleado debe tener una jornada activa.
    - Debe existir un descanso activo (sin hora_fin) en esa jornada.
    - Requiere token JWT válido en Authorization: Bearer <token>.

    Errores posibles:
    - 400 si no hay jornada activa.
    - 400 si no hay ningún descanso en curso.
    - 401 si el token es inválido o expirado.
    - 403 si la cuenta está inactiva.
    """
    # 1. Verificar jornada activa
    result_jornada = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == current_user.id_empleado,
            Asistencia.hora_salida.is_(None),
        )
    )
    jornada_activa = result_jornada.scalar_one_or_none()

    if not jornada_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tienes una jornada activa.",
        )

    # 2. Buscar el descanso activo (sin hora_fin)
    result_descanso = await db.execute(
        select(Descanso).where(
            Descanso.id_asistencia == jornada_activa.id_asistencia,
            Descanso.hora_fin.is_(None),
        )
    )
    descanso_activo = result_descanso.scalar_one_or_none()

    if not descanso_activo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No tienes ningún descanso en curso. "
                "Inicia un descanso antes de intentar finalizarlo."
            ),
        )

    # 3. Registrar la hora de fin
    now = datetime.now()
    descanso_activo.hora_fin = now.time()

    return {
        "message": "Descanso finalizado correctamente",
        "id_descanso": descanso_activo.id_descanso,
        "hora_inicio": descanso_activo.hora_inicio.strftime("%H:%M:%S"),
    }
