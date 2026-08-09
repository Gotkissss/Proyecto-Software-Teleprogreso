# backend/app/services/empleados.py
"""
Efectos en cascada al desactivar un empleado — Teleprogreso S.A.
-----------------------------------------------------------------------------
Desactivar una cuenta cambiaba una sola columna y nada más. Todo lo que ese
empleado tenía tomado se quedaba tomado:

  · Su vehículo seguía asignado a él y en estado 'en_uso', así que no se podía
    dar a nadie más hasta que alguien se acordara de liberarlo a mano.
  · Su jornada, si la había abierto, quedaba abierta para siempre. Nunca iba a
    marcar salida, y esa jornada seguía contando como abierta en el historial.
  · Sus tareas activas seguían asignadas a alguien que ya no puede entrar al
    sistema, sin que nadie se enterara de que había trabajo huérfano.

Las dos primeras se resuelven solas aquí. La tercera NO se toca a propósito:
desasignar tareas automáticamente borraría a quién se le habían dado, que es
justo el dato que hace falta para repartirlas de nuevo. Se devuelve el conteo
para que la respuesta lo diga y el admin sepa que tiene que reasignarlas.
-----------------------------------------------------------------------------
"""
from dataclasses import dataclass
from datetime import time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.reglas import ESTADO_DISPONIBLE, ESTADOS_TAREA_ACTIVOS
from app.core.tiempo import ahora as ahora_local
from app.models.activo import Carro
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado, EmpleadoCarro, EmpleadoTarea
from app.models.tarea import Tarea

# Misma marca que usa el router de asistencia para cerrar jornadas colgadas.
HORA_CIERRE_FORZADO = time(23, 59, 59)


@dataclass
class ResultadoDesvinculacion:
    """Qué se soltó al desactivar, para poder contarlo en la respuesta."""
    vehiculo_liberado: str | None = None   # placa, o None si no tenía
    jornadas_cerradas: int = 0
    tareas_activas: int = 0                # quedan asignadas: hay que repartirlas


async def desvincular_recursos(
    db: AsyncSession,
    empleado: Empleado,
) -> ResultadoDesvinculacion:
    """
    Suelta los recursos que retiene un empleado que deja de estar activo.

    No hace commit: se ejecuta dentro de la transacción del endpoint.
    """
    resultado = ResultadoDesvinculacion()
    ahora = ahora_local()

    # ── 1. Vehículo ─────────────────────────────────────────────────────────
    result_asig = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_empleado == empleado.id_empleado)
    )
    for asignacion in result_asig.scalars().all():
        result_carro = await db.execute(
            select(Carro).where(Carro.id_activo == asignacion.id_carro)
        )
        carro = result_carro.scalars().first()
        if carro is not None:
            carro.estado_vehiculo = ESTADO_DISPONIBLE
            resultado.vehiculo_liberado = carro.placa
        await db.delete(asignacion)

    # ── 2. Jornadas abiertas ────────────────────────────────────────────────
    # Se cierran con la hora actual si son de hoy y al final del día si son de
    # días anteriores, igual que hace el registro de entrada con las jornadas
    # que quedaron colgadas.
    result_jornadas = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == empleado.id_empleado,
            Asistencia.hora_salida.is_(None),
        )
    )
    for jornada in result_jornadas.scalars().all():
        cierre = ahora.time() if jornada.fecha == ahora.date() else HORA_CIERRE_FORZADO
        jornada.hora_salida = cierre

        # Las pausas en curso se cierran con la jornada; si no, quedarían
        # abiertas dentro de una jornada ya cerrada e inflarían el tiempo de
        # descanso del historial.
        result_pausas = await db.execute(
            select(Descanso).where(
                Descanso.id_asistencia == jornada.id_asistencia,
                Descanso.hora_fin.is_(None),
            )
        )
        for pausa in result_pausas.scalars().all():
            pausa.hora_fin = cierre

        resultado.jornadas_cerradas += 1

    # ── 3. Tareas activas: se cuentan, no se tocan ──────────────────────────
    result_tareas = await db.execute(
        select(func.count())
        .select_from(EmpleadoTarea)
        .join(Tarea, Tarea.id_tarea == EmpleadoTarea.id_tarea)
        .where(
            EmpleadoTarea.id_empleado == empleado.id_empleado,
            Tarea.estado_tarea.in_(ESTADOS_TAREA_ACTIVOS),
        )
    )
    resultado.tareas_activas = result_tareas.scalar() or 0

    await db.flush()
    return resultado
