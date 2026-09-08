
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
from jose import ExpiredSignatureError, JWTError

logger = logging.getLogger(__name__)


ERROR_CODES = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHORIZED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_409_CONFLICT: "CONFLICT",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "VALIDATION_ERROR",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
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
) -> JSONResponse:
    """
    Construye una respuesta JSON de error con formato consistente.

    Args:
        status_code: Codigo HTTP (401, 403, 422, etc.)
        error_code:  Identificador de máquina del error (p.ej. TOKEN_EXPIRED)
        detail:      Mensaje legible para el usuario o frontend
    """
    return JSONResponse(
        status_code=status_code,
        content={
            "error": error_code,
            "detail": detail,
            "status_code": status_code,
        },
    )



# Manejadores individuales
# Cada uno captura un tipo específico de error y devuelve una respuesta con formato consistente.

async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """
    Captura todos los HTTPException lanzados en la app.

    Especializa los mensajes mas comunes de autenticación:
    - 401: Token invalido / no autenticado
    - 403: Sin permisos para este recurso
    - 404: Recurso no encontrado
    """
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
    )

# Captura errores de JWT no manejados explicitamente (token malformado, etc.)
async def jwt_error_handler(request: Request, exc: JWTError) -> JSONResponse:
    """
    Captura errores de JWT no manejados explicitamente (token malformado, etc.)
    """
    logger.warning("JWTError en %s: %s", request.url.path, str(exc))

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
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "VALIDATION_ERROR",
            "detail": "Los datos enviados no son validos.",
            "status_code": status.HTTP_422_UNPROCESSABLE_ENTITY,
            "errors": errors,
        },
    )
 

# Captura cualquier excepcion no manejada para evitar que el servidor devuelva stack traces al cliente.
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Captura cualquier excepción no manejada para evitar que el servidor
    devuelva stack traces al cliente.
    """
    logger.exception("Error no manejado en %s: %s", request.url.path, str(exc))

    return error_response(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code="INTERNAL_ERROR",
        detail="Error interno del servidor. Contacta al administrador.",
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
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(JWTError, jwt_error_handler)
    app.add_exception_handler(ExpiredSignatureError, expired_token_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
