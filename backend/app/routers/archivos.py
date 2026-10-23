# backend/app/routers/archivos.py
"""
Router de Archivos subidos — Teleprogreso S.A. (HU-S10-02)
-----------------------------------------------------------------------------
Sirve las fotos de evidencia y de activos a partir del enlace firmado que la
API entrega al serializar una respuesta (app/core/archivos_firmados.py).

Endpoints:
  GET /archivos/{carpeta}/{nombre}?exp=...&firma=... = Ver una foto subida

Control de acceso:
  - Sin JWT a propósito: un <img> y "abrir en pestaña nueva" no pueden mandar
    la cabecera Authorization.
  - Lo que da acceso es la firma más el vencimiento, y solo los emite un
    endpoint que ya aplicó su regla de rol.

Orden de validación: formato de la ruta (400), firma y vencimiento (403),
ruta dentro de STATIC_ROOT (400) y archivo con formato de imagen real (404).
-----------------------------------------------------------------------------
"""

import os
import re

from fastapi import APIRouter
from fastapi.responses import Response

from app.core.archivos_firmados import firma_valida
from app.core.exceptions import bad_request, forbidden, not_found
from app.services import uploads

router = APIRouter(prefix="/archivos", tags=["Archivos"])

CARPETAS_PERMITIDAS = ("incidencias", "activos")

_NOMBRE_VALIDO = re.compile(r"^[A-Za-z0-9_.-]+$")
_EXP_VALIDA = re.compile(r"^[0-9]{1,12}$")
_FIRMA_VALIDA = re.compile(r"^[0-9a-f]{64}$")
_SEGMENTO_PELIGROSO = re.compile(r"\.\.|[\\:\x00]")

TIPO_POR_FORMATO = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}

# Un solo mensaje para firma ausente, alterada o vencida: no se le dice a
# nadie cuál de las tres falló.
_ENLACE_NO_VALIDO = (
    "El enlace a este archivo no es válido o ya venció. Recarga la pantalla "
    "para obtener uno nuevo."
)
_RUTA_NO_VALIDA = "La ruta del archivo no es válida."
_NO_ENCONTRADO = "Archivo no encontrado."


def _formato_valido(carpeta: str, nombre: str) -> bool:
    """¿La carpeta es de la lista permitida y el nombre no trae separadores ni '..'?"""
    return (
        carpeta in CARPETAS_PERMITIDAS
        and _NOMBRE_VALIDO.fullmatch(nombre) is not None
        and ".." not in nombre
    )


def _enlace_vigente(carpeta: str, nombre: str, exp: str | None, firma: str | None) -> bool:
    """¿El enlace trae una exp numérica y una firma válida y vigente para este archivo?"""
    if exp is None or firma is None:
        return False
    if not _EXP_VALIDA.fullmatch(exp) or not _FIRMA_VALIDA.fullmatch(firma):
        return False
    return firma_valida(carpeta, nombre, int(exp), firma)


def _ruta_en_static(carpeta: str, nombre: str) -> str | None:
    """Ruta real del archivo, o None si al resolverla queda fuera de STATIC_ROOT."""
    raiz = os.path.realpath(uploads.STATIC_ROOT)
    ruta = os.path.realpath(os.path.join(raiz, carpeta, nombre))
    if os.path.commonpath([raiz, ruta]) != raiz or ruta == raiz:
        return None
    return ruta


def _leer_imagen(ruta: str) -> tuple[bytes, str] | None:
    """Contenido y Content-Type del archivo, o None si no se pudo leer, supera el máximo o no es imagen."""
    maximo = uploads.MAX_FILE_SIZE_MB * 1024 * 1024
    try:
        with open(ruta, "rb") as archivo:
            contenido = archivo.read(maximo + 1)
    except OSError:
        return None
    if len(contenido) > maximo:
        return None
    tipo = TIPO_POR_FORMATO.get(uploads.formato_real(contenido[:16]))
    if tipo is None:
        return None
    return contenido, tipo


@router.get(
    "/{carpeta}/{nombre}",
    response_class=Response,
    summary="Ver una foto subida a partir de su enlace firmado",
    responses={
        400: {"description": "La carpeta o el nombre no tienen un formato válido."},
        403: {"description": "Enlace sin firma, con firma alterada o vencido."},
        404: {"description": "El archivo no existe o no es una imagen."},
    },
)
async def get_archivo(
    carpeta: str,
    nombre: str,
    exp: str | None = None,
    firma: str | None = None,
):
    """
    Devuelve la foto si el enlace lo emitió la API y no ha vencido.

    No pide JWT a propósito: un <img> y una pestaña nueva no pueden enviar la
    cabecera Authorization, así que el control de acceso es la firma y su vencimiento.
    """
    if not _formato_valido(carpeta, nombre):
        raise bad_request(_RUTA_NO_VALIDA)

    if not _enlace_vigente(carpeta, nombre, exp, firma):
        raise forbidden(_ENLACE_NO_VALIDO)

    ruta = _ruta_en_static(carpeta, nombre)
    if ruta is None:
        raise bad_request(_RUTA_NO_VALIDA)

    if not os.path.isfile(ruta):
        raise not_found(_NO_ENCONTRADO)

    # Se lee todo aquí (máximo MAX_FILE_SIZE_MB): con FileResponse el archivo
    # se abría otra vez al enviar y, si ya no estaba, la respuesta era un 500.
    leida = _leer_imagen(ruta)
    if leida is None:
        raise not_found(_NO_ENCONTRADO)

    contenido, tipo = leida
    return Response(
        content=contenido,
        media_type=tipo,
        headers={"Cache-Control": "private", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{resto:path}", include_in_schema=False)
async def get_archivo_ruta_no_valida(resto: str):
    """Ruta de respaldo: 400 si intenta salir de la carpeta, 404 en otro caso. Nunca sirve un archivo."""
    if _SEGMENTO_PELIGROSO.search(resto):
        raise bad_request(_RUTA_NO_VALIDA)
    raise not_found(_NO_ENCONTRADO)
