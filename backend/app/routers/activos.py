from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_empleado, require_supervisor
from app.db.session import get_db
from app.models.activo import Activo, Carro, CarroHerramienta, Herramienta, Material
from app.models.empleado import Empleado, EmpleadoCarro
from app.schemas.activo import (
    AsignarHerramientaRequest,
    AsignarTecnicoRequest,
    CarroResponse,
    HerramientaEnCarroResponse,
    HerramientaResponse,
    MaterialResponse,
)

router = APIRouter(prefix="/activos", tags=["Activos"])


# ═══════════════════════════════════════════════════════════
# ENDPOINTS DE MATERIALES
# ═══════════════════════════════════════════════════════════

# ─── GET /activos/materiales/bajo-stock ──────────────────────────────
@router.get(
    "/materiales/bajo-stock",
    response_model=List[MaterialResponse],
    summary="Materiales con stock bajo el minimo definido",
    status_code=status.HTTP_200_OK,
)
async def get_materiales_bajo_stock(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Retorna todos los materiales donde cantidad_disponible < stock_minimo.
    Roles: cualquier empleado autenticado.
    """
    result = await db.execute(
        select(Activo, Material)
        .join(Material, Material.id_activo == Activo.id_activo)
        .where(Material.cantidad_disponible < Material.stock_minimo)
        .order_by(Material.cantidad_disponible)  # los mas criticos primero
    )
    rows = result.all()

    respuesta = []
    for activo, material in rows:
        respuesta.append(
            MaterialResponse(
                id_activo=activo.id_activo,
                nombre_activo=activo.nombre_activo,
                descripcion=activo.descripcion,
                tipo=activo.tipo,
                fecha_registro=activo.fecha_registro,
                cantidad_disponible=material.cantidad_disponible,
                stock_minimo=material.stock_minimo,
                unidad_medida=material.unidad_medida,
                tipo_material=material.tipo_material,
            )
        )

    return respuesta


# ─── GET /activos/materiales ───────────────────────────────────────────────
@router.get(
    "/materiales",
    response_model=List[MaterialResponse],
    summary="Listar todos los materiales",
    status_code=status.HTTP_200_OK,
)
async def get_materiales(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Lista todos los materiales del inventario.
    Roles: cualquier empleado autenticado.
    """
    result = await db.execute(
        select(Activo, Material)
        .join(Material, Material.id_activo == Activo.id_activo)
        .order_by(Activo.nombre_activo)
    )
    rows = result.all()

    return [
        MaterialResponse(
            id_activo=activo.id_activo,
            nombre_activo=activo.nombre_activo,
            descripcion=activo.descripcion,
            tipo=activo.tipo,
            fecha_registro=activo.fecha_registro,
            cantidad_disponible=material.cantidad_disponible,
            stock_minimo=material.stock_minimo,
            unidad_medida=material.unidad_medida,
            tipo_material=material.tipo_material,
        )
        for activo, material in rows
    ]


# ═══════════════════════════════════════════════════════════
# ENDPOINTS DE HERRAMIENTAS
# ═══════════════════════════════════════════════════════════

# ─── GET /activos/herramientas ─────────────────────────────────────────────
@router.get(
    "/herramientas",
    response_model=List[HerramientaResponse],
    summary="Listar todas las herramientas",
    status_code=status.HTTP_200_OK,
)
async def get_herramientas(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Lista todas las herramientas del inventario.
    Roles: cualquier empleado autenticado.
    """
    result = await db.execute(
        select(Activo, Herramienta)
        .join(Herramienta, Herramienta.id_activo == Activo.id_activo)
        .order_by(Activo.nombre_activo)
    )
    rows = result.all()

    return [
        HerramientaResponse(
            id_activo=activo.id_activo,
            nombre_activo=activo.nombre_activo,
            descripcion=activo.descripcion,
            tipo=activo.tipo,
            fecha_registro=activo.fecha_registro,
            tipo_herramienta=herramienta.tipo_herramienta,
            marca=herramienta.marca,
            modelo=herramienta.modelo,
            estado=herramienta.estado,
        )
        for activo, herramienta in rows
    ]


# ═══════════════════════════════════════════════════════════
# ENDPOINTS DE CARROS
# ═══════════════════════════════════════════════════════════

# ─── GET /activos/carros ──────────────────────────────────────────────────
@router.get(
    "/carros",
    response_model=List[CarroResponse],
    summary="Listar todos los vehiculos",
    status_code=status.HTTP_200_OK,
)
async def get_carros(
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Lista todos los vehiculos del inventario con su tecnico asignado (si aplica).
    Roles: cualquier empleado autenticado.
    """
    result = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .order_by(Activo.nombre_activo)
    )
    rows = result.all()

    # Para cada carro, obtener tecnico asignado en una sola consulta
    ids_carros = [carro.id_activo for _, carro in rows]

    asignaciones: dict[int, EmpleadoCarro] = {}
    if ids_carros:
        result_asig = await db.execute(
            select(EmpleadoCarro)
            .options(selectinload(EmpleadoCarro.empleado))
            .where(EmpleadoCarro.id_carro.in_(ids_carros))
        )
        for asig in result_asig.scalars().all():
            asignaciones[asig.id_carro] = asig

    respuesta = []
    for activo, carro in rows:
        asig = asignaciones.get(carro.id_activo)
        respuesta.append(
            CarroResponse(
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
                id_empleado_asignado=asig.id_empleado if asig else None,
                nombre_empleado_asignado=(
                    f"{asig.empleado.nombre} {asig.empleado.apellido}"
                    if asig and asig.empleado
                    else None
                ),
            )
        )

    return respuesta


# ─── GET /activos/carros/{id} ─────────────────────────────────────────────
@router.get(
    "/carros/{id}",
    response_model=CarroResponse,
    summary="Obtener detalle de un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def get_carro_by_id(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Devuelve el detalle de un vehiculo por su id_activo.
    Roles: cualquier empleado autenticado.
    """
    result = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .where(Activo.id_activo == id)
    )
    row = result.one_or_none()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ningun vehiculo con id={id}.",
        )

    activo, carro = row

    # Tecnico asignado
    result_asig = await db.execute(
        select(EmpleadoCarro)
        .options(selectinload(EmpleadoCarro.empleado))
        .where(EmpleadoCarro.id_carro == id)
    )
    asig = result_asig.scalar_one_or_none()

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
        id_empleado_asignado=asig.id_empleado if asig else None,
        nombre_empleado_asignado=(
            f"{asig.empleado.nombre} {asig.empleado.apellido}"
            if asig and asig.empleado
            else None
        ),
    )


# ═══════════════════════════════════════════════════════════
# T3 — HERRAMIENTAS DE UN CARRO
# ═══════════════════════════════════════════════════════════

# ─── GET /activos/carros/{id}/herramientas ───────────────────────────
@router.get(
    "/carros/{id}/herramientas",
    response_model=List[HerramientaEnCarroResponse],
    summary="Listar herramientas asignadas a un vehiculo",
    status_code=status.HTTP_200_OK,
)
async def get_herramientas_de_carro(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Lista todas las herramientas actualmente asignadas al vehiculo indicado.
    Incluye datos de la tabla CarroHerramienta (fecha_asignacion, estado_entrega, comentario).
    Roles: cualquier empleado autenticado.
    """
    # Verificar que el carro existe
    result_carro = await db.execute(
        select(Carro).where(Carro.id_activo == id)
    )
    carro = result_carro.scalar_one_or_none()

    if not carro:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ningun vehiculo con id={id}.",
        )

    # Join CarroHerramienta → Herramienta → Activo
    result = await db.execute(
        select(CarroHerramienta, Herramienta, Activo)
        .join(Herramienta, Herramienta.id_activo == CarroHerramienta.id_herramienta)
        .join(Activo, Activo.id_activo == Herramienta.id_activo)
        .where(CarroHerramienta.id_carro == id)
        .order_by(Activo.nombre_activo)
    )
    rows = result.all()

    return [
        HerramientaEnCarroResponse(
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
        for relacion, herramienta, activo in rows
    ]


# ─── POST /activos/carros/{id}/herramientas ─────────────────────────
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
    # 1. Verificar carro
    result_carro = await db.execute(
        select(Carro).where(Carro.id_activo == id)
    )
    carro = result_carro.scalar_one_or_none()
    if not carro:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ningun vehiculo con id={id}.",
        )

    # 2. Verificar herramienta existe y esta disponible
    result_herr = await db.execute(
        select(Herramienta, Activo)
        .join(Activo, Activo.id_activo == Herramienta.id_activo)
        .where(Herramienta.id_activo == body.id_herramienta)
    )
    row_herr = result_herr.one_or_none()

    if not row_herr:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ninguna herramienta con id={body.id_herramienta}.",
        )

    herramienta, activo = row_herr

    if herramienta.estado != "disponible":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La herramienta '{activo.nombre_activo}' no esta disponible "
                f"(estado actual: '{herramienta.estado}'). "
                "Solo se pueden asignar herramientas en estado 'disponible'."
            ),
        )

    # 3. Verificar que no este ya asignada a este carro
    result_existe = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_carro == id,
            CarroHerramienta.id_herramienta == body.id_herramienta,
        )
    )
    if result_existe.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La herramienta '{activo.nombre_activo}' ya esta asignada a este vehiculo."
            ),
        )

    # 4. Crear la relacion en CarroHerramienta
    nueva_asignacion = CarroHerramienta(
        id_carro=id,
        id_herramienta=body.id_herramienta,
        estado_entrega="Buenas condiciones",
    )
    db.add(nueva_asignacion)

    # 5. Marcar herramienta como en uso
    herramienta.estado = "en_uso"

    await db.flush()

    return HerramientaEnCarroResponse(
        id_activo=activo.id_activo,
        nombre_activo=activo.nombre_activo,
        descripcion=activo.descripcion,
        tipo_herramienta=herramienta.tipo_herramienta,
        marca=herramienta.marca,
        modelo=herramienta.modelo,
        estado=herramienta.estado,
        fecha_asignacion=nueva_asignacion.fecha_asignacion,
        estado_entrega=nueva_asignacion.estado_entrega,
        comentario=nueva_asignacion.comentario,
    )


# ─── DELETE /activos/carros/{id}/herramientas/{id_h} ────────────────
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
    # Buscar la relacion
    result = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_carro == id,
            CarroHerramienta.id_herramienta == id_h,
        )
    )
    relacion = result.scalar_one_or_none()

    if not relacion:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"La herramienta id={id_h} no esta asignada al vehiculo id={id}."
            ),
        )

    # Liberar la herramienta (vuelve a disponible)
    result_herr = await db.execute(
        select(Herramienta).where(Herramienta.id_activo == id_h)
    )
    herramienta = result_herr.scalar_one_or_none()
    if herramienta:
        herramienta.estado = "disponible"

    # Eliminar la relacion
    await db.delete(relacion)

    return {
        "detail": f"Herramienta id={id_h} liberada del vehiculo id={id} correctamente.",
        "id_carro": id,
        "id_herramienta": id_h,
    }


# ═══════════════════════════════════════════════════════════
# T4 — ASIGNACION DE TECNICO A CARRO
# ═══════════════════════════════════════════════════════════

# ─── POST /activos/carros/{id}/asignar ──────────────────────────────
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

    Si el vehiculo ya tiene tecnico asignado, se reemplaza la asignacion anterior
    (el tecnico anterior queda liberado automaticamente).

    Roles: admin, supervisor.
    """
    # 1. Verificar vehiculo
    result_carro = await db.execute(
        select(Activo, Carro)
        .join(Carro, Carro.id_activo == Activo.id_activo)
        .where(Activo.id_activo == id)
    )
    row_carro = result_carro.one_or_none()

    if not row_carro:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ningun vehiculo con id={id}.",
        )

    activo_carro, carro = row_carro

    if carro.estado_vehiculo != "disponible":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El vehiculo '{activo_carro.nombre_activo}' (placa: {carro.placa}) "
                f"no esta disponible para asignacion "
                f"(estado actual: '{carro.estado_vehiculo}'). "
                "Solo se pueden asignar vehiculos en estado 'disponible'."
            ),
        )

    # 2. Verificar tecnico
    result_emp = await db.execute(
        select(Empleado).where(Empleado.id_empleado == body.id_empleado)
    )
    empleado = result_emp.scalar_one_or_none()

    if not empleado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ningun empleado con id={body.id_empleado}.",
        )

    if empleado.estado != "activo":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El empleado '{empleado.nombre} {empleado.apellido}' "
                f"no esta activo (estado: '{empleado.estado}'). "
                "Solo se pueden asignar empleados activos."
            ),
        )

    # 3. Regla: 1 tecnico = 1 carro
    # Verificar si el tecnico ya tiene otro carro asignado
    result_tecnico_carro = await db.execute(
        select(EmpleadoCarro).where(
            EmpleadoCarro.id_empleado == body.id_empleado
        )
    )
    asig_existente_tecnico = result_tecnico_carro.scalar_one_or_none()

    if asig_existente_tecnico:
        # Si ya esta asignado al mismo carro, no hay nada que hacer
        if asig_existente_tecnico.id_carro == id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"El tecnico '{empleado.nombre} {empleado.apellido}' "
                    "ya esta asignado a este vehiculo."
                ),
            )
        # Si esta asignado a otro carro, es conflicto
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El tecnico '{empleado.nombre} {empleado.apellido}' "
                f"ya tiene asignado el vehiculo id={asig_existente_tecnico.id_carro}. "
                "Un tecnico solo puede tener un vehiculo a la vez. "
                "Libera el vehiculo actual antes de reasignar."
            ),
        )

    # 4. Verificar si el carro ya tiene tecnico asignado
    # Si lo tiene, liberar la asignacion anterior
    result_carro_tecnico = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_carro == id)
    )
    asig_anterior = result_carro_tecnico.scalar_one_or_none()

    if asig_anterior:
        # Eliminar asignacion anterior (reemplazo)
        await db.delete(asig_anterior)
        await db.flush()

    # 5. Crear nueva asignacion
    nueva_asignacion = EmpleadoCarro(
        id_empleado=body.id_empleado,
        id_carro=id,
    )
    db.add(nueva_asignacion)

    # 6. Actualizar estado del vehiculo a 'en_uso'
    carro.estado_vehiculo = "en_uso"

    await db.flush()

    return {
        "detail": "Tecnico asignado al vehiculo correctamente.",
        "id_carro": id,
        "placa": carro.placa,
        "id_empleado": body.id_empleado,
        "nombre_empleado": f"{empleado.nombre} {empleado.apellido}",
    }


# ─── DELETE /activos/carros/{id}/asignacion ─────────────────────────
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
    # Verificar vehiculo
    result_carro = await db.execute(
        select(Carro).where(Carro.id_activo == id)
    )
    carro = result_carro.scalar_one_or_none()

    if not carro:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontro ningun vehiculo con id={id}.",
        )

    # Buscar asignacion
    result_asig = await db.execute(
        select(EmpleadoCarro)
        .options(selectinload(EmpleadoCarro.empleado))
        .where(EmpleadoCarro.id_carro == id)
    )
    asignacion = result_asig.scalar_one_or_none()

    if not asignacion:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El vehiculo id={id} no tiene ningun tecnico asignado.",
        )

    nombre_empleado = (
        f"{asignacion.empleado.nombre} {asignacion.empleado.apellido}"
        if asignacion.empleado
        else f"id={asignacion.id_empleado}"
    )

    # Eliminar asignacion
    await db.delete(asignacion)

    # Vehiculo vuelve a disponible
    carro.estado_vehiculo = "disponible"

    return {
        "detail": f"Tecnico '{nombre_empleado}' liberado del vehiculo id={id} correctamente.",
        "id_carro": id,
        "id_empleado": asignacion.id_empleado,
    }

# ══════════════════════════════════════════════════════════════════════
# T1.2 — CRUD COMPLETO DE ACTIVOS (POST / PATCH / DELETE)
# ══════════════════════════════════════════════════════════════════════

from datetime import date as date_type
from app.schemas.activo import (
    ActivoDetalleResponse,
    ActivoUpdateRequest,
    CarroCreate,
    HerramientaCreate,
    MaterialCreate,
)
from typing import Union
from fastapi import Body


def _build_detalle(activo: Activo, subtipo) -> ActivoDetalleResponse:
    """Helper que construye ActivoDetalleResponse a partir del ORM."""
    base = dict(
        id_activo=activo.id_activo,
        nombre_activo=activo.nombre_activo,
        descripcion=activo.descripcion,
        tipo=activo.tipo,
        fecha_registro=activo.fecha_registro,
        foto_url=activo.foto_url,
    )
    if isinstance(subtipo, Carro):
        # buscar asignacion desde el objeto ORM si está cargado
        base.update(
            placa=subtipo.placa,
            marca=subtipo.marca,
            modelo=subtipo.modelo,
            capacidad=subtipo.capacidad,
            estado_vehiculo=subtipo.estado_vehiculo,
        )
    elif isinstance(subtipo, Herramienta):
        base.update(
            tipo_herramienta=subtipo.tipo_herramienta,
            marca=subtipo.marca,
            modelo=subtipo.modelo,
            estado=subtipo.estado,
        )
    elif isinstance(subtipo, Material):
        base.update(
            cantidad_disponible=subtipo.cantidad_disponible,
            stock_minimo=subtipo.stock_minimo,
            unidad_medida=subtipo.unidad_medida,
            tipo_material=subtipo.tipo_material,
        )
    return ActivoDetalleResponse(**base)


# ─── POST /activos ────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=ActivoDetalleResponse,
    summary="Crear un nuevo activo (Carro, Herramienta o Material)",
    status_code=status.HTTP_201_CREATED,
)
async def crear_activo(
    body: Union[CarroCreate, HerramientaCreate, MaterialCreate] = Body(..., discriminator="tipo"),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _current_user: Annotated[Empleado, Depends(require_supervisor)] = None,
):
    """
    Crea un nuevo activo según su tipo.

    - tipo='carro'       → crea Activo + Carro (requiere placa)
    - tipo='herramienta' → crea Activo + Herramienta
    - tipo='material'    → crea Activo + Material

    Roles: admin, supervisor.
    """
    # 1. Crear el Activo base
    nuevo_activo = Activo(
        nombre_activo=body.nombre_activo,
        descripcion=body.descripcion,
        tipo=body.tipo,
        fecha_registro=date_type.today(),
    )
    db.add(nuevo_activo)
    await db.flush()  # obtener id_activo

    subtipo = None

    if isinstance(body, CarroCreate):
        # Verificar placa única
        result_placa = await db.execute(
            select(Carro).where(Carro.placa == body.placa)
        )
        if result_placa.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un vehículo con la placa '{body.placa}'.",
            )
        subtipo = Carro(
            id_activo=nuevo_activo.id_activo,
            placa=body.placa,
            marca=body.marca,
            modelo=body.modelo,
            capacidad=body.capacidad,
            estado_vehiculo=body.estado_vehiculo,
        )
        db.add(subtipo)

    elif isinstance(body, HerramientaCreate):
        subtipo = Herramienta(
            id_activo=nuevo_activo.id_activo,
            tipo_herramienta=body.tipo_herramienta,
            marca=body.marca,
            modelo=body.modelo,
            estado=body.estado,
        )
        db.add(subtipo)

    elif isinstance(body, MaterialCreate):
        subtipo = Material(
            id_activo=nuevo_activo.id_activo,
            cantidad_disponible=body.cantidad_disponible,
            stock_minimo=body.stock_minimo,
            unidad_medida=body.unidad_medida,
            tipo_material=body.tipo_material,
        )
        db.add(subtipo)

    await db.flush()
    return _build_detalle(nuevo_activo, subtipo)


# ─── GET /activos/{id} ───────────────────────────────────────────────────
@router.get(
    "/{id}",
    response_model=ActivoDetalleResponse,
    summary="Obtener un activo por ID",
    status_code=status.HTTP_200_OK,
)
async def get_activo_by_id(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """Devuelve el detalle de cualquier activo independientemente de su tipo."""
    activo_result = await db.execute(select(Activo).where(Activo.id_activo == id))
    activo = activo_result.scalar_one_or_none()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo id={id} no encontrado.")

    subtipo = None
    if activo.tipo == "carro":
        r = await db.execute(select(Carro).where(Carro.id_activo == id))
        subtipo = r.scalar_one_or_none()
    elif activo.tipo == "herramienta":
        r = await db.execute(select(Herramienta).where(Herramienta.id_activo == id))
        subtipo = r.scalar_one_or_none()
    elif activo.tipo == "material":
        r = await db.execute(select(Material).where(Material.id_activo == id))
        subtipo = r.scalar_one_or_none()

    return _build_detalle(activo, subtipo)


# ─── PATCH /activos/{id} ─────────────────────────────────────────────────
@router.patch(
    "/{id}",
    response_model=ActivoDetalleResponse,
    summary="Editar un activo",
    status_code=status.HTTP_200_OK,
)
async def actualizar_activo(
    id: int,
    body: ActivoUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Edición parcial de un activo. Solo se actualizan los campos enviados.
    Roles: admin, supervisor.
    """
    activo_result = await db.execute(select(Activo).where(Activo.id_activo == id))
    activo = activo_result.scalar_one_or_none()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo id={id} no encontrado.")

    # Actualizar campos base
    if body.nombre_activo is not None:
        activo.nombre_activo = body.nombre_activo
    if body.descripcion is not None:
        activo.descripcion = body.descripcion

    subtipo = None

    if activo.tipo == "carro":
        r = await db.execute(select(Carro).where(Carro.id_activo == id))
        subtipo = r.scalar_one_or_none()
        if subtipo:
            if body.placa is not None:
                # Verificar unicidad de la placa
                r2 = await db.execute(
                    select(Carro).where(Carro.placa == body.placa, Carro.id_activo != id)
                )
                if r2.scalar_one_or_none():
                    raise HTTPException(
                        status_code=409,
                        detail=f"Ya existe otro vehículo con la placa '{body.placa}'.",
                    )
                subtipo.placa = body.placa
            if body.marca           is not None: subtipo.marca           = body.marca
            if body.modelo          is not None: subtipo.modelo          = body.modelo
            if body.capacidad       is not None: subtipo.capacidad       = body.capacidad
            if body.estado_vehiculo is not None: subtipo.estado_vehiculo = body.estado_vehiculo

    elif activo.tipo == "herramienta":
        r = await db.execute(select(Herramienta).where(Herramienta.id_activo == id))
        subtipo = r.scalar_one_or_none()
        if subtipo:
            if body.tipo_herramienta is not None: subtipo.tipo_herramienta = body.tipo_herramienta
            if body.marca            is not None: subtipo.marca            = body.marca
            if body.modelo           is not None: subtipo.modelo           = body.modelo
            if body.estado           is not None: subtipo.estado           = body.estado

    elif activo.tipo == "material":
        r = await db.execute(select(Material).where(Material.id_activo == id))
        subtipo = r.scalar_one_or_none()
        if subtipo:
            if body.cantidad_disponible is not None: subtipo.cantidad_disponible = body.cantidad_disponible
            if body.stock_minimo        is not None: subtipo.stock_minimo        = body.stock_minimo
            if body.unidad_medida       is not None: subtipo.unidad_medida       = body.unidad_medida
            if body.tipo_material       is not None: subtipo.tipo_material       = body.tipo_material

    await db.flush()
    return _build_detalle(activo, subtipo)


# ─── DELETE /activos/{id} ────────────────────────────────────────────────
@router.delete(
    "/{id}",
    summary="Eliminar un activo",
    status_code=status.HTTP_200_OK,
)
async def eliminar_activo(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Elimina un activo y su subtipo asociado (CASCADE en BD).

    Reglas:
    - No se puede eliminar un vehículo que tiene técnico asignado.
    - No se puede eliminar una herramienta que está asignada a un vehículo.

    Roles: admin, supervisor.
    """
    activo_result = await db.execute(select(Activo).where(Activo.id_activo == id))
    activo = activo_result.scalar_one_or_none()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo id={id} no encontrado.")

    # Validación: carro con técnico asignado
    if activo.tipo == "carro":
        r = await db.execute(select(EmpleadoCarro).where(EmpleadoCarro.id_carro == id))
        if r.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="No se puede eliminar un vehículo que tiene un técnico asignado. Libera la asignación primero.",
            )

    # Validación: herramienta asignada a un carro
    if activo.tipo == "herramienta":
        r = await db.execute(
            select(CarroHerramienta).where(CarroHerramienta.id_herramienta == id)
        )
        if r.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="No se puede eliminar una herramienta que está asignada a un vehículo. Libérala primero.",
            )

    await db.delete(activo)
    return {"detail": f"Activo id={id} eliminado correctamente.", "id_activo": id}


# ══════════════════════════════════════════════════════════════════════
# T1.4 — UPLOAD DE IMAGEN  POST /activos/{id}/imagen
# ══════════════════════════════════════════════════════════════════════

import os, uuid, shutil
from fastapi import UploadFile, File

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "static", "activos")
os.makedirs(STATIC_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FILE_SIZE_MB = 5


@router.post(
    "/{id}/imagen",
    summary="Subir o reemplazar la imagen de un activo",
    status_code=status.HTTP_200_OK,
)
async def upload_imagen_activo(
    id: int,
    file: UploadFile = File(...),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _current_user: Annotated[Empleado, Depends(require_supervisor)] = None,
):
    """
    Sube una imagen para el activo indicado.

    - Extensiones permitidas: jpg, jpeg, png, webp, gif
    - Tamaño máximo: 5 MB
    - La imagen anterior se elimina si existía

    La URL pública queda guardada en `activo.foto_url` y se devuelve en la respuesta.
    Roles: admin, supervisor.
    """
    # Verificar activo
    activo_result = await db.execute(select(Activo).where(Activo.id_activo == id))
    activo = activo_result.scalar_one_or_none()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo id={id} no encontrado.")

    # Validar extensión
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Extensión '{ext}' no permitida. Usa: {', '.join(ALLOWED_EXTENSIONS)}.",
        )

    # Leer contenido y validar tamaño
    contenido = await file.read()
    if len(contenido) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"El archivo supera el límite de {MAX_FILE_SIZE_MB} MB.",
        )

    # Eliminar imagen anterior si existe
    if activo.foto_url:
        old_path = os.path.join(
            os.path.dirname(__file__), "..", "..", activo.foto_url.lstrip("/")
        )
        if os.path.isfile(old_path):
            os.remove(old_path)

    # Guardar la nueva imagen
    nombre_archivo = f"activo_{id}_{uuid.uuid4().hex[:8]}{ext}"
    ruta_disco = os.path.join(STATIC_DIR, nombre_archivo)

    with open(ruta_disco, "wb") as f_out:
        f_out.write(contenido)

    # Actualizar la URL en la BD (relativa al servidor)
    activo.foto_url = f"/static/activos/{nombre_archivo}"
    await db.flush()

    return {"detail": "Imagen subida correctamente.", "foto_url": activo.foto_url}
