# backend/app/routers/descanso.py
"""
Router de Descanso — Teleprogreso S.A.
--------------
Gestiona el registro de inicio y fin de descanso del empleado autenticado.

Todos los endpoints estan protegidos con JWT mediante get_current_empleado.
El empleado solo puede registrar su propio descanso.

Endpoints:
  GET  /descanso/tipos     = Tipos de pausa permitidos por normativa
  POST /descanso/iniciar   = Registra el inicio de un descanso
  POST /descanso/finalizar = Registra el fin del descanso activo
  GET  /descanso/activo    = Consulta si hay un descanso activo ahora mismo
  GET  /descanso/hoy       = Pausas de la jornada de hoy (para reconstruir la UI)

Nota de diseño: la pantalla de Pausas del técnico no guarda nada en memoria del
navegador. Todo lo que muestra (cronómetro, pausa en curso, historial, pausas ya
usadas) se reconstruye desde `/descanso/hoy`, para que cerrar sesión, recargar o
cambiar de pestaña no reinicie el estado.
"""

from datetime import date, datetime, time
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

# Reloj de la operación (America/Guatemala). El contenedor corre en UTC:
# usar datetime.now() aquí desplazaba las fechas 6 horas.
from app.core.tiempo import ahora as ahora_local, hora_actual as hora_local, hoy as hoy_local
from app.core.deps import get_current_empleado
from app.db.session import get_db
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado
from app.services.asistencia import segundos_entre
from app.services.pausas import (
    Catalogo,
    cargar_catalogo,
    duracion_max_min,
    label,
    tipo_valido,
)

router = APIRouter(prefix="/descanso", tags=["Descanso"])


class DescansoIniciar(BaseModel):
    """
    Body opcional de POST /descanso/iniciar.

    Se acepta sin body para no romper a los clientes que llamaban al endpoint
    sin parámetros; en ese caso la pausa se registra como 'personal'.
    """

    tipo: Optional[str] = Field(
        None,
        description="almuerzo | tecnica | personal. Si se omite, se usa 'personal'.",
    )


def _serializar_descanso(descanso: Descanso, ahora: time, catalogo: Catalogo) -> dict:
    """
    Convierte un Descanso en el objeto que consume la pantalla de Pausas.

    Para una pausa en curso, `duracion_segundos` se calcula contra la hora
    actual: así el cronómetro del navegador arranca en el valor real que lleva
    la pausa en lugar de en cero.

    El catálogo llega ya cargado desde el endpoint: serializar en bucle las
    pausas del día haría una consulta por pausa si se leyera aquí dentro.
    """
    en_curso = descanso.hora_fin is None
    referencia = ahora if en_curso else descanso.hora_fin
    transcurridos = segundos_entre(descanso.hora_inicio, referencia)
    maximo = duracion_max_min(catalogo, descanso.tipo) * 60

    return {
        "id_descanso":        descanso.id_descanso,
        "tipo":               descanso.tipo,
        "label":              label(catalogo, descanso.tipo),
        "hora_inicio":        descanso.hora_inicio.strftime("%H:%M:%S"),
        "hora_fin":           descanso.hora_fin.strftime("%H:%M:%S") if descanso.hora_fin else None,
        "duracion_segundos":  transcurridos,
        "duracion_max_seg":   maximo,
        "segundos_restantes": max(0, maximo - transcurridos) if en_curso else 0,
        "excedida":           transcurridos > maximo,
        "en_curso":           en_curso,
    }


async def _jornada_activa(db: AsyncSession, id_empleado: int) -> Optional[Asistencia]:
    """
    Jornada abierta (entrada sin salida) más reciente del empleado, o None.

    Se ordena por fecha descendente para que una jornada vieja que quedó sin
    cerrar no se lleve las pausas de hoy.
    """
    result = await db.execute(
        select(Asistencia)
        .where(
            Asistencia.id_empleado == id_empleado,
            Asistencia.hora_salida.is_(None),
        )
        .order_by(Asistencia.fecha.desc(), Asistencia.hora_entrada.desc())
    )
    return result.scalars().first()


async def _descanso_activo(db: AsyncSession, id_asistencia: int) -> Optional[Descanso]:
    """Descanso sin hora_fin de esa jornada, o None."""
    result = await db.execute(
        select(Descanso).where(
            Descanso.id_asistencia == id_asistencia,
            Descanso.hora_fin.is_(None),
        )
    )
    return result.scalars().first()


# ─── GET /descanso/tipos ─────────────────────────────────────────────────────

@router.get(
    "/tipos",
    summary="Listar tipos de pausa disponibles",
    status_code=status.HTTP_200_OK,
)
async def get_tipos_pausa(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Retorna la lista de tipos de pausa permitidos según la normativa operativa,
    leída de la tabla `tipo_pausa`.

    Campos:
      - id:               identificador interno usado al iniciar la pausa
      - label:            nombre visible en la UI
      - duracion_max_min: duración máxima permitida en minutos
    """
    catalogo = await cargar_catalogo(db)
    return [
        {
            "id": tipo_id,
            "label": config["label"],
            "duracion_max_min": config["duracion_max_min"],
        }
        for tipo_id, config in catalogo.items()
    ]


# ─── POST /descanso/iniciar ──────────────────────────────────────────────────

@router.post(
    "/iniciar",
    summary="Iniciar descanso",
    status_code=status.HTTP_201_CREATED,
)
async def iniciar_descanso(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
    data: Optional[DescansoIniciar] = None,
):
    """
    Registra el inicio de un descanso para el empleado autenticado.

    Reglas de negocio:
    - El empleado debe tener una jornada activa (entrada sin salida).
    - No puede iniciar un descanso si ya tiene uno activo (sin hora_fin).
    - Cada tipo de pausa se puede usar una sola vez por jornada.
    - Requiere token JWT válido en Authorization: Bearer <token>.

    Errores que se pueden dar:
    - 400 si no hay jornada activa.
    - 400 si ya hay un descanso en curso.
    - 400 si ese tipo de pausa ya se consumió en la jornada.
    - 401 si el token es invalido o expirado.
    - 403 si la cuenta está inactiva.
    """
    catalogo = await cargar_catalogo(db)
    tipo = tipo_valido(catalogo, data.tipo if data else None)

    # 1. Verificar que el empleado tenga una jornada activa
    jornada = await _jornada_activa(db, current_user.id_empleado)

    if not jornada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No tienes una jornada activa. "
                "Registra tu entrada antes de iniciar un descanso."
            ),
        )

    # 2. Verificar que no haya ya un descanso en curso (sin hora_fin)
    if await _descanso_activo(db, jornada.id_asistencia):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Ya tienes un descanso en curso. "
                "Finaliza el descanso actual antes de iniciar uno nuevo."
            ),
        )

    # 3. Una pausa de cada tipo por jornada. Esta regla vivía solo en el estado
    #    de React, así que recargar la pantalla la anulaba y el técnico podía
    #    repetir la misma pausa las veces que quisiera.
    result_mismo_tipo = await db.execute(
        select(Descanso).where(
            Descanso.id_asistencia == jornada.id_asistencia,
            Descanso.tipo == tipo,
        )
    )
    if result_mismo_tipo.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya usaste tu '{label(catalogo, tipo)}' en esta jornada.",
        )

    # 4. Crear el nuevo descanso
    now = ahora_local()
    nuevo_descanso = Descanso(
        id_asistencia=jornada.id_asistencia,
        hora_inicio=now.time(),
        tipo=tipo,
    )

    db.add(nuevo_descanso)
    await db.flush()  # obtener id_descanso generado

    return {
        "message": "Descanso iniciado correctamente",
        "id_descanso": nuevo_descanso.id_descanso,
        "id_asistencia": jornada.id_asistencia,
        "empleado": f"{current_user.nombre} {current_user.apellido}",
        "tipo": tipo,
        "label": label(catalogo, tipo),
        "duracion_max_seg": duracion_max_min(catalogo, tipo) * 60,
        "hora_inicio": now.time().strftime("%H:%M:%S"),
    }


# ─── POST /descanso/finalizar ────────────────────────────────────────────────

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
    jornada = await _jornada_activa(db, current_user.id_empleado)

    if not jornada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tienes una jornada activa.",
        )

    # 2. Buscar el descanso activo (sin hora_fin)
    descanso_activo = await _descanso_activo(db, jornada.id_asistencia)

    if not descanso_activo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No tienes ningún descanso en curso. "
                "Inicia un descanso antes de intentar finalizarlo."
            ),
        )

    # 3. Registrar la hora de fin
    now = ahora_local()
    descanso_activo.hora_fin = now.time()
    await db.flush()

    catalogo = await cargar_catalogo(db)

    return {
        "message": "Descanso finalizado correctamente",
        "id_descanso": descanso_activo.id_descanso,
        "tipo": descanso_activo.tipo,
        "label": label(catalogo, descanso_activo.tipo),
        "hora_inicio": descanso_activo.hora_inicio.strftime("%H:%M:%S"),
        "hora_fin": now.time().strftime("%H:%M:%S"),
        "duracion_segundos": segundos_entre(descanso_activo.hora_inicio, now.time()),
    }


# ─── GET /descanso/activo ────────────────────────────────────────────────────

@router.get(
    "/activo",
    summary="Consultar el descanso en curso",
    status_code=status.HTTP_200_OK,
)
async def get_descanso_activo(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Devuelve el descanso en curso del empleado, o `null` si no hay ninguno.

    Responde 200 con `pausa_activa: null` en vez de 404 porque "no estoy en
    pausa" es una respuesta perfectamente normal, no un error: la pantalla
    consulta este endpoint en cada carga.
    """
    jornada = await _jornada_activa(db, current_user.id_empleado)

    if not jornada:
        return {"jornada_activa": False, "pausa_activa": None}

    descanso = await _descanso_activo(db, jornada.id_asistencia)
    ahora = hora_local()
    catalogo = await cargar_catalogo(db)

    return {
        "jornada_activa": True,
        "id_asistencia": jornada.id_asistencia,
        "pausa_activa": _serializar_descanso(descanso, ahora, catalogo) if descanso else None,
    }


# ─── GET /descanso/hoy ───────────────────────────────────────────────────────

@router.get(
    "/hoy",
    summary="Pausas de la jornada de hoy",
    status_code=status.HTTP_200_OK,
)
async def get_descansos_hoy(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Estado completo de pausas de la jornada de hoy del empleado autenticado.

    Es la fuente única con la que la pantalla de Pausas se reconstruye tras un
    reinicio: qué pausa está en curso y cuánto lleva, cuáles ya se consumieron,
    el historial del día y el total acumulado en pausa.

    Si no hay jornada hoy devuelve la estructura vacía con 200, no un 404: es
    un estado válido (el técnico todavía no ha marcado entrada).
    """
    hoy = hoy_local()
    ahora = hora_local()

    result = await db.execute(
        select(Asistencia)
        .options(selectinload(Asistencia.descansos))
        .where(
            Asistencia.id_empleado == current_user.id_empleado,
            Asistencia.fecha == hoy,
        )
        .order_by(Asistencia.hora_entrada.desc())
    )
    jornada = result.scalars().first()

    if jornada is None:
        return {
            "fecha": str(hoy),
            "id_asistencia": None,
            "jornada_activa": False,
            "hora_entrada": None,
            "hora_salida": None,
            "segundos_brutos": 0,
            "segundos_trabajados": 0,
            "segundos_en_pausa": 0,
            "pausa_activa": None,
            "tipos_usados": [],
            "descansos": [],
        }

    descansos = sorted(jornada.descansos, key=lambda d: d.hora_inicio)
    catalogo = await cargar_catalogo(db)
    serializados = [_serializar_descanso(d, ahora, catalogo) for d in descansos]
    pausa_activa = next((d for d in serializados if d["en_curso"]), None)

    segundos_en_pausa = sum(d["duracion_segundos"] for d in serializados)

    # Segundos desde la entrada: la referencia es la salida real si ya cerró la
    # jornada, y la hora actual si sigue abierta.
    cierre = jornada.hora_salida or ahora
    segundos_brutos = segundos_entre(jornada.hora_entrada, cierre)

    return {
        "fecha": str(jornada.fecha),
        "id_asistencia": jornada.id_asistencia,
        "jornada_activa": jornada.hora_salida is None,
        "hora_entrada": jornada.hora_entrada.strftime("%H:%M:%S"),
        "hora_salida": jornada.hora_salida.strftime("%H:%M:%S") if jornada.hora_salida else None,
        "segundos_brutos": segundos_brutos,
        "segundos_trabajados": max(0, segundos_brutos - segundos_en_pausa),
        "segundos_en_pausa": segundos_en_pausa,
        "pausa_activa": pausa_activa,
        # Los tipos ya consumidos hoy: la UI los muestra deshabilitados.
        "tipos_usados": [d.tipo for d in descansos if d.tipo],
        "descansos": serializados,
    }
