"""Detección y persistencia de alertas operativas."""

from datetime import date, datetime, time

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.activo import Activo, Material
from app.models.alerta import Alerta
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado
from app.models.tarea import Tarea
# Reloj de la operación (America/Guatemala). El contenedor corre en UTC:
# usar datetime.now() aquí desplazaba las fechas 6 horas.
from app.core.tiempo import ahora as ahora_local, hora_actual as hora_local, hoy as hoy_local


TIPO_TAREA_VENCIDA = "tarea_vencida"
TIPO_TECNICO_SIN_ENTRADA = "tecnico_sin_entrada"
TIPO_STOCK_CRITICO = "stock_critico"

# Estado que pone el propio sistema cuando la causa de la alerta desaparece.
ESTADO_RESUELTA = "resuelta"


async def generar_alertas(db: AsyncSession) -> int:
    """Detecta condiciones operativas y crea las alertas que aún no existen.

    La generación se ejecuta al consultar el módulo de alertas porque el
    proyecto todavía no cuenta con un scheduler o un worker independiente.
    De esta forma se mantienen las alertas persistentes sin agregar una nueva
    infraestructura de ejecución. Cuando exista un scheduler, esta función
    puede reutilizarse directamente desde ese proceso.

    La combinación ``tipo + referencia`` funciona como clave lógica para
    evitar duplicados cuando el supervisor consulta varias veces la pantalla.

    Se consideran "ya existentes" únicamente las alertas pendientes y las que
    fueron atendidas o descartadas **hoy**. Antes se miraban todas sin importar
    la fecha, así que en cuanto el supervisor descartaba una alerta esa
    condición no volvía a avisar nunca más y la pantalla quedaba vacía para
    siempre. Con esta regla la alerta se vuelve a levantar al día siguiente si
    el problema sigue vigente, pero no reaparece a los 30 segundos de haberla
    atendido.
    """
    hoy = hoy_local()
    referencias_existentes = await _obtener_referencias_existentes(db, hoy)
    nuevas_alertas: list[Alerta] = []

    # Condiciones que se cumplen AHORA MISMO, se hayan detectado antes o no.
    # Sirve para lo contrario que `referencias_existentes`: saber cuales de las
    # alertas ya guardadas siguen teniendo motivo. Sin esto una alerta se
    # quedaba pendiente para siempre aunque el problema estuviera resuelto.
    vigentes: set[tuple[str, str]] = set()

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
        vigentes.add((TIPO_TAREA_VENCIDA, f"tarea:{id_tarea}"))
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
    if hora_local() >= _hora_limite():
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
            vigentes.add((TIPO_TECNICO_SIN_ENTRADA, f"empleado:{id_empleado}"))
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
        vigentes.add((TIPO_STOCK_CRITICO, f"material:{id_material}"))
        _agregar_alerta_si_nueva(
            nuevas_alertas,
            referencias_existentes,
            tipo=TIPO_STOCK_CRITICO,
            severidad="critica",
            referencia=f"material:{id_material}",
        )

    if nuevas_alertas:
        # ON CONFLICT DO NOTHING en lugar de add_all(): la detección corre
        # dentro de un GET, así que dos supervisores abriendo la pantalla a la
        # vez leen el mismo "no existe todavía" y ambos intentan insertar. El
        # índice único uq_alerta_tipo_referencia_dia lo impide, y sin esta
        # cláusula el segundo se llevaría un IntegrityError que tumbaría la
        # generación entera en vez de simplemente saltarse el duplicado.
        # La fecha se manda explícita en hora de Guatemala. La columna tiene
        # server_default=now(), que es la hora del servidor de PostgreSQL: en
        # UTC. Eso dejaba toda alerta recién creada 6 horas en el futuro, así
        # que la pantalla mostraba "Hace un momento" para alertas viejas y la
        # deduplicación por día empezaba a fallar cada tarde a partir de las
        # 18:00 locales, cuando en UTC ya es el día siguiente.
        creada = ahora_local()
        await db.execute(
            pg_insert(Alerta)
            .values(
                [
                    {
                        "tipo": alerta.tipo,
                        "severidad": alerta.severidad,
                        "estado": alerta.estado,
                        "referencia": alerta.referencia,
                        "fecha": creada,
                    }
                    for alerta in nuevas_alertas
                ]
            )
            .on_conflict_do_nothing()
        )
        # El flush deja los registros preparados dentro de la transacción
        # actual; el commit continúa siendo responsabilidad de get_db().
        await db.flush()

    # El detector solo sabía crear. Ahora también cierra lo que ya no aplica.
    await _resolver_alertas_obsoletas(
        db,
        vigentes,
        hoy=hoy,
        # La detección de "técnico sin entrada" solo corre pasada la hora
        # límite. Antes de esa hora `vigentes` no contiene ninguna referencia
        # de ese tipo, y darlas por resueltas borraría cada mañana los avisos
        # legítimos del día anterior.
        evaluar_sin_entrada=hora_local() >= _hora_limite(),
    )

    return len(nuevas_alertas)


async def describir_referencias(
    db: AsyncSession,
    alertas: list[Alerta],
) -> dict[str, str]:
    """
    Traduce las referencias "entidad:id" al nombre real de esa entidad.

    Devuelve {referencia: etiqueta}, p. ej.
        {"tarea:7": "Cambio de poste dañado — Callejón San José"}

    Sin esto la pantalla del supervisor mostraba "La tarea #7 venció", que
    obliga a ir a buscar a mano cuál es la tarea 7. Se resuelven todas las
    referencias en tres consultas (una por tipo de entidad) en vez de una por
    alerta.
    """
    ids_por_entidad: dict[str, set[int]] = {}

    for alerta in alertas:
        if not alerta.referencia or ":" not in alerta.referencia:
            continue
        entidad, _, id_txt = alerta.referencia.partition(":")
        if id_txt.isdigit():
            ids_por_entidad.setdefault(entidad, set()).add(int(id_txt))

    etiquetas: dict[str, str] = {}

    if ids_tarea := ids_por_entidad.get("tarea"):
        result = await db.execute(
            select(Tarea.id_tarea, Tarea.titulo).where(Tarea.id_tarea.in_(ids_tarea))
        )
        for id_tarea, titulo in result.all():
            etiquetas[f"tarea:{id_tarea}"] = titulo

    if ids_empleado := ids_por_entidad.get("empleado"):
        result = await db.execute(
            select(Empleado.id_empleado, Empleado.nombre, Empleado.apellido).where(
                Empleado.id_empleado.in_(ids_empleado)
            )
        )
        for id_empleado, nombre, apellido in result.all():
            etiquetas[f"empleado:{id_empleado}"] = f"{nombre} {apellido}"

    if ids_material := ids_por_entidad.get("material"):
        # El nombre del material vive en `activo`, no en `material`.
        result = await db.execute(
            select(Activo.id_activo, Activo.nombre_activo).where(
                Activo.id_activo.in_(ids_material)
            )
        )
        for id_activo, nombre in result.all():
            etiquetas[f"material:{id_activo}"] = nombre

    return etiquetas


async def _resolver_alertas_obsoletas(
    db: AsyncSession,
    vigentes: set[tuple[str, str]],
    *,
    hoy: date,
    evaluar_sin_entrada: bool,
) -> int:
    """
    Cierra como 'resuelta' las alertas pendientes cuya causa ya no existe.

    Es la mitad que le faltaba al detector. Antes solo sabía crear alertas: una
    vez levantada, la alerta se quedaba pendiente aunque el problema estuviera
    arreglado. En la práctica eso significaba que el panel avisaba de una tarea
    vencida que el técnico ya había cerrado, o de un material bajo mínimos que
    ya se había repuesto, y la única forma de quitarla de en medio era
    descartarla a mano — lo que además borraba la única señal de que ese aviso
    había existido.

    `vigentes` son las condiciones que se cumplen en este mismo instante, tal
    como las acaba de calcular la detección. Todo lo pendiente que no esté ahí
    es un aviso sin motivo.

    Las alertas 'atendida' y 'descartada' no se tocan: ya las cerró una persona
    y su estado es parte del registro de lo que hizo.

    Devuelve cuántas se cerraron.
    """
    tipos_evaluados = [TIPO_TAREA_VENCIDA, TIPO_STOCK_CRITICO]
    if evaluar_sin_entrada:
        tipos_evaluados.append(TIPO_TECNICO_SIN_ENTRADA)

    result = await db.execute(
        select(Alerta).where(
            Alerta.estado == "pendiente",
            Alerta.tipo.in_(tipos_evaluados),
        )
    )

    resueltas = 0
    for alerta in result.scalars().all():
        if alerta.referencia is None:
            continue
        if (alerta.tipo, alerta.referencia) in vigentes:
            continue

        # Los avisos de "no marcó entrada" son de un día concreto: que hoy sí
        # haya marcado no borra que ayer no lo hizo. Solo se cierran los del
        # propio día.
        if (
            alerta.tipo == TIPO_TECNICO_SIN_ENTRADA
            and alerta.fecha.date() != hoy
        ):
            continue

        alerta.estado = ESTADO_RESUELTA
        resueltas += 1

    if resueltas:
        await db.flush()

    return resueltas


async def _obtener_referencias_existentes(
    db: AsyncSession,
    hoy: date,
) -> set[tuple[str, str]]:
    """
    Claves (tipo, referencia) que no deben volver a crearse en esta ejecución:
    las alertas todavía pendientes y las que ya se resolvieron hoy.
    """
    result = await db.execute(
        select(Alerta.tipo, Alerta.referencia).where(
            or_(
                Alerta.estado == "pendiente",
                func.date(Alerta.fecha) == hoy,
            )
        )
    )
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
