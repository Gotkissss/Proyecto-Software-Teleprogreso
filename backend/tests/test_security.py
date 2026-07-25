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

import pytest
from jose import JWTError

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    revoke_token,
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


# 3. REVOCACIÓN (LOGOUT)

def test_token_revocado_no_es_valido():
    """Después del logout, el token revocado debe ser rechazado."""
    token = create_access_token(subject=7, rol="tecnico")
    decode_access_token(token)  # antes de revocar: válido
    revoke_token(token)
    with pytest.raises(JWTError):
        decode_access_token(token)
