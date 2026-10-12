import pytest

from tests.soporte_bd import (  # noqa: F401
    cliente,
    gerente,
    hash_contrasena_prueba,
    jornada_abierta_a,
    proteccion_bd,
    siembra,
    supervisor,
    tecnico_a,
    tecnico_b,
)


@pytest.fixture(autouse=True)
def eventos_bitacora(monkeypatch):
    """
    Sustituye al de tests/conftest.py: en integración los eventos sin fila
    (logout, 403, lecturas) se guardan en la base de verdad, como en
    producción. Solo se reinician las ventanas de "una vez por minuto".
    """
    monkeypatch.setattr("app.services.bitacora._ULTIMO_AVISO", {})


@pytest.fixture(autouse=True)
def static_temporal(monkeypatch, tmp_path):
    """Las fotos que suben los casos de prueba van a una carpeta temporal, no a backend/static."""
    monkeypatch.setattr("app.services.uploads.STATIC_ROOT", str(tmp_path))
