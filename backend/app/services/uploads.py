# backend/app/services/uploads.py
"""
Guardado y borrado de imágenes subidas — Teleprogreso S.A.
-----------------------------------------------------------------------------
Centraliza la validación (extensión, tamaño y firma del archivo) y la escritura en disco que antes
vivía duplicada en el endpoint de imagen de activos, para que el upload de
fotos de evidencia use exactamente las mismas reglas.

Los archivos se guardan bajo `<STATIC_DIR>/<subcarpeta>/` con un nombre de
128 bits al azar, y en la base queda la ruta `/static/<subcarpeta>/<archivo>`.
Esa ruta ya no es pública: la API la convierte en un enlace firmado al
responder (core/archivos_firmados.py) y solo GET /archivos/... sirve el archivo.

Dónde cae `STATIC_DIR` es lo que decide si las fotos sobreviven a un deploy.
El disco del contenedor es efímero: en Railway cada deploy y cada reinicio
arrancan un contenedor nuevo y vacío, así que una foto escrita dentro de la
imagen desaparece y su URL pasa a devolver 404 — la evidencia queda como una
imagen rota y no hay forma de recuperarla. Apuntando `STATIC_DIR` al punto de
montaje de un volumen persistente los archivos se quedan donde están.
-----------------------------------------------------------------------------
"""

import os
import uuid

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

# Extensiones y tamaño máximo permitidos para cualquier imagen del sistema.
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FILE_SIZE_MB = 5
# Se lee el archivo por bloques para no cargar en memoria uno desmesurado.
TAMANO_BLOQUE = 64 * 1024

# Formato real de cada extensión admitida. La extensión la escribe quien sube
# el archivo; el formato se lee de sus primeros bytes (ver formato_real).
FORMATO_POR_EXTENSION = {
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".png": "png",
    ".webp": "webp",
    ".gif": "gif",
}
EXTENSION_POR_FORMATO = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}


def formato_real(contenido: bytes) -> str | None:
    """
    Formato de imagen según la firma de sus primeros bytes, o None si no es
    ninguno de los admitidos.

    La extensión sola no dice nada: un HTML o un ejecutable renombrado a
    .jpg pasaba la validación y quedaba publicado. Se comparan los
    "magic bytes" a mano (sin dependencias nuevas; `imghdr` ya no existe en
    Python 3.13).
    """
    if contenido.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if contenido.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if contenido[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if len(contenido) >= 12 and contenido[:4] == b"RIFF" and contenido[8:12] == b"WEBP":
        return "webp"
    return None


# Respaldo cuando no hay STATIC_DIR configurado: `backend/static`, junto al
# código. Es lo correcto en local y en docker-compose.
_STATIC_POR_DEFECTO = os.path.join(os.path.dirname(__file__), "..", "..", "static")


def resolver_static_root(configurado: str | None) -> str:
    """Carpeta de subidas: la configurada, o `backend/static` si no hay ninguna."""
    return os.path.abspath(configurado or _STATIC_POR_DEFECTO)


# Mismo directorio que lee routers/archivos.py. Se resuelve una sola vez aquí
# para que el que escribe los archivos y el que los sirve no puedan
# desincronizarse: apuntando a carpetas distintas, la subida responde 200 y la
# imagen sale rota, que es de los fallos más difíciles de ver.
STATIC_ROOT = resolver_static_root(settings.STATIC_DIR)


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
    Valida y guarda una imagen subida, devolviendo la ruta que se guarda en la base.

    Args:
        file:         archivo recibido en el multipart/form-data.
        subcarpeta:   carpeta bajo static/ (p.e. "incidencias").
        prefijo:      prefijo del nombre de archivo (p.e. "incidencia_12").
        url_anterior: si se pasa, esa imagen se elimina tras guardar la nueva.

    Raises:
        HTTPException 400 si la extensión no está permitida, si el archivo
        supera el límite de tamaño, si viene vacío o si su contenido no es una
        imagen JPEG, PNG, WEBP o GIF.

    Si el contenido es una imagen válida pero de otro formato que el que dice
    su extensión (un PNG llamado .jpg), se guarda con la extensión real.
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

    # Lectura por bloques: se corta en cuanto se pasa del tope (MAX + 1 bytes
    # como mucho), en vez de `await file.read()` del archivo completo y medir
    # después (HU-S10-04, tarea 4).
    maximo = MAX_FILE_SIZE_MB * 1024 * 1024
    bloques: list[bytes] = []
    leidos = 0
    while True:
        bloque = await file.read(min(TAMANO_BLOQUE, maximo + 1 - leidos))
        if not bloque:
            break
        leidos += len(bloque)
        if leidos > maximo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El archivo supera el límite de {MAX_FILE_SIZE_MB} MB.",
            )
        bloques.append(bloque)
    contenido = b"".join(bloques)

    if not contenido:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo está vacío.",
        )

    formato = formato_real(contenido)
    if formato is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El archivo no es una imagen válida. Sube una foto JPG, PNG, "
                "WEBP o GIF."
            ),
        )
    if FORMATO_POR_EXTENSION[extension] != formato:
        extension = EXTENSION_POR_FORMATO[formato]

    destino = os.path.join(STATIC_ROOT, subcarpeta)
    os.makedirs(destino, exist_ok=True)

    nombre_archivo = f"{prefijo}_{uuid.uuid4().hex}{extension}"
    with open(os.path.join(destino, nombre_archivo), "wb") as salida:
        salida.write(contenido)

    # La anterior se borra solo después de escribir la nueva: si algo falla
    # a mitad, el registro sigue teniendo una imagen válida.
    eliminar_imagen(url_anterior)

    return f"/static/{subcarpeta}/{nombre_archivo}"
