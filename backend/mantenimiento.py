"""
mantenimiento.py — Tareas de mantenimiento de datos de Teleprogreso S.A.
-----------------------------------------------------------------------------
Uso (desde backend/):

    python mantenimiento.py purgar               # retención de datos
    python mantenimiento.py verificar-bitacora   # integridad de la auditoría
    python mantenimiento.py alertas              # alertas operativas y de seguridad
    python mantenimiento.py anclar               # ancla externa del final de la bitácora
    python mantenimiento.py verificar-bitacora --ancla <id>:<hash>

`purgar` borra, cada uno en su propia transacción:

  1. Tokens revocados que ya expiraron (antes solo se purgaban cuando alguien
     hacía logout).
  2. Puntos GPS de los técnicos (`ubicacion_empleado`) más viejos que
     RETENCION_UBICACIONES_DIAS (90 por defecto).
  3. Filas de la bitácora más viejas que RETENCION_BITACORA_DIAS (90 por
     defecto), con bitacora_auditoria_purgar(): borra solo un prefijo de la
     cadena y deja un ancla para que la verificación siga cuadrando.

Cada purga que borra algo deja su fila en la bitácora (rol 'sistema', con un
request_id `mantenimiento-…` común a toda la ejecución).

Se conecta con DATABASE_URL_MIGRACIONES (el propietario del esquema) si está
definida: la bitácora solo la puede purgar su propietario, nunca el rol de la
app. Se ejecuta en cada arranque (servicio `migraciones` de docker-compose y
CMD del Dockerfile); para que la retención no dependa de los despliegues,
prográmalo además una vez al día (ver README, "Mantenimiento").

`verificar-bitacora` recorre la cadena completa y termina con código 1 si
está rota, indicando la primera fila que no cuadra y por qué.

`alertas` (HU-S10-05) corre la detección de alertas sin que nadie abra la
pantalla: las operativas (tareas vencidas, técnicos sin entrada, stock bajo)
y las de seguridad sobre la bitácora, incluida la cadena entera, que no se
revisa al abrir la pantalla porque es cara. Prográmalo cada 5 minutos (ver
README). Los fallos de auditoría y la conexión privilegiada se miran desde
el backend, que es el proceso que los conoce.

`anclar` (HU-S10-05) escribe en la salida el id y el hash de la última fila
de la bitácora. La salida queda en el log del servicio, fuera de la base, que
es lo que la hace útil: la cadena no detecta que un superusuario borre las
últimas filas, y `verificar-bitacora --ancla <id>:<hash>` sí, porque comprueba
que la fila anclada sigue ahí con el mismo hash. Prográmalo una vez al día.

Todos terminan con código 0 si todo fue bien y 1 si algo falló.
-----------------------------------------------------------------------------
"""
import asyncio
import sys
import uuid
from datetime import timedelta

from sqlalchemy import create_engine, delete
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import settings
from app.core.security import sentencia_purga_tokens
from app.core.tiempo import ahora as ahora_local
from app.models.ubicacion import UbicacionEmpleado
from app.services import auditoria
from app.services.alertas import generar_alertas
from app.services.alertas_seguridad import generar_alertas_seguridad
from app.services.bitacora import insertar, registro_sistema


def _motor():
    return create_engine(settings.url_migraciones, pool_pre_ping=True)


def _purgar_tokens(conexion, request_id: str) -> str:
    filas = conexion.execute(sentencia_purga_tokens()).rowcount or 0
    if filas:
        insertar(
            conexion,
            registro_sistema("purgar", "token_revocado", {"filas": filas, "criterio": "expirados"}, request_id),
        )
    return f"token_revocado: {filas} filas expiradas"


def _purgar_ubicaciones(conexion, request_id: str) -> str:
    dias = settings.RETENCION_UBICACIONES_DIAS
    # fecha_hora_registro se guarda en hora local sin zona (core/tiempo.py).
    limite = ahora_local() - timedelta(days=dias)
    filas = conexion.execute(
        delete(UbicacionEmpleado).where(UbicacionEmpleado.fecha_hora_registro < limite)
    ).rowcount or 0
    if filas:
        insertar(
            conexion,
            registro_sistema(
                "purgar",
                "ubicacion_empleado",
                {"filas": filas, "retencion_dias": dias, "antes_de": limite.isoformat()},
                request_id,
            ),
        )
    return f"ubicacion_empleado: {filas} puntos con más de {dias} días"


def _purgar_bitacora(conexion, request_id: str) -> str:
    dias = settings.RETENCION_BITACORA_DIAS
    filas, hasta = auditoria.purgar_sync(conexion, dias, request_id)
    detalle = f" (hasta la fila #{hasta}, ancla registrada)" if filas else ""
    return f"bitacora_auditoria: {filas} filas con más de {dias} días{detalle}"


def purgar() -> int:
    request_id = f"mantenimiento-{uuid.uuid4().hex[:16]}"
    motor = _motor()
    fallos = 0
    try:
        for paso in (_purgar_tokens, _purgar_ubicaciones, _purgar_bitacora):
            try:
                with motor.begin() as conexion:
                    print(f"[mantenimiento] {paso(conexion, request_id)}")
            except SQLAlchemyError as error:
                fallos += 1
                causa = getattr(error, "orig", error)
                print(f"[mantenimiento] ERROR en {paso.__name__}: {causa}", file=sys.stderr)
    finally:
        motor.dispose()
    return 1 if fallos else 0


def _leer_ancla(texto: str) -> tuple[int, str] | None:
    """'<id>:<hash>' → (id, hash), o None si no tiene esa forma."""
    id_texto, _, hash_ancla = texto.partition(":")
    if not id_texto.isdigit() or len(hash_ancla) != 64:
        return None
    try:
        int(hash_ancla, 16)
    except ValueError:
        return None
    return int(id_texto), hash_ancla.lower()


def verificar_bitacora(ancla: str | None = None) -> int:
    leida = None
    if ancla is not None:
        leida = _leer_ancla(ancla)
        if leida is None:
            print("[bitácora] El ancla tiene que ser <id>:<hash de 64 hex>.", file=sys.stderr)
            return 2

    motor = _motor()
    try:
        with motor.connect() as conexion:
            filas, id_rota, motivo = auditoria.verificar_sync(conexion)
            estado_ancla = auditoria.comprobar_ancla_sync(conexion, *leida) if leida else None
    finally:
        motor.dispose()

    codigo = 0
    if motivo is None:
        print(f"[bitácora] Cadena íntegra: {filas} filas verificadas.")
    else:
        descripcion = auditoria.DESCRIPCION_MOTIVO.get(motivo, "No cuadra en la fila #{id}.")
        print(f"[bitácora] CADENA ROTA ({motivo}): {descripcion.format(id=id_rota)}", file=sys.stderr)
        codigo = 1

    if leida:
        id_ancla = leida[0]
        if estado_ancla == auditoria.ANCLA_PRESENTE:
            print(f"[bitácora] Ancla #{id_ancla} presente: no falta ninguna fila hasta ahí.")
        elif estado_ancla == auditoria.ANCLA_PURGADA:
            print(
                f"[bitácora] La fila #{id_ancla} ya la quitó la purga por retención; "
                "compara con un ancla más reciente."
            )
        elif estado_ancla == auditoria.ANCLA_ALTERADA:
            print(f"[bitácora] ANCLA NO CUADRA: la fila #{id_ancla} cambió de hash.", file=sys.stderr)
            codigo = 1
        else:
            print(
                f"[bitácora] FALTAN FILAS: la fila #{id_ancla} del ancla ya no existe; "
                "borraron el final de la bitácora.",
                file=sys.stderr,
            )
            codigo = 1
    return codigo


def anclar() -> int:
    motor = _motor()
    try:
        with motor.connect() as conexion:
            ultima = auditoria.ultima_fila_sync(conexion)
    finally:
        motor.dispose()
    if ultima is None:
        print("[ancla-bitácora] La bitácora está vacía: no hay nada que anclar.")
        return 0
    id_bitacora, hash_fila, fecha = ultima
    print(f"[ancla-bitácora] id={id_bitacora} hash={hash_fila} fecha={fecha.isoformat()}")
    print(
        "[ancla-bitácora] Para comprobarla: python mantenimiento.py "
        f"verificar-bitacora --ancla {id_bitacora}:{hash_fila}"
    )
    return 0


async def _generar_alertas() -> int:
    motor = create_async_engine(settings.url_migraciones_async, pool_pre_ping=True)
    fallos = 0
    pasos = (
        ("operativas", generar_alertas),
        ("de seguridad", lambda db: generar_alertas_seguridad(db, verificar_cadena=True)),
    )
    try:
        # Cada detección en su propia transacción: si una falla, la otra se
        # guarda igual.
        for nombre, paso in pasos:
            async with AsyncSession(motor) as db:
                try:
                    creadas = await paso(db)
                    await db.commit()
                    print(f"[mantenimiento] alertas {nombre}: {creadas} nuevas")
                except SQLAlchemyError as error:
                    fallos += 1
                    await db.rollback()
                    causa = getattr(error, "orig", error)
                    print(f"[mantenimiento] ERROR en alertas {nombre}: {causa}", file=sys.stderr)
    finally:
        await motor.dispose()
    return 1 if fallos else 0


def alertas() -> int:
    return asyncio.run(_generar_alertas())


COMANDOS = {
    "purgar": purgar,
    "verificar-bitacora": verificar_bitacora,
    "alertas": alertas,
    "anclar": anclar,
}


def main(argumentos: list[str]) -> int:
    if not argumentos or argumentos[0] not in COMANDOS:
        return _uso()
    comando, resto = argumentos[0], argumentos[1:]
    if comando == "verificar-bitacora" and len(resto) == 2 and resto[0] == "--ancla":
        return verificar_bitacora(resto[1])
    if resto:
        return _uso()
    return COMANDOS[comando]()


def _uso() -> int:
    print(
        f"Uso: python mantenimiento.py [{' | '.join(COMANDOS)}]\n"
        "     python mantenimiento.py verificar-bitacora --ancla <id>:<hash>",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
