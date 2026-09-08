"""Carros: contrato HTTP, permisos y serialización (rutas /activos/carros)."""

from typing import Annotated, List

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_current_empleado,
    require_admin_supervisor_gerente,
    require_supervisor,
)
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.activo import (
    AsignarHerramientaRequest,
    AsignarTecnicoRequest,
    CarroResponse,
    HerramientaEnCarroResponse,
)
from app.services import carros as carros_service

router = APIRouter(prefix="/activos", tags=["Carros"])


def _serializar_carro(activo, carro, asignacion=None) -> CarroResponse:
    """Construye la respuesta pública de un vehículo."""
    return CarroResponse(
        id_activo=activo.id_activo,
        nombre_activo=activo.nombre_activo,
        descripcion=activo.descripcion,
        tipo=activo.tipo,
        fecha_registro=activo.fecha_registro,
        placa=carro.placa,
        marca=carro.marca,
        modelo=carro.modelo,
        capacidad=carro.capacidad,
        estado_vehiculo=carro.estado_vehiculo,
        id_empleado_asignado=(
            asignacion.id_empleado if asignacion else None
        ),
        nombre_empleado_asignado=(
            f"{asignacion.empleado.nombre} {asignacion.empleado.apellido}"
            if asignacion and asignacion.empleado
            else None
        ),
    )


def _serializar_herramienta(
    relacion,
    herramienta,
    activo,
) -> HerramientaEnCarroResponse:
    """Construye la respuesta pública de una herramienta asignada."""
    return HerramientaEnCarroResponse(
        id_activo=activo.id_activo,
        nombre_activo=activo.nombre_activo,
        descripcion=activo.descripcion,
        tipo_herramienta=herramienta.tipo_herramienta,
        marca=herramienta.marca,
        modelo=herramienta.modelo,
        estado=herramienta.estado,
        fecha_asignacion=relacion.fecha_asignacion,
        estado_entrega=relacion.estado_entrega,
        comentario=relacion.comentario,
    )


@router.get(
    "/carros",
    response_model=List[CarroResponse],
    summary="Listar todos los vehiculos",
    status_code=status.HTTP_200_OK,
)
async def get_carros(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Lista todos los vehiculos del inventario con su tecnico asignado (si aplica).

    Roles: admin, supervisor y gerente. Un tecnico ve su propio vehiculo en
    GET /empleados/mi-equipo, no la flota entera.
    """
    rows = await carros_service.listar_carros(db)
    return [
        _serializar_carro(activo, carro, asignacion)
        for activo, carro, asignacion in rows
    ]


@router.get(
    "/carros/{id}",
    response_model=CarroResponse,
    summary="Obtener detalle de un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def get_carro_by_id(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Devuelve el detalle de un vehiculo por su id_activo.
    Roles: admin, supervisor y gerente.
    """
    activo, carro, asignacion = await carros_service.obtener_carro(db, id)
    return _serializar_carro(activo, carro, asignacion)


@router.get(
    "/carros/{id}/herramientas",
    response_model=List[HerramientaEnCarroResponse],
    summary="Listar herramientas asignadas a un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def get_herramientas_de_carro(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Lista todas las herramientas actualmente asignadas al vehiculo indicado.
    Incluye datos de la tabla CarroHerramienta (fecha_asignacion, estado_entrega, comentario).

    Roles: admin, supervisor y gerente sobre cualquier vehiculo. Un tecnico
    solo sobre el suyo: es la unica parte del inventario que le corresponde
    ver, porque son las herramientas que lleva encima.
    """
    rows = await carros_service.listar_herramientas_de_carro(
        db,
        id,
        current_user,
    )
    return [
        _serializar_herramienta(relacion, herramienta, activo)
        for relacion, herramienta, activo in rows
    ]


@router.post(
    "/carros/{id}/herramientas",
    response_model=HerramientaEnCarroResponse,
    summary="Asignar una herramienta a un vehiculo",
    status_code=status.HTTP_201_CREATED,
)
async def asignar_herramienta_a_carro(
    id: int,
    body: AsignarHerramientaRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Asigna una herramienta disponible al vehiculo especificado.

    Reglas de negocio:
    - El vehiculo debe existir.
    - La herramienta debe existir y estar en estado 'disponible'.
    - La herramienta no puede estar ya asignada al mismo carro.

    Roles: admin, supervisor.
    """
    relacion, herramienta, activo = await carros_service.asignar_herramienta(
        db,
        id,
        body.id_herramienta,
    )
    return _serializar_herramienta(relacion, herramienta, activo)


@router.delete(
    "/carros/{id}/herramientas/{id_h}",
    summary="Liberar una herramienta de un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def liberar_herramienta_de_carro(
    id: int,
    id_h: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Desasigna (libera) una herramienta del vehiculo especificado.
    La herramienta vuelve al estado 'disponible'.

    Reglas de negocio:
    - La relacion carro-herramienta debe existir.

    Roles: admin, supervisor.
    """
    await carros_service.liberar_herramienta(db, id, id_h)
    return {
        "detail": f"Herramienta id={id_h} liberada del vehiculo id={id} correctamente.",
        "id_carro": id,
        "id_herramienta": id_h,
    }


@router.post(
    "/carros/{id}/asignar",
    summary="Asignar un tecnico a un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def asignar_tecnico_a_carro(
    id: int,
    body: AsignarTecnicoRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Asigna un tecnico activo a un vehiculo disponible.

    Reglas de negocio:
    1. El vehiculo debe existir y estar en estado 'disponible'.
    2. El tecnico debe existir y estar 'activo'.
    3. Un tecnico solo puede tener un vehiculo asignado a la vez (1 tecnico = 1 carro).
    4. Un vehiculo solo puede tener un tecnico asignado a la vez.

    Si el vehiculo ya tiene tecnico asignado se devuelve 400: hay que liberar
    la asignacion primero. Antes se reemplazaba en silencio, asi que reasignar
    un vehiculo dejaba a otro tecnico sin transporte sin ningun aviso.

    Roles: admin, supervisor.
    """
    carro, empleado = await carros_service.asignar_tecnico(
        db,
        id,
        body.id_empleado,
    )
    return {
        "detail": "Tecnico asignado al vehiculo correctamente.",
        "id_carro": id,
        "placa": carro.placa,
        "id_empleado": body.id_empleado,
        "nombre_empleado": f"{empleado.nombre} {empleado.apellido}",
    }


@router.delete(
    "/carros/{id}/asignacion",
    summary="Liberar el tecnico asignado a un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def liberar_asignacion_tecnico(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Elimina la asignacion entre un tecnico y un vehiculo.
    El vehiculo vuelve al estado 'disponible'.

    Reglas:
    - El vehiculo debe existir.
    - Debe tener un tecnico asignado para poder liberarlo.

    Roles: admin, supervisor.
    """
    id_empleado, nombre_empleado = await carros_service.liberar_tecnico(db, id)
    return {
        "detail": (
            f"Tecnico '{nombre_empleado}' liberado del vehiculo id={id} "
            "correctamente."
        ),
        "id_carro": id,
        "id_empleado": id_empleado,
    }
