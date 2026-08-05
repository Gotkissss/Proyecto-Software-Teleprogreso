"""
Dependencias de FastAPI para autenticacion y autorizacion por rol.

Uso en endpoints:
    # Cualquier usuario autenticado
    @router.get("/ruta")
    async def mi_ruta(empleado = Depends(get_current_empleado)):
        ...

    # Solo admins
    @router.delete("/ruta")
    async def solo_admin(empleado = Depends(require_roles("admin"))):
        ...

    # Varios roles permitidos
    @router.post("/ruta")
    async def supervisores_y_admins(
        empleado = Depends(require_roles("admin", "supervisor"))
    ):
        ...
"""
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token, token_esta_revocado
from app.db.session import get_db
from app.models.empleado import Empleado

# Extrae el Bearer token del header Authorization
# auto_error=False para poder responder 401 (no 403) cuando falta el token
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_empleado(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Empleado:
    """
    Dependencia base: valida el JWT y devuelve el empleado autenticado.
    Lanza 401 si el token falta o es inválido/expirado/revocado.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise credentials_exception
    try:
        payload = decode_access_token(credentials.credentials)
        id_empleado: str | None = payload.get("sub")
        if id_empleado is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # La revocación se consulta en la BD (tabla token_revocado) y no en memoria
    # del proceso, para que un logout siga valiendo tras un redeploy y sea
    # visible desde cualquier worker.
    if await token_esta_revocado(db, payload):
        raise credentials_exception

    result = await db.execute(
        select(Empleado).where(Empleado.id_empleado == int(id_empleado))
    )
    empleado = result.scalar_one_or_none()

    if empleado is None:
        raise credentials_exception

    if empleado.estado != "activo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta de usuario inactiva",
        )

    return empleado


def require_roles(*roles: str):
    """
    fabrica de dependencias para proteger rutas por rol.

    Ejemplo:
        Depends(require_roles("admin", "gerente"))

    Roles disponibles: admin | supervisor | tecnico | gerente
    """
    async def _check(
        empleado: Annotated[Empleado, Depends(get_current_empleado)],
    ) -> Empleado:
        if empleado.rol not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Rol '{empleado.rol}' no tiene permiso para este recurso. "
                    f"Se requiere uno de: {', '.join(roles)}"
                ),
            )
        return empleado

    return _check


# --- Aliases de conveniencia ------
require_admin       = require_roles("admin")
require_supervisor  = require_roles("admin", "supervisor")
require_gerente     = require_roles("admin", "gerente")
require_tecnico     = require_roles("admin", "supervisor", "tecnico")
# Para vistas/endpoints de gestión visibles a roles administrativos
# (admin, supervisor y gerente). Pe. dashboards y métricas operativas.
require_admin_supervisor_gerente = require_roles("admin", "supervisor", "gerente")