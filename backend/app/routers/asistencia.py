# backend/app/routers/asistencia.py
"""
Router de Asistencia — Teleprogreso S.A.
----------------
Gestiona el registro de entrada/salida del empleado autenticado.

Todos los endpoints estan protegidos con JWT mediante la dependencia
get_current_empleado. El empleado solo puede registrar su propia asistencia.

Endpoints que se tieneen:
  POST /asistencia/entrada    = Registra la hora de entrada
  POST /asistencia/salida     = Registra la hora de salida
  GET  /asistencia/hoy        = Consulta la asistencia del día actual
  GET  /asistencia/historial  = Historial de jornadas con filtros y paginación
"""

from datetime import date, datetime
from math import ceil
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_empleado
from app.db.session import get_db
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado
from app.schemas.asistencia import (
    DescansoResumen,
    HistorialAsistenciaResponse,
    HistorialTotales,
    JornadaResponse,
)
from app.services.asistencia import calcular_jornada, formatear_hhmm

router = APIRouter(prefix="/asistencia", tags=["Asistencia"])

# Roles que pueden consultar el historial de cualquier empleado.
# El resto (tecnicos) solo puede ver su propio historial.
ROLES_SUPERVISION = ("admin", "supervisor", "gerente")



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


# ─────── GET /asistencia/historial ───────────────────────────────────────────

def _construir_jornada(asistencia: Asistencia, hoy: date) -> JornadaResponse:
    """
    Convierte un registro de Asistencia (con sus descansos ya cargados)
    en la respuesta del historial, incluyendo horas trabajadas y pausas.

    Para la jornada del día en curso se usa la hora actual como referencia
    para que el supervisor vea el avance en tiempo real; las jornadas de días
    anteriores que quedaron abiertas no inventan tiempo y reportan 00:00.
    """
    referencia = datetime.now().time() if asistencia.fecha == hoy else None
    resumen = calcular_jornada(asistencia, asistencia.descansos, referencia=referencia)

    empleado = asistencia.empleado

    return JornadaResponse(
        id_asistencia=asistencia.id_asistencia,
        id_empleado=asistencia.id_empleado,
        nombre_empleado=(
            f"{empleado.nombre} {empleado.apellido}" if empleado else "—"
        ),
        rol=empleado.rol if empleado else "—",
        fecha=asistencia.fecha,
        hora_entrada=asistencia.hora_entrada,
        hora_salida=asistencia.hora_salida,
        jornada_activa=resumen.jornada_activa,
        minutos_brutos=resumen.minutos_brutos,
        minutos_pausa=resumen.minutos_pausa,
        minutos_trabajados=resumen.minutos_trabajados,
        horas_brutas=formatear_hhmm(resumen.minutos_brutos),
        horas_pausa=formatear_hhmm(resumen.minutos_pausa),
        horas_trabajadas=formatear_hhmm(resumen.minutos_trabajados),
        total_pausas=resumen.total_pausas,
        descansos=[
            DescansoResumen(
                id_descanso=p.id_descanso,
                hora_inicio=p.hora_inicio,
                hora_fin=p.hora_fin,
                minutos=p.minutos,
                en_curso=p.en_curso,
            )
            for p in resumen.pausas
        ],
    )


@router.get(
    "/historial",
    response_model=HistorialAsistenciaResponse,
    summary="Historial de jornadas con horas trabajadas y pausas",
    status_code=status.HTTP_200_OK,
)
async def get_historial_asistencia(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
    empleado: Optional[int] = Query(
        None,
        description="ID del empleado a consultar. Solo admin/supervisor/gerente "
                    "pueden consultar a otros empleados.",
    ),
    fecha_inicio: Optional[date] = Query(
        None, description="Fecha mínima (YYYY-MM-DD), inclusive."
    ),
    fecha_fin: Optional[date] = Query(
        None, description="Fecha máxima (YYYY-MM-DD), inclusive."
    ),
    page: int = Query(1, ge=1, description="Página solicitada (empieza en 1)."),
    page_size: int = Query(
        20, ge=1, le=100, description="Cantidad de jornadas por página."
    ),
):
    """
    Devuelve el historial de jornadas con el cálculo de horas trabajadas y
    tiempo en pausas de cada una.

    Filtros: `empleado`, `fecha_inicio`, `fecha_fin`. Paginación: `page` y
    `page_size`.

    Control de acceso:
    - admin, supervisor y gerente ven el historial de cualquier empleado.
    - el resto de roles solo puede ver su propio historial (el parámetro
      `empleado` se ignora y se fuerza al usuario autenticado).

    Los totales del bloque `totales` corresponden a **todo el rango filtrado**,
    no solo a la página devuelta, para que la UI pueda mostrar acumulados
    correctos sin recorrer todas las páginas.
    """
    # ── 1. Resolver el empleado consultado según el rol ──────────────────────
    if current_user.rol in ROLES_SUPERVISION:
        id_empleado = empleado
    else:
        id_empleado = current_user.id_empleado

    if fecha_inicio and fecha_fin and fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha de inicio no puede ser posterior a la fecha de fin.",
        )

    # ── 2. Filtros comunes ───────────────────────────────────────────────────
    filtros = []
    if id_empleado is not None:
        filtros.append(Asistencia.id_empleado == id_empleado)
    if fecha_inicio is not None:
        filtros.append(Asistencia.fecha >= fecha_inicio)
    if fecha_fin is not None:
        filtros.append(Asistencia.fecha <= fecha_fin)

    # ── 3. Total de jornadas que cumplen el filtro ───────────────────────────
    result_total = await db.execute(
        select(func.count(Asistencia.id_asistencia)).where(*filtros)
    )
    total: int = result_total.scalar() or 0
    total_pages = ceil(total / page_size) if total else 0

    hoy = date.today()

    # ── 4. Página solicitada ─────────────────────────────────────────────────
    query = (
        select(Asistencia)
        .options(
            selectinload(Asistencia.descansos),
            selectinload(Asistencia.empleado),
        )
        .where(*filtros)
        .order_by(Asistencia.fecha.desc(), Asistencia.hora_entrada.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    items = [_construir_jornada(a, hoy) for a in result.scalars().all()]

    # ── 5. Totales del rango completo ────────────────────────────────────────
    # El cálculo se hace en Python porque las horas se guardan como TIME y hay
    # que contemplar turnos que cruzan medianoche. Para el volumen del proyecto
    # es suficiente; si el historial crece, conviene precalcular los minutos en
    # una columna o materializar un resumen diario.
    totales = await _calcular_totales(db, filtros, hoy)

    return HistorialAsistenciaResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        totales=totales,
        items=items,
    )


async def _calcular_totales(db: AsyncSession, filtros: list, hoy: date) -> HistorialTotales:
    """
    Acumula minutos brutos, en pausa y trabajados de todas las jornadas que
    cumplen el filtro (no solo las de la página actual).
    """
    result = await db.execute(
        select(Asistencia)
        .options(selectinload(Asistencia.descansos))
        .where(*filtros)
    )
    jornadas = result.scalars().all()

    minutos_brutos = 0
    minutos_pausa = 0
    minutos_trabajados = 0
    abiertas = 0

    for jornada in jornadas:
        referencia = datetime.now().time() if jornada.fecha == hoy else None
        resumen = calcular_jornada(jornada, jornada.descansos, referencia=referencia)
        minutos_brutos += resumen.minutos_brutos
        minutos_pausa += resumen.minutos_pausa
        minutos_trabajados += resumen.minutos_trabajados
        if resumen.jornada_activa:
            abiertas += 1

    cantidad = len(jornadas)
    promedio = minutos_trabajados // cantidad if cantidad else 0

    return HistorialTotales(
        jornadas=cantidad,
        jornadas_abiertas=abiertas,
        minutos_trabajados=minutos_trabajados,
        minutos_pausa=minutos_pausa,
        minutos_brutos=minutos_brutos,
        horas_trabajadas=formatear_hhmm(minutos_trabajados),
        horas_pausa=formatear_hhmm(minutos_pausa),
        horas_brutas=formatear_hhmm(minutos_brutos),
        promedio_minutos_trabajados=promedio,
    )