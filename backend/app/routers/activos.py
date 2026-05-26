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


