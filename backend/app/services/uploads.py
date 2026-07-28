# backend/app/services/uploads.py
"""
Guardado y borrado de imágenes subidas — Teleprogreso S.A.
-----------------------------------------------------------------------------
Centraliza la validación (extensión + tamaño) y la escritura en disco que antes
vivía duplicada en el endpoint de imagen de activos, para que el upload de
fotos de evidencia use exactamente las mismas reglas.

Los archivos se guardan bajo `backend/static/<subcarpeta>/` y se sirven desde
la ruta pública `/static/<subcarpeta>/<archivo>` que monta main.py.

Nota de despliegue: el disco de Railway es efímero, así que las imágenes se
pierden en cada redeploy. Para producción real habría que mover esto a un
almacenamiento externo (S3, Cloudinary); la firma de `guardar_imagen` no
cambiaría, solo su implementación.
-----------------------------------------------------------------------------
"""

import os
import uuid

from fastapi import HTTPException, UploadFile, status

# Extensiones y tamaño máximo permitidos para cualquier imagen del sistema.
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FILE_SIZE_MB = 5

# backend/static — mismo directorio que monta main.py en /static
STATIC_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "static")
)


def _ruta_en_disco(url_publica: str) -> str:
    """Traduce '/static/x/y.jpg' a la ruta absoluta del archivo."""
    relativa = url_publica.replace("/static/", "", 1).lstrip("/")
    return os.path.join(STATIC_ROOT, relativa)


def eliminar_imagen(url_publica: str | None) -> None:
    """Borra del disco una imagen previamente guardada. Silencioso si no existe."""
    if not url_publica or not url_publica.startswith("/static/"):
        return
    ruta = _ruta_en_disco(url_publica)
    if os.path.isfile(ruta):
        try:
            os.remove(ruta)
        except OSError:
            # Un archivo que no se puede borrar no debe romper la petición:
            # el registro en BD ya apunta a la imagen nueva.
            pass


async def guardar_imagen(
    file: UploadFile,
    *,
    subcarpeta: str,
    prefijo: str,
    url_anterior: str | None = None,
) -> str:
    """
    Valida y guarda una imagen subida, devolviendo su URL pública.

    Args:
        file:         archivo recibido en el multipart/form-data.
        subcarpeta:   carpeta bajo static/ (p.e. "incidencias").
        prefijo:      prefijo del nombre de archivo (p.e. "incidencia_12").
        url_anterior: si se pasa, esa imagen se elimina tras guardar la nueva.

    Raises:
        HTTPException 400 si la extensión no está permitida, si el archivo
        supera el límite de tamaño o si viene vacío.
    """
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Extensión '{extension or 'desconocida'}' no permitida. "
                f"Usa: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            ),
        )

    contenido = await file.read()

    if not contenido:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo está vacío.",
        )

    if len(contenido) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El archivo supera el límite de {MAX_FILE_SIZE_MB} MB.",
        )

    destino = os.path.join(STATIC_ROOT, subcarpeta)
    os.makedirs(destino, exist_ok=True)

    nombre_archivo = f"{prefijo}_{uuid.uuid4().hex[:8]}{extension}"
    with open(os.path.join(destino, nombre_archivo), "wb") as salida:
        salida.write(contenido)

    # La anterior se borra solo después de escribir la nueva: si algo falla
    # a mitad, el registro sigue teniendo una imagen válida.
    eliminar_imagen(url_anterior)

    return f"/static/{subcarpeta}/{nombre_archivo}"
