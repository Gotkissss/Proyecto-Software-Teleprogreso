"""Inventario: consulta de materiales y herramientas (rutas /activos/materiales, /activos/herramientas)."""
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import require_admin_supervisor_gerente, require_supervisor, require_tecnico
from app.db.session import get_db
from app.models.activo import Activo, Carro, CarroHerramienta, Herramienta, Material
from app.models.empleado import Empleado, EmpleadoCarro
from app.schemas.activo import (
    AsignarHerramientaRequest,
    AsignarTecnicoRequest,
    CarroResponse,
    HerramientaEnCarroResponse,
    HerramientaResponse,
    MaterialParaConsumoResponse,
    MaterialResponse,
)

router = APIRouter(prefix="/activos", tags=["Inventario"])


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
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Retorna todos los materiales donde cantidad_disponible < stock_minimo.
    Roles: admin, supervisor y gerente.

    Un tecnico NO lista el inventario: solo ve lo que lleva asignado, en
    GET /empleados/mi-equipo. Lo que necesite de mas lo pide al supervisor.
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
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Lista todos los materiales del inventario.
    Roles: admin, supervisor y gerente.

    Un tecnico NO lista el inventario: solo ve lo que lleva asignado, en
    GET /empleados/mi-equipo. Lo que necesite de mas lo pide al supervisor.
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


# ─── GET /activos/materiales/para-consumo ─────────────────────────────
@router.get(
    "/materiales/para-consumo",
    response_model=List[MaterialParaConsumoResponse],
    summary="Materiales que se pueden declarar al cerrar una tarea",
    status_code=status.HTTP_200_OK,
)
async def get_materiales_para_consumo(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_tecnico)],
):
    """
    HU-S10-07: la lista con la que el técnico elige qué materiales usó al
    finalizar una tarea. Solo los que tienen existencias, y solo su nombre y
    unidad: el técnico sigue sin ver el nivel del inventario.

    Roles: técnico, supervisor y admin (los que pueden finalizar tareas).
    """
    result = await db.execute(
        select(Activo.id_activo, Activo.nombre_activo, Material.unidad_medida)
        .join(Material, Material.id_activo == Activo.id_activo)
        .where(Material.cantidad_disponible > 0)
        .order_by(Activo.nombre_activo)
    )
    return [
        MaterialParaConsumoResponse(id_activo=i, nombre_activo=n, unidad_medida=u)
        for i, n, u in result.all()
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
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    _current_user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    """
    Lista todas las herramientas del inventario.
    Roles: admin, supervisor y gerente.

    Un tecnico NO lista el inventario: solo ve lo que lleva asignado, en
    GET /empleados/mi-equipo. Lo que necesite de mas lo pide al supervisor.
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


