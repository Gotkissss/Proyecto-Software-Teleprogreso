
"""
Excepciones personalizadas y manejadores globales de errores HTTP.
-------
lo que hace es que centraliza las respuestas de error para que TODOS los endpoints
devuelvan el mismo formato JSON ante fallos de autenticacion/autorizacion.

Formato estandar de error:
{
    "error": "CÓDIGO_ERROR",
    "detail": "Mensaje legible para el usuario",
    "status_code": 401
}

Uso en main.py:
    from app.core.exceptions import register_exception_handlers
    register_exception_handlers(app)
"""

import logging
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from jwt import ExpiredSignatureError, InvalidTokenError
from http import HTTPStatus
from sqlalchemy.exc import DBAPIError, DataError, IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


ERROR_CODES = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHORIZED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_409_CONFLICT: "CONFLICT",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "VALIDATION_ERROR",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
    status.HTTP_405_METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
}


class APIException(HTTPException):
    """Error HTTP de la aplicación con código estable y `detail` textual."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: str | None = None,
    ) -> None:
        if not isinstance(detail, str):
            raise TypeError("detail debe ser una cadena de texto.")

        super().__init__(status_code=status_code, detail=detail)
        self.error_code = error_code or ERROR_CODES.get(status_code, "HTTP_ERROR")


def bad_request(detail: str) -> APIException:
    """Construye un error 400 con el formato estándar de la API."""
    return APIException(status.HTTP_400_BAD_REQUEST, detail, "BAD_REQUEST")


def forbidden(detail: str) -> APIException:
    """Construye un error 403 con el formato estándar de la API."""
    return APIException(status.HTTP_403_FORBIDDEN, detail, "FORBIDDEN")


def not_found(detail: str) -> APIException:
    """Construye un error 404 con el formato estándar de la API."""
    return APIException(status.HTTP_404_NOT_FOUND, detail, "NOT_FOUND")


def conflict(detail: str) -> APIException:
    """Construye un error 409 con el formato estándar de la API."""
    return APIException(status.HTTP_409_CONFLICT, detail, "CONFLICT")


# Formato de respuesta de error estandarizado


def error_response(
    status_code: int,
    error_code: str,
    detail: str,
    headers: dict[str, str] | None = None,
    request_id: str | None = None) -> JSONResponse:
    """
    Construye una respuesta JSON de error con formato consistente.

    Args:
        status_code: Codigo HTTP (401, 403, 422, etc.)
        error_code:  Identificador de máquina del error (p.ej. TOKEN_EXPIRED)
        detail:      Mensaje legible para el usuario o frontend
        request_id:  Identificador de la petición, solo en errores 500 para
                     poder reportarlos (ver unhandled_exception_handler).
    """
    contenido = {
        "error": error_code,
        "detail": detail,
        "status_code": status_code,
    }
    if request_id:
        contenido["request_id"] = request_id
    return JSONResponse(
        status_code=status_code,
        content=contenido,
        headers=headers,
    )



# Manejadores individuales
# Cada uno captura un tipo específico de error y devuelve una respuesta con formato consistente.


_MENSAJES_DE_RUTA = {
    status.HTTP_404_NOT_FOUND: "El recurso solicitado no existe.",
    status.HTTP_405_METHOD_NOT_ALLOWED: "Método no permitido para este recurso.",
}

def _es_mensaje_por_defecto(exc: StarletteHTTPException) -> bool:
    try:
        return exc.detail == HTTPStatus(exc.status_code).phrase
    except ValueError:
        return False

    
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """
    Captura todos los HTTPException lanzados en la app.

    Especializa los mensajes mas comunes de autenticación:
    - 401: Token invalido / no autenticado
    - 403: Sin permisos para este recurso
    - 404: Recurso no encontrado
    """
    if exc.status_code == status.HTTP_403_FORBIDDEN:
        # Todo 403 pasa por aquí: falta de rol (require_roles), jerarquía
        # (puede_administrar), cuenta inactiva... Import diferido: la bitácora
        # arrastra modelos y sesión de BD.
        from app.services.bitacora import anotar_evento

        anotar_evento(
            "acceso_denegado",
            "ruta",
            cambios={
                "metodo": request.method,
                "ruta": request.url.path,
                "detalle": getattr(exc, "detalle_bitacora", exc.detail),
            },
        )
    # Mensajes por defecto para errores de autenticacion
    default_messages = {
        status.HTTP_401_UNAUTHORIZED: (
            "No autenticado. Proporciona un token JWT válido "
            "en el header Authorization: Bearer <token>."
        ),
        status.HTTP_403_FORBIDDEN: (
            "No tienes permisos para acceder a este recurso."
        ),
    }

    error_code = getattr(exc, "error_code", None) or ERROR_CODES.get(
        exc.status_code,
        "HTTP_ERROR",
    )

    # Usar mensaje personalizado del lanzador si existe,
    # o el mensaje por defecto si aplica
    detail = exc.detail or default_messages.get(exc.status_code, "Error en la solicitud.")
    if not isinstance(detail, str):
        detail = str(detail)

    if exc.status_code in _MENSAJES_DE_RUTA and _es_mensaje_por_defecto(exc):
        detail = _MENSAJES_DE_RUTA[exc.status_code]

    logger.warning(
        "HTTPException %s en %s: %s",
        exc.status_code,
        request.url.path,
        detail,
    )

    return error_response(
        status_code=exc.status_code,
        error_code=error_code,
        detail=detail,
        headers=getattr(exc, "headers", None)
    )

# Captura errores de JWT no manejados explicitamente (token malformado, etc.)
async def jwt_error_handler(request: Request, exc: InvalidTokenError) -> JSONResponse:
    """
    Captura errores de JWT no manejados explicitamente (token malformado, etc.)
    """
    logger.warning("Token JWT inválido en %s: %s", request.url.path, str(exc))

    return error_response(
        status_code=status.HTTP_401_UNAUTHORIZED,
        error_code="INVALID_TOKEN",
        detail="Token JWT invalido o malformado. Por favor inicia sesion nuevamente.",
    )

# Captura especificamente tokens expirados para dar un mensaje mas claro.
async def expired_token_handler(request: Request, exc: ExpiredSignatureError) -> JSONResponse:
    """
    Captura especificamente tokens expirados para dar un mensaje mas claro.
    """
    logger.info("Token expirado en %s", request.url.path)

    return error_response(
        status_code=status.HTTP_401_UNAUTHORIZED,
        error_code="TOKEN_EXPIRED",
        detail="Tu sesion ha expirado. Por favor inicia sesion nuevamente.",
    )


async def validation_error_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """
    Captura errores de validacion de Pydantic (body incorrecto, campos faltantes).
    Devuelve un resumen legible en lugar del verbose default de FastAPI.
    """
    # Extraer solo los campos con error y sus mensajes
    errors = []
    for error in exc.errors():
        field = " → ".join(str(loc) for loc in error["loc"] if loc != "body")
        errors.append({
            "field": field or "body",
            "message": error["msg"],
            "type": error["type"],
        })

    logger.warning("ValidationError en %s: %s", request.url.path, errors)

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "error": "VALIDATION_ERROR",
            "detail": "Los datos enviados no son validos.",
            "status_code": status.HTTP_422_UNPROCESSABLE_CONTENT,
            "errors": errors,
        },
    )
 

_MENSAJES_DE_INTEGRIDAD = {
    "23505": "Ya existe un registro con esos datos.",
    "23503": "El registro hace referencia a datos que no existen o está en uso por otros.",
}
_MENSAJE_INTEGRIDAD = "La operación choca con datos existentes o con una regla del sistema."
_MENSAJE_DATO = "Alguno de los datos enviados es demasiado largo o está fuera del rango permitido."


def _sqlstate(exc: DBAPIError) -> str | None:
    original = getattr(exc, "orig", None)
    codigo = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    return codigo if isinstance(codigo, str) else None


def _clase_de_error(exc: DBAPIError) -> str | None:
    if isinstance(exc, IntegrityError):
        return "23"
    if isinstance(exc, DataError):
        return "22"
    codigo = _sqlstate(exc)
    return codigo[:2] if codigo else None


async def database_error_handler(request: Request, exc: DBAPIError) -> JSONResponse:
    clase = _clase_de_error(exc)
    if clase not in ("22", "23"):
        return await unhandled_exception_handler(request, exc)   # conexión, timeout...
    # Nunca str(exc): incluye el SQL y sus parámetros.
    logger.warning("Error de base de datos en %s %s: %s (SQLSTATE %s)",
                   request.method, request.url.path,
                   type(getattr(exc, "orig", exc)).__name__, _sqlstate(exc))
    if clase == "23":
        return error_response(status.HTTP_409_CONFLICT, "CONFLICT",
                              _MENSAJES_DE_INTEGRIDAD.get(_sqlstate(exc), _MENSAJE_INTEGRIDAD))
    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, "VALIDATION_ERROR", _MENSAJE_DATO)


# Captura cualquier excepcion no manejada para evitar que el servidor devuelva stack traces al cliente.
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Captura cualquier excepción no manejada para evitar que el servidor
    devuelva stack traces al cliente.

    El 500 deja rastro (HU-S10-04, tarea 5): el cuerpo lleva el `request_id`
    (el mismo del header X-Request-ID, del log y de la bitácora) para que quien
    lo vea en pantalla pueda reportarlo, y se anota un evento `error_interno`
    con ruta, método y TIPO de excepción: nunca su mensaje, que puede traer SQL
    o datos de la petición, ni el stack.
    """
    # Import diferido: la bitácora arrastra modelos y sesión de BD.
    from app.core.contexto import contexto_actual
    from app.services.bitacora import anotar_evento

    ctx = contexto_actual()
    request_id = ctx.request_id if ctx else None
    tipo = type(exc).__name__

    logger.exception(
        "Error interno [request_id=%s] en %s %s: %s",
        request_id, request.method, request.url.path, tipo,
    )
    anotar_evento(
        "error_interno",
        "peticion",
        cambios={
            "metodo": request.method,
            "ruta": request.url.path,
            "excepcion": tipo,
        },
    )

    return error_response(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code="INTERNAL_ERROR",
        detail="Error interno del servidor. Contacta al administrador.",
        request_id=request_id,
    )


# Funcion de registro  la cual se va a llamar solo una vez desde el main.py

# Esta funcion se encarga de registrar todos los manejadores de excepciones personalizados en la aplicación FastAPI.
def register_exception_handlers(app: FastAPI) -> None:
    """
    Registra todos los manejadores de error en la aplicación FastAPI.

    Llamar desde main.py:
        from app.core.exceptions import register_exception_handlers
        register_exception_handlers(app)
    """
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(DBAPIError, database_error_handler)
    app.add_exception_handler(InvalidTokenError, jwt_error_handler)
    app.add_exception_handler(ExpiredSignatureError, expired_token_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
