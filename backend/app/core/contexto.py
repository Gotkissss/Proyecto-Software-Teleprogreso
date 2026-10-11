"""
Contexto de la petición en curso: quién, con qué rol, desde qué IP y con qué
request_id.

Lo rellenan ContextoPeticionMiddleware (ip, request_id) y get_current_empleado
(actor y rol, en cuanto valida el JWT). El hook de auditoría lo lee con
contexto_actual() sin que current_user tenga que viajar por cada servicio.

El ContextVar guarda un objeto MUTABLE a propósito: BaseHTTPMiddleware corre
el endpoint en otra tarea con una copia del contexto, así que un .set() hecho
dentro de la dependencia no se vería fuera de ella. Mutar el mismo objeto sí.
"""
import ipaddress
import re
import uuid
from contextvars import ContextVar
from dataclasses import dataclass

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.rate_limit import ip_cliente

CABECERA_REQUEST_ID = "X-Request-ID"
# Se acepta el id que mande un proxy o el frontend solo si es corto y sin
# caracteres raros: termina en la bitácora y en los logs.
_REQUEST_ID_VALIDO = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


@dataclass
class ContextoPeticion:
    ip: str | None = None
    request_id: str | None = None
    id_actor: int | None = None
    rol_actor: str | None = None


_contexto: ContextVar[ContextoPeticion | None] = ContextVar("contexto_peticion", default=None)


def contexto_actual() -> ContextoPeticion | None:
    """El de la petición en curso; None fuera de una (seed, scripts, tests)."""
    return _contexto.get()


def registrar_actor(empleado) -> None:
    ctx = _contexto.get()
    if ctx is not None:
        ctx.id_actor = empleado.id_empleado
        ctx.rol_actor = empleado.rol


def _ip(request: Request) -> str | None:
    # La columna `ip` es INET: "desconocido" o "testclient" la harían fallar.
    ip = ip_cliente(request)
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return None
    return ip


def _request_id(request: Request) -> str:
    recibido = request.headers.get(CABECERA_REQUEST_ID, "")
    return recibido if _REQUEST_ID_VALIDO.match(recibido) else uuid.uuid4().hex


class ContextoPeticionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ctx = ContextoPeticion(ip=_ip(request), request_id=_request_id(request))
        token = _contexto.set(ctx)
        try:
            response = await call_next(request)
        finally:
            _contexto.reset(token)
        response.headers[CABECERA_REQUEST_ID] = ctx.request_id
        return response