from datetime import datetime, timedelta
from typing import Optional

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tiempo import ahora as ahora_local
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.models.ubicacion import UbicacionEmpleado
from app.schemas.ubicacion import UbicacionTecnicoResponse
from app.services.asistencia import es_del_turno_en_curso


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
