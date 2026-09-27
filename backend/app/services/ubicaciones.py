from datetime import date, datetime, time, timedelta
from typing import List, Optional, Tuple

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import conflict, not_found
from app.core.geo import lat_lng_de, punto_wkt
from app.core.reglas import (
    DURACION_MAXIMA_TURNO_HORAS,
    EVENTO_ENTRADA,
    EVENTO_FIN_TAREA,
    EVENTO_PERIODICO,
    EVENTO_SALIDA,
    MINUTOS_HUECO_RECORRIDO,
    ROL_TECNICO,
    TOLERANCIA_RELOJ_SEGUNDOS,
)
from app.core.tiempo import a_hora_local
from app.core.tiempo import ahora as ahora_local
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.models.ubicacion import UbicacionEmpleado
from app.schemas.ubicacion import (
    PuntoLote,
    PuntoRecorrido,
    RecorridoResponse,
    UbicacionCreate,
    UbicacionTecnicoResponse,
)
from app.services.asistencia import es_del_turno_en_curso


# ─── Jornada en curso ────────────────────────────────────────────────────────
#
# Vive aquí y no en services/asistencia.py porque aquel módulo es de cálculo
# puro (se prueba sin base de datos) y esto consulta la sesión.

async def jornada_en_curso(
    db: AsyncSession,
    id_empleado: int,
    ahora: Optional[datetime] = None,
) -> Optional[Asistencia]:
    """
    Jornada del turno en marcha (entrada sin salida) del empleado, o None.

    Aplica la regla única es_del_turno_en_curso: vale la jornada de hoy, o la
    de ayer si el turno cruzó la medianoche sin pasar del tope de horas. Se
    piden todas las filas porque un doble clic en "Entrada" puede dejar dos
    abiertas, y `scalar_one_or_none()` reventaría con un 500.
    """
    momento = ahora or ahora_local()
    result = await db.execute(
        select(Asistencia)
        .where(
            Asistencia.id_empleado == id_empleado,
            Asistencia.hora_salida.is_(None),
        )
        .order_by(Asistencia.fecha.desc(), Asistencia.hora_entrada.desc())
    )
    return next(
        (j for j in result.scalars().all() if es_del_turno_en_curso(j, momento)),
        None,
    )


async def exigir_jornada_abierta(db: AsyncSession, empleado: Empleado) -> None:
    """
    Un técnico no trabaja en tareas sin haber marcado entrada (HU-5).

    Se aplica al iniciar y finalizar tareas y al registrar su evidencia. Solo
    al rol técnico: admin y supervisor no marcan jornada y pueden operar las
    tareas desde el panel. Responde 409 (no 400) porque la petición está bien
    formada; lo que no encaja es el estado de la jornada.
    """
    if empleado.rol != ROL_TECNICO:
        return
    if await jornada_en_curso(db, empleado.id_empleado) is None:
        raise conflict(
            "Registra tu entrada para iniciar la jornada antes de trabajar "
            "en tus tareas."
        )


# ─── Puntos de inicio y fin de tarea ─────────────────────────────────────────

async def registrar_evento_tarea(
    db: AsyncSession,
    empleado: Empleado,
    evento: str,
    id_tarea: int,
    ubicacion: Optional[UbicacionCreate],
) -> bool:
    """
    Guarda en el recorrido dónde se inició o finalizó una tarea (HU-5).

    No guarda nada si no llegó ubicación (GPS denegado o sin señal: la tarea
    sigue su curso igual) o si quien opera no es técnico. El fin de una tarea
    se registra una sola vez: el frontend reintenta el cierre y la foto de
    evidencia también puede cerrarla, así que PATCH /finalizar puede llegar
    más de una vez para la misma tarea.

    Devuelve True si guardó el punto.
    """
    if ubicacion is None or empleado.rol != ROL_TECNICO:
        return False

    if evento == EVENTO_FIN_TAREA:
        existente = await db.execute(
            select(UbicacionEmpleado.id_ubicacion).where(
                UbicacionEmpleado.id_empleado == empleado.id_empleado,
                UbicacionEmpleado.id_tarea == id_tarea,
                UbicacionEmpleado.evento == EVENTO_FIN_TAREA,
            )
        )
        if existente.first() is not None:
            return False

    db.add(
        UbicacionEmpleado(
            id_empleado=empleado.id_empleado,
            fecha_hora_registro=ahora_local(),
            coordenada=punto_wkt(ubicacion.lat, ubicacion.lng),
            evento=evento,
            id_tarea=id_tarea,
        )
    )
    return True


# ─── Envío en lote (cola sin conexión) ───────────────────────────────────────

def _intervalo_de_jornada(jornada: Asistencia, ahora: datetime) -> Tuple[datetime, datetime]:
    """
    Desde cuándo y hasta cuándo una jornada admite puntos.

    Cerrada: de la entrada a la salida (la salida cae al día siguiente si el
    turno cruzó la medianoche). Abierta: hasta ahora, sin pasar del tope de
    horas de un turno, para que una salida olvidada no abra una ventana de días.
    """
    inicio = datetime.combine(jornada.fecha, jornada.hora_entrada)
    if jornada.hora_salida is not None:
        fin = datetime.combine(jornada.fecha, jornada.hora_salida)
        if fin < inicio:
            fin += timedelta(days=1)
        return inicio, fin
    return inicio, min(ahora, inicio + timedelta(hours=DURACION_MAXIMA_TURNO_HORAS))


async def registrar_lote(
    db: AsyncSession,
    empleado: Empleado,
    puntos: List[PuntoLote],
) -> Tuple[int, int]:
    """
    Guarda los puntos que el técnico acumuló sin señal. Devuelve
    (guardados, descartados).

    Cada punto conserva la hora real en que se tomó, pero solo se acepta si:
      - no es futuro (con un margen por diferencias de reloj), y
      - cae dentro de una jornada del técnico (entre su entrada y su salida).
    Un punto repetido (misma hora, ya guardado o repetido en el lote) se
    descarta: si la respuesta de un envío se pierde, el teléfono lo reintenta.
    """
    ahora = ahora_local()
    limite = ahora + timedelta(seconds=TOLERANCIA_RELOJ_SEGUNDOS)

    candidatos = []
    for punto in puntos:
        momento = a_hora_local(punto.fecha_hora).replace(microsecond=0)
        if momento <= limite:
            candidatos.append((momento, punto))

    if not candidatos:
        return 0, len(puntos)

    fechas = [m.date() for m, _ in candidatos]
    result = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == empleado.id_empleado,
            Asistencia.fecha >= min(fechas) - timedelta(days=1),
            Asistencia.fecha <= max(fechas),
        )
    )
    intervalos = [_intervalo_de_jornada(j, ahora) for j in result.scalars().all()]

    dentro = [
        (m, p) for m, p in candidatos
        if any(inicio <= m <= fin for inicio, fin in intervalos)
    ]
    if not dentro:
        return 0, len(puntos)

    result = await db.execute(
        select(UbicacionEmpleado.fecha_hora_registro).where(
            UbicacionEmpleado.id_empleado == empleado.id_empleado,
            UbicacionEmpleado.fecha_hora_registro.in_([m for m, _ in dentro]),
        )
    )
    ya_guardados = set(result.scalars().all())

    guardados = 0
    for momento, punto in dentro:
        if momento in ya_guardados:
            continue
        ya_guardados.add(momento)
        db.add(
            UbicacionEmpleado(
                id_empleado=empleado.id_empleado,
                fecha_hora_registro=momento,
                coordenada=punto_wkt(punto.lat, punto.lng),
                evento=EVENTO_PERIODICO,
            )
        )
        guardados += 1

    return guardados, len(puntos) - guardados


# ─── Recorrido del día ───────────────────────────────────────────────────────

async def obtener_recorrido(
    db: AsyncSession,
    id_empleado: int,
    fecha: date,
) -> RecorridoResponse:
    """
    Puntos del técnico en un día, en orden cronológico (HU-5).

    Junta los puntos guardados en `ubicacion_empleado` (periódicos y de
    inicio/fin de tarea) con el lugar de la entrada y la salida de sus
    jornadas de ese día (HU-4), y marca `tras_hueco` en cada punto al que se
    llega después de más de MINUTOS_HUECO_RECORRIDO sin datos.
    """
    empleado = await db.get(Empleado, id_empleado)
    if empleado is None:
        raise not_found(f"No se encontró ningún empleado con id={id_empleado}.")

    inicio_dia = datetime.combine(fecha, time.min)
    fin_dia = inicio_dia + timedelta(days=1)
    coord = cast(UbicacionEmpleado.coordenada, Geometry)

    result = await db.execute(
        select(
            UbicacionEmpleado.fecha_hora_registro,
            func.ST_Y(coord).label("lat"),
            func.ST_X(coord).label("lng"),
            UbicacionEmpleado.evento,
            UbicacionEmpleado.id_tarea,
            Tarea.titulo,
        )
        .outerjoin(Tarea, Tarea.id_tarea == UbicacionEmpleado.id_tarea)
        .where(
            UbicacionEmpleado.id_empleado == id_empleado,
            UbicacionEmpleado.fecha_hora_registro >= inicio_dia,
            UbicacionEmpleado.fecha_hora_registro < fin_dia,
        )
        .order_by(
            UbicacionEmpleado.fecha_hora_registro,
            UbicacionEmpleado.id_ubicacion,
        )
    )
    puntos = [
        PuntoRecorrido(
            lat=lat,
            lng=lng,
            fecha_hora=momento,
            evento=evento,
            id_tarea=id_tarea,
            titulo_tarea=titulo,
        )
        for momento, lat, lng, evento, id_tarea, titulo in result.all()
    ]

    result = await db.execute(
        select(Asistencia).where(
            Asistencia.id_empleado == id_empleado,
            Asistencia.fecha == fecha,
        )
    )
    for jornada in result.scalars().all():
        entrada = lat_lng_de(jornada.coordenada_entrada)
        if entrada:
            puntos.append(
                PuntoRecorrido(
                    lat=entrada[0],
                    lng=entrada[1],
                    fecha_hora=datetime.combine(jornada.fecha, jornada.hora_entrada),
                    evento=EVENTO_ENTRADA,
                )
            )
        salida = lat_lng_de(jornada.coordenada_salida)
        if salida and jornada.hora_salida is not None:
            _, momento_salida = _intervalo_de_jornada(jornada, ahora_local())
            puntos.append(
                PuntoRecorrido(
                    lat=salida[0],
                    lng=salida[1],
                    fecha_hora=momento_salida,
                    evento=EVENTO_SALIDA,
                )
            )

    # sorted es estable: a igual hora se respeta el orden de inserción.
    puntos.sort(key=lambda p: p.fecha_hora)
    hueco = timedelta(minutes=MINUTOS_HUECO_RECORRIDO)
    for anterior, actual in zip(puntos, puntos[1:]):
        actual.tras_hueco = actual.fecha_hora - anterior.fecha_hora > hueco

    return RecorridoResponse(
        id_empleado=empleado.id_empleado,
        nombre=f"{empleado.nombre} {empleado.apellido}",
        fecha=fecha,
        minutos_hueco=MINUTOS_HUECO_RECORRIDO,
        puntos=puntos,
    )


async def obtener_ultimas_ubicaciones(
    db: AsyncSession,
    ahora: Optional[datetime] = None,
) -> list[UbicacionTecnicoResponse]:
    ahora = ahora or ahora_local()
    ayer = ahora.date() - timedelta(days=1)

    resultado = await db.execute(
        select(Asistencia, Empleado)
        .join(Empleado, Empleado.id_empleado == Asistencia.id_empleado)
        .where(
            Asistencia.hora_salida.is_(None),
            Asistencia.fecha >= ayer,
            Empleado.rol == "tecnico",
            Empleado.estado == "activo",
        )
        .order_by(Asistencia.fecha.desc(), Asistencia.hora_entrada.desc())
    )

    en_jornada: dict[int, tuple[Asistencia, Empleado]] = {}
    for jornada, empleado in resultado.all():
        if empleado.id_empleado in en_jornada:
            continue
        if es_del_turno_en_curso(jornada, ahora):
            en_jornada[empleado.id_empleado] = (jornada, empleado)

    if not en_jornada:
        return []

    coord = cast(UbicacionEmpleado.coordenada, Geometry)
    ultimas = await db.execute(
        select(
            UbicacionEmpleado.id_empleado,
            UbicacionEmpleado.fecha_hora_registro,
            func.ST_Y(coord).label("lat"),
            func.ST_X(coord).label("lng"),
        )
        .where(UbicacionEmpleado.id_empleado.in_(list(en_jornada)))
        .distinct(UbicacionEmpleado.id_empleado)
        .order_by(
            UbicacionEmpleado.id_empleado,
            UbicacionEmpleado.fecha_hora_registro.desc(),
            UbicacionEmpleado.id_ubicacion.desc(),
        )
    )

    vigentes = {}
    for id_empleado, registro, lat, lng in ultimas.all():
        jornada, _ = en_jornada[id_empleado]
        if registro >= datetime.combine(jornada.fecha, jornada.hora_entrada):
            vigentes[id_empleado] = (registro, lat, lng)

    if not vigentes:
        return []

    ids_jornada = [en_jornada[i][0].id_asistencia for i in vigentes]
    pausas = await db.execute(
        select(Descanso.id_asistencia).where(
            Descanso.id_asistencia.in_(ids_jornada),
            Descanso.hora_fin.is_(None),
        )
    )
    jornadas_en_pausa = set(pausas.scalars().all())

    tareas = await db.execute(
        select(EmpleadoTarea.id_empleado)
        .join(Tarea, Tarea.id_tarea == EmpleadoTarea.id_tarea)
        .where(
            EmpleadoTarea.id_empleado.in_(list(vigentes)),
            Tarea.estado_tarea == "en_progreso",
        )
    )
    con_tarea = set(tareas.scalars().all())

    respuesta = []
    for id_empleado, (registro, lat, lng) in vigentes.items():
        jornada, empleado = en_jornada[id_empleado]
        if jornada.id_asistencia in jornadas_en_pausa:
            estado = "en_pausa"
        elif id_empleado in con_tarea:
            estado = "en_tarea"
        else:
            estado = "disponible"

        respuesta.append(
            UbicacionTecnicoResponse(
                id_empleado=id_empleado,
                nombre=f"{empleado.nombre} {empleado.apellido}",
                lat=lat,
                lng=lng,
                fecha_hora_registro=registro,
                estado=estado,
            )
        )

    return sorted(respuesta, key=lambda u: u.nombre)
