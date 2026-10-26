"""
Arranque de producción y TLS hacia la base (HU-S10-06, tarea 3).
"""
from unittest.mock import AsyncMock

import pytest

from app.core import arranque, config
from app.core.config import Settings
from app.services import auditoria


class _Sesiones:
    def __call__(self):
        return self

    async def __aenter__(self):
        return object()

    async def __aexit__(self, *_):
        return False


@pytest.mark.asyncio
async def test_en_produccion_una_conexion_sin_proteccion_no_arranca(monkeypatch):
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(auditoria, "conexion_protegida", AsyncMock(return_value=(False, "Es superusuario.")))

    with pytest.raises(arranque.ConexionNoSegura, match="Es superusuario"):
        await arranque.verificar_conexion_produccion(_Sesiones())


@pytest.mark.asyncio
async def test_en_produccion_una_conexion_protegida_arranca(monkeypatch):
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(auditoria, "conexion_protegida", AsyncMock(return_value=(True, "ok")))

    await arranque.verificar_conexion_produccion(_Sesiones())


@pytest.mark.asyncio
async def test_si_no_se_puede_comprobar_tampoco_arranca(monkeypatch):
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(auditoria, "conexion_protegida", AsyncMock(side_effect=OSError("sin red")))

    with pytest.raises(arranque.ConexionNoSegura, match="No se pudo comprobar"):
        await arranque.verificar_conexion_produccion(_Sesiones())


@pytest.mark.asyncio
async def test_fuera_de_produccion_no_se_comprueba(monkeypatch):
    revisar = AsyncMock()
    monkeypatch.setattr(auditoria, "conexion_protegida", revisar)

    await arranque.verificar_conexion_produccion(_Sesiones())

    revisar.assert_not_called()


BASE = {
    "DATABASE_URL": "postgresql+asyncpg://u:p@db:5432/x",
    "DATABASE_URL_SYNC": "postgresql://u:p@db:5432/x",
    "DATABASE_URL_MIGRACIONES": "postgresql://dueno:p@db:5432/x",
    "SECRET_KEY": "Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM",
    "ENVIRONMENT": "test",
}


def test_sin_db_ssl_mode_las_url_no_cambian():
    ajustes = Settings(**BASE)

    assert ajustes.DATABASE_URL == BASE["DATABASE_URL"]
    assert ajustes.url_migraciones == BASE["DATABASE_URL_MIGRACIONES"]


def test_db_ssl_mode_llega_a_las_tres_conexiones_con_el_nombre_de_cada_driver():
    ajustes = Settings(**BASE, DB_SSL_MODE="require")

    assert ajustes.DATABASE_URL.endswith("?ssl=require")
    assert ajustes.DATABASE_URL_SYNC.endswith("?sslmode=require")
    assert ajustes.url_migraciones.endswith("?sslmode=require")
    # El seed usa la del propietario con asyncpg: ahí vuelve a ser `ssl`.
    assert ajustes.url_migraciones_async.endswith("?ssl=require")


def test_un_db_ssl_mode_inventado_no_arranca():
    with pytest.raises(ValueError, match="DB_SSL_MODE"):
        Settings(**BASE, DB_SSL_MODE="siempre")
