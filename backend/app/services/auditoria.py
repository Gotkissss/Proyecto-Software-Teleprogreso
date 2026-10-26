"""
Bitácora de auditoría (HU-S9-03): CONSULTA, VERIFICACIÓN, EXPORTACIÓN y PURGA.
La captura vive en services/bitacora.py.

La verificación y la purga son funciones de la base (migración 0010):
`bitacora_auditoria_verificar()` recalcula la cadena con la misma función que
usa el trigger de inserción, y `bitacora_auditoria_purgar()` borra un prefijo
dejando un ancla. Aquí solo se llaman y se traducen.
"""
import json
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from math import ceil

from sqlalchemy import func, literal, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import bad_request
from app.core.reglas import MAX_FILAS_EXPORTAR_BITACORA
from app.core.tiempo import a_hora_local
from app.models.bitacora import BitacoraAncla, BitacoraAuditoria
from app.models.empleado import Empleado
from app.schemas.auditoria import (
    CatalogosBitacoraResponse,
    FilaBitacoraResponse,
    UltimaPurgaResponse,
    VerificacionBitacoraResponse,
)
from app.services.exportacion_reportes import generar_excel_tabla

SQL_VERIFICAR = text("SELECT o_filas, o_id_rota, o_motivo FROM bitacora_auditoria_verificar()")
SQL_PURGAR = text(
    "SELECT o_filas, o_hasta_id FROM bitacora_auditoria_purgar(:dias, :request_id)"
)

DESCRIPCION_MOTIVO = {
    "contenido_alterado": "La fila #{id} se modificó después de escribirse.",
    "eslabon_roto": (
        "La fila #{id} no enlaza con la anterior: falta una fila intermedia o "
        "la anterior fue alterada."
    ),
    "inicio_sin_ancla": (
        "La cadena empieza en la fila #{id} sin un ancla de purga que lo "
        "justifique: se borraron filas del comienzo por fuera de una purga."
    ),
}

# Cada celda de Excel admite hasta 32 767 caracteres.
_MAX_CELDA = 32_000


@dataclass(frozen=True)
class FiltrosBitacora:
    id_actor: int | None = None
    rol_actor: str | None = None
    accion: str | None = None
    entidad: str | None = None
    id_entidad: int | None = None
    request_id: str | None = None
    fecha_inicio: date | None = None
    fecha_fin: date | None = None


def _inicio_del_dia(dia: date):
    """Medianoche de ese día en la hora de la operación, como timestamptz."""
    return func.timezone(settings.TIMEZONE, literal(datetime.combine(dia, time.min)))


def _condiciones(filtros: FiltrosBitacora) -> list:
    if filtros.fecha_inicio and filtros.fecha_fin and filtros.fecha_inicio > filtros.fecha_fin:
        raise bad_request("La fecha de inicio no puede ser posterior a la fecha de fin.")

    b = BitacoraAuditoria
    condiciones = []
    if filtros.id_actor is not None:
        condiciones.append(b.id_actor == filtros.id_actor)
    if filtros.rol_actor:
        condiciones.append(b.rol_actor == filtros.rol_actor)
    if filtros.accion:
        condiciones.append(b.accion == filtros.accion)
    if filtros.entidad:
        condiciones.append(b.entidad == filtros.entidad)
    if filtros.id_entidad is not None:
        condiciones.append(b.id_entidad == filtros.id_entidad)
    if filtros.request_id:
        condiciones.append(b.request_id == filtros.request_id)
    if filtros.fecha_inicio:
        condiciones.append(b.fecha_hora >= _inicio_del_dia(filtros.fecha_inicio))
    if filtros.fecha_fin:
        condiciones.append(b.fecha_hora < _inicio_del_dia(filtros.fecha_fin + timedelta(days=1)))
    return condiciones


def _consulta_filas(condiciones):
    nombre = func.concat(Empleado.nombre, " ", Empleado.apellido)
    return (
        select(BitacoraAuditoria, nombre.label("nombre_actor"))
        .outerjoin(Empleado, Empleado.id_empleado == BitacoraAuditoria.id_actor)
        .where(*condiciones)
        .order_by(BitacoraAuditoria.id_bitacora.desc())
    )


def _serializar(fila: BitacoraAuditoria, nombre_actor: str | None) -> FilaBitacoraResponse:
    return FilaBitacoraResponse(
        id_bitacora=fila.id_bitacora,
        fecha_hora=fila.fecha_hora,
        id_actor=fila.id_actor,
        nombre_actor=nombre_actor if fila.id_actor is not None else None,
        rol_actor=fila.rol_actor,
        ip=str(fila.ip) if fila.ip is not None else None,
        request_id=fila.request_id,
        accion=fila.accion,
        entidad=fila.entidad,
        id_entidad=fila.id_entidad,
        cambios=fila.cambios,
        hash=fila.hash,
        hash_anterior=fila.hash_anterior,
    )


async def listar(
    db: AsyncSession, filtros: FiltrosBitacora, page: int, page_size: int
) -> tuple[int, int, list[FilaBitacoraResponse]]:
    """Página de la bitácora, de la más reciente a la más antigua."""
    condiciones = _condiciones(filtros)
    total = (
        await db.execute(
            select(func.count(BitacoraAuditoria.id_bitacora)).where(*condiciones)
        )
    ).scalar_one()
    resultado = await db.execute(
        _consulta_filas(condiciones).offset((page - 1) * page_size).limit(page_size)
    )
    items = [_serializar(fila, nombre) for fila, nombre in resultado.all()]
    return total, ceil(total / page_size) if total else 0, items


async def catalogos(db: AsyncSession) -> CatalogosBitacoraResponse:
    async def _distintos(columna):
        filas = await db.execute(
            select(columna).where(columna.is_not(None)).distinct().order_by(columna)
        )
        return list(filas.scalars().all())

    return CatalogosBitacoraResponse(
        acciones=await _distintos(BitacoraAuditoria.accion),
        entidades=await _distintos(BitacoraAuditoria.entidad),
        roles=await _distintos(BitacoraAuditoria.rol_actor),
    )


async def _estado_proteccion(db: AsyncSession) -> tuple[bool, str]:
    """
    ¿Puede la conexión del backend alterar la bitácora? Puede si es
    superusuario o si es (o actúa como) propietaria de la tabla: en ese caso
    la base no la detiene y solo queda la detección por la cadena.
    """
    fila = (
        await db.execute(
            text(
                """
                SELECT current_user AS usuario,
                       r.rolsuper AS es_super,
                       pg_has_role(current_user, c.relowner, 'MEMBER') AS es_dueno,
                       pg_get_userbyid(c.relowner) AS dueno
                  FROM pg_class c
                  JOIN pg_roles r ON r.rolname = current_user
                 WHERE c.oid = 'bitacora_auditoria'::regclass
                """
            )
        )
    ).one()
    if fila.es_super:
        return False, (
            f"El backend se conecta como superusuario («{fila.usuario}»): la base no "
            "puede impedirle alterar la bitácora y solo queda la detección por la "
            "cadena. Configura APP_DB_USER (rol de privilegio mínimo) y "
            "DATABASE_URL_MIGRACIONES; ver SEGURIDAD.md."
        )
    if fila.es_dueno:
        return False, (
            f"El backend («{fila.usuario}») es propietario de la bitácora: podría "
            "desactivar sus triggers. Las migraciones deben correr con otro usuario "
            "(DATABASE_URL_MIGRACIONES) y aplicarse backend/db/aplicar_rol_aplicacion.sql."
        )
    return True, (
        f"El backend se conecta como «{fila.usuario}» y la bitácora pertenece a "
        f"«{fila.dueno}»: solo puede insertar y leer, nunca modificar ni borrar."
    )


async def conexion_protegida(db: AsyncSession) -> tuple[bool, str]:
    """Lo mismo que muestra la pantalla de la bitácora, para la alerta de HU-S10-05."""
    return await _estado_proteccion(db)


async def verificar(db: AsyncSession) -> VerificacionBitacoraResponse:
    filas, id_rota, motivo = (await db.execute(SQL_VERIFICAR)).one()
    protegida, detalle = await _estado_proteccion(db)
    ancla = (
        await db.execute(
            select(BitacoraAncla).order_by(BitacoraAncla.id_ancla.desc()).limit(1)
        )
    ).scalar_one_or_none()

    if motivo is None:
        descripcion = f"Cadena íntegra: {filas} filas verificadas."
    else:
        descripcion = DESCRIPCION_MOTIVO.get(motivo, "La cadena no cuadra en la fila #{id}.").format(id=id_rota)

    return VerificacionBitacoraResponse(
        integra=motivo is None,
        filas=filas,
        id_rota=id_rota,
        motivo=motivo,
        descripcion=descripcion,
        protegida=protegida,
        detalle_proteccion=detalle,
        ultima_purga=(
            UltimaPurgaResponse(
                fecha_hora=ancla.fecha_hora,
                hasta_id_bitacora=ancla.hasta_id_bitacora,
                filas_purgadas=ancla.filas_purgadas,
                retencion_dias=ancla.retencion_dias,
            )
            if ancla
            else None
        ),
        verificada_en=datetime.now(timezone.utc),
    )


def _texto_filtros(filtros: FiltrosBitacora) -> str:
    partes = [
        f"{etiqueta}: {valor}"
        for etiqueta, valor in (
            ("Desde", filtros.fecha_inicio),
            ("Hasta", filtros.fecha_fin),
            ("Actor", filtros.id_actor),
            ("Rol", filtros.rol_actor),
            ("Acción", filtros.accion),
            ("Entidad", filtros.entidad),
            ("ID entidad", filtros.id_entidad),
            ("Request ID", filtros.request_id),
        )
        if valor not in (None, "")
    ]
    return " · ".join(partes) if partes else "Sin filtros"


async def exportar(db: AsyncSession, filtros: FiltrosBitacora) -> bytes:
    """XLSX con todas las filas del filtro (no solo la página visible)."""
    condiciones = _condiciones(filtros)
    total = (
        await db.execute(
            select(func.count(BitacoraAuditoria.id_bitacora)).where(*condiciones)
        )
    ).scalar_one()
    if total > MAX_FILAS_EXPORTAR_BITACORA:
        def miles(n: int) -> str:
            return f"{n:,}".replace(",", " ")

        raise bad_request(
            f"El filtro devuelve {miles(total)} filas y el máximo exportable es "
            f"{miles(MAX_FILAS_EXPORTAR_BITACORA)}. Acota el rango de fechas o los filtros."
        )

    resultado = await db.execute(_consulta_filas(condiciones))
    filas = []
    for fila, nombre in resultado.all():
        cambios = (
            json.dumps(fila.cambios, ensure_ascii=False, sort_keys=True)[:_MAX_CELDA]
            if fila.cambios is not None
            else ""
        )
        filas.append(
            (
                fila.id_bitacora,
                a_hora_local(fila.fecha_hora),
                (nombre if fila.id_actor is not None else None) or "",
                fila.id_actor,
                fila.rol_actor or "",
                str(fila.ip) if fila.ip is not None else "",
                fila.request_id or "",
                fila.accion,
                fila.entidad,
                fila.id_entidad,
                cambios,
                fila.hash,
            )
        )

    return generar_excel_tabla(
        titulo="Bitácora de auditoría — Teleprogreso S.A.",
        subtitulo=f"{_texto_filtros(filtros)} · {total} filas",
        nombre_hoja="Bitácora",
        encabezados=(
            "ID", "Fecha y hora", "Actor", "ID actor", "Rol", "IP", "Request ID",
            "Acción", "Entidad", "ID entidad", "Cambios", "Hash",
        ),
        filas=filas,
    )


def nombre_archivo(filtros: FiltrosBitacora) -> str:
    desde = filtros.fecha_inicio.isoformat() if filtros.fecha_inicio else "inicio"
    hasta = filtros.fecha_fin.isoformat() if filtros.fecha_fin else "hoy"
    return f"bitacora_{desde}_{hasta}.xlsx"


# --- Mantenimiento (síncrono: lo usa mantenimiento.py) ------------------------

def purgar_sync(conexion, retencion_dias: int, request_id: str | None) -> tuple[int, int | None]:
    """Borra lo anterior a la retención dejando un ancla. Solo el propietario puede."""
    filas, hasta = conexion.execute(
        SQL_PURGAR, {"dias": retencion_dias, "request_id": request_id}
    ).one()
    return filas, hasta


def verificar_sync(conexion) -> tuple[int, int | None, str | None]:
    filas, id_rota, motivo = conexion.execute(SQL_VERIFICAR).one()
    return filas, id_rota, motivo


# --- Ancla externa del final de la cadena (HU-S10-05, tarea 4) -----------------
# La cadena detecta filas alteradas, que faltan en medio y el comienzo borrado,
# pero no que un superusuario borre las ÚLTIMAS: la cadena que queda sigue
# cuadrando. `mantenimiento.py anclar` deja el id y el hash de la última fila
# fuera de la base (en el log), y `verificar-bitacora --ancla` comprueba que
# esa fila sigue ahí: si falta, borraron el final.

ANCLA_PRESENTE = "presente"
ANCLA_ALTERADA = "alterada"
ANCLA_PURGADA = "purgada"
ANCLA_FALTA = "falta"


def ultima_fila_sync(conexion) -> tuple[int, str, datetime] | None:
    """(id, hash, fecha_hora) de la última fila de la bitácora, o None si está vacía."""
    fila = conexion.execute(
        select(BitacoraAuditoria.id_bitacora, BitacoraAuditoria.hash, BitacoraAuditoria.fecha_hora)
        .order_by(BitacoraAuditoria.id_bitacora.desc())
        .limit(1)
    ).first()
    return tuple(fila) if fila else None


def comprobar_ancla_sync(conexion, id_bitacora: int, hash_esperado: str) -> str:
    """
    ¿Sigue en la bitácora la fila anclada, con el mismo hash?

    Devuelve ANCLA_PRESENTE, ANCLA_ALTERADA (la fila está pero su hash no es
    el anclado), ANCLA_PURGADA (la quitó la purga por retención: no es un
    ataque, hace falta un ancla más reciente) o ANCLA_FALTA (la borraron).
    """
    hash_actual = conexion.execute(
        select(BitacoraAuditoria.hash).where(BitacoraAuditoria.id_bitacora == id_bitacora)
    ).scalar_one_or_none()
    if hash_actual is not None:
        return ANCLA_PRESENTE if hash_actual == hash_esperado else ANCLA_ALTERADA
    purgada_hasta = conexion.execute(select(func.max(BitacoraAncla.hasta_id_bitacora))).scalar()
    if purgada_hasta is not None and id_bitacora <= purgada_hasta:
        return ANCLA_PURGADA
    return ANCLA_FALTA
