# backend/app/routers/empleados.py
"""
Router de Empleados Teleprogreso S.A.
----------------------------------------
Gestiona la consulta y modifica  empleados del sistema.

Control de acceso: Todos los endpoints estan protegidos con require_admin.
 Solo usuarios con rol 'admin' pueden acceder.

Endpoints implementados:

  GET  /empleados                   = Lista empleados con filtros opcionales 
  PATCH /empleados/{id}             = Editar datos de un empleado
  PATCH /empleados/{id}/estado      = Activar o desactivar un empleado 

Endpoint POST /empleados:
  Va estar Implementado por Biancka.

Importate:
  - 'Desactivar' cambia el campo de `estado` a 'inactivo', en si no elimina el registro.
  - Un empleado inactivo recibe 403 al intentar autenticarse ( deps.py).
  - El admin no puede desactivarse a si mismo (guard en PATCH /{id}/estado).
"""

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_empleado, require_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.empleado import Empleado, EmpleadoCarro
from app.models.activo import Carro
from app.schemas.empleado import (
    EmpleadoCreate,
    EmpleadoEstadoUpdate,
    EmpleadoListResponse,
    EmpleadoResponse,
    EmpleadoUpdate,
)

router = APIRouter(prefix="/empleados", tags=["Empleados"])


#---------- GET /empleados -----------------
#Como administrador, quiero ver la lista completa de empleados.

@router.get(
    "",  # ← antes era "/", ahora ""
    response_model=EmpleadoListResponse,
    summary="Listar todos los empleados",
    status_code=status.HTTP_200_OK,
)
async def get_empleados( # Endpoint para listar empleados con filtros opcionales.
    db: Annotated[AsyncSession, Depends(get_db)],
    # Solo el admin puede ver la lista completa de empleados
    _current_user: Annotated[Empleado, Depends(require_admin)],
    # Filtros opcionales
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

    # Query base con LEFT JOIN a EmpleadoCarro → Carro para obtener placa_vehiculo
    query = (
        select(Empleado, Carro.placa)
        .outerjoin(EmpleadoCarro, EmpleadoCarro.id_empleado == Empleado.id_empleado)
        .outerjoin(Carro, Carro.id_activo == EmpleadoCarro.id_carro)
    )

    # Aplicar filtro por rol si se proporciono
    if rol:
        roles_validos = {"admin", "supervisor", "tecnico", "gerente"}
        if rol not in roles_validos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Rol '{rol}' no es válido. "
                    f"Roles permitidos: {', '.join(sorted(roles_validos))}"
                ),
            )
        query = query.where(Empleado.rol == rol)

    # Aplicar filtro por estado si se proporciono
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
        query = query.where(Empleado.estado == estado)

    # Aplicar busqueda de texto libre (case-insensitive) si se proporciono
    if buscar:
        termino = f"%{buscar.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Empleado.nombre).like(termino),
                func.lower(Empleado.apellido).like(termino),
                func.lower(Empleado.correo).like(termino),
            )
        )

    # Ordenar por nombre para presentacion consistente
    query = query.order_by(Empleado.nombre, Empleado.apellido)

    result = await db.execute(query)
    rows = result.all()  # lista de (Empleado, placa | None)

    # Construir respuestas incluyendo placa_vehiculo del JOIN
    empleados_response = [
        EmpleadoResponse(
            id_empleado=emp.id_empleado,
            nombre=emp.nombre,
            apellido=emp.apellido,
            correo=emp.correo,
            rol=emp.rol,
            estado=emp.estado,
            telefono=emp.telefono,
            fecha_contratacion=emp.fecha_contratacion,
            fecha_registro=emp.fecha_registro,
            ultimo_acceso=emp.ultimo_acceso,
            placa_vehiculo=placa,
        )
        for emp, placa in rows
    ]

    return EmpleadoListResponse(
        total=len(empleados_response),
        empleados=empleados_response,
    )


# ----------------- POST /empleados ---------------
# Como administrador, quiero crear nuevos empleados en el sistema.
#
# Validaciones de negocio implementadas:
#   1. Correo unico: si ya existe -> 409 Conflict
#   2. Rol valido: validado por el Enum RolEmpleado del schema -> 422
#   3. Fecha ISO: validada por el tipo date de Pydantic -> 422
#   4. Contrasena minima 8 chars: validator en EmpleadoCreate -> 422

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

    #  Verificar que el correo no este registrado ya
    #  (la columna 'correo' tiene unique=True en la BD, pero validamos antes
    #   para devolver un mensaje claro en lugar de un IntegrityError feo)
    result = await db.execute(
        select(Empleado).where(Empleado.correo == empleado_data.correo)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe un empleado registrado con el correo "
                f"'{empleado_data.correo}'."
            ),
        )

    # Crear el nuevo empleado con contraseña hasheada
    nuevo_empleado = Empleado(
        nombre=empleado_data.nombre,
        apellido=empleado_data.apellido,
        correo=empleado_data.correo,
        hash_contrasena=hash_password(empleado_data.contrasena),
        rol=empleado_data.rol,
        estado="activo",
        telefono=empleado_data.telefono,
        fecha_contratacion=empleado_data.fecha_contratacion,
    )

    db.add(nuevo_empleado)
    await db.flush()             # Obtener el id_empleado generado por la BD
    await db.refresh(nuevo_empleado)  # Cargar fecha_registro (server_default=now())

    return nuevo_empleado


# -------   PATCH /empleados/{id}---=-----
#Como administrador, quiero editar datos de un empleado.

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
    _current_user: Annotated[Empleado, Depends(require_admin)],
):
    #Buscar el empleado que se quiere editar
    result = await db.execute(
        select(Empleado).where(Empleado.id_empleado == id)
    )
    empleado = result.scalar_one_or_none()

    if not empleado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún empleado con id={id}.",
        )

    # Si se esta cambiando el correo, verificar que no este en uso
    if data.correo and data.correo != empleado.correo:
        result_correo = await db.execute(
            select(Empleado).where(Empleado.correo == data.correo)
        )
        if result_correo.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"El correo '{data.correo}' ya está en uso "
                    f"por otro empleado."
                ),
            )

    # Aplicar solo los campos que se enviaron (PATCH parcial)
    #    Se usa exclude_unset=True para no sobreescribir con None
    campos_actualizados = data.model_dump(exclude_unset=True)

    for campo, valor in campos_actualizados.items():
        setattr(empleado, campo, valor)

    #La sesion hace commit automatico al salir del contexto ( session.py)
    return empleado


# -------- PATCH /empleados/{id}/estado ---------
#Como administrador, quiero activar o desactivar cuentas.

@router.patch(
    "/{id}/estado",
    response_model=EmpleadoResponse,
    summary="Activar o desactivar la cuenta de un empleado",
    status_code=status.HTTP_200_OK,
)
async def update_estado_empleado(
    id: int,
    data: EmpleadoEstadoUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(require_admin)],
):
    #Cambia el estado de la cuenta de un empleado a activo o inactivo.
    #Guard: el admin no puede desactivarse a si mismo
    if id == current_user.id_empleado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No puedes cambiar el estado de tu propia cuenta. "
                "Pide a otro administrador que realice este cambio."
            ),
        )

    #Buscar el empleado objetivo
    result = await db.execute(
        select(Empleado).where(Empleado.id_empleado == id)
    )
    empleado = result.scalar_one_or_none()

    if not empleado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún empleado con id={id}.",
        )

    # Verificar si el cambio es necesario para evitar escrituras innecesarias
    if empleado.estado == data.estado:
        accion = "activo" if data.estado == "activo" else "inactivo"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El empleado '{empleado.nombre} {empleado.apellido}' "
                f"ya tiene el estado '{accion}'."
            ),
        )

    # Aplicar el cambio de estado
    empleado.estado = data.estado

    return empleado

# ─── GET /empleados/mi-equipo ─────────────────────────────────────────────
# T5.1: Endpoint para que el técnico autenticado vea su vehículo + herramientas

from app.models.activo import Activo, Carro, CarroHerramienta, Herramienta
from app.models.empleado import EmpleadoCarro
from app.schemas.activo import CarroResponse, HerramientaEnCarroResponse


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
    # 1. Buscar asignación carro↔empleado
    result_asig = await db.execute(
        select(EmpleadoCarro)
        .where(EmpleadoCarro.id_empleado == current_user.id_empleado)
    )
    asig = result_asig.scalar_one_or_none()

    if not asig:
        return {"vehiculo": None, "herramientas": []}

    # 2. Obtener datos del carro
    result_carro = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .where(Carro.id_activo == asig.id_carro)
    )
    row_carro = result_carro.one_or_none()

    if not row_carro:
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
        nombre_empleado_asignado=f"{current_user.nombre} {current_user.apellido}",
    )

    # 3. Obtener herramientas del carro
    result_herr = await db.execute(
        select(CarroHerramienta, Herramienta, Activo)
        .join(Herramienta, Herramienta.id_activo == CarroHerramienta.id_herramienta)
        .join(Activo, Activo.id_activo == Herramienta.id_activo)
        .where(CarroHerramienta.id_carro == asig.id_carro)
        .order_by(Activo.nombre_activo)
    )
    rows_herr = result_herr.all()

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
        for relacion, herramienta, activo in rows_herr
    ]

    return {"vehiculo": vehiculo, "herramientas": herramientas}
