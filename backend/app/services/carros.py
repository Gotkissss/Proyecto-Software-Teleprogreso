"""
Consultas y reglas de negocio de vehículos — Teleprogreso S.A.

Las funciones de este módulo operan dentro de la sesión recibida y no hacen
commit. Los routers conservan el contrato HTTP, los permisos y la
serialización de las respuestas.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request, not_found
from app.core.reglas import (
    ESTADO_DISPONIBLE,
    ESTADO_EMPLEADO_ACTIVO,
    ESTADO_EN_USO,
)
from app.models.activo import Activo, Carro, CarroHerramienta, Herramienta
from app.models.empleado import Empleado, EmpleadoCarro
from app.services.inventario import exigir_acceso_a_carro


async def listar_carros(db: AsyncSession) -> list[tuple]:
    """Obtiene los vehículos con su asignación actual, si existe."""
    result = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .order_by(Activo.nombre_activo)
    )
    rows = result.all()
    ids_carros = [carro.id_activo for _, carro in rows]

    asignaciones: dict[int, EmpleadoCarro] = {}
    if ids_carros:
        result_asig = await db.execute(
            select(EmpleadoCarro)
            .options(selectinload(EmpleadoCarro.empleado))
            .where(EmpleadoCarro.id_carro.in_(ids_carros))
        )
        for asignacion in result_asig.scalars().all():
            asignaciones[asignacion.id_carro] = asignacion

    return [
        (activo, carro, asignaciones.get(carro.id_activo))
        for activo, carro in rows
    ]


async def obtener_carro(db: AsyncSession, id_carro: int) -> tuple:
    """Obtiene un vehículo y su asignación actual."""
    result = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .where(Activo.id_activo == id_carro)
    )
    row = result.one_or_none()

    if not row:
        raise not_found(f"No se encontro ningun vehiculo con id={id_carro}.")

    result_asig = await db.execute(
        select(EmpleadoCarro)
        .options(selectinload(EmpleadoCarro.empleado))
        .where(EmpleadoCarro.id_carro == id_carro)
    )
    return row[0], row[1], result_asig.scalars().first()


async def listar_herramientas_de_carro(
    db: AsyncSession,
    id_carro: int,
    current_user: Empleado,
) -> list[tuple]:
    """Obtiene las herramientas de un vehículo visible para el usuario."""
    result_carro = await db.execute(
        select(Carro).where(Carro.id_activo == id_carro)
    )
    if not result_carro.scalar_one_or_none():
        raise not_found(f"No se encontro ningun vehiculo con id={id_carro}.")

    await exigir_acceso_a_carro(db, current_user, id_carro)

    result = await db.execute(
        select(CarroHerramienta, Herramienta, Activo)
        .join(
            Herramienta,
            Herramienta.id_activo == CarroHerramienta.id_herramienta,
        )
        .join(Activo, Activo.id_activo == Herramienta.id_activo)
        .where(CarroHerramienta.id_carro == id_carro)
        .order_by(Activo.nombre_activo)
    )
    return list(result.all())


async def asignar_herramienta(
    db: AsyncSession,
    id_carro: int,
    id_herramienta: int,
) -> tuple:
    """Asigna una herramienta disponible a un vehículo."""
    result_carro = await db.execute(
        select(Carro).where(Carro.id_activo == id_carro)
    )
    if not result_carro.scalar_one_or_none():
        raise not_found(f"No se encontro ningun vehiculo con id={id_carro}.")

    result_herr = await db.execute(
        select(Herramienta, Activo)
        .join(Activo, Activo.id_activo == Herramienta.id_activo)
        .where(Herramienta.id_activo == id_herramienta)
    )
    row_herr = result_herr.one_or_none()

    if not row_herr:
        raise not_found(
            f"No se encontro ninguna herramienta con id={id_herramienta}."
        )

    herramienta, activo = row_herr
    if herramienta.estado != ESTADO_DISPONIBLE:
        raise bad_request(
            (
                f"La herramienta '{activo.nombre_activo}' no esta disponible "
                f"(estado actual: '{herramienta.estado}'). "
                "Solo se pueden asignar herramientas en estado 'disponible'."
            )
        )

    result_existe = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_carro == id_carro,
            CarroHerramienta.id_herramienta == id_herramienta,
        )
    )
    if result_existe.scalar_one_or_none():
        raise bad_request(
            (
                f"La herramienta '{activo.nombre_activo}' ya esta asignada "
                "a este vehiculo."
            )
        )

    nueva_asignacion = CarroHerramienta(
        id_carro=id_carro,
        id_herramienta=id_herramienta,
        estado_entrega="Buenas condiciones",
    )
    db.add(nueva_asignacion)
    herramienta.estado = ESTADO_EN_USO
    await db.flush()

    return nueva_asignacion, herramienta, activo


async def liberar_herramienta(
    db: AsyncSession,
    id_carro: int,
    id_herramienta: int,
) -> None:
    """Libera una herramienta y actualiza su disponibilidad si corresponde."""
    result = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_carro == id_carro,
            CarroHerramienta.id_herramienta == id_herramienta,
        )
    )
    relacion = result.scalar_one_or_none()

    if not relacion:
        raise not_found(
            (
                f"La herramienta id={id_herramienta} no esta asignada al "
                f"vehiculo id={id_carro}."
            )
        )

    await db.delete(relacion)
    await db.flush()

    result_otras = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_herramienta == id_herramienta,
        )
    )
    sigue_asignada = result_otras.scalars().first() is not None

    result_herr = await db.execute(
        select(Herramienta).where(Herramienta.id_activo == id_herramienta)
    )
    herramienta = result_herr.scalar_one_or_none()
    if herramienta and not sigue_asignada:
        herramienta.estado = ESTADO_DISPONIBLE


async def asignar_tecnico(
    db: AsyncSession,
    id_carro: int,
    id_empleado: int,
) -> tuple[Carro, Empleado]:
    """Asigna un empleado activo a un vehículo disponible."""
    result_carro = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .where(Activo.id_activo == id_carro)
    )
    row_carro = result_carro.one_or_none()

    if not row_carro:
        raise not_found(f"No se encontro ningun vehiculo con id={id_carro}.")

    activo_carro, carro = row_carro
    if carro.estado_vehiculo != ESTADO_DISPONIBLE:
        raise bad_request(
            (
                f"El vehiculo '{activo_carro.nombre_activo}' (placa: {carro.placa}) "
                "no esta disponible para asignacion "
                f"(estado actual: '{carro.estado_vehiculo}'). "
                "Solo se pueden asignar vehiculos en estado 'disponible'."
            )
        )

    result_emp = await db.execute(
        select(Empleado).where(Empleado.id_empleado == id_empleado)
    )
    empleado = result_emp.scalar_one_or_none()
    if not empleado:
        raise not_found(f"No se encontro ningun empleado con id={id_empleado}.")

    if empleado.estado != ESTADO_EMPLEADO_ACTIVO:
        raise bad_request(
            (
                f"El empleado '{empleado.nombre} {empleado.apellido}' "
                f"no esta activo (estado: '{empleado.estado}'). "
                "Solo se pueden asignar empleados activos."
            )
        )

    result_tecnico_carro = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_empleado == id_empleado)
    )
    asig_existente_tecnico = result_tecnico_carro.scalars().first()
    if asig_existente_tecnico:
        if asig_existente_tecnico.id_carro == id_carro:
            raise bad_request(
                (
                    f"El tecnico '{empleado.nombre} {empleado.apellido}' "
                    "ya esta asignado a este vehiculo."
                )
            )
        raise bad_request(
            (
                f"El tecnico '{empleado.nombre} {empleado.apellido}' "
                f"ya tiene asignado el vehiculo id={asig_existente_tecnico.id_carro}. "
                "Un tecnico solo puede tener un vehiculo a la vez. "
                "Libera el vehiculo actual antes de reasignar."
            )
        )

    result_carro_tecnico = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_carro == id_carro)
    )
    asig_anterior = result_carro_tecnico.scalars().first()
    if asig_anterior:
        raise bad_request(
            (
                f"El vehiculo '{activo_carro.nombre_activo}' ya tiene asignado "
                f"al empleado id={asig_anterior.id_empleado}. Libera esa "
                "asignacion antes de asignarlo a otro tecnico."
            )
        )

    db.add(EmpleadoCarro(id_empleado=id_empleado, id_carro=id_carro))
    carro.estado_vehiculo = ESTADO_EN_USO
    await db.flush()

    return carro, empleado


async def liberar_tecnico(
    db: AsyncSession,
    id_carro: int,
) -> tuple[int, str]:
    """Libera al empleado asignado y devuelve su id y nombre visible."""
    result_carro = await db.execute(
        select(Carro).where(Carro.id_activo == id_carro)
    )
    carro = result_carro.scalar_one_or_none()
    if not carro:
        raise not_found(f"No se encontro ningun vehiculo con id={id_carro}.")

    result_asig = await db.execute(
        select(EmpleadoCarro)
        .options(selectinload(EmpleadoCarro.empleado))
        .where(EmpleadoCarro.id_carro == id_carro)
    )
    asignacion = result_asig.scalars().first()
    if not asignacion:
        raise bad_request(
            f"El vehiculo id={id_carro} no tiene ningun tecnico asignado."
        )

    nombre_empleado = (
        f"{asignacion.empleado.nombre} {asignacion.empleado.apellido}"
        if asignacion.empleado
        else f"id={asignacion.id_empleado}"
    )
    id_empleado = asignacion.id_empleado
    await db.delete(asignacion)
    carro.estado_vehiculo = ESTADO_DISPONIBLE

    return id_empleado, nombre_empleado
