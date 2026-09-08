"""Pruebas de perfil y cambio de contraseña para cualquier rol."""

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core import deps
from app.core.deps import get_current_empleado
from app.core.exceptions import register_exception_handlers
from app.core.security import create_access_token
from app.db.session import get_db
from app.routers import auth
from app.schemas.auth import CambiarContrasenaRequest, LoginRequest


def _empleado(rol="tecnico", version_token=0):
    return SimpleNamespace(
        id_empleado=7,
        nombre="Ana",
        apellido="López",
        correo="ana@teleprogreso.com",
        rol=rol,
        estado="activo",
        telefono="5555-0101",
        fecha_contratacion=date(2025, 1, 15),
        fecha_registro=datetime(2025, 1, 10, 8, 30),
        ultimo_acceso=None,
        hash_contrasena="hash-anterior",
        version_token=version_token,
    )


def _app(empleado, db=None):
    aplicacion = FastAPI()
    aplicacion.include_router(auth.router)
    register_exception_handlers(aplicacion)
    db = db or AsyncMock()

    async def usuario_actual():
        return empleado

    async def db_simulada():
        yield db

    aplicacion.dependency_overrides[get_current_empleado] = usuario_actual
    aplicacion.dependency_overrides[get_db] = db_simulada
    return aplicacion


async def _request(aplicacion, method, url, **kwargs):
    transport = ASGITransport(app=aplicacion)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        return await client.request(method, url, **kwargs)


def _db_para_autenticacion(empleado):
    resultado_revocacion = MagicMock()
    resultado_revocacion.scalar_one_or_none.return_value = None
    resultado_empleado = MagicMock()
    resultado_empleado.scalar_one_or_none.return_value = empleado

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[resultado_revocacion, resultado_empleado]
    )
    return db


async def _ejecutar_sin_hilo(funcion, *argumentos):
    """Sustituye solo el salto de hilo; conserva la función que se prueba."""
    return funcion(*argumentos)


@pytest.mark.asyncio
async def test_login_emite_la_version_actual_del_empleado(monkeypatch):
    empleado = _empleado(version_token=5)
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = empleado
    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    crear_token = MagicMock(return_value="jwt-de-prueba")
    monkeypatch.setattr(auth, "run_in_threadpool", _ejecutar_sin_hilo)
    monkeypatch.setattr(auth, "verify_password", lambda _plain, _hash: True)
    monkeypatch.setattr(auth, "create_access_token", crear_token)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/login",
            "headers": [],
            "query_string": b"",
            "server": ("test", 80),
            "client": ("127.0.0.1", 50000),
            "scheme": "http",
        }
    )

    response = await auth.login(
        request,
        LoginRequest(
            correo="ana@teleprogreso.com",
            contrasena="clave-anterior",
        ),
        db,
    )

    crear_token.assert_called_once_with(
        subject=7,
        rol="tecnico",
        version_token=5,
    )
    assert response.access_token == "jwt-de-prueba"


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["admin", "supervisor", "tecnico", "gerente"])
async def test_perfil_esta_disponible_para_cualquier_rol(rol):
    response = await _request(_app(_empleado(rol)), "GET", "/auth/perfil")

    assert response.status_code == 200
    assert response.json() == {
        "id_empleado": 7,
        "nombre": "Ana",
        "apellido": "López",
        "correo": "ana@teleprogreso.com",
        "rol": rol,
        "estado": "activo",
        "telefono": "5555-0101",
        "fecha_contratacion": "2025-01-15",
        "fecha_registro": "2025-01-10T08:30:00",
        "ultimo_acceso": None,
    }
    assert "hash_contrasena" not in response.json()
    assert "version_token" not in response.json()


def test_cambio_rechaza_una_contrasena_nueva_corta():
    with pytest.raises(ValidationError):
        CambiarContrasenaRequest(
            contrasena_actual="clave-anterior",
            nueva_contrasena="corta",
            confirmacion_contrasena="corta",
        )


def test_cambio_rechaza_confirmacion_distinta():
    with pytest.raises(ValidationError):
        CambiarContrasenaRequest(
            contrasena_actual="clave-anterior",
            nueva_contrasena="clave-nueva-1",
            confirmacion_contrasena="clave-nueva-2",
        )


@pytest.mark.asyncio
async def test_cambio_rechaza_la_contrasena_actual_incorrecta(monkeypatch):
    empleado = _empleado()
    db = AsyncMock()
    monkeypatch.setattr(auth, "run_in_threadpool", _ejecutar_sin_hilo)
    monkeypatch.setattr(auth, "verify_password", lambda _plain, _hash: False)

    response = await _request(
        _app(empleado, db),
        "POST",
        "/auth/cambiar-contrasena",
        json={
            "contrasena_actual": "clave-equivocada",
            "nueva_contrasena": "clave-nueva-1",
            "confirmacion_contrasena": "clave-nueva-1",
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "error": "BAD_REQUEST",
        "detail": "La contraseña actual es incorrecta.",
        "status_code": 400,
    }
    assert empleado.hash_contrasena == "hash-anterior"
    assert empleado.version_token == 0
    db.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_cambio_rechaza_reutilizar_la_contrasena_actual(monkeypatch):
    empleado = _empleado()
    db = AsyncMock()
    monkeypatch.setattr(auth, "run_in_threadpool", _ejecutar_sin_hilo)
    monkeypatch.setattr(auth, "verify_password", lambda _plain, _hash: True)

    response = await _request(
        _app(empleado, db),
        "POST",
        "/auth/cambiar-contrasena",
        json={
            "contrasena_actual": "clave-repetida",
            "nueva_contrasena": "clave-repetida",
            "confirmacion_contrasena": "clave-repetida",
        },
    )

    assert response.status_code == 400
    assert empleado.hash_contrasena == "hash-anterior"
    assert empleado.version_token == 0
    db.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_cambio_actualiza_hash_e_invalida_el_token_anterior(monkeypatch):
    empleado = _empleado(version_token=2)
    token_anterior = create_access_token(
        subject=empleado.id_empleado,
        rol=empleado.rol,
        version_token=empleado.version_token,
    )
    db_cambio = AsyncMock()
    monkeypatch.setattr(auth, "run_in_threadpool", _ejecutar_sin_hilo)
    monkeypatch.setattr(auth, "verify_password", lambda _plain, _hash: True)
    monkeypatch.setattr(auth, "hash_password", lambda _plain: "hash-nuevo")

    response = await _request(
        _app(empleado, db_cambio),
        "POST",
        "/auth/cambiar-contrasena",
        json={
            "contrasena_actual": "clave-anterior",
            "nueva_contrasena": "clave-nueva-1",
            "confirmacion_contrasena": "clave-nueva-1",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "detail": "Contraseña actualizada correctamente. Inicia sesión nuevamente."
    }
    assert empleado.hash_contrasena == "hash-nuevo"
    assert empleado.version_token == 3
    db_cambio.flush.assert_awaited_once()

    credenciales_anteriores = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials=token_anterior,
    )
    with pytest.raises(HTTPException) as error:
        await get_current_empleado(
            credenciales_anteriores,
            _db_para_autenticacion(empleado),
        )
    assert error.value.status_code == 401

    token_nuevo = create_access_token(
        subject=empleado.id_empleado,
        rol=empleado.rol,
        version_token=empleado.version_token,
    )
    credenciales_nuevas = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials=token_nuevo,
    )
    autenticado = await get_current_empleado(
        credenciales_nuevas,
        _db_para_autenticacion(empleado),
    )
    assert autenticado is empleado


@pytest.mark.asyncio
async def test_token_legacy_solo_es_valido_mientras_la_version_es_cero(
    monkeypatch,
):
    """Mantiene sesiones existentes hasta que el usuario cambie su clave."""
    monkeypatch.setattr(
        deps,
        "decode_access_token",
        lambda _token: {"sub": "7", "jti": "token-anterior"},
    )
    credenciales = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials="token-sin-version",
    )
    empleado = _empleado(version_token=0)

    autenticado = await get_current_empleado(
        credenciales,
        _db_para_autenticacion(empleado),
    )
    assert autenticado is empleado

    empleado.version_token = 1
    with pytest.raises(HTTPException) as error:
        await get_current_empleado(
            credenciales,
            _db_para_autenticacion(empleado),
        )
    assert error.value.status_code == 401
