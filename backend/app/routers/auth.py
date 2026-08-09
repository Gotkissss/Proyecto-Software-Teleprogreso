"""
Router de autenticacion.

Rutas:
  POST /auth/login   -> valida credenciales y devuelve JWT
  POST /auth/logout  -> revoca el token activo del usuario
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado
from app.core.rate_limit import (
    intentos_login,
    intentos_login_por_correo,
    ip_cliente,
    peticiones_login_por_ip,
)
from app.core.security import (
    consumir_tiempo_de_hash,
    create_access_token,
    decode_access_token,
    purgar_tokens_expirados,
    revoke_token,
    verify_password,
)
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.auth import LoginRequest, TokenResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Autenticación"])

bearer_scheme = HTTPBearer(auto_error=True)


# --- POST /auth/login -----------------------------------
@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Iniciar sesión",
    status_code=status.HTTP_200_OK,
)
async def login(
    request: Request,
    body: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Recibe **correo** y **contraseña**.
    Devuelve un JWT Bearer si las credenciales son validas.

    Este endpoint es la única puerta hacia los datos, así que está protegido
    contra fuerza bruta: tras varios fallos seguidos desde la misma IP contra
    el mismo correo, la combinación queda bloqueada un rato (ver
    LOGIN_MAX_INTENTOS y LOGIN_BLOQUEO_SEGUNDOS en la configuración).
    """
    ip = ip_cliente(request)
    correo_normalizado = body.correo.lower()
    # La clave junta IP y correo: bloquear solo por correo permitiría que un
    # atacante dejara fuera a un empleado real a base de fallar a propósito.
    clave_intentos = f"login:{ip}:{correo_normalizado}"
    # Segunda clave, solo por cuenta, para el caso de un ataque repartido entre
    # muchas IPs (ver comentarios en app/core/rate_limit.py).
    clave_cuenta = f"cuenta:{correo_normalizado}"

    # 0. ¿Está esta combinación castigada por intentos anteriores? ¿O esta IP
    #    está pidiendo verificaciones de contraseña más rápido de lo razonable?
    espera = (
        intentos_login.segundos_de_bloqueo(clave_intentos)
        or intentos_login_por_correo.segundos_de_bloqueo(clave_cuenta)
        or peticiones_login_por_ip.registrar(f"login-ip:{ip}")
    )
    if espera:
        logger.warning("Login bloqueado por exceso de intentos: %s desde %s", body.correo, ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Demasiados intentos fallidos. Vuelve a intentarlo en "
                f"{espera} segundos."
            ),
            headers={"Retry-After": str(espera)},
        )

    # 1. Buscar empleado por correo
    result = await db.execute(
        select(Empleado).where(Empleado.correo == body.correo)
    )
    empleado: Empleado | None = result.scalar_one_or_none()

    # 2. Validar existencia y contraseña (mismo mensaje para no dar pistas)
    # Las dos ramas van a un hilo aparte: bcrypt es CPU pura y unos 250 ms
    # dentro del bucle de eventos dejan al servidor sordo para TODAS las demás
    # peticiones mientras dura. En un hilo, el resto de la aplicación sigue
    # respondiendo aunque alguien esté martilleando el login.
    if empleado is None:
        # Sin este paso, un correo inexistente responde mucho más rápido que
        # uno real (no hay hash que verificar). Midiendo ese tiempo se puede
        # averiguar qué correos están registrados; se gasta el mismo esfuerzo
        # en los dos casos para que no se distingan.
        await run_in_threadpool(consumir_tiempo_de_hash)
        credenciales_validas = False
    else:
        credenciales_validas = await run_in_threadpool(
            verify_password, body.contrasena, empleado.hash_contrasena
        )

    if not credenciales_validas:
        bloqueo = intentos_login.registrar(clave_intentos)
        intentos_login_por_correo.registrar(clave_cuenta)
        logger.warning(
            "Credenciales inválidas para %s desde %s%s",
            body.correo, ip,
            f" — bloqueado {bloqueo}s" if bloqueo else "",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Verificar que la cuenta este activa
    if empleado.estado != "activo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La cuenta esta inactiva. Contacta al administrador.",
        )

    # 4. Generar JWT
    token = create_access_token(
        subject=empleado.id_empleado,
        rol=empleado.rol,
    )

    # Login correcto: se borra el historial de fallos de esta combinación para
    # que un usuario legítimo que se equivocó un par de veces no arrastre el
    # contador.
    intentos_login.limpiar(clave_intentos)
    intentos_login_por_correo.limpiar(clave_cuenta)
    logger.info("Login correcto de %s (rol %s) desde %s", empleado.correo, empleado.rol, ip)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        rol=empleado.rol,
        id_empleado=empleado.id_empleado,
        nombre=f"{empleado.nombre} {empleado.apellido}",
    )


# -------- POST /auth/logout --------------------------------
@router.post(
    "/logout",
    summary="Cerrar sesión",
    status_code=status.HTTP_200_OK,
)
async def logout(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
    _empleado: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Revoca el token JWT activo del usuario autenticado.
    Tras este llamado el token queda invalido aunque no haya expirado.

    La revocación se guarda en la tabla `token_revocado`, así que sobrevive a
    reinicios y la ven todos los workers del backend.
    """
    payload = decode_access_token(credentials.credentials)
    await revoke_token(db, payload)

    # Aprovecha el logout para barrer los tokens que ya expiraron solos: sin
    # esto la tabla solo crecería.
    await purgar_tokens_expirados(db)

    return {"detail": "Sesion cerrada correctamente"}


# ----------- GET /auth/me (utilidad de diagnóstico) ----------------------
@router.get(
    "/me",
    summary="Informacion del usuario autenticado",
    status_code=status.HTTP_200_OK,
)
async def me(
    empleado: Annotated[Empleado, Depends(get_current_empleado)],
):
    """Devuelve los datos basicos del empleado cuyo token esta activo."""
    return {
        "id_empleado": empleado.id_empleado,
        "nombre": f"{empleado.nombre} {empleado.apellido}",
        "correo": empleado.correo,
        "rol": empleado.rol,
        "estado": empleado.estado,
    }