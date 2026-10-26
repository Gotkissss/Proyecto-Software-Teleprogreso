"""
Alertas de seguridad sobre la bitácora — Teleprogreso S.A. (HU-S10-05)
-----------------------------------------------------------------------------
La bitácora registra todo (login fallido, bloqueos, 403, cambios de cuentas),
pero hasta ahora nadie la leía: un ataque de fuerza bruta solo se descubría si
el admin abría la bitácora y lo buscaba. Estas reglas la leen y dejan una
alerta que solo ve el admin, en la misma tabla y pantalla que las operativas.

Reglas (umbrales en core/reglas.py):

  a. Fuerza bruta: UMBRAL_LOGIN_FALLIDO intentos fallidos contra un mismo
     correo, o desde una misma IP, en MINUTOS_VENTANA_SEGURIDAD.
  b. Cuenta bloqueada por el límite de intentos (`login_bloqueado`).
  c. UMBRAL_ACCESO_DENEGADO respuestas 403 a un mismo actor en la ventana:
     alguien probando URLs que su rol no puede abrir.
  d. Cuenta de admin tocada por otra persona: contraseña restablecida, rol
     cambiado a admin o admin nuevo. Cambiarse la propia no avisa.
  e. Cadena de la bitácora rota (verificar_cadena=True). Recorre la tabla
     entera, así que solo la pide el comando programado, no cada pantalla.
  f. Fallos al guardar eventos de auditoría. El contador vive en memoria del
     proceso del backend (services/bitacora.fallos_auditoria), así que solo
     se evalúa desde ese proceso.
  g. Backend conectado como superusuario o dueño de la bitácora en
     producción. Igual que (f): tiene que mirar la conexión del backend, no la
     del comando programado, que es la del propietario a propósito.

Una alerta por regla, referencia y día (el índice único de la tabla), igual
que las operativas: si sigue pasando, se vuelve a levantar al día siguiente.
-----------------------------------------------------------------------------
"""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.reglas import (
    MINUTOS_SOLAPE_SEGURIDAD,
    MINUTOS_VENTANA_SEGURIDAD,
    ROL_ADMIN,
    UMBRAL_ACCESO_DENEGADO,
    UMBRAL_LOGIN_FALLIDO,
)
from app.core.tiempo import ahora as ahora_local, hoy as hoy_local
from app.models.alerta import Alerta
from app.models.bitacora import BitacoraAuditoria
from app.models.empleado import Empleado
from app.services import auditoria
from app.services.alertas import (
    _agregar_alerta_si_nueva,
    _obtener_referencias_existentes,
    insertar_alertas,
)

TIPO_LOGIN_FALLIDO = "seguridad_login_fallido"
TIPO_LOGIN_BLOQUEADO = "seguridad_login_bloqueado"
TIPO_ACCESO_DENEGADO = "seguridad_acceso_denegado"
TIPO_CUENTA_ADMIN = "seguridad_cuenta_admin"
TIPO_BITACORA_ROTA = "seguridad_bitacora_rota"
TIPO_AUDITORIA_FALLIDA = "seguridad_auditoria_fallida"
TIPO_CONEXION_PRIVILEGIADA = "seguridad_conexion_privilegiada"

# Lo que cabe en alerta.referencia.
_MAX_REFERENCIA = 255


def _referencia(entidad: str, valor) -> str:
    return f"{entidad}:{valor}"[:_MAX_REFERENCIA]


def _momentos(ahora_utc: datetime | None = None) -> tuple[datetime, datetime]:
    """
    (desde_ventana, desde_dia), con zona horaria para comparar con
    bitacora_auditoria.fecha_hora. `desde_dia` es el comienzo del día local o
    MINUTOS_SOLAPE_SEGURIDAD atrás, lo que sea antes.
    """
    ahora_utc = ahora_utc or datetime.now(timezone.utc)
    desde_ventana = ahora_utc - timedelta(minutes=MINUTOS_VENTANA_SEGURIDAD)
    transcurrido_hoy = ahora_local() - datetime.combine(hoy_local(), time.min)
    desde_dia = min(
        ahora_utc - transcurrido_hoy,
        ahora_utc - timedelta(minutes=MINUTOS_SOLAPE_SEGURIDAD),
    )
    return desde_ventana, desde_dia


async def _fuerza_bruta(db: AsyncSession, desde: datetime) -> list[tuple[str, str]]:
    correo = BitacoraAuditoria.cambios["correo"].astext
    por_correo = await db.execute(
        select(correo)
        .where(
            BitacoraAuditoria.accion == "login_fallido",
            BitacoraAuditoria.fecha_hora >= desde,
            correo.is_not(None),
        )
        .group_by(correo)
        .having(func.count() >= UMBRAL_LOGIN_FALLIDO)
    )
    ip = func.host(BitacoraAuditoria.ip)
    por_ip = await db.execute(
        select(ip)
        .where(
            BitacoraAuditoria.accion == "login_fallido",
            BitacoraAuditoria.fecha_hora >= desde,
            BitacoraAuditoria.ip.is_not(None),
        )
        .group_by(ip)
        .having(func.count() >= UMBRAL_LOGIN_FALLIDO)
    )
    return [_referencia("correo", c) for (c,) in por_correo.all()] + [
        _referencia("ip", i) for (i,) in por_ip.all()
    ]


async def _cuentas_bloqueadas(db: AsyncSession, desde: datetime) -> list[str]:
    correo = BitacoraAuditoria.cambios["correo"].astext
    resultado = await db.execute(
        select(correo)
        .where(
            BitacoraAuditoria.accion == "login_bloqueado",
            BitacoraAuditoria.fecha_hora >= desde,
            correo.is_not(None),
        )
        .distinct()
    )
    return [_referencia("correo", c) for (c,) in resultado.all()]


async def _accesos_denegados(db: AsyncSession, desde: datetime) -> list[str]:
    resultado = await db.execute(
        select(BitacoraAuditoria.id_actor)
        .where(
            BitacoraAuditoria.accion == "acceso_denegado",
            BitacoraAuditoria.fecha_hora >= desde,
            BitacoraAuditoria.id_actor.is_not(None),
        )
        .group_by(BitacoraAuditoria.id_actor)
        .having(func.count() >= UMBRAL_ACCESO_DENEGADO)
    )
    return [_referencia("empleado", i) for (i,) in resultado.all()]


async def _cuentas_admin(db: AsyncSession, desde: datetime) -> list[str]:
    cambios = BitacoraAuditoria.cambios
    sobre_empleado = and_(
        BitacoraAuditoria.entidad == "empleado",
        BitacoraAuditoria.fecha_hora >= desde,
        BitacoraAuditoria.id_entidad.is_not(None),
    )
    # Otra persona le puso contraseña a una cuenta que hoy es de admin. La
    # propia, cambiada en /auth/cambiar-contrasena, no es un aviso.
    restablecidas = (
        select(BitacoraAuditoria.id_entidad)
        .join(Empleado, Empleado.id_empleado == BitacoraAuditoria.id_entidad)
        .where(
            sobre_empleado,
            BitacoraAuditoria.accion == "actualizar",
            cambios.has_key("hash_contrasena"),
            Empleado.rol == ROL_ADMIN,
            or_(
                BitacoraAuditoria.id_actor.is_(None),
                BitacoraAuditoria.id_actor != BitacoraAuditoria.id_entidad,
            ),
        )
    )
    # Alguien pasó a ser admin: por cambio de rol o porque se creó así.
    nuevos_admin = select(BitacoraAuditoria.id_entidad).where(
        sobre_empleado,
        or_(
            and_(
                BitacoraAuditoria.accion == "actualizar",
                cambios["rol"]["despues"].astext == ROL_ADMIN,
            ),
            and_(
                BitacoraAuditoria.accion == "crear",
                cambios["rol"].astext == ROL_ADMIN,
            ),
        ),
    )
    resultado = await db.execute(restablecidas.union(nuevos_admin))
    return [_referencia("empleado", i) for (i,) in resultado.all()]


async def _cadena_rota(db: AsyncSession) -> list[str]:
    _, id_rota, motivo = (await db.execute(auditoria.SQL_VERIFICAR)).one()
    if motivo is None:
        return []
    return [_referencia("bitacora", id_rota if id_rota is not None else motivo)]


def _auditoria_fallida(fallos: dict, desde: datetime) -> list[str]:
    ultimo = fallos.get("ultimo")
    if not fallos.get("total") or ultimo is None:
        return []
    if datetime.fromtimestamp(ultimo, timezone.utc) < desde:
        return []
    return [_referencia("proceso", "auditoria")]


async def _conexion_privilegiada(db: AsyncSession) -> list[str]:
    if not settings.es_produccion:
        return []
    protegida, _ = await auditoria.conexion_protegida(db)
    if protegida:
        return []
    usuario = (await db.execute(select(func.current_user()))).scalar_one()
    return [_referencia("bd", usuario)]


async def generar_alertas_seguridad(
    db: AsyncSession,
    *,
    verificar_cadena: bool = False,
    fallos: dict | None = None,
    revisar_conexion: bool = False,
    ahora_utc: datetime | None = None,
) -> int:
    """
    Corre las reglas y guarda las alertas nuevas. Devuelve cuántas creó.

    Las reglas (a) a (d) leen la bitácora y corren siempre. Las otras tres se
    piden: `verificar_cadena` (e) desde el comando programado, `fallos` (f) y
    `revisar_conexion` (g) desde el proceso del backend.
    """
    desde_ventana, desde_dia = _momentos(ahora_utc)

    detectadas: list[tuple[str, str, str]] = []
    detectadas += [(TIPO_LOGIN_FALLIDO, "critica", r) for r in await _fuerza_bruta(db, desde_ventana)]
    detectadas += [(TIPO_LOGIN_BLOQUEADO, "advertencia", r) for r in await _cuentas_bloqueadas(db, desde_dia)]
    detectadas += [(TIPO_ACCESO_DENEGADO, "advertencia", r) for r in await _accesos_denegados(db, desde_ventana)]
    detectadas += [(TIPO_CUENTA_ADMIN, "critica", r) for r in await _cuentas_admin(db, desde_dia)]
    if verificar_cadena:
        detectadas += [(TIPO_BITACORA_ROTA, "critica", r) for r in await _cadena_rota(db)]
    if fallos is not None:
        detectadas += [(TIPO_AUDITORIA_FALLIDA, "critica", r) for r in _auditoria_fallida(fallos, desde_dia)]
    if revisar_conexion:
        detectadas += [(TIPO_CONEXION_PRIVILEGIADA, "critica", r) for r in await _conexion_privilegiada(db)]

    if not detectadas:
        return 0

    existentes = await _obtener_referencias_existentes(db, hoy_local())
    nuevas: list[Alerta] = []
    for tipo, severidad, referencia in detectadas:
        _agregar_alerta_si_nueva(
            nuevas, existentes, tipo=tipo, severidad=severidad, referencia=referencia
        )
    await insertar_alertas(db, nuevas)
    return len(nuevas)
