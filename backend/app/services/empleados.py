# backend/app/services/empleados.py
"""
Consultas y reglas de negocio de empleados — Teleprogreso S.A.
-----------------------------------------------------------------------------
Centraliza listado, creación, edición, estado, contraseñas y equipo asignado.
Las operaciones trabajan dentro de la sesión recibida y no hacen commit.

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
import logging
from dataclasses import dataclass
from datetime import time

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, conflict, not_found
from app.core.reglas import (
    ESTADO_DISPONIBLE,
    ESTADO_EMPLEADO_ACTIVO,
    ESTADOS_TAREA_ACTIVOS,
    ROL_ADMIN,
)
from app.core.security import hash_password
from app.core.tiempo import ahora as ahora_local
from app.models.activo import Activo, Carro, CarroHerramienta, Herramienta
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado, EmpleadoCarro, EmpleadoTarea
from app.models.tarea import Tarea
from app.schemas.empleado import (
    EmpleadoCreate,
    EmpleadoEstadoUpdate,
    EmpleadoPasswordUpdate,
    EmpleadoUpdate,
)

logger = logging.getLogger(__name__)

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


async def listar_empleados(
    db: AsyncSession,
    rol: str | None = None,
    estado: str | None = None,
    buscar: str | None = None,
) -> list[tuple]:
    """Consulta empleados con su placa y elimina duplicados por empleado."""
    query = (
        select(Empleado, Carro.placa)
        .outerjoin(EmpleadoCarro, EmpleadoCarro.id_empleado == Empleado.id_empleado)
        .outerjoin(Carro, Carro.id_activo == EmpleadoCarro.id_carro)
    )

    if rol:
        query = query.where(Empleado.rol == rol)
    if estado:
        query = query.where(Empleado.estado == estado)
    if buscar:
        termino = f"%{buscar.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Empleado.nombre).like(termino),
                func.lower(Empleado.apellido).like(termino),
                func.lower(Empleado.correo).like(termino),
            )
        )

    result = await db.execute(query.order_by(Empleado.nombre, Empleado.apellido))
    vistos: set[int] = set()
    unicos = []
    for empleado, placa in result.all():
        if empleado.id_empleado in vistos:
            continue
        vistos.add(empleado.id_empleado)
        unicos.append((empleado, placa))

    return unicos


async def crear_empleado(
    db: AsyncSession,
    data: EmpleadoCreate,
) -> Empleado:
    """Crea un empleado después de verificar que su correo sea único."""
    result = await db.execute(
        select(Empleado).where(Empleado.correo == data.correo)
    )
    if result.scalar_one_or_none():
        raise conflict(
            (
                "Ya existe un empleado registrado con el correo "
                f"'{data.correo}'."
            )
        )

    nuevo_empleado = Empleado(
        nombre=data.nombre,
        apellido=data.apellido,
        correo=data.correo,
        hash_contrasena=hash_password(data.contrasena),
        rol=data.rol,
        estado="activo",
        telefono=data.telefono,
        fecha_contratacion=data.fecha_contratacion,
    )
    db.add(nuevo_empleado)
    await db.flush()
    await db.refresh(nuevo_empleado)
    return nuevo_empleado


async def editar_empleado(
    db: AsyncSession,
    id_empleado: int,
    data: EmpleadoUpdate,
    current_user: Empleado,
) -> Empleado:
    """Edita un empleado preservando el último administrador activo."""
    result = await db.execute(
        select(Empleado).where(Empleado.id_empleado == id_empleado)
    )
    empleado = result.scalar_one_or_none()
    if not empleado:
        raise not_found(f"No se encontró ningún empleado con id={id_empleado}.")

    if data.rol is not None and data.rol != empleado.rol:
        if id_empleado == current_user.id_empleado:
            raise bad_request(
                (
                    "No puedes cambiar tu propio rol. "
                    "Pide a otro administrador que lo haga."
                )
            )

        if empleado.rol == ROL_ADMIN:
            result_admins = await db.execute(
                select(func.count(Empleado.id_empleado)).where(
                    Empleado.rol == ROL_ADMIN,
                    Empleado.estado == ESTADO_EMPLEADO_ACTIVO,
                    Empleado.id_empleado != id_empleado,
                )
            )
            if (result_admins.scalar() or 0) == 0:
                raise bad_request(
                    (
                        "No se puede quitar el rol de administrador: es el "
                        "único admin activo que queda. Asigna primero el rol "
                        "'admin' a otro empleado."
                    )
                )

    if data.correo and data.correo != empleado.correo:
        result_correo = await db.execute(
            select(Empleado).where(Empleado.correo == data.correo)
        )
        if result_correo.scalar_one_or_none():
            raise conflict(
                (
                    f"El correo '{data.correo}' ya está en uso "
                    "por otro empleado."
                )
            )

    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(empleado, campo, valor)

    return empleado


async def cambiar_estado_empleado(
    db: AsyncSession,
    id_empleado: int,
    data: EmpleadoEstadoUpdate,
) -> tuple[Empleado, ResultadoDesvinculacion | None]:
    """Cambia el estado y libera los recursos retenidos al desactivar."""
    result = await db.execute(
        select(Empleado).where(Empleado.id_empleado == id_empleado)
    )
    empleado = result.scalar_one_or_none()
    if not empleado:
        raise not_found(f"No se encontró ningún empleado con id={id_empleado}.")

    if empleado.estado == data.estado:
        accion = "activo" if data.estado == "activo" else "inactivo"
        raise bad_request(
            (
                f"El empleado '{empleado.nombre} {empleado.apellido}' "
                f"ya tiene el estado '{accion}'."
            )
        )

    if empleado.rol == ROL_ADMIN and data.estado != ESTADO_EMPLEADO_ACTIVO:
        result_admins = await db.execute(
            select(func.count(Empleado.id_empleado)).where(
                Empleado.rol == ROL_ADMIN,
                Empleado.estado == ESTADO_EMPLEADO_ACTIVO,
                Empleado.id_empleado != id_empleado,
            )
        )
        if (result_admins.scalar() or 0) == 0:
            raise bad_request(
                (
                    "No se puede desactivar: es el único administrador activo "
                    "que queda. Activa o crea otro admin antes de desactivar "
                    "este."
                )
            )

    empleado.estado = data.estado
    efectos = None
    if data.estado != ESTADO_EMPLEADO_ACTIVO:
        efectos = await desvincular_recursos(db, empleado)
        logger.info(
            "Empleado %s (id=%s) desactivado: vehiculo=%s, jornadas cerradas=%s, "
            "tareas activas sin reasignar=%s",
            empleado.correo,
            empleado.id_empleado,
            efectos.vehiculo_liberado,
            efectos.jornadas_cerradas,
            efectos.tareas_activas,
        )

    return empleado, efectos


async def restablecer_contrasena(
    db: AsyncSession,
    id_empleado: int,
    data: EmpleadoPasswordUpdate,
    current_user: Empleado,
) -> Empleado:
    """Restablece la contraseña y registra quién realizó la operación."""
    result = await db.execute(
        select(Empleado).where(Empleado.id_empleado == id_empleado)
    )
    empleado = result.scalar_one_or_none()
    if not empleado:
        raise not_found(f"No se encontró ningún empleado con id={id_empleado}.")

    empleado.hash_contrasena = hash_password(data.contrasena)
    # Las sesiones que el empleado tuviera abiertas dejan de valer aquí mismo.
    # Sin esto, restablecer la contraseña de una cuenta que se cree
    # comprometida no echaba a nadie: los JWT ya emitidos seguían funcionando
    # hasta expirar solos, que es justo lo que se quiere evitar al
    # restablecerla. `version_token` ya existe para el cambio de contraseña
    # propio (POST /auth/cambiar-contrasena); solo faltaba aplicarlo también
    # por esta puerta.
    empleado.version_token += 1
    logger.warning(
        "Contraseña restablecida para %s (id=%s) por %s (id=%s, rol=%s)",
        empleado.correo,
        empleado.id_empleado,
        current_user.correo,
        current_user.id_empleado,
        current_user.rol,
    )
    return empleado


async def obtener_equipo_empleado(
    db: AsyncSession,
    id_empleado: int,
) -> tuple[tuple | None, list[tuple]]:
    """Obtiene el vehículo y las herramientas asignadas a un empleado."""
    result_asig = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_empleado == id_empleado)
    )
    asignacion = result_asig.scalar_one_or_none()
    if not asignacion:
        return None, []

    result_carro = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .where(Carro.id_activo == asignacion.id_carro)
    )
    row_carro = result_carro.one_or_none()
    if not row_carro:
        return None, []

    result_herr = await db.execute(
        select(CarroHerramienta, Herramienta, Activo)
        .join(
            Herramienta,
            Herramienta.id_activo == CarroHerramienta.id_herramienta,
        )
        .join(Activo, Activo.id_activo == Herramienta.id_activo)
        .where(CarroHerramienta.id_carro == asignacion.id_carro)
        .order_by(Activo.nombre_activo)
    )
    return row_carro, list(result_herr.all())
