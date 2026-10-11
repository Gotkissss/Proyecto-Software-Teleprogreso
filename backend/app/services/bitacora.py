"""
Bitácora de auditoría (tabla bitacora_auditoria, migración 0009).

Dos caminos de escritura y una sola cadena de hashes:

1. Hook `after_flush`: todo INSERT/UPDATE/DELETE hecho con el ORM durante una
   petición deja su fila en la MISMA transacción. Así cubre los endpoints
   mutantes sin tocarlos, y si la petición hace rollback su rastro también se
   va: la bitácora no cuenta cambios que no ocurrieron.
2. `anotar_evento()`: lo que no cambia filas pero importa (login fallido,
   bloqueos, logout, 403, lecturas sensibles). Se acumula en el contexto de la
   petición y ContextoPeticionMiddleware lo guarda con `guardar_eventos()`
   cuando la petición ya terminó, en su propia transacción. Así sobrevive al
   rollback de un 401/403 y nunca espera el candado de la cadena que la propia
   petición pudiera tener tomado.

Fuera de una petición (seed, scripts, migraciones) no se registra nada.
"""
import hashlib
import json
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session

from app.core.contexto import contexto_actual
from app.db.session import AsyncSessionLocal
from app.models.bitacora import BitacoraAuditoria
from app.models.token import TokenRevocado

logger = logging.getLogger(__name__)

# Candado de transacción que ordena la cadena: entre leer el último hash e
# insertar el siguiente nadie más puede colarse. Se suelta solo con el commit.
_CANDADO_CADENA = 90009
# token_revocado no se audita fila a fila: el logout ya queda como evento.
_NO_AUDITADOS = (BitacoraAuditoria, TokenRevocado)
_OCULTOS = {"hash_contrasena"}


def _json(valor):
    """El valor tal como quedará en JSONB, para hashear lo mismo que se guarda."""
    return json.loads(json.dumps(valor, default=str, ensure_ascii=False))


def calcular_hash(hash_anterior: str | None, registro: dict) -> str:
    contenido = {**registro, "hash_anterior": hash_anterior}
    canonico = json.dumps(
        contenido, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False
    )
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def _registro(accion: str, entidad: str, id_entidad=None, cambios=None) -> dict:
    ctx = contexto_actual()
    return {
        "fecha_hora": datetime.now(timezone.utc).isoformat(),
        "id_actor": ctx.id_actor if ctx else None,
        "rol_actor": ctx.rol_actor if ctx else None,
        "ip": ctx.ip if ctx else None,
        "request_id": ctx.request_id if ctx else None,
        "accion": accion,
        "entidad": entidad,
        "id_entidad": id_entidad,
        "cambios": _json(cambios) if cambios is not None else None,
    }


def insertar(conexion, registro: dict) -> None:
    """Encadena e inserta una fila. `conexion` es una Connection síncrona."""
    conexion.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _CANDADO_CADENA})
    anterior = conexion.execute(
        text("SELECT hash FROM bitacora_auditoria ORDER BY id_bitacora DESC LIMIT 1")
    ).scalar()
    conexion.execute(
        BitacoraAuditoria.__table__.insert().values(
            **{**registro, "fecha_hora": datetime.fromisoformat(registro["fecha_hora"])},
            hash_anterior=anterior,
            hash=calcular_hash(anterior, registro),
        )
    )


# --- 1. Hook: cambios hechos con el ORM -------------------------------------

def _id_entidad(estado):
    pk = [estado.dict.get(estado.mapper.get_property_by_column(c).key) for c in estado.mapper.primary_key]
    return pk[0] if len(pk) == 1 and isinstance(pk[0], int) else None


def describir_cambios(obj, accion: str) -> dict:
    # Solo lee lo que ya está en memoria (estado.dict / history): cargar un
    # atributo aquí sería IO síncrono dentro de una sesión async.
    estado = inspect(obj)
    cambios = {}
    for attr in estado.mapper.column_attrs:
        clave = attr.key
        if accion == "actualizar":
            historia = estado.attrs[clave].history
            if not historia.has_changes():
                continue
            valor = {
                "antes": historia.deleted[0] if historia.deleted else None,
                "despues": historia.added[0] if historia.added else None,
            }
        elif clave in estado.dict:
            valor = estado.dict[clave]
        else:
            continue
        cambios[clave] = "***" if clave in _OCULTOS else valor
    return cambios


@event.listens_for(Session, "after_flush")
def _auditar_flush(session, _contexto_flush):
    if contexto_actual() is None:
        return
    filas = []
    for accion, objetos in (
        ("crear", session.new),
        ("actualizar", session.dirty),
        ("eliminar", session.deleted),
    ):
        for obj in objetos:
            if isinstance(obj, _NO_AUDITADOS):
                continue
            cambios = describir_cambios(obj, accion)
            if accion == "actualizar" and not cambios:
                continue
            filas.append(_registro(accion, obj.__tablename__, _id_entidad(inspect(obj)), cambios))
    if filas:
        conexion = session.connection()
        for fila in filas:
            insertar(conexion, fila)


# --- 2. Eventos que no cambian filas -----------------------------------------

def anotar_evento(accion: str, entidad: str, id_entidad=None, cambios=None) -> None:
    ctx = contexto_actual()
    if ctx is not None:
        ctx.eventos.append(_registro(accion, entidad, id_entidad, cambios))


async def guardar_eventos(eventos: list[dict]) -> None:
    if not eventos:
        return
    try:
        async with AsyncSessionLocal() as sesion:
            conexion = await sesion.connection()
            for registro in eventos:
                await conexion.run_sync(insertar, registro)
            await sesion.commit()
    except Exception:
        # La auditoría no tumba la respuesta, pero el fallo no pasa en silencio.
        logger.exception("No se pudieron guardar %d eventos de auditoría", len(eventos))


_ULTIMO_AVISO: dict[str, float] = {}


def primera_vez(clave: str, ventana_s: float = 60) -> bool:
    """
    Una fila por bloqueo y minuto, no una por petición rechazada: si no, quien
    inunda la API a 429 también inundaría la bitácora.
    """
    ahora = time.monotonic()
    if len(_ULTIMO_AVISO) > 10_000:
        _ULTIMO_AVISO.clear()
    if ahora - _ULTIMO_AVISO.get(clave, float("-inf")) < ventana_s:
        return False
    _ULTIMO_AVISO[clave] = ahora
    return True
