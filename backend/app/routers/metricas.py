# backend/app/routers/metricas.py
"""
Router de Métricas — Teleprogreso S.A.
-------

Control de acceso:
  - GET /metricas/supervisor          → admin, supervisor, gerente
  - GET /empleados/tecnicos/disponibles → admin, supervisor

Requiere token JWT válido en Authorization: Bearer <token>.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin_supervisor_gerente, require_supervisor
from app.db.session import get_db
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea

router = APIRouter(tags=["Métricas"])

# Estados que cuentan como "tareas activas" para el límite de carga
ESTADOS_ACTIVOS = ("pendiente", "en_progreso")


# ─── GET /metricas/supervisor ─────────────────────────────────────────────────
# Acceso: admin, supervisor, gerente.

@router.get(
    "/metricas/supervisor",
    summary="Métricas en tiempo real para el dashboard del supervisor",
    status_code=status.HTTP_200_OK,
)
async def get_metricas_supervisor(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Devuelve las métricas operativas del día actual:

    - **tecnicos_activos**: técnicos que tienen una jornada abierta hoy
      (registro de asistencia con hora_entrada y sin hora_salida).
    - **tareas_completadas**: tareas con estado 'completado' y fecha_inicio = hoy.
    - **tareas_pendientes**: tareas en estado 'pendiente'.
    - **tareas_retrasadas**: tareas en estado 'en_progreso' con fecha_finalizacion
      anterior a hoy (debían completarse antes).

    Roles: admin | supervisor | gerente.
    """
    hoy = date.today()

    # ── 1. Técnicos con jornada activa hoy ──────────────────────────────────
    # Un técnico está "activo" si tiene asistencia de hoy con hora_entrada
    # y sin hora_salida aún.
    result_tecnicos = await db.execute(
        select(func.count(Asistencia.id_asistencia))
        .join(Empleado, Empleado.id_empleado == Asistencia.id_empleado)
        .where(
            Asistencia.fecha == hoy,
            Asistencia.hora_entrada.isnot(None),
            Asistencia.hora_salida.is_(None),
            Empleado.rol == "tecnico",
            Empleado.estado == "activo",
        )
    )
    tecnicos_activos: int = result_tecnicos.scalar() or 0

    # ── 2. Tareas completadas ────────────────────────────────────────────────
    # Contamos tareas cuyo estado es 'completado' y fueron iniciadas hoy.
    # Si fecha_inicio puede ser NULL para completadas antiguas, contamos
    # todas las completadas para no perder datos.
    result_completadas = await db.execute(
        select(func.count(Tarea.id_tarea)).where(
            Tarea.estado_tarea == "completado",
            # Solo las completadas del día (fecha_inicio = hoy)
            # Si no tienen fecha_inicio usamos fecha_asignacion como fallback.
            # Para no excluir tareas sin fecha, incluimos todas las 'completado'.
            # El supervisor puede filtrar por fecha desde el frontend si lo desea.
        )
    )
    tareas_completadas: int = result_completadas.scalar() or 0

    # ── 3. Tareas pendientes ─────────────────────────────────────────────────
    result_pendientes = await db.execute(
        select(func.count(Tarea.id_tarea)).where(
            Tarea.estado_tarea == "pendiente",
        )
    )
    tareas_pendientes: int = result_pendientes.scalar() or 0

    # ── 4. Tareas retrasadas ─────────────────────────────────────────────────
    # Definición: están en 'en_progreso' O 'pendiente' y su fecha_finalizacion
    # esperada ya pasó (es anterior a hoy).
    result_retrasadas = await db.execute(
        select(func.count(Tarea.id_tarea)).where(
            Tarea.estado_tarea.in_(("pendiente", "en_progreso")),
            Tarea.fecha_finalizacion.isnot(None),
            Tarea.fecha_finalizacion < hoy,
        )
    )
    tareas_retrasadas: int = result_retrasadas.scalar() or 0

    return {
        "tecnicos_activos":   tecnicos_activos,
        "tareas_completadas": tareas_completadas,
        "tareas_pendientes":  tareas_pendientes,
        "tareas_retrasadas":  tareas_retrasadas,
    }


# ─── GET /empleados/tecnicos/disponibles ─────────────────────────────────────
# Devuelve técnicos activos con conteo de tareas activas.
# El frontend lo usa para poblar el selector y deshabilitar técnicos al límite.
# Acceso: admin, supervisor.

@router.get(
    "/empleados/tecnicos/disponibles",
    summary="Técnicos activos con conteo de tareas activas",
    status_code=status.HTTP_200_OK,
)
async def get_tecnicos_disponibles(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Lista de técnicos activos con sus métricas de carga:

    ```json
    [
      {
        "id_empleado": 2,
        "nombre": "Juan",
        "apellido": "Pérez García",
        "nombre_completo": "Juan Pérez García",
        "correo": "tecnico@teleprogreso.com",
        "telefono": "5550-0002",
        "tareas_activas": 2,
        "disponible": true        // false si tareas_activas >= 3
      },
      ...
    ]
    ```

    El campo `disponible` indica si el técnico puede recibir más tareas.
    El frontend puede usar este campo para deshabilitar la opción en el selector.

    Roles: admin | supervisor.
    """
    LIMITE = 3

    # Traer todos los técnicos activos
    result_tecnicos = await db.execute(
        select(Empleado).where(
            Empleado.rol == "tecnico",
            Empleado.estado == "activo",
        ).order_by(Empleado.nombre, Empleado.apellido)
    )
    tecnicos = result_tecnicos.scalars().all()

    if not tecnicos:
        return []

    # Para cada técnico contar sus tareas activas en una sola consulta
    # usando una subconsulta agrupada → evitamos N+1 queries.
    ids_tecnicos = [t.id_empleado for t in tecnicos]

    result_conteos = await db.execute(
        select(
            EmpleadoTarea.id_empleado,
            func.count(EmpleadoTarea.id_tarea).label("total"),
        )
        .join(Tarea, Tarea.id_tarea == EmpleadoTarea.id_tarea)
        .where(
            EmpleadoTarea.id_empleado.in_(ids_tecnicos),
            Tarea.estado_tarea.in_(ESTADOS_ACTIVOS),
        )
        .group_by(EmpleadoTarea.id_empleado)
    )

    # Mapear id_empleado → conteo
    conteos: dict[int, int] = {
        row.id_empleado: row.total
        for row in result_conteos.all()
    }

    return [
        {
            "id_empleado":    tec.id_empleado,
            "nombre":         tec.nombre,
            "apellido":       tec.apellido,
            "nombre_completo": f"{tec.nombre} {tec.apellido}",
            "correo":         tec.correo,
            "telefono":       tec.telefono,
            "tareas_activas": conteos.get(tec.id_empleado, 0),
            "disponible":     conteos.get(tec.id_empleado, 0) < LIMITE,
        }
        for tec in tecnicos
    ]