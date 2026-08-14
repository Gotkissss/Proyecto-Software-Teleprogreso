"""Carros: listado, detalle, herramientas asignadas y asignacion de tecnicos (rutas /activos/carros)."""
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    get_current_empleado,
    require_admin_supervisor_gerente,
    require_supervisor,
)
from app.core.reglas import (
    ESTADO_DISPONIBLE,
    ESTADO_EMPLEADO_ACTIVO,
    ESTADO_EN_USO,
)
from app.db.session import get_db
from app.services.inventario import exigir_acceso_a_carro
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

router = APIRouter(prefix="/activos", tags=["Carros"])


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
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Lista todos los vehiculos del inventario con su tecnico asignado (si aplica).

    Roles: admin, supervisor y gerente. Un tecnico ve su propio vehiculo en
    GET /empleados/mi-equipo, no la flota entera.
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
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Devuelve el detalle de un vehiculo por su id_activo.
    Roles: admin, supervisor y gerente.
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
    asig = result_asig.scalars().first()

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
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Lista todas las herramientas actualmente asignadas al vehiculo indicado.
    Incluye datos de la tabla CarroHerramienta (fecha_asignacion, estado_entrega, comentario).

    Roles: admin, supervisor y gerente sobre cualquier vehiculo. Un tecnico
    solo sobre el suyo: es la unica parte del inventario que le corresponde
    ver, porque son las herramientas que lleva encima.
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

    await exigir_acceso_a_carro(db, current_user, id)

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

    if herramienta.estado != ESTADO_DISPONIBLE:
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
    herramienta.estado = ESTADO_EN_USO

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

    # Eliminar la relacion
    await db.delete(relacion)
    await db.flush()

    # Liberar la herramienta solo si ya no queda en ningun otro vehiculo.
    #
    # Antes se ponia en 'disponible' sin mirar: si por lo que fuera la
    # herramienta figuraba en dos vehiculos, quitarla de uno la anunciaba como
    # libre mientras seguia cargada en el otro.
    result_otras = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_herramienta == id_h,
        )
    )
    sigue_asignada = result_otras.scalars().first() is not None

    result_herr = await db.execute(
        select(Herramienta).where(Herramienta.id_activo == id_h)
    )
    herramienta = result_herr.scalar_one_or_none()
    if herramienta and not sigue_asignada:
        herramienta.estado = ESTADO_DISPONIBLE

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

    Si el vehiculo ya tiene tecnico asignado se devuelve 400: hay que liberar
    la asignacion primero. Antes se reemplazaba en silencio, asi que reasignar
    un vehiculo dejaba a otro tecnico sin transporte sin ningun aviso.

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

    if carro.estado_vehiculo != ESTADO_DISPONIBLE:
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

    if empleado.estado != ESTADO_EMPLEADO_ACTIVO:
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
    asig_existente_tecnico = result_tecnico_carro.scalars().first()

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

    # 4. Verificar si el carro ya tiene tecnico asignado.
    #
    # Antes se borraba la asignacion anterior en silencio: quien reasignaba un
    # vehiculo dejaba a otro tecnico sin transporte sin enterarse. Ahora es un
    # error explicito, coherente con la regla "un vehiculo = un tecnico" y con
    # el paso 3, que ya rechaza el caso simetrico.
    result_carro_tecnico = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_carro == id)
    )
    asig_anterior = result_carro_tecnico.scalars().first()

    if asig_anterior:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El vehiculo '{activo_carro.nombre_activo}' ya tiene asignado "
                f"al empleado id={asig_anterior.id_empleado}. Libera esa "
                "asignacion antes de asignarlo a otro tecnico."
            ),
        )

    # 5. Crear nueva asignacion
    nueva_asignacion = EmpleadoCarro(
        id_empleado=body.id_empleado,
        id_carro=id,
    )
    db.add(nueva_asignacion)

    # 6. Actualizar estado del vehiculo a 'en_uso'
    carro.estado_vehiculo = ESTADO_EN_USO

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
    asignacion = result_asig.scalars().first()

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
    carro.estado_vehiculo = ESTADO_DISPONIBLE

    return {
        "detail": f"Tecnico '{nombre_empleado}' liberado del vehiculo id={id} correctamente.",
        "id_carro": id,
        "id_empleado": asignacion.id_empleado,
    }

