# backend/app/services/inventario.py
"""
Control de acceso al inventario — Teleprogreso S.A.
-----------------------------------------------------------------------------
Regla de negocio: un empleado de campo solo ve **lo que tiene asignado**. Su
vehículo y las herramientas cargadas en él, nada más. Si necesita una
herramienta o un material que no lleva, lo pide al supervisor o al gerente;
no lo busca él en el catálogo.

Antes cualquier empleado autenticado podía listar la flota completa, el
inventario entero de herramientas y todos los materiales con sus existencias,
además de ver a qué técnico estaba asignado cada vehículo. No era un fallo de
autenticación —hacía falta token— pero sí mucha más visibilidad de la que
corresponde al puesto.

Las funciones de aquí las usan los routers de activos, carros e inventario.
-----------------------------------------------------------------------------
"""
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.reglas import ROLES_SUPERVISION
from app.models.activo import CarroHerramienta
from app.models.empleado import Empleado, EmpleadoCarro

# Mensaje único para no filtrar, por la diferencia entre respuestas, si un
# activo existe o simplemente no es del empleado que pregunta.
_SIN_ACCESO = (
    "Solo puedes consultar el vehículo y las herramientas que tienes "
    "asignados. Si necesitas otra herramienta o algún material, solicítalo a "
    "tu supervisor."
)


async def carro_asignado_a(db: AsyncSession, id_empleado: int) -> Optional[int]:
    """id_activo del vehículo asignado al empleado, o None si no tiene."""
    result = await db.execute(
        select(EmpleadoCarro.id_carro).where(
            EmpleadoCarro.id_empleado == id_empleado
        )
    )
    return result.scalars().first()


async def puede_ver_activo(
    db: AsyncSession,
    empleado: Empleado,
    id_activo: int,
) -> bool:
    """
    True si el empleado puede consultar ese activo.

    Los roles de supervisión (admin, supervisor, gerente) ven todo el
    inventario: es parte de su trabajo. El resto solo ve su propio vehículo y
    las herramientas cargadas en él.
    """
    if empleado.rol in ROLES_SUPERVISION:
        return True

    id_carro = await carro_asignado_a(db, empleado.id_empleado)
    if id_carro is None:
        return False

    if id_activo == id_carro:
        return True

    result = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_carro == id_carro,
            CarroHerramienta.id_herramienta == id_activo,
        )
    )
    return result.scalars().first() is not None


async def exigir_acceso_a_activo(
    db: AsyncSession,
    empleado: Empleado,
    id_activo: int,
) -> None:
    """Lanza 403 si el empleado no puede consultar ese activo."""
    if not await puede_ver_activo(db, empleado, id_activo):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_SIN_ACCESO,
        )


async def exigir_acceso_a_carro(
    db: AsyncSession,
    empleado: Empleado,
    id_carro: int,
) -> None:
    """
    Lanza 403 si el vehículo no es el del empleado.

    Se separa de `exigir_acceso_a_activo` porque consultar las herramientas de
    un vehículo ajeno no debe permitirse aunque el técnico lleve alguna
    herramienta con el mismo id.
    """
    if empleado.rol in ROLES_SUPERVISION:
        return

    if await carro_asignado_a(db, empleado.id_empleado) != id_carro:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_SIN_ACCESO,
        )
