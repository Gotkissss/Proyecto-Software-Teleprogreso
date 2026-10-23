# backend/app/core/archivos_firmados.py
"""
Enlaces firmados a las fotos subidas — Teleprogreso S.A. (HU-S10-02)
-----------------------------------------------------------------------------
Las fotos de evidencia y de activos se publicaban en /static sin pedir
sesión: quien tuviera el enlace (o lo adivinara) veía la foto, aunque la API
solo deja listar las evidencias al técnico asignado y a supervisión.

La solución elegida es un enlace temporal firmado:

    /archivos/{carpeta}/{nombre}?exp=<unix>&firma=<hmac>

  · Lo emite la API al serializar una respuesta que ya pasó la regla de
    acceso, así que solo recibe el enlace quien podía ver la foto.
  · Funciona tal cual en un <img> y en "abrir en pestaña nueva", que no
    pueden mandar la cabecera Authorization. Por eso se descartó pedir la
    imagen con axios y pintarla como blob: obligaba a reescribir cada
    componente que muestra una foto y a cargarlas en memoria de JavaScript.
  · Vence a los MINUTOS_URL_FIRMADA (core/reglas.py). Un enlace copiado deja
    de abrir la foto en unos minutos: es el precio de la decisión, y lo acota.
  · La firma es HMAC-SHA256 sobre la ruta Y el vencimiento con
    CLAVE_FIRMA_ARCHIVOS, que no es SECRET_KEY: cambiar la carpeta, el nombre
    o alargar `exp` invalida la firma, y sin la llave no se puede fabricar una.

En la base se sigue guardando la ruta pública de siempre (/static/...): la
firma se calcula al responder, así que no hay datos que migrar.

Este módulo solo firma y verifica. Quien sirve el archivo (GET /archivos/...)
llama a `firma_valida` y además resuelve la ruta dentro de STATIC_ROOT.
-----------------------------------------------------------------------------
"""
import hashlib
import hmac
import time
from typing import Annotated, Optional
from urllib.parse import urlencode

from pydantic import PlainSerializer

from app.core.config import settings
from app.core.reglas import MINUTOS_URL_FIRMADA

# Prefijo con el que services/uploads.py guarda la ruta de cada imagen.
PREFIJO_GUARDADO = "/static/"

# Prefijo de los enlaces firmados (lo atiende el endpoint de archivos).
PREFIJO_FIRMADO = "/archivos/"


def _segmentos(ruta_guardada: str) -> tuple[str, str] | None:
    """
    ('carpeta', 'nombre') de una ruta '/static/carpeta/nombre', o None si no
    tiene esa forma exacta. Lo que no tenga esa forma no lo escribió
    guardar_imagen y no se firma.
    """
    if not ruta_guardada.startswith(PREFIJO_GUARDADO):
        return None
    partes = ruta_guardada[len(PREFIJO_GUARDADO):].split("/")
    if len(partes) != 2 or any(p in ("", ".", "..") for p in partes):
        return None
    return partes[0], partes[1]


def _firma(carpeta: str, nombre: str, exp: int) -> str:
    """HMAC-SHA256 de la ruta y el vencimiento, en hexadecimal."""
    mensaje = f"{carpeta}/{nombre}\n{exp}".encode("utf-8")
    return hmac.new(
        settings.CLAVE_FIRMA_ARCHIVOS.encode("utf-8"), mensaje, hashlib.sha256
    ).hexdigest()


def url_firmada(ruta_guardada: str | None, ahora: int | None = None) -> str | None:
    """
    Enlace temporal a una imagen a partir de la ruta guardada en la base.

    Devuelve None si no hay imagen o si la ruta no es de las que escribe
    guardar_imagen: es preferible que la foto no salga a publicar una ruta
    sin firmar.
    """
    if not ruta_guardada:
        return None
    segmentos = _segmentos(ruta_guardada)
    if segmentos is None:
        return None

    carpeta, nombre = segmentos
    exp = int(time.time() if ahora is None else ahora) + MINUTOS_URL_FIRMADA * 60
    consulta = urlencode({"exp": exp, "firma": _firma(carpeta, nombre, exp)})
    return f"{PREFIJO_FIRMADO}{carpeta}/{nombre}?{consulta}"


def firma_valida(
    carpeta: str,
    nombre: str,
    exp: int,
    firma: str,
    ahora: int | None = None,
) -> bool:
    """
    ¿Este enlace lo emitió la API y sigue vigente?

    False si venció, si su vencimiento está más lejos de lo que la API emite
    (nadie con la llave lo habría firmado así) o si la firma no corresponde a
    esta carpeta, este nombre y este vencimiento. La comparación es en tiempo
    constante para no filtrar la firma byte a byte.
    """
    momento = int(time.time() if ahora is None else ahora)
    if exp < momento or exp - momento > MINUTOS_URL_FIRMADA * 60:
        return False
    return hmac.compare_digest(_firma(carpeta, nombre, exp), firma)


def _serializar(ruta_guardada: str | None) -> str | None:
    return url_firmada(ruta_guardada)


# Tipo para los campos de respuesta que llevan una foto (foto_url,
# foto_evidencia): Pydantic lo convierte en el enlace firmado al serializar.
# Solo para respuestas; un schema de entrada que lo usara firmaría lo que
# manda el cliente.
UrlArchivo = Annotated[
    Optional[str],
    PlainSerializer(_serializar, return_type=Optional[str], when_used="always"),
]
