"""
Utilidades de seguridad: hashing de contraseñas y JWT.
"""
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.token import TokenRevocado

# ── Hashing de contraseñas ─────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    """Devuelve el hash bcrypt de una contraseña en texto plano."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Compara la contraseña en texto plano con el hash almacenado."""
    return pwd_context.verify(plain, hashed)


# ── JWT ──────────────────────────────────────────────────────────────────────

def create_access_token(
    subject: int | str,
    rol: str,
    extra: dict[str, Any] | None = None,
) -> str:
    """
    Genera un JWT con los campos:
      - sub  : id del empleado (como str)
      - rol  : rol del empleado
      - jti  : identificador único del token, necesario para revocarlo
      - exp  : fecha de expiración
      - iat  : fecha de emisión
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: dict[str, Any] = {
        "sub": str(subject),
        "rol": rol,
        # Identificador propio del token. Se revoca por jti y no por la cadena
        # completa para no guardar credenciales utilizables en la base.
        "jti": uuid4().hex,
        "iat": now,
        "exp": expire,
    }
    if extra:
        payload.update(extra)

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decodifica y valida la firma y la vigencia del JWT.

    Lanza JWTError si el token es inválido o está expirado. La revocación NO
    se comprueba aquí: vive en la base de datos y esta función es síncrona.
    Para validar un token de una petición real usa `token_esta_revocado`, que
    es lo que hace la dependencia `get_current_empleado`.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


# ── Revocación (logout) ──────────────────────────────────────────────────────

async def token_esta_revocado(db: AsyncSession, payload: dict[str, Any]) -> bool:
    """True si el jti del payload figura en la tabla de tokens revocados."""
    jti = payload.get("jti")
    if not jti:
        # Tokens emitidos antes de que existiera el jti. Siguen siendo válidos
        # hasta que expiren por su cuenta; no hay forma de identificarlos.
        return False

    result = await db.execute(
        select(TokenRevocado.jti).where(TokenRevocado.jti == jti)
    )
    return result.scalar_one_or_none() is not None


async def revoke_token(db: AsyncSession, payload: dict[str, Any]) -> bool:
    """
    Marca el token como revocado. Devuelve False si el token no tiene jti y
    por tanto no se puede identificar.

    Es idempotente: repetir el logout con el mismo token no falla.
    """
    jti = payload.get("jti")
    if not jti:
        return False

    if await token_esta_revocado(db, payload):
        return True

    exp = payload.get("exp")
    expira = (
        datetime.fromtimestamp(exp, tz=timezone.utc).replace(tzinfo=None)
        if exp
        else datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    id_empleado = payload.get("sub")
    db.add(
        TokenRevocado(
            jti=jti,
            id_empleado=int(id_empleado) if id_empleado else None,
            expira=expira,
        )
    )
    await db.flush()
    return True


async def purgar_tokens_expirados(db: AsyncSession) -> int:
    """
    Borra las filas de tokens que ya expiraron por su cuenta.

    Se llama desde el logout: una vez pasada la expiración el registro no
    aporta nada y, sin esta purga, la tabla crecería indefinidamente.
    """
    result = await db.execute(
        delete(TokenRevocado).where(TokenRevocado.expira < datetime.utcnow())
    )
    return result.rowcount or 0