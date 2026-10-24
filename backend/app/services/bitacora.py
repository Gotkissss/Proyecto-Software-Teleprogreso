"""
Bitácora de auditoría (tablas bitacora_auditoria y bitacora_ancla, migraciones
0009 y 0010): CAPTURA. La consulta, verificación, exportación y purga viven en
services/auditoria.py.

Dos caminos de escritura y una sola cadena de hashes:

1. Hook del ORM: todo INSERT/UPDATE/DELETE hecho durante una petición deja su
   fila en la MISMA transacción, con el antes/después armado solo, así que
   ningún endpoint lo escribe a mano. `before_flush` captura el diff (con
   get_history por columna, mientras el estado previo sigue intacto) y
   `after_flush` lo escribe, cuando los INSERT ya asignaron sus ids. Si la
   petición hace rollback, su rastro también se va. Lo que no pasa por el
   flush (insert/update/delete masivos con session.execute) lo recoge
   `do_orm_execute`.
2. `anotar_evento()`: lo que no cambia filas pero importa (login fallido,
   bloqueos, logout, 403, lecturas sensibles). Se acumula en el contexto de la
   petición y ContextoPeticionMiddleware lo guarda con `guardar_eventos()`
   cuando la petición ya terminó, en su propia transacción. Así sobrevive al
   rollback de un 401/403.

La cadena (id, hora, hash_anterior y hash) la calcula la base en el trigger
bitacora_auditoria_encadenar: aquí solo se inserta el contenido. Así el
backend no puede fabricar un hash, y la verificación usa exactamente la misma
función que la inserción.

Fuera de una petición (seed, scripts, migraciones) el hook no registra nada.
"""
import json
import logging
import time

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import PASSIVE_NO_INITIALIZE, get_history

from app.core.contexto import contexto_actual
from app.db.session import AsyncSessionLocal
from app.models.bitacora import BitacoraAncla, BitacoraAuditoria
from app.models.token import TokenRevocado

logger = logging.getLogger(__name__)

# token_revocado no se audita fila a fila: el logout ya queda como evento.
_NO_AUDITADOS = (BitacoraAuditoria, BitacoraAncla, TokenRevocado)
_TABLAS_NO_AUDITADAS = {"bitacora_auditoria", "bitacora_ancla", "token_revocado"}

# Columnas que nunca se copian a la bitácora. Se deja constancia de que
# cambiaron, pero no de su valor.
_OCULTOS = {"hash_contrasena", "version_token"}

# Telemetría: un técnico en jornada manda un punto cada 2 minutos y un lote
# puede traer 500. De esas tablas se guarda una fila por flush con cuántas
# filas y cuáles ids, sin coordenadas: el punto ya vive en su tabla (con su
# propia retención) y copiarlo aquí duplicaría un dato sensible en un sitio
# que no se puede borrar fila a fila.
_RESUMIDOS = {"ubicacion_empleado"}

ROL_SISTEMA = "sistema"


def _json(valor):
    """El valor tal como quedará en JSONB (fechas, Decimal y geometrías como texto)."""
    return json.loads(json.dumps(valor, default=str, ensure_ascii=False))


def _registro(accion: str, entidad: str, id_entidad=None, cambios=None) -> dict:
    ctx = contexto_actual()
    return {
        "id_actor": ctx.id_actor if ctx else None,
        "rol_actor": ctx.rol_actor if ctx else None,
        "ip": ctx.ip if ctx else None,
        "request_id": ctx.request_id if ctx else None,
        "accion": accion,
        "entidad": entidad,
        "id_entidad": id_entidad,
        "cambios": _json(cambios) if cambios is not None else None,
    }


def registro_sistema(accion: str, entidad: str, cambios=None, request_id=None) -> dict:
    """Fila para lo que hace un proceso sin sesión (mantenimiento, migraciones)."""
    return {
        "id_actor": None,
        "rol_actor": ROL_SISTEMA,
        "ip": None,
        "request_id": request_id,
        "accion": accion,
        "entidad": entidad,
        "id_entidad": None,
        "cambios": _json(cambios) if cambios is not None else None,
    }


def insertar(conexion, registro: dict) -> None:
    """Inserta una fila. `conexion` es una Connection síncrona; la base la encadena."""
    conexion.execute(BitacoraAuditoria.__table__.insert().values(**registro))


# --- 1. Hook: cambios hechos con el ORM -------------------------------------

def _id_entidad(estado):
    pk = [estado.dict.get(estado.mapper.get_property_by_column(c).key) for c in estado.mapper.primary_key]
    return pk[0] if len(pk) == 1 and isinstance(pk[0], int) else None


def describir_cambios(obj, accion: str) -> dict:
    """
    Diff de una fila a partir de get_history() columna por columna:
    - crear / eliminar: el valor de cada columna conocida.
    - actualizar: {"antes", "despues"} solo de las columnas que cambiaron.

    PASSIVE_NO_INITIALIZE: lee solo lo que ya está en memoria. Una columna sin
    cargar no se trae de la BD a mitad de un flush; simplemente no aparece.
    """
    cambios = {}
    for attr in inspect(obj).mapper.column_attrs:
        clave = attr.key
        historia = get_history(obj, clave, passive=PASSIVE_NO_INITIALIZE)
        if accion == "actualizar":
            if not historia.has_changes():
                continue
            valor = {
                "antes": historia.deleted[0] if historia.deleted else None,
                "despues": historia.added[0] if historia.added else None,
            }
            if clave in _OCULTOS:
                valor = {"antes": "***", "despues": "***"}
        else:
            actuales = list(historia.added or ()) + list(historia.unchanged or ())
            if not actuales:
                continue
            valor = "***" if clave in _OCULTOS else actuales[0]
        cambios[clave] = valor
    return cambios


_PENDIENTE = "bitacora_pendiente"


@event.listens_for(Session, "before_flush")
def _capturar_diff(session, _contexto_flush, _instancias):
    # Se reemplaza (no se acumula): si un flush anterior falló a medias, su
    # captura no debe colarse en este.
    session.info[_PENDIENTE] = []
    if contexto_actual() is None:
        return
    for accion, objetos in (
        ("crear", session.new),
        ("actualizar", session.dirty),
        ("eliminar", session.deleted),
    ):
        for obj in objetos:
            if isinstance(obj, _NO_AUDITADOS):
                continue
            if obj.__tablename__ in _RESUMIDOS:
                # El resumen no lleva columnas: basta con saber que la fila existe.
                if accion != "actualizar" or session.is_modified(obj):
                    session.info[_PENDIENTE].append((accion, obj, None))
                continue
            cambios = describir_cambios(obj, accion)
            # `dirty` incluye objetos que solo se tocaron sin cambiar nada.
            if accion == "actualizar" and not cambios:
                continue
            session.info[_PENDIENTE].append((accion, obj, cambios))


@event.listens_for(Session, "after_flush")
def _escribir_diff(session, _contexto_flush):
    pendientes = session.info.pop(_PENDIENTE, [])
    if not pendientes:
        return
    conexion = session.connection()
    resumenes: dict[tuple[str, str], list] = {}
    for accion, obj, cambios in pendientes:
        # El id se lee ahora: en before_flush una fila nueva aún no lo tenía.
        id_entidad = _id_entidad(inspect(obj))
        if obj.__tablename__ in _RESUMIDOS:
            resumenes.setdefault((accion, obj.__tablename__), []).append(id_entidad)
            continue
        insertar(conexion, _registro(accion, obj.__tablename__, id_entidad, cambios))
    for (accion, tabla), ids in resumenes.items():
        insertar(
            conexion,
            _registro(
                accion,
                tabla,
                ids[0] if len(ids) == 1 else None,
                {"resumen": True, "filas": len(ids), "ids": ids},
            ),
        )


def _condicion(sentencia) -> str | None:
    if getattr(sentencia, "whereclause", None) is None:
        return None
    try:
        return str(sentencia.whereclause.compile(compile_kwargs={"literal_binds": True}))
    except Exception:
        return str(sentencia.whereclause)


@event.listens_for(Session, "do_orm_execute")
def _auditar_masivo(estado_ejecucion):
    """
    insert()/update()/delete() masivos con session.execute() no pasan por el
    flush: sin esto no dejarían rastro. Ejemplos: quitar los técnicos de una
    tarea al reasignarla (services/tareas.py) o crear las alertas con
    ON CONFLICT DO NOTHING (services/alertas.py).

    No hay objetos de los que sacar un diff, así que se guarda la condición,
    cuántas filas tocó y, si la sentencia trae RETURNING, los ids que devolvió
    (la primera columna del RETURNING).
    """
    es_insert = estado_ejecucion.is_insert
    if not (es_insert or estado_ejecucion.is_update or estado_ejecucion.is_delete):
        return None
    tabla = estado_ejecucion.statement.table.name
    if contexto_actual() is None or tabla in _TABLAS_NO_AUDITADAS:
        return None

    resultado = estado_ejecucion.invoke_statement()
    cambios = {"masivo": True}
    devolver = resultado
    if resultado.returns_rows:
        # Leer las filas consumiría el resultado de quien llamó: se congela y
        # se le entrega una copia intacta.
        congelado = resultado.freeze()
        ids = [fila[0] for fila in congelado().all()]
        cambios.update(filas=len(ids), ids=ids)
        devolver = congelado()
    else:
        cambios["filas"] = resultado.rowcount
    if not es_insert:
        cambios["condicion"] = _condicion(estado_ejecucion.statement)

    if cambios["filas"]:
        if es_insert:
            accion = "crear"
        elif estado_ejecucion.is_delete:
            accion = "eliminar"
        else:
            accion = "actualizar"
        insertar(
            estado_ejecucion.session.connection(),
            _registro(accion, tabla, None, cambios),
        )
    return devolver


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
        # La auditoría no tumba la respuesta, pero el fallo no pasa en silencio:
        # se registra en el log y se cuenta, para que HU-S10-05 lo convierta en
        # alerta (HU-S10-04, tarea 5).
        _FALLOS_AUDITORIA["total"] += 1
        _FALLOS_AUDITORIA["eventos_perdidos"] += len(eventos)
        _FALLOS_AUDITORIA["ultimo"] = time.time()
        logger.exception("No se pudieron guardar %d eventos de auditoría", len(eventos))


# Fallos al guardar eventos de auditoría desde que arrancó el proceso.
_FALLOS_AUDITORIA: dict = {"total": 0, "eventos_perdidos": 0, "ultimo": None}


def fallos_auditoria() -> dict:
    """Copia del contador de fallos al guardar auditoría (total, eventos perdidos, último)."""
    return dict(_FALLOS_AUDITORIA)


_ULTIMO_AVISO: dict[str, float] = {}


def primera_vez(clave: str, ventana_s: float = 60) -> bool:
    """
    Una fila por clave y ventana, no una por petición: si no, quien inunda la
    API a 429 también inundaría la bitácora, y un mapa que se refresca solo
    cada 15 s dejaría cuatro lecturas idénticas por minuto.
    """
    ahora = time.monotonic()
    if len(_ULTIMO_AVISO) > 10_000:
        _ULTIMO_AVISO.clear()
    if ahora - _ULTIMO_AVISO.get(clave, float("-inf")) < ventana_s:
        return False
    _ULTIMO_AVISO[clave] = ahora
    return True
