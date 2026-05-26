# backend/app/routers/activos.py
"""
Router de Activos — Teleprogreso S.A.
--------------------------------------
Implementa los endpoints de la Historia 1, 2, 3 y 4 del sprint.
Todos los endpoints de este modulo fueron desarrollados por Gualim.

Endpoints implementados:

  T2.1  GET  /activos/materiales/bajo-stock
        Retorna materiales donde cantidad_disponible < stock_minimo.
        Usado por AlertasPage.jsx (seccion Stock critico).

  T3.1  GET  /activos/carros/{id}/herramientas
        Lista las herramientas asignadas a un carro especifico.
        Usado por CarroDetallePage.jsx.

  T3.2  POST /activos/carros/{id}/herramientas
        Asigna una herramienta disponible a un carro.
        Body: { id_herramienta: int }
        Usado por ModalAsignarHerramientas.jsx.

  T3.3  DELETE /activos/carros/{id}/herramientas/{id_h}
        Libera (desasigna) una herramienta del carro.
        Usado por CarroDetallePage.jsx (boton Liberar).

  T4.1  POST /activos/carros/{id}/asignar
        Asigna un tecnico a un vehiculo.
        Reglas: 1 tecnico = 1 carro, vehiculo disponible, tecnico activo.
        Body: { id_empleado: int }

  T4.2  DELETE /activos/carros/{id}/asignacion
        Libera al tecnico asignado al vehiculo.

Endpoints complementarios (para que el frontend pueda listar activos):
  GET  /activos/carros
  GET  /activos/carros/{id}
  GET  /activos/herramientas
  GET  /activos/materiales

Control de acceso:
  - Todos requieren JWT valido.
  - Las mutaciones (POST/DELETE) requieren rol admin o supervisor.
  - Las consultas (GET) permiten cualquier rol autenticado.
"""

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

# ─── T2.1  GET /activos/materiales/bajo-stock ──────────────────────────────
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

    Usado por AlertasPage.jsx en la seccion "Stock critico".
    El frontend muestra:
    - Badge rojo para materiales sin existencias (cantidad == 0)
    - Badge naranja para materiales con stock insuficiente

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
    Usado por ModalAsignarHerramientas.jsx para poblar el multi-select.
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

# ─── T3.1  GET /activos/carros/{id}/herramientas ───────────────────────────
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

    El shape de respuesta coincide exactamente con lo que espera
    CarroDetallePage.jsx para renderizar la lista de herramientas.

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


# ─── T3.2  POST /activos/carros/{id}/herramientas ─────────────────────────
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


# ─── T3.3  DELETE /activos/carros/{id}/herramientas/{id_h} ────────────────
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

# ─── T4.1  POST /activos/carros/{id}/asignar ──────────────────────────────
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

    Reglas de negocio (T4.3):
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


# ─── T4.2  DELETE /activos/carros/{id}/asignacion ─────────────────────────
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