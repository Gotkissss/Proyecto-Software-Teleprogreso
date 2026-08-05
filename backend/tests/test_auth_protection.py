# backend/tests/test_auth_protection.py
"""
Pruebas de endpoints protegidos — Teleprogreso S.A.
-------
Verifica:
Sin token = 401
Token invalido = 401
Token expirado = 401
Control de roles = 403
Token valido = acceso permitido
Cuenta inactiva = 403

Nota: para simular la base de datos se usa app.dependency_overrides
(la forma correcta en FastAPI). unittest.mock.patch sobre get_db no
funciona porque FastAPI captura la referencia original al declararla
como Depends(...).
"""

from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.main import app
from app.core.security import create_access_token
from app.db.session import get_db

client = TestClient(app, raise_server_exceptions=False)


# Helpers para generar tokens y simular empleados

def make_token(rol="tecnico"):
    return create_access_token(subject=1, rol=rol)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def mock_empleado(rol="tecnico", estado="activo"):
    emp = MagicMock()
    emp.id_empleado = 1
    emp.nombre = "Test"
    emp.apellido = "User"
    emp.correo = "test@teleprogreso.com"
    emp.rol = rol
    emp.estado = estado
    return emp


def override_db_con_empleado(empleado, token_revocado=False):
    """
    Dependencia get_db falsa cuyo execute() encuentra al empleado.

    Distingue la consulta por tabla: `get_current_empleado` lanza dos, primero
    la de tokens revocados y luego la del empleado. Devolver el empleado a las
    dos hacía que el token pareciera revocado siempre y todo respondiera 401.
    """
    async def _fake_db():
        db = AsyncMock()

        async def _execute(statement, *args, **kwargs):
            result = MagicMock()
            if "token_revocado" in str(statement):
                result.scalar_one_or_none.return_value = (
                    "jti-revocado" if token_revocado else None
                )
            else:
                result.scalar_one_or_none.return_value = empleado
            return result

        db.execute = AsyncMock(side_effect=_execute)
        yield db
    return _fake_db


# 1. SIN TOKEN = 401

def test_sin_token_asistencia():
    res = client.post("/asistencia/entrada")
    assert res.status_code == 401


def test_sin_token_tareas():
    res = client.get("/tareas/")
    assert res.status_code == 401


# 2. TOKEN INVALIDO = 401

def test_token_invalido():
    res = client.get(
        "/tareas/",
        headers={"Authorization": "Bearer token_invalido"},
    )
    assert res.status_code == 401


# 3. TOKEN EXPIRADO = 401

def test_token_expirado():
    from unittest.mock import patch
    with patch("app.core.security.settings") as mock_settings:
        mock_settings.ACCESS_TOKEN_EXPIRE_MINUTES = -1
        mock_settings.SECRET_KEY = "test"
        mock_settings.ALGORITHM = "HS256"
        expired_token = create_access_token(subject=1, rol="tecnico")

    res = client.get("/auth/me", headers=auth(expired_token))
    assert res.status_code == 401


# 4. CONTROL DE ROL = 403

def test_tecnico_no_puede_crear_tarea():
    app.dependency_overrides[get_db] = override_db_con_empleado(mock_empleado("tecnico"))
    try:
        res = client.post(
            "/tareas/",
            headers=auth(make_token("tecnico")),
            json={"nombre": "Test", "prioridad": "media"},
        )
        assert res.status_code == 403
    finally:
        app.dependency_overrides.clear()


# 5. TOKEN VALIDO = 200

def test_token_valido_acceso():
    app.dependency_overrides[get_db] = override_db_con_empleado(mock_empleado("tecnico"))
    try:
        res = client.get("/auth/me", headers=auth(make_token("tecnico")))
        assert res.status_code == 200
        assert res.json()["rol"] == "tecnico"
    finally:
        app.dependency_overrides.clear()


# 6. TOKEN REVOCADO (LOGOUT) = 401

def test_token_revocado_no_da_acceso():
    """Un token con logout hecho debe rebotar aunque no haya expirado."""
    app.dependency_overrides[get_db] = override_db_con_empleado(
        mock_empleado("tecnico"), token_revocado=True
    )
    try:
        res = client.get("/auth/me", headers=auth(make_token("tecnico")))
        assert res.status_code == 401
    finally:
        app.dependency_overrides.clear()


# 7. CUENTA INACTIVA = 403

def test_cuenta_inactiva():
    app.dependency_overrides[get_db] = override_db_con_empleado(
        mock_empleado("tecnico", estado="inactivo")
    )
    try:
        res = client.get("/auth/me", headers=auth(make_token("tecnico")))
        assert res.status_code == 403
    finally:
        app.dependency_overrides.clear()
