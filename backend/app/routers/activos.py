# backend/app/routers/activos.py
"""
Router de Activos / Inventario — Teleprogreso S.A.
---------------------------------------------------
Gestiona el ciclo de vida de los activos de la empresa, que se
clasifican en tres subtipos (ISA): carro, material y herramienta.

Historias implementadas:
  SCRUM-96  CRUD GET/POST/PATCH/DELETE /activos con creación tipada
  SCRUM-97  Endpoint de búsqueda y filtros (?tipo=...&estado=...&q=...)
  SCRUM-98  Upload de imágenes POST /activos/{id}/imagen

Control de acceso:
  - GET    /activos                → admin, supervisor, gerente
  - GET    /activos/{id}           → admin, supervisor, gerente
  - POST   /activos                → admin
  - PATCH  /activos/{id}           → admin
  - DELETE /activos/{id}           → admin
  - POST   /activos/{id}/imagen    → admin

Notas:
  - El subtipo (carro/material/herramienta) NO se puede cambiar en un PATCH;
    para eso se debe eliminar y crear de nuevo.
  - El filtro `estado` aplica a estado_vehiculo (carro) y estado (herramienta).
  - Las imágenes se guardan en /static/activos/<id_activo>.<ext> y se
    sirven a través del mount /static configurado en main.py.
"""

from pathlib import Path
from typing import Annotated, Optional
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin, require_admin_supervisor_gerente
from app.db.session import get_db
from app.models.activo import Activo, Carro, Herramienta, Material
from app.models.empleado import Empleado
from app.schemas.activo import (
    ActivoCreate,
    ActivoListResponse,
    ActivoResponse,
    ActivoUpdate,
    TipoActivo,
)

router = APIRouter(prefix="/activos", tags=["Activos"])

# ── Configuración de subida de imágenes ──────────────────────────────────
# Carpeta absoluta en disco donde se guardan las imágenes de activos.
# Coincide con el mount /static configurado en app/main.py.
STATIC_ROOT = Path(__file__).resolve().parent.parent.parent / "static"
ACTIVOS_IMG_DIR = STATIC_ROOT / "activos"
ACTIVOS_IMG_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ALLOWED_IMAGE_MIME = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


# ── Helpers ──────────────────────────────────────────────────────────────

async def _get_activo_completo(db: AsyncSession, id_activo: int) -> Activo | None:
    """Busca un activo con sus relaciones de subtipo cargadas."""
    result = await db.execute(
        select(Activo)
        .options(
            selectinload(Activo.carro),
            selectinload(Activo.material),
            selectinload(Activo.herramienta),
        )
        .where(Activo.id_activo == id_activo)
    )
    return result.scalar_one_or_none()


# ──────────────────────────────────────────────────────────────────────────
# GET /activos  — Listado con filtros (SCRUM-97)
# ──────────────────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=ActivoListResponse,
    summary="Listar activos con filtros opcionales",
    status_code=status.HTTP_200_OK,
)
async def listar_activos(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
    tipo: Optional[TipoActivo] = Query(
        None,
        description="Filtrar por tipo: carro | material | herramienta",
    ),
    estado: Optional[str] = Query(
        None,
        description=(
            "Filtrar por estado. Aplica a `estado_vehiculo` (carro) "
            "o `estado` (herramienta). Para material se ignora."
        ),
    ),
    q: Optional[str] = Query(
        None,
        description=(
            "Búsqueda de texto libre (case-insensitive) en nombre_activo "
            "y descripción."
        ),
    ),
):
    """
    Lista los activos aplicando los filtros opcionales recibidos.
    """
    query = (
        select(Activo)
        .options(
            selectinload(Activo.carro),
            selectinload(Activo.material),
            selectinload(Activo.herramienta),
        )
    )

    # Filtro por tipo
    if tipo is not None:
        tipo_str = tipo.value if isinstance(tipo, TipoActivo) else tipo
        query = query.where(Activo.tipo == tipo_str)

    # Filtro por estado (depende del subtipo)
    if estado is not None:
        estado_norm = estado.strip()
        if not estado_norm:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El parámetro 'estado' no puede estar vacío.",
            )

        # Si se filtra por estado SIN especificar tipo, buscamos en ambos
        # subtipos (carro o herramienta) mediante join + or_.
        if tipo is None:
            query = query.outerjoin(Carro).outerjoin(Herramienta).where(
                or_(
                    Carro.estado_vehiculo == estado_norm,
                    Herramienta.estado == estado_norm,
                )
            )
        elif tipo == TipoActivo.carro:
            query = query.join(Carro).where(Carro.estado_vehiculo == estado_norm)
        elif tipo == TipoActivo.herramienta:
            query = query.join(Herramienta).where(Herramienta.estado == estado_norm)
        else:
            # tipo == material → no tiene 'estado'
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El subtipo 'material' no soporta filtro por 'estado'.",
            )

    # Búsqueda libre (nombre o descripción)
    if q:
        termino = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Activo.nombre_activo).like(termino),
                func.lower(func.coalesce(Activo.descripcion, "")).like(termino),
            )
        )

    query = query.order_by(Activo.nombre_activo)

    result = await db.execute(query)
    activos = result.scalars().unique().all()

    return ActivoListResponse(total=len(activos), activos=activos)


# ──────────────────────────────────────────────────────────────────────────
# GET /activos/{id}  — Detalle
# ──────────────────────────────────────────────────────────────────────────
@router.get(
    "/{id_activo}",
    response_model=ActivoResponse,
    summary="Obtener un activo por id",
    status_code=status.HTTP_200_OK,
)
async def obtener_activo(
    id_activo: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[Empleado, Depends(require_admin_supervisor_gerente)],
):
    activo = await _get_activo_completo(db, id_activo)
    if activo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún activo con id={id_activo}.",
        )
    return activo


# ──────────────────────────────────────────────────────────────────────────
# POST /activos  — Creación tipada (SCRUM-96)
# ──────────────────────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=ActivoResponse,
    summary="Crear un nuevo activo (carro, material o herramienta)",
    status_code=status.HTTP_201_CREATED,
)
async def crear_activo(
    data: ActivoCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[Empleado, Depends(require_admin)],
):
    """
    Crea el `activo` base y su subtipo asociado en la misma transacción.
    Para tipo='carro' se valida unicidad de la placa antes de insertar.
    """
    tipo_str = data.tipo.value if isinstance(data.tipo, TipoActivo) else data.tipo

    # Validación de unicidad de placa para carro
    if tipo_str == TipoActivo.carro.value:
        result = await db.execute(
            select(Carro).where(Carro.placa == data.carro.placa)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un carro registrado con la placa '{data.carro.placa}'.",
            )

    nuevo = Activo(
        nombre_activo=data.nombre_activo,
        descripcion=data.descripcion,
        tipo=tipo_str,
    )
    db.add(nuevo)
    await db.flush()  # obtener id_activo

    # Insertar fila del subtipo correspondiente
    if tipo_str == TipoActivo.carro.value:
        sub = Carro(
            id_activo=nuevo.id_activo,
            placa=data.carro.placa,
            marca=data.carro.marca,
            modelo=data.carro.modelo,
            capacidad=data.carro.capacidad,
            estado_vehiculo=(
                data.carro.estado_vehiculo.value
                if hasattr(data.carro.estado_vehiculo, "value")
                else data.carro.estado_vehiculo
            ),
        )
    elif tipo_str == TipoActivo.material.value:
        sub = Material(
            id_activo=nuevo.id_activo,
            cantidad_disponible=data.material.cantidad_disponible,
            stock_minimo=data.material.stock_minimo,
            unidad_medida=data.material.unidad_medida,
            tipo_material=data.material.tipo_material,
        )
    else:  # herramienta
        sub = Herramienta(
            id_activo=nuevo.id_activo,
            tipo_herramienta=data.herramienta.tipo_herramienta,
            marca=data.herramienta.marca,
            modelo=data.herramienta.modelo,
            estado=(
                data.herramienta.estado.value
                if hasattr(data.herramienta.estado, "value")
                else data.herramienta.estado
            ),
        )

    db.add(sub)
    await db.flush()
    await db.refresh(nuevo)

    # Recargar con relaciones para la respuesta
    activo_full = await _get_activo_completo(db, nuevo.id_activo)
    return activo_full


# ──────────────────────────────────────────────────────────────────────────
# PATCH /activos/{id}  — Edición parcial
# ──────────────────────────────────────────────────────────────────────────
@router.patch(
    "/{id_activo}",
    response_model=ActivoResponse,
    summary="Editar un activo existente",
    status_code=status.HTTP_200_OK,
)
async def actualizar_activo(
    id_activo: int,
    data: ActivoUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[Empleado, Depends(require_admin)],
):
    activo = await _get_activo_completo(db, id_activo)
    if activo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún activo con id={id_activo}.",
        )

    # Campos del activo base
    if data.nombre_activo is not None:
        activo.nombre_activo = data.nombre_activo
    if data.descripcion is not None:
        activo.descripcion = data.descripcion
    if data.foto_url is not None:
        activo.foto_url = data.foto_url

    # Verificar que el subtipo recibido coincide con el del activo
    if data.carro is not None and activo.tipo != TipoActivo.carro.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Este activo no es de tipo 'carro' (es '{activo.tipo}').",
        )
    if data.material is not None and activo.tipo != TipoActivo.material.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Este activo no es de tipo 'material' (es '{activo.tipo}').",
        )
    if data.herramienta is not None and activo.tipo != TipoActivo.herramienta.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Este activo no es de tipo 'herramienta' (es '{activo.tipo}').",
        )

    # Actualizar el subtipo correspondiente
    if data.carro is not None and activo.carro is not None:
        campos = data.carro.model_dump(exclude_unset=True)
        # Si se cambia la placa, validar unicidad
        nueva_placa = campos.get("placa")
        if nueva_placa and nueva_placa != activo.carro.placa:
            result = await db.execute(
                select(Carro).where(Carro.placa == nueva_placa)
            )
            if result.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Ya existe un carro registrado con la placa '{nueva_placa}'.",
                )
        for campo, valor in campos.items():
            setattr(activo.carro, campo, valor)

    if data.material is not None and activo.material is not None:
        for campo, valor in data.material.model_dump(exclude_unset=True).items():
            setattr(activo.material, campo, valor)

    if data.herramienta is not None and activo.herramienta is not None:
        for campo, valor in data.herramienta.model_dump(exclude_unset=True).items():
            setattr(activo.herramienta, campo, valor)

    await db.flush()
    return activo


# ──────────────────────────────────────────────────────────────────────────
# DELETE /activos/{id}
# ──────────────────────────────────────────────────────────────────────────
@router.delete(
    "/{id_activo}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un activo",
)
async def eliminar_activo(
    id_activo: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[Empleado, Depends(require_admin)],
):
    activo = await _get_activo_completo(db, id_activo)
    if activo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún activo con id={id_activo}.",
        )

    # Intentar eliminar el archivo de imagen asociado (si existe)
    if activo.foto_url:
        try:
            # foto_url tiene formato "/static/activos/<archivo>"
            nombre_archivo = Path(activo.foto_url).name
            ruta = ACTIVOS_IMG_DIR / nombre_archivo
            if ruta.exists():
                ruta.unlink()
        except Exception:
            # No bloqueamos el delete de BD si falla el cleanup en disco
            pass

    await db.delete(activo)  # CASCADE elimina las filas de subtipo
    return None


# ──────────────────────────────────────────────────────────────────────────
# POST /activos/{id}/imagen  — Upload de imagen (SCRUM-98)
# ──────────────────────────────────────────────────────────────────────────
@router.post(
    "/{id_activo}/imagen",
    response_model=ActivoResponse,
    summary="Subir/reemplazar la imagen de un activo",
    status_code=status.HTTP_200_OK,
)
async def subir_imagen_activo(
    id_activo: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[Empleado, Depends(require_admin)],
    file: UploadFile = File(..., description="Imagen del activo (jpg, jpeg, png, webp, gif). Máx 5 MB."),
):
    """
    Guarda la imagen en disco bajo /static/activos/ y registra
    la ruta resultante en `activo.foto_url`. Si el activo ya tenía
    una imagen previa, se reemplaza (se borra el archivo viejo).
    """
    activo = await _get_activo_completo(db, id_activo)
    if activo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún activo con id={id_activo}.",
        )

    # Validar extensión y tipo MIME
    nombre_original = file.filename or ""
    ext = Path(nombre_original).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Extensión '{ext}' no permitida. "
                f"Usa una de: {', '.join(sorted(ALLOWED_IMAGE_EXTS))}."
            ),
        )
    if file.content_type and file.content_type not in ALLOWED_IMAGE_MIME:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo MIME '{file.content_type}' no es una imagen permitida.",
        )

    # Leer y validar tamaño
    contenido = await file.read()
    if len(contenido) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo recibido está vacío.",
        )
    if len(contenido) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El archivo excede el tamaño máximo de {MAX_IMAGE_BYTES // (1024 * 1024)} MB.",
        )

    # Si había una imagen anterior, intentar borrarla
    if activo.foto_url:
        try:
            nombre_anterior = Path(activo.foto_url).name
            ruta_anterior = ACTIVOS_IMG_DIR / nombre_anterior
            if ruta_anterior.exists():
                ruta_anterior.unlink()
        except Exception:
            pass

    # Guardar el nuevo archivo con un nombre único
    nombre_archivo = f"{id_activo}_{uuid4().hex}{ext}"
    ruta_destino = ACTIVOS_IMG_DIR / nombre_archivo
    ruta_destino.write_bytes(contenido)

    # Guardar la URL relativa servida por /static
    activo.foto_url = f"/static/activos/{nombre_archivo}"
    await db.flush()

    return activo
