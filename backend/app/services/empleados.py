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

from fastapi import status

from app.core.exceptions import (
    APIException,
    bad_request,
    conflict,
    forbidden,
    not_found,
)
from app.core.reglas import (
    ESTADO_DISPONIBLE,
    ESTADO_EMPLEADO_ACTIVO,
    ESTADOS_TAREA_ACTIVOS,
    ROL_ADMIN,
    puede_administrar,
    validar_politica_contrasena,
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
        # RTF-01 / R3-3: esta salida la pone el sistema al desactivar la
        # cuenta, no la persona. Marcarla es lo que impide que sus horas entren
        # en los reportes como trabajo real.
        jornada.cierre_automatico = True

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


# RTF-01 / R1-5: la pantalla lo usa para ofrecer «son dos personas distintas»
# en vez del mensaje del correo repetido, que es el otro 409 de este módulo.
ERROR_EMPLEADO_DUPLICADO = "EMPLEADO_DUPLICADO"


async def _exigir_que_no_sea_un_duplicado(
    db: AsyncSession,
    nombre: str,
    apellido: str,
    *,
    excluir: int | None = None,
) -> None:
    """
    Rechaza un empleado cuyo nombre y apellido ya están registrados.

    RTF-01 / R1-5: el informe encontró a «Luis Fonzi» dos veces, como técnico
    y como supervisor. No es un dato raro: es la misma persona duplicada, y
    duplicada parte en dos su historial —sus tareas, sus jornadas y sus horas
    quedan repartidas entre dos ids— de modo que los reportes del gerente
    cuentan a medias.

    No se prohíbe del todo porque los homónimos existen; hay muchos «José
    García». Lo que se hace es parar el alta y decir con quién choca, para que
    el admin vea si es la misma persona. Si de verdad son dos, repite el alta
    con `permitir_homonimo`.

    La comparación ignora mayúsculas y espacios de sobra, que es por donde
    entran los duplicados que no se ven a simple vista.
    """
    nombre_limpio = " ".join((nombre or "").split()).lower()
    apellido_limpio = " ".join((apellido or "").split()).lower()

    condiciones = [
        func.lower(func.trim(Empleado.nombre)) == nombre_limpio,
        func.lower(func.trim(Empleado.apellido)) == apellido_limpio,
    ]
    if excluir is not None:
        condiciones.append(Empleado.id_empleado != excluir)

    result = await db.execute(select(Empleado).where(*condiciones))
    gemelo = result.scalars().first()
    if gemelo is None:
        return

    # Código propio para que la pantalla lo distinga del 409 del correo
    # repetido: los dos son conflictos, pero se resuelven de forma distinta.
    raise APIException(
        status.HTTP_409_CONFLICT,
        f"Ya hay un empleado llamado '{gemelo.nombre} {gemelo.apellido}' "
        f"(#{gemelo.id_empleado}, {gemelo.rol}, {gemelo.estado}). Si es la "
        "misma persona, edita ese registro en vez de crear otro; si de verdad "
        "son dos, vuelve a enviarlo marcando que es un homónimo.",
        ERROR_EMPLEADO_DUPLICADO,
    )


async def crear_empleado(
    db: AsyncSession,
    data: EmpleadoCreate,
) -> Empleado:
    """Crea un empleado después de verificar que su correo y su nombre no se repitan."""
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

    if not data.permitir_homonimo:
        await _exigir_que_no_sea_un_duplicado(db, data.nombre, data.apellido)

    nuevo_empleado = Empleado(
        nombre=data.nombre,
        apellido=data.apellido,
        correo=data.correo,
        hash_contrasena=hash_password(data.contrasena),
        rol=data.rol,
        estado="activo",
        telefono=data.telefono,
        fecha_contratacion=data.fecha_contratacion,
        # La contraseña la eligió el admin, no su dueño (HU-S10-01).
        debe_cambiar_contrasena=True,
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

    # La misma regla que al crear: si editar fuera más permisivo, el duplicado
    # entraría por la otra puerta —renombrando a alguien (RTF-01 / R1-5).
    nombre_nuevo = data.nombre if data.nombre is not None else empleado.nombre
    apellido_nuevo = (
        data.apellido if data.apellido is not None else empleado.apellido
    )
    cambia_el_nombre = (
        nombre_nuevo != empleado.nombre or apellido_nuevo != empleado.apellido
    )
    if cambia_el_nombre and not data.permitir_homonimo:
        await _exigir_que_no_sea_un_duplicado(
            db, nombre_nuevo, apellido_nuevo, excluir=id_empleado
        )

    # `permitir_homonimo` no es una columna: es permiso para esta petición.
    cambios = data.model_dump(exclude_unset=True)
    cambios.pop("permitir_homonimo", None)
    for campo, valor in cambios.items():
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


        # HU-S9-02: esta puerta es para restablecerle la clave a OTRA persona. El
    # dueño de la cuenta pasa por POST /auth/cambiar-contrasena, que sí exige
    # la contraseña actual; si no, quien tuviera una sesión robada podría
    # fijar una clave nueva sin conocer la vieja. Va antes de la jerarquía
    # porque un admin sí "puede" sobre sí mismo y habría que frenarlo igual.
    if current_user.id_empleado == empleado.id_empleado:
        raise forbidden(
            "No puedes restablecer tu propia contraseña por aquí. "
            "Usa «Cambiar contraseña» desde tu perfil."
        )

        # HU-S9-02: nadie toma una cuenta de más privilegio que la suya. Va ANTES
    # de tocar el hash y el mensaje es el mismo cuando el objetivo iguala y
    # cuando supera al actor, para no revelar qué rol tiene la otra cuenta.
    if not puede_administrar(current_user.rol, empleado.rol):
        raise forbidden("No tienes permiso para restablecer la contraseña de esta cuenta.")

    # Política única (HU-S10-01): el schema ya validó longitud, espacios y
    # contraseñas comunes. "Distinta del correo" no se ve desde el schema (solo
    # viaja el id en la ruta), así que se comprueba aquí con la cuenta a la
    # vista. Va después de la autorización para no confirmar el correo a quien
    # no puede tocar la cuenta. No se compara con la actual: quien restablece
    # no la conoce.
    try:
        validar_politica_contrasena(data.contrasena, correo=empleado.correo)
    except ValueError as error:
        raise bad_request(str(error)) from error

    empleado.hash_contrasena = hash_password(data.contrasena)
    # Las sesiones que el empleado tuviera abiertas dejan de valer aquí mismo.
    # Sin esto, restablecer la contraseña de una cuenta que se cree
    # comprometida no echaba a nadie: los JWT ya emitidos seguían funcionando
    # hasta expirar solos, que es justo lo que se quiere evitar al
    # restablecerla. `version_token` ya existe para el cambio de contraseña
    # propio (POST /auth/cambiar-contrasena); solo faltaba aplicarlo también
    # por esta puerta.
    empleado.version_token += 1
    # Quien la restablece la conoce: su dueño tiene que cambiarla al entrar
    # (HU-S10-01).
    empleado.debe_cambiar_contrasena = True
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