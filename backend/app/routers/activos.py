"""Activos: CRUD generico y subida de imagen (rutas /activos, /activos/{id})."""
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_empleado, require_supervisor
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
