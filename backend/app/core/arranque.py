# backend/app/core/arranque.py
"""
Comprobaciones al arrancar el backend — Teleprogreso S.A. (HU-S10-06)
-----------------------------------------------------------------------------
La bitácora de auditoría solo es inmutable si el backend se conecta con un rol
que no puede alterarla: sin privilegios de superusuario y sin ser dueño de la
tabla (ver SEGURIDAD.md, capa 3). Hasta ahora, conectarse mal solo lo avisaba
la pantalla de la bitácora, y un despliegue podía quedarse así meses.

En producción, el backend ahora se niega a arrancar en ese caso: el despliegue
falla con un mensaje que dice qué hay que cambiar, en vez de quedar corriendo
sin protección. Si no puede ni comprobarlo (la base no responde), tampoco
arranca: lo seguro es no atender sin saberlo.

Fuera de producción no se comprueba nada: en desarrollo es normal conectarse
con el usuario de siempre.
-----------------------------------------------------------------------------
"""
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class ConexionNoSegura(RuntimeError):
    """El backend no debe atender peticiones con esta conexión."""


async def verificar_conexion_produccion(sesiones) -> None:
    """
    Lanza ConexionNoSegura si, en producción, la conexión puede alterar la
    bitácora o no se pudo comprobar. `sesiones` es una fábrica de AsyncSession.
    """
    if not settings.es_produccion:
        return

    # Import diferido: la auditoría arrastra modelos y schemas.
    from app.services.auditoria import conexion_protegida

    try:
        async with sesiones() as db:
            protegida, detalle = await conexion_protegida(db)
    except Exception as error:
        logger.critical("No se pudo comprobar la conexión a la base al arrancar: %s", error)
        raise ConexionNoSegura(
            "No se pudo comprobar con qué privilegios se conecta el backend a la "
            "base, así que no arranca. Revisa DATABASE_URL y que la base responda."
        ) from error

    if not protegida:
        logger.critical("Conexión a la base sin protección para la bitácora: %s", detalle)
        raise ConexionNoSegura(
            f"{detalle} En producción el backend no arranca así (HU-S10-06)."
        )
