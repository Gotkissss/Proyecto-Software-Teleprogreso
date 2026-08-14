# backend/tests/test_security.py
"""
Pruebas unitarias del módulo de seguridad — Teleprogreso S.A.
-------------------------------------------------------------
Verifica:
- Hashing de contraseñas (bcrypt)
- Creación y decodificación de tokens JWT
- Revocación de tokens (logout)

Se ejecutan con: pytest tests/ -v
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from jose import JWTError

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    purgar_tokens_expirados,
    revoke_token,
    token_esta_revocado,
    verify_password,
)


# 1. HASHING DE CONTRASEÑAS

def test_hash_password_no_guarda_texto_plano():
    """El hash generado nunca debe contener la contraseña original."""
    plain = "MiClaveSegura123"
    hashed = hash_password(plain)
    assert hashed != plain
    assert plain not in hashed
    assert hashed.startswith("$2b$")  # formato bcrypt


def test_verify_password_correcta():
    """La contraseña correcta debe validar contra su hash."""
    plain = "MiClaveSegura123"
    hashed = hash_password(plain)
    assert verify_password(plain, hashed) is True


def test_verify_password_incorrecta():
    """Una contraseña incorrecta no debe validar."""
    hashed = hash_password("MiClaveSegura123")
    assert verify_password("OtraClave456", hashed) is False


def test_hashes_distintos_para_misma_password():
    """bcrypt usa salt aleatorio: dos hashes de la misma clave difieren."""
    plain = "MiClaveSegura123"
    assert hash_password(plain) != hash_password(plain)


# 2. TOKENS JWT

def test_token_contiene_sub_y_rol():
    """El payload del JWT debe incluir sub (id) y rol del empleado."""
    token = create_access_token(subject=42, rol="supervisor")
    payload = decode_access_token(token)
    assert payload["sub"] == "42"
    assert payload["rol"] == "supervisor"
    assert "exp" in payload
    assert "iat" in payload


def test_token_con_campos_extra():
    """Los campos extra deben quedar incluidos en el payload."""
    token = create_access_token(subject=1, rol="admin", extra={"turno": "matutino"})
    payload = decode_access_token(token)
    assert payload["turno"] == "matutino"


def test_decode_token_invalido_lanza_error():
    """Un token malformado debe lanzar JWTError."""
    with pytest.raises(JWTError):
        decode_access_token("esto.no.es_un_jwt")


def test_token_incluye_jti_unico():
    """Sin jti no hay forma de revocar un token concreto."""
    payload_a = decode_access_token(create_access_token(subject=1, rol="admin"))
    payload_b = decode_access_token(create_access_token(subject=1, rol="admin"))

    assert payload_a["jti"]
    assert payload_a["jti"] != payload_b["jti"]


# 3. REVOCACIÓN (LOGOUT)
#
# La revocación vive en la tabla token_revocado, así que la sesión se simula:
# lo que se comprueba aquí es que se consulte e inserte por jti, no el
# comportamiento de PostgreSQL.

def _db(existe_jti=False):
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = "jti-existente" if existe_jti else None
    resultado.rowcount = 3

    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_token_sin_revocar_pasa():
    db = _db(existe_jti=False)
    payload = decode_access_token(create_access_token(subject=7, rol="tecnico"))

    assert await token_esta_revocado(db, payload) is False


@pytest.mark.asyncio
async def test_token_revocado_es_rechazado():
    db = _db(existe_jti=True)
    payload = decode_access_token(create_access_token(subject=7, rol="tecnico"))

    assert await token_esta_revocado(db, payload) is True


@pytest.mark.asyncio
async def test_revocar_guarda_el_jti_y_su_expiracion():
    db = _db(existe_jti=False)
    payload = decode_access_token(create_access_token(subject=7, rol="tecnico"))

    assert await revoke_token(db, payload) is True

    fila = db.add.call_args.args[0]
    assert fila.jti == payload["jti"]
    assert fila.id_empleado == 7
    # La fila deja de tener sentido cuando el token expira por su cuenta.
    assert fila.expira > datetime.utcnow()


@pytest.mark.asyncio
async def test_revocar_dos_veces_no_duplica():
    """El logout repetido con el mismo token no debe insertar otra fila."""
    db = _db(existe_jti=True)
    payload = decode_access_token(create_access_token(subject=7, rol="tecnico"))

    assert await revoke_token(db, payload) is True
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_token_antiguo_sin_jti_no_se_puede_revocar():
    """Los tokens emitidos antes del jti siguen valiendo hasta expirar."""
    db = _db()

    assert await revoke_token(db, {"sub": "7"}) is False
    assert await token_esta_revocado(db, {"sub": "7"}) is False
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_purga_borra_los_tokens_ya_expirados():
    """Sin purga la tabla de revocados solo crecería."""
    db = _db()

    assert await purgar_tokens_expirados(db) == 3

    sql = str(db.execute.await_args.args[0])
    assert "DELETE FROM token_revocado" in sql
