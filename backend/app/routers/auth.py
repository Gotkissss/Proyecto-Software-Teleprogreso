"""
Router de autenticacion.

Rutas:
  POST /auth/login   -> valida credenciales y devuelve JWT
  POST /auth/logout  -> revoca el token activo del usuario
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado
from app.core.security import (
    create_access_token,
    revoke_token,
    verify_password,
)
from app.db.session import get_db
from app.models.empleado import Empleado
from app.schemas.auth import LoginRequest, TokenResponse

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
    body: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Recibe **correo** y **contraseña**.
    Devuelve un JWT Bearer si las credenciales son validas.
    """
    # 1. Buscar empleado por correo
    result = await db.execute(
        select(Empleado).where(Empleado.correo == body.correo)
    )
    empleado: Empleado | None = result.scalar_one_or_none()

    # 2. Validar existencia y contraseña (mismo mensaje para no dar pistas)
    if empleado is None or not verify_password(body.contrasena, empleado.hash_contrasena):
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
    _empleado: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Revoca el token JWT activo del usuario autenticado.
    Tras este llamado el token queda invalido aunque no haya expirado.
    """
    revoke_token(credentials.credentials)
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