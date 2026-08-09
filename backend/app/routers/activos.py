"""Activos: CRUD generico y subida de imagen (rutas /activos, /activos/{id})."""
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_empleado, require_supervisor
from app.core.reglas import ESTADO_DISPONIBLE
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


async def _exigir_herramienta_libre(
    db: AsyncSession, id_herramienta: int, nombre: str
) -> None:
    """Lanza 400 si la herramienta sigue asignada a algún vehículo."""
    result = await db.execute(
        select(CarroHerramienta).where(
            CarroHerramienta.id_herramienta == id_herramienta
        )
    )
    asignacion = result.scalars().first()
    if asignacion is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La herramienta '{nombre}' está cargada en el vehículo "
                f"id={asignacion.id_carro}. Libérala desde el vehículo antes de "
                "marcarla como disponible; si no, podría acabar asignada a dos "
                "vehículos a la vez."
            ),
        )


async def _exigir_vehiculo_libre(
    db: AsyncSession, id_carro: int, nombre: str
) -> None:
    """Lanza 400 si el vehículo todavía tiene un técnico asignado."""
    result = await db.execute(
        select(EmpleadoCarro).where(EmpleadoCarro.id_carro == id_carro)
    )
    asignacion = result.scalars().first()
    if asignacion is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El vehículo '{nombre}' tiene asignado al empleado "
                f"id={asignacion.id_empleado}. Libera la asignación antes de "
                "marcarlo como disponible."
            ),
        )


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
    # 1. Validaciones que no dependen de tener el activo creado.
    #
    #    La comprobación de placa se hace ANTES de insertar. Antes iba después
    #    del flush: en el camino de error el rollback dejaba la base limpia,
    #    pero la secuencia de id_activo ya se había consumido y el 409 llegaba
    #    tras haber escrito de más.
    if isinstance(body, CarroCreate):
        result_placa = await db.execute(
            select(Carro).where(Carro.placa == body.placa)
        )
        if result_placa.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un vehículo con la placa '{body.placa}'.",
            )

    # 2. Crear el Activo base
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

    # La comprobación de placa de arriba no basta si dos peticiones llegan a la
    # vez: las dos la pasan y la segunda choca contra el UNIQUE de la columna.
    # Sin capturarlo, ese choque sale como 500; capturado, es el mismo 409 que
    # habría devuelto la comprobación previa.
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe un vehículo con la placa '{getattr(body, 'placa', '')}'."
                if isinstance(body, CarroCreate)
                else "El activo entra en conflicto con uno ya existente."
            ),
        )

    return _build_detalle(nuevo_activo, subtipo)


# ─── GET /activos/{id} ───────────────────────────────────────────────────
@router.get(
    "/{id:int}",
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
    "/{id:int}",
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
            if body.estado_vehiculo is not None:
                # Mismo razonamiento que con las herramientas: devolver a
                # 'disponible' un vehículo que aún tiene técnico permitía que
                # la siguiente asignación borrara esa asignación en silencio.
                if body.estado_vehiculo == ESTADO_DISPONIBLE:
                    await _exigir_vehiculo_libre(db, id, activo.nombre_activo)
                subtipo.estado_vehiculo = body.estado_vehiculo

    elif activo.tipo == "herramienta":
        r = await db.execute(select(Herramienta).where(Herramienta.id_activo == id))
        subtipo = r.scalar_one_or_none()
        if subtipo:
            if body.tipo_herramienta is not None: subtipo.tipo_herramienta = body.tipo_herramienta
            if body.marca            is not None: subtipo.marca            = body.marca
            if body.modelo           is not None: subtipo.modelo           = body.modelo
            if body.estado is not None:
                # Marcar como 'disponible' una herramienta que sigue cargada en
                # un vehículo era el atajo para asignarla a un segundo: el
                # endpoint de asignación solo mira este campo. Con la
                # asignación viva, el estado no se puede tocar a mano.
                if body.estado == ESTADO_DISPONIBLE:
                    await _exigir_herramienta_libre(db, id, activo.nombre_activo)
                subtipo.estado = body.estado

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
    "/{id:int}",
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

from fastapi import UploadFile, File

# Validación y escritura en disco compartidas con el upload de fotos de
# evidencia (app/services/uploads.py), para que ambos apliquen exactamente
# las mismas reglas de extensión y tamaño.
from app.services.uploads import (
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_MB,
    guardar_imagen,
)


@router.post(
    "/{id:int}/imagen",
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

    activo.foto_url = await guardar_imagen(
        file,
        subcarpeta="activos",
        prefijo=f"activo_{id}",
        url_anterior=activo.foto_url,
    )
    await db.flush()

    return {"detail": "Imagen subida correctamente.", "foto_url": activo.foto_url}
