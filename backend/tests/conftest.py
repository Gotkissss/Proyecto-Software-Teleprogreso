# backend/tests/conftest.py
"""
Confi global de pytest para los tests de Teleprogreso S.A.
-----------------------------------------------------------
Define fixtures compartidas y la confi de pytest-asyncio.

se usa de la sigueinte manera : pytest tests/ -v
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from app.main import app
from app.core.security import create_access_token



# Bitácora: los eventos sin fila (login fallido, 403, lecturas...) se guardan
# en su propia conexión al terminar cada petición. En los tests se recogen en
# esta lista en vez de ir a la BD; pedir el fixture permite revisarlos.

@pytest.fixture(autouse=True)
def eventos_bitacora(monkeypatch):
    guardados = []

    async def _guardar(eventos):
        guardados.extend(eventos)

    monkeypatch.setattr("app.services.bitacora.guardar_eventos", _guardar)
    return guardados



# Cliente HTTP de prueba

@pytest.fixture(scope="session")
def test_client():
    """
    Cliente HTTP sincrónico para pruebas.
    scope="session" → se crea una sola vez por sesión de pytest.
    """
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c



# Tokens JWT de prueba por rol

@pytest.fixture
def token_tecnico():
    """Token JWT válido con rol 'tecnico'."""
    return create_access_token(subject=1, rol="tecnico")


@pytest.fixture
def token_supervisor():
    """Token JWT válido con rol 'supervisor'."""
    return create_access_token(subject=2, rol="supervisor")


@pytest.fixture
def token_admin():
    """Token JWT válido con rol 'admin'."""
    return create_access_token(subject=3, rol="admin")


@pytest.fixture
def token_gerente():
    """Token JWT válido con rol 'gerente'."""
    return create_access_token(subject=4, rol="gerente")



# Empleados mock por rol


def _make_empleado(id_empleado: int, rol: str, estado: str = "activo") -> MagicMock: # Crea un empleado mock con los atributos necesarios para las pruebas.
    emp = MagicMock()
    emp.id_empleado = id_empleado
    emp.nombre = "Empleado"
    emp.apellido = "Prueba"
    emp.correo = f"{rol}@teleprogreso.com"
    emp.rol = rol
    emp.estado = estado
    return emp


@pytest.fixture
def empleado_tecnico():
    return _make_empleado(id_empleado=1, rol="tecnico")


@pytest.fixture
def empleado_supervisor():
    return _make_empleado(id_empleado=2, rol="supervisor")


@pytest.fixture
def empleado_admin():
    return _make_empleado(id_empleado=3, rol="admin")


@pytest.fixture
def empleado_inactivo():
    return _make_empleado(id_empleado=99, rol="tecnico", estado="inactivo")