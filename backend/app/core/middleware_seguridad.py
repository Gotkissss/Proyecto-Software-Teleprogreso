"""
Middlewares de seguridad HTTP — Teleprogreso S.A.
-----------------------------------------------------------------------------
La base de datos ya solo es alcanzable a través de este backend. Estos
middlewares refuerzan el borde por el que sí se puede entrar:

  · `LimiteTamanoBody`   — corta las peticiones desmesuradas antes de leerlas.
  · `LimiteFrecuencia`   — tope de peticiones por minuto y por IP.
  · `CabecerasSeguridad` — cabeceras que endurecen el navegador del usuario.

Se registran en main.py. Recuerda que en Starlette el ÚLTIMO middleware
añadido es el primero en ejecutarse.
-----------------------------------------------------------------------------
"""
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import settings
from app.core.rate_limit import ip_cliente, limite_general

logger = logging.getLogger(__name__)


class LimiteTamanoBody(BaseHTTPMiddleware):
    """
    Rechaza cuerpos de petición por encima de MAX_REQUEST_BODY_MB.

    La validación de tamaño de app/services/uploads.py ocurre después de leer
    el archivo completo en memoria; para entonces el daño de un envío de varios
    gigabytes ya está hecho. Aquí se mira el Content-Length y se corta antes.
    """

    async def dispatch(self, request: Request, call_next):
        maximo = settings.MAX_REQUEST_BODY_MB * 1024 * 1024
        declarado = request.headers.get("content-length")

        if declarado is not None:
            try:
                if int(declarado) > maximo:
                    logger.warning(
                        "Petición rechazada por tamaño: %s bytes desde %s hacia %s",
                        declarado, ip_cliente(request), request.url.path,
                    )
                    return JSONResponse(
                        status_code=413,
                        content={
                            "error": "PAYLOAD_TOO_LARGE",
                            "detail": (
                                "El contenido enviado supera el límite de "
                                f"{settings.MAX_REQUEST_BODY_MB} MB."
                            ),
                            "status_code": 413,
                        },
                    )
            except ValueError:
                # Content-Length no numérico: petición malformada.
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "BAD_REQUEST",
                        "detail": "Cabecera Content-Length inválida.",
                        "status_code": 400,
                    },
                )

        return await call_next(request)


class LimiteFrecuencia(BaseHTTPMiddleware):
    """
    Tope de peticiones por minuto y por IP.

    No aplica a los health checks: Docker y el balanceador los consultan cada
    pocos segundos y no deben consumir cupo, ni quedarse sin él.
    """

    RUTAS_EXENTAS = frozenset({"/", "/health"})

    async def dispatch(self, request: Request, call_next):
        if request.url.path in self.RUTAS_EXENTAS:
            return await call_next(request)

        ip = ip_cliente(request)
        espera = limite_general.registrar(f"ip:{ip}")

        if espera:
            logger.warning(
                "Límite de frecuencia alcanzado por %s en %s", ip, request.url.path
            )
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(espera)},
                content={
                    "error": "TOO_MANY_REQUESTS",
                    "detail": (
                        "Demasiadas peticiones. Espera unos segundos antes de "
                        "volver a intentarlo."
                    ),
                    "status_code": 429,
                },
            )

        return await call_next(request)


class CabecerasSeguridad(BaseHTTPMiddleware):
    """
    Añade cabeceras de seguridad a todas las respuestas.

    Importan sobre todo por /static: ahí se sirven imágenes subidas por los
    usuarios. Sin `X-Content-Type-Options: nosniff`, un navegador puede
    interpretar como HTML un archivo que se subió con extensión de imagen, y
    ejecutarlo en el dominio de la API; con el token de sesión al alcance, eso
    es un camino directo a los datos.
    """

    async def dispatch(self, request: Request, call_next):
        respuesta: Response = await call_next(request)
        cabeceras = respuesta.headers

        # No adivinar el tipo de contenido: se respeta el Content-Type.
        cabeceras.setdefault("X-Content-Type-Options", "nosniff")
        # La API no se muestra dentro de un iframe de nadie (clickjacking).
        cabeceras.setdefault("X-Frame-Options", "DENY")
        # No filtrar la URL completa (con ids de recursos) a terceros.
        cabeceras.setdefault("Referrer-Policy", "no-referrer")
        # Apagar APIs del navegador que esta API nunca necesita.
        cabeceras.setdefault(
            "Permissions-Policy",
            "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
        )
        # Respuestas de la API fuera de cachés intermedias.
        if request.url.path.startswith(("/auth", "/empleados")):
            cabeceras.setdefault("Cache-Control", "no-store")

        # Política de contenido restrictiva: esto es una API JSON más archivos
        # estáticos; no debe cargar ni ejecutar nada de terceros. `sandbox`
        # neutraliza cualquier HTML que llegara a colarse entre las subidas.
        #
        # Swagger y ReDoc se quedan fuera porque son páginas HTML que cargan su
        # propio JS: con esta política no se verían. Solo existen fuera de
        # producción (ver main.py).
        if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
            cabeceras.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; img-src 'self' data:; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'none'; sandbox",
            )

        # HSTS solo tiene sentido servido por https y solo en producción.
        if settings.es_produccion:
            cabeceras.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )

        return respuesta
