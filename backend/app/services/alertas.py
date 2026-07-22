"""Detección y persistencia de alertas operativas."""

from datetime import date, datetime, time

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.activo import Material
from app.models.alerta import Alerta
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado
from app.models.tarea import Tarea


TIPO_TAREA_VENCIDA = "tarea_vencida"
TIPO_TECNICO_SIN_ENTRADA = "tecnico_sin_entrada"
TIPO_STOCK_CRITICO = "stock_critico"


async def generar_alertas(db: AsyncSession) -> int:
    """Detecta condiciones operativas y crea las alertas que aún no existen.

    La generación se ejecuta al consultar el módulo de alertas porque el
    proyecto todavía no cuenta con un scheduler o un worker independiente.
    De esta forma se mantienen las alertas persistentes sin agregar una nueva
    infraestructura de ejecución. Cuando exista un scheduler, esta función
    puede reutilizarse directamente desde ese proceso.

    La combinación ``tipo + referencia`` funciona como clave lógica para
    evitar duplicados cuando el supervisor consulta varias veces la pantalla.
    Se revisan también alertas atendidas o descartadas para no recrear la
    misma alerta en cada consulta mientras la condición siga vigente.
    """
    hoy = date.today()
    referencias_existentes = await _obtener_referencias_existentes(db)
    nuevas_alertas: list[Alerta] = []

    # Una tarea se considera vencida solamente si sigue activa. Las tareas
    # completadas o canceladas ya no deben generar una nueva alerta operativa.
    result_tareas = await db.execute(
        select(Tarea.id_tarea).where(
            Tarea.fecha_finalizacion.is_not(None),
            Tarea.fecha_finalizacion < hoy,
            Tarea.estado_tarea.in_(
                (
                    "pendiente",
                    "en_progreso",
                )
            ),
        )
    )
    for (id_tarea,) in result_tareas.all():
        _agregar_alerta_si_nueva(
            nuevas_alertas,
            referencias_existentes,
            tipo=TIPO_TAREA_VENCIDA,
            severidad="critica",
            referencia=f"tarea:{id_tarea}",
        )

    # Antes de la hora límite todavía es válido que un técnico no haya
    # marcado entrada. La hora se obtiene del reloj local del servidor, igual
    # que los endpoints actuales de asistencia.
    if datetime.now().time() >= _hora_limite():
        result_tecnicos = await db.execute(
            select(Empleado.id_empleado)
            .outerjoin(
                Asistencia,
                and_(
                    Asistencia.id_empleado == Empleado.id_empleado,
                    Asistencia.fecha == hoy,
                ),
            )
            .where(
                Empleado.rol == "tecnico",
                Empleado.estado == "activo",
                Asistencia.id_asistencia.is_(None),
            )
        )
        for (id_empleado,) in result_tecnicos.all():
            _agregar_alerta_si_nueva(
                nuevas_alertas,
                referencias_existentes,
                tipo=TIPO_TECNICO_SIN_ENTRADA,
                severidad="advertencia",
                referencia=f"empleado:{id_empleado}",
            )

    # La comparación se realiza directamente en la base de datos para que
    # la regla sea consistente y no dependa de cuántos materiales devuelve
    # previamente un endpoint del inventario.
    result_materiales = await db.execute(
        select(Material.id_activo).where(
            Material.cantidad_disponible < Material.stock_minimo,
        )
    )
    for (id_material,) in result_materiales.all():
        _agregar_alerta_si_nueva(
            nuevas_alertas,
            referencias_existentes,
            tipo=TIPO_STOCK_CRITICO,
            severidad="critica",
            referencia=f"material:{id_material}",
        )

    if nuevas_alertas:
        db.add_all(nuevas_alertas)
        # El flush deja los registros preparados dentro de la transacción
        # actual; el commit continúa siendo responsabilidad de get_db().
        await db.flush()

    return len(nuevas_alertas)


async def _obtener_referencias_existentes(db: AsyncSession) -> set[tuple[str, str]]:
    result = await db.execute(select(Alerta.tipo, Alerta.referencia))
    return {
        (tipo, referencia)
        for tipo, referencia in result.all()
        if referencia is not None
    }


def _agregar_alerta_si_nueva(
    nuevas_alertas: list[Alerta],
    referencias_existentes: set[tuple[str, str]],
    *,
    tipo: str,
    severidad: str,
    referencia: str,
) -> None:
    clave = (tipo, referencia)
    if clave in referencias_existentes:
        return

    nuevas_alertas.append(
        Alerta(
            tipo=tipo,
            severidad=severidad,
            estado="pendiente",
            referencia=referencia,
        )
    )
    # También se agrega al conjunto en memoria para impedir duplicados si dos
    # consultas de detección producen la misma referencia en esta ejecución.
    referencias_existentes.add(clave)


def _hora_limite() -> time:
    """Convierte la hora configurada y conserva un valor seguro ante errores."""
    try:
        return time.fromisoformat(settings.ALERTA_HORA_LIMITE)
    except ValueError:
        # La configuración tiene 08:00 como valor predeterminado. Este fallback
        # evita que una variable de entorno mal formada impida arrancar la API.
        return time(8, 0)
