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

from app.core.reglas import ROL_TECNICO
from app.core.tiempo import hora_actual, hoy
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.schemas.reporte import (
    AsistenciaEmpleado,
    ProductividadEmpleado,
    ReporteAsistenciaResponse,
    ReporteProductividadResponse,
    ReporteResumenResponse,
    ReporteTareasCompletadasResponse,
    ResumenEmpleado,
    TareasCompletadasEmpleado,
)
from app.services.asistencia import calcular_jornada, formatear_hhmm


def consulta_asistencias_por_rango(
    fecha_inicio: date,
    fecha_fin: date,
    id_empleado: int | None = None,
    rol: str | None = None,
):
    """Construye la consulta base por rango y, opcionalmente, empleado."""
    filtros = [
        Asistencia.fecha >= fecha_inicio,
        Asistencia.fecha <= fecha_fin,
    ]
    if id_empleado is not None:
        filtros.append(Asistencia.id_empleado == id_empleado)
    if rol is not None:
        filtros.append(Asistencia.empleado.has(Empleado.rol == rol))

    return (
        select(Asistencia)
        .options(
            selectinload(Asistencia.descansos),
            selectinload(Asistencia.empleado),
        )
        .where(*filtros)
        .order_by(Asistencia.fecha, Asistencia.id_asistencia)
    )


def consulta_tareas_completadas_por_rango(
    fecha_inicio: date,
    fecha_fin: date,
    id_tecnico: int | None = None,
):
    """Construye la consulta de tareas cerradas por técnico y rango."""
    limite_inferior = datetime.combine(fecha_inicio, time.min)
    limite_superior = datetime.combine(fecha_fin, time.max)
    filtros = [
        Tarea.estado_tarea == "completado",
        Tarea.fecha_completado.is_not(None),
        Tarea.fecha_completado >= limite_inferior,
        Tarea.fecha_completado <= limite_superior,
        Empleado.rol == ROL_TECNICO,
    ]
    if id_tecnico is not None:
        filtros.append(Empleado.id_empleado == id_tecnico)

    return (
        select(
            Tarea.id_tarea,
            Empleado.id_empleado,
            Empleado.nombre,
            Empleado.apellido,
        )
        .join(EmpleadoTarea, EmpleadoTarea.id_tarea == Tarea.id_tarea)
        .join(Empleado, Empleado.id_empleado == EmpleadoTarea.id_empleado)
        .where(*filtros)
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
                "descansos": 0,
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
        # Cuantas pausas tomo, no solo cuanto duraron: "3 descansos de 15 min"
        # y "un descanso de 45" son la misma cifra de minutos y dos cosas muy
        # distintas para quien revisa la jornada.
        datos["descansos"] += resumen.total_pausas

    return por_empleado


def _agregar_tareas(filas: list) -> tuple[dict[int, dict], int]:
    """Agrupa tareas por empleado y devuelve también el total sin duplicados."""
    por_empleado: dict[int, dict] = {}
    ids_tareas: set[int] = set()

    for fila in filas:
        if fila.id_empleado is None:
            continue

        ids_tareas.add(fila.id_tarea)
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
    rol: str | None = None,
) -> dict[int, dict]:
    result = await db.execute(
        consulta_asistencias_por_rango(
            fecha_inicio,
            fecha_fin,
            id_empleado=id_empleado,
            rol=rol,
        )
    )
    return _agregar_asistencias(list(result.scalars().all()))


async def _cargar_tareas(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
    id_tecnico: int | None = None,
) -> tuple[dict[int, dict], int]:
    result = await db.execute(
        consulta_tareas_completadas_por_rango(
            fecha_inicio,
            fecha_fin,
            id_tecnico=id_tecnico,
        )
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
        total_jornadas_abiertas=sum(item.jornadas_abiertas for item in items),
        total_minutos_trabajados=total_minutos_trabajados,
        total_minutos_pausa=total_minutos_pausa,
        total_descansos=sum(item.descansos for item in items),
        total_horas_trabajadas=formatear_hhmm(total_minutos_trabajados),
        total_horas_pausa=formatear_hhmm(total_minutos_pausa),
        items=items,
    )


def _tareas_por_hora(tareas: int, minutos: int) -> float:
    """Tareas cerradas por hora efectivamente trabajada (sin pausas)."""
    return round((tareas * 60) / minutos, 2) if minutos else 0.0


async def obtener_reporte_resumen(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
    id_empleado: int | None = None,
) -> ReporteResumenResponse:
    """
    Resumen operativo: una fila por empleado con todo lo del periodo.

    A diferencia de `obtener_reporte_productividad`, aqui no se filtra por rol:
    la asistencia y las pausas son de toda la plantilla, no solo de los
    tecnicos. Un empleado que no cierra tareas aparece igual, con 0 en esa
    columna, porque el reporte contesta "que hizo cada quien en estas fechas".
    """
    asistencias = await _cargar_asistencias(
        db,
        fecha_inicio,
        fecha_fin,
        id_empleado=id_empleado,
    )
    tareas, total_tareas = await _cargar_tareas(
        db,
        fecha_inicio,
        fecha_fin,
        id_tecnico=id_empleado,
    )

    items: list[ResumenEmpleado] = []
    for id_actual in asistencias.keys() | tareas.keys():
        datos_asistencia = asistencias.get(id_actual, {})
        datos_tareas = tareas.get(id_actual, {})
        minutos = datos_asistencia.get("minutos_trabajados", 0)
        minutos_descanso = datos_asistencia.get("minutos_pausa", 0)
        completadas = datos_tareas.get("tareas_completadas", 0)

        items.append(
            ResumenEmpleado(
                id_empleado=id_actual,
                nombre_empleado=(
                    datos_asistencia.get("nombre_empleado")
                    or datos_tareas["nombre_empleado"]
                ),
                jornadas=datos_asistencia.get("jornadas", 0),
                jornadas_abiertas=datos_asistencia.get("jornadas_abiertas", 0),
                minutos_trabajados=minutos,
                horas_trabajadas=formatear_hhmm(minutos),
                descansos=datos_asistencia.get("descansos", 0),
                minutos_descanso=minutos_descanso,
                horas_descanso=formatear_hhmm(minutos_descanso),
                tareas_completadas=completadas,
                tareas_por_hora=_tareas_por_hora(completadas, minutos),
            )
        )

    items.sort(key=lambda item: item.nombre_empleado)
    total_minutos = sum(item.minutos_trabajados for item in items)
    total_minutos_descanso = sum(item.minutos_descanso for item in items)

    return ReporteResumenResponse(
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        total_empleados=len(items),
        total_jornadas=sum(item.jornadas for item in items),
        total_jornadas_abiertas=sum(item.jornadas_abiertas for item in items),
        total_minutos_trabajados=total_minutos,
        total_horas_trabajadas=formatear_hhmm(total_minutos),
        total_descansos=sum(item.descansos for item in items),
        total_minutos_descanso=total_minutos_descanso,
        total_horas_descanso=formatear_hhmm(total_minutos_descanso),
        total_tareas_completadas=total_tareas,
        tareas_por_hora=_tareas_por_hora(total_tareas, total_minutos),
        items=items,
    )


async def obtener_reporte_tareas_completadas(
    db: AsyncSession,
    fecha_inicio: date,
    fecha_fin: date,
    id_tecnico: int | None = None,
) -> ReporteTareasCompletadasResponse:
    """Genera los conteos de tareas completadas por técnico."""
    agregados, total_tareas = await _cargar_tareas(
        db,
        fecha_inicio,
        fecha_fin,
        id_tecnico=id_tecnico,
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
    id_tecnico: int | None = None,
) -> ReporteProductividadResponse:
    """Combina asistencia y tareas para calcular productividad por técnico."""
    asistencias = await _cargar_asistencias(
        db,
        fecha_inicio,
        fecha_fin,
        id_empleado=id_tecnico,
        rol=ROL_TECNICO,
    )
    tareas, total_tareas = await _cargar_tareas(
        db,
        fecha_inicio,
        fecha_fin,
        id_tecnico=id_tecnico,
    )
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
                tareas_por_hora=_tareas_por_hora(completadas, minutos),
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
        tareas_por_hora=_tareas_por_hora(total_tareas, total_minutos),
        items=items,
    )
