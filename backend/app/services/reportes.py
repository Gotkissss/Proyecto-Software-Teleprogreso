"""
Consultas y agregaciones reutilizables del modulo de Reportes.

Los reportes de asistencia y productividad comparten el mismo calculo de
jornada que el historial de asistencia, incluida la resta de pausas y el
manejo de turnos nocturnos.
"""

from datetime import date, datetime, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.tiempo import hora_actual, hoy
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.schemas.reporte import (
    AsistenciaEmpleado,
    ProductividadEmpleado,
    ReporteAsistenciaResponse,
    ReporteProductividadResponse,
    ReporteTareasCompletadasResponse,
    TareasCompletadasEmpleado,
)
from app.services.asistencia import calcular_jornada, formatear_hhmm


def consulta_asistencias_por_rango(
    fecha_inicio: date,
    fecha_fin: date,
    id_empleado: int | None = None,
):
    """Construye la consulta base por rango y, opcionalmente, empleado."""
    filtros = [
        Asistencia.fecha >= fecha_inicio,
        Asistencia.fecha <= fecha_fin,
    ]
    if id_empleado is not None:
        filtros.append(Asistencia.id_empleado == id_empleado)

    return (
        select(Asistencia)
        .options(
            selectinload(Asistencia.descansos),
            selectinload(Asistencia.empleado),
        )
        .where(*filtros)
        .order_by(Asistencia.fecha, Asistencia.id_asistencia)
    )


def consulta_tareas_completadas_por_rango(fecha_inicio: date, fecha_fin: date):
    """Construye la consulta base de tareas cerradas para un rango inclusivo."""
    limite_inferior = datetime.combine(fecha_inicio, time.min)
    limite_superior = datetime.combine(fecha_fin, time.max)

    return (
        select(
            Tarea.id_tarea,
            Empleado.id_empleado,
            Empleado.nombre,
            Empleado.apellido,
        )
        .outerjoin(EmpleadoTarea, EmpleadoTarea.id_tarea == Tarea.id_tarea)
        .outerjoin(Empleado, Empleado.id_empleado == EmpleadoTarea.id_empleado)
        .where(
            Tarea.estado_tarea == "completado",
            Tarea.fecha_completado.is_not(None),
            Tarea.fecha_completado >= limite_inferior,
            Tarea.fecha_completado <= limite_superior,
        )
        .order_by(Tarea.fecha_completado, Tarea.id_tarea)
    )


def _agregar_asistencias(jornadas: list[Asistencia]) -> dict[int, dict]:
    """Agrupa jornadas cargadas por empleado y acumula sus minutos."""
    por_empleado: dict[int, dict] = {}
    hoy_local = hoy()

    for jornada in jornadas:
        empleado = jornada.empleado
        if empleado is None:
            continue

        datos = por_empleado.setdefault(
            jornada.id_empleado,
            {
                "id_empleado": jornada.id_empleado,
                "nombre_empleado": f"{empleado.nombre} {empleado.apellido}",
                "jornadas": 0,
                "jornadas_abiertas": 0,
                "minutos_trabajados": 0,
                "minutos_pausa": 0,
            },
        )

        referencia = hora_actual() if jornada.fecha == hoy_local else None
        resumen = calcular_jornada(
            jornada,
            jornada.descansos,
            referencia=referencia,
        )

        datos["jornadas"] += 1
        datos["jornadas_abiertas"] += int(resumen.jornada_activa)
        datos["minutos_trabajados"] += resumen.minutos_trabajados
        datos["minutos_pausa"] += resumen.minutos_pausa

    return por_empleado


def _agregar_tareas(filas: list) -> tuple[dict[int, dict], int]:
    """Agrupa tareas por empleado y devuelve también el total sin duplicados."""
    por_empleado: dict[int, dict] = {}
    ids_tareas: set[int] = set()

    for fila in filas:
        ids_tareas.add(fila.id_tarea)
        if fila.id_empleado is None:
            continue

        datos = por_empleado.setdefault(
            fila.id_empleado,
            {
                "id_empleado": fila.id_empleado,
                "nombre_empleado": f"{fila.nombre} {fila.apellido}",
                "tareas_completadas": 0,
            },
        )
        datos["tareas_completadas"] += 1

    return por_empleado, len(ids_tareas)


async def _cargar_asistencias(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
    id_empleado: int | None = None,
) -> dict[int, dict]:
    result = await db.execute(
        consulta_asistencias_por_rango(
            fecha_inicio,
            fecha_fin,
            id_empleado=id_empleado,
        )
    )
    return _agregar_asistencias(list(result.scalars().all()))


async def _cargar_tareas(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
) -> tuple[dict[int, dict], int]:
    result = await db.execute(
        consulta_tareas_completadas_por_rango(fecha_inicio, fecha_fin)
    )
    return _agregar_tareas(list(result.all()))


async def obtener_reporte_asistencia(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
    id_empleado: int | None = None,
) -> ReporteAsistenciaResponse:
    """Genera los totales de asistencia por empleado y del rango completo."""
    agregados = await _cargar_asistencias(
        db,
        fecha_inicio,
        fecha_fin,
        id_empleado=id_empleado,
    )

    items = [
        AsistenciaEmpleado(
            **datos,
            horas_trabajadas=formatear_hhmm(datos["minutos_trabajados"]),
            horas_pausa=formatear_hhmm(datos["minutos_pausa"]),
        )
        for datos in sorted(
            agregados.values(), key=lambda item: item["nombre_empleado"]
        )
    ]

    total_minutos_trabajados = sum(
        item.minutos_trabajados for item in items
    )
    total_minutos_pausa = sum(item.minutos_pausa for item in items)

    return ReporteAsistenciaResponse(
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        total_empleados=len(items),
        total_jornadas=sum(item.jornadas for item in items),
        total_minutos_trabajados=total_minutos_trabajados,
        total_minutos_pausa=total_minutos_pausa,
        total_horas_trabajadas=formatear_hhmm(total_minutos_trabajados),
        total_horas_pausa=formatear_hhmm(total_minutos_pausa),
        items=items,
    )


async def obtener_reporte_tareas_completadas(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
) -> ReporteTareasCompletadasResponse:
    """Genera los conteos de tareas completadas por empleado."""
    agregados, total_tareas = await _cargar_tareas(
        db, fecha_inicio, fecha_fin
    )

    items = [
        TareasCompletadasEmpleado(**datos)
        for datos in sorted(
            agregados.values(),
            key=lambda item: (
                -item["tareas_completadas"],
                item["nombre_empleado"],
            ),
        )
    ]

    return ReporteTareasCompletadasResponse(
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        total_empleados=len(items),
        total_tareas_completadas=total_tareas,
        items=items,
    )


async def obtener_reporte_productividad(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
) -> ReporteProductividadResponse:
    """Combina asistencia y tareas para calcular tareas por hora trabajada."""
    asistencias = await _cargar_asistencias(db, fecha_inicio, fecha_fin)
    tareas, total_tareas = await _cargar_tareas(db, fecha_inicio, fecha_fin)
    ids_empleados = asistencias.keys() | tareas.keys()

    items: list[ProductividadEmpleado] = []
    for id_empleado in ids_empleados:
        datos_asistencia = asistencias.get(id_empleado, {})
        datos_tareas = tareas.get(id_empleado, {})
        minutos = datos_asistencia.get("minutos_trabajados", 0)
        completadas = datos_tareas.get("tareas_completadas", 0)
        nombre = (
            datos_asistencia.get("nombre_empleado")
            or datos_tareas["nombre_empleado"]
        )

        items.append(
            ProductividadEmpleado(
                id_empleado=id_empleado,
                nombre_empleado=nombre,
                jornadas=datos_asistencia.get("jornadas", 0),
                minutos_trabajados=minutos,
                horas_trabajadas=formatear_hhmm(minutos),
                tareas_completadas=completadas,
                tareas_por_hora=(
                    round((completadas * 60) / minutos, 2)
                    if minutos
                    else 0.0
                ),
            )
        )

    items.sort(
        key=lambda item: (-item.tareas_por_hora, item.nombre_empleado)
    )
    total_minutos = sum(item.minutos_trabajados for item in items)

    return ReporteProductividadResponse(
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        total_empleados=len(items),
        total_jornadas=sum(item.jornadas for item in items),
        total_minutos_trabajados=total_minutos,
        total_horas_trabajadas=formatear_hhmm(total_minutos),
        total_tareas_completadas=total_tareas,
        tareas_por_hora=(
            round((total_tareas * 60) / total_minutos, 2)
            if total_minutos
            else 0.0
        ),
        items=items,
    )
