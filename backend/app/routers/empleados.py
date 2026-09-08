# backend/app/routers/empleados.py
"""
Router de Empleados — Teleprogreso S.A.

Define el contrato HTTP, valida filtros, aplica permisos y serializa las
respuestas. Las consultas y reglas de negocio viven en
app/services/empleados.py.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado, require_admin, require_supervisor
from app.core.reglas import ROLES_VALIDOS
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.activo import CarroResponse, HerramientaEnCarroResponse
from app.schemas.empleado import (
    EmpleadoCreate,
    EmpleadoEstadoResponse,
    EmpleadoEstadoUpdate,
    EmpleadoListResponse,
    EmpleadoPasswordUpdate,
    EmpleadoResponse,
    EmpleadoUpdate,
)
from app.services import empleados as empleados_service

router = APIRouter(prefix="/empleados", tags=["Empleados"])


def _serializar_empleado(empleado, placa=None) -> EmpleadoResponse:
    """Construye la representación pública de un empleado."""
    return EmpleadoResponse(
        id_empleado=empleado.id_empleado,
        nombre=empleado.nombre,
        apellido=empleado.apellido,
        correo=empleado.correo,
        rol=empleado.rol,
        estado=empleado.estado,
        telefono=empleado.telefono,
        fecha_contratacion=empleado.fecha_contratacion,
        fecha_registro=empleado.fecha_registro,
        ultimo_acceso=empleado.ultimo_acceso,
        placa_vehiculo=placa,
    )


@router.get(
    "",
    response_model=EmpleadoListResponse,
    summary="Listar todos los empleados",
    status_code=status.HTTP_200_OK,
)
async def get_empleados(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
    rol: Optional[str] = Query(
        None,
        description="Filtrar por rol: admin | supervisor | tecnico | gerente",
    ),
    estado: Optional[str] = Query(
        None,
        description="Filtrar por estado: activo | inactivo",
    ),
    buscar: Optional[str] = Query(
        None,
        description="Buscar por nombre, apellido o correo (búsqueda parcial)",
    ),
):
    if rol:
        roles_validos = set(ROLES_VALIDOS)
        if rol not in roles_validos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Rol '{rol}' no es válido. "
                    f"Roles permitidos: {', '.join(sorted(roles_validos))}"
                ),
            )

    if estado:
        estados_validos = {"activo", "inactivo"}
        if estado not in estados_validos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Estado '{estado}' no es válido. "
                    f"Estados permitidos: {', '.join(sorted(estados_validos))}"
                ),
            )

    rows = await empleados_service.listar_empleados(
        db,
        rol=rol,
        estado=estado,
        buscar=buscar,
    )
    empleados_response = [
        _serializar_empleado(empleado, placa)
        for empleado, placa in rows
    ]
    return EmpleadoListResponse(
        total=len(empleados_response),
        empleados=empleados_response,
    )


@router.post(
    "",
    response_model=EmpleadoResponse,
    summary="Crear nuevo empleado",
    status_code=status.HTTP_201_CREATED,
)
async def create_empleado(
    empleado_data: EmpleadoCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_admin)],
):
    """
    Crea un nuevo empleado en el sistema.
    Solo accesible para usuarios con rol 'admin'.
    La contrasena se guarda hasheada con bcrypt; nunca en texto plano.
    """
    return await empleados_service.crear_empleado(db, empleado_data)


@router.patch(
    "/{id}",
    response_model=EmpleadoResponse,
    summary="Editar datos de un empleado",
    status_code=status.HTTP_200_OK,
)
async def update_empleado(
    id: int,
    data: EmpleadoUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(require_admin)],
):
    return await empleados_service.editar_empleado(db, id, data, current_user)


@router.patch(
    "/{id}/estado",
    response_model=EmpleadoEstadoResponse,
    summary="Activar o desactivar la cuenta de un empleado",
    status_code=status.HTTP_200_OK,
)
async def update_estado_empleado(
    id: int,
    data: EmpleadoEstadoUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(require_admin)],
):
    if id == current_user.id_empleado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No puedes cambiar el estado de tu propia cuenta. "
                "Pide a otro administrador que realice este cambio."
            ),
        )

    empleado, efectos = await empleados_service.cambiar_estado_empleado(
        db,
        id,
        data,
    )
    return EmpleadoEstadoResponse(
        id_empleado=empleado.id_empleado,
        nombre=empleado.nombre,
        apellido=empleado.apellido,
        correo=empleado.correo,
        rol=empleado.rol,
        estado=empleado.estado,
        telefono=empleado.telefono,
        fecha_contratacion=empleado.fecha_contratacion,
        fecha_registro=empleado.fecha_registro,
        ultimo_acceso=empleado.ultimo_acceso,
        vehiculo_liberado=efectos.vehiculo_liberado if efectos else None,
        jornadas_cerradas=efectos.jornadas_cerradas if efectos else 0,
        tareas_activas_sin_reasignar=efectos.tareas_activas if efectos else 0,
    )


@router.patch(
    "/{id}/contrasena",
    summary="Restablecer la contraseña de un empleado",
    status_code=status.HTTP_200_OK,
)
async def update_contrasena_empleado(
    id: int,
    data: EmpleadoPasswordUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Asigna una contraseña nueva a un empleado.

    Hasta ahora la contraseña se fijaba al crear el empleado y no había forma
    de volver a cambiarla: ni el propio usuario ni un administrador. Un
    empleado que la olvidara quedaba sin acceso de forma permanente.

    Reglas:
    - Solo admin y supervisor (`require_supervisor`).
    - Mínimo 8 caracteres y hay que escribirla dos veces (la valida el schema).
    - Se guarda hasheada con bcrypt; nunca en texto plano y nunca se devuelve.
    - No se pide la contraseña anterior: quien la restablece es un
      administrador, no el dueño de la cuenta.
    """
    empleado = await empleados_service.restablecer_contrasena(
        db,
        id,
        data,
        current_user,
    )
    return {
        "detail": (
            f"Contraseña actualizada para {empleado.nombre} {empleado.apellido}. "
            "Comunícasela por un medio seguro y pídele que la cambie contigo "
            "si sospecha que alguien más la vio."
        ),
        "id_empleado": empleado.id_empleado,
    }


@router.get(
    "/mi-equipo",
    summary="Ver el vehículo y herramientas asignadas al técnico autenticado",
    status_code=status.HTTP_200_OK,
)
async def get_mi_equipo(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Devuelve el vehículo asignado al técnico autenticado y las herramientas
    que lleva ese vehículo.

    Respuesta:
      {
        "vehiculo": CarroResponse | null,
        "herramientas": HerramientaEnCarroResponse[]
      }

    Roles: cualquier empleado autenticado (principalmente técnicos).
    """
    row_carro, rows_herramientas = await empleados_service.obtener_equipo_empleado(
        db,
        current_user.id_empleado,
    )
    if row_carro is None:
        return {"vehiculo": None, "herramientas": []}

    activo_carro, carro = row_carro
    vehiculo = CarroResponse(
        id_activo=activo_carro.id_activo,
        nombre_activo=activo_carro.nombre_activo,
        descripcion=activo_carro.descripcion,
        tipo=activo_carro.tipo,
        fecha_registro=activo_carro.fecha_registro,
        foto_url=activo_carro.foto_url,
        placa=carro.placa,
        marca=carro.marca,
        modelo=carro.modelo,
        capacidad=carro.capacidad,
        estado_vehiculo=carro.estado_vehiculo,
        id_empleado_asignado=current_user.id_empleado,
        nombre_empleado_asignado=(
            f"{current_user.nombre} {current_user.apellido}"
        ),
    )
    herramientas = [
        HerramientaEnCarroResponse(
            id_activo=activo.id_activo,
            nombre_activo=activo.nombre_activo,
            descripcion=activo.descripcion,
            foto_url=activo.foto_url,
            tipo_herramienta=herramienta.tipo_herramienta,
            marca=herramienta.marca,
            modelo=herramienta.modelo,
            estado=herramienta.estado,
            fecha_asignacion=relacion.fecha_asignacion,
            estado_entrega=relacion.estado_entrega,
            comentario=relacion.comentario,
        )
        for relacion, herramienta, activo in rows_herramientas
    ]
    return {"vehiculo": vehiculo, "herramientas": herramientas}
