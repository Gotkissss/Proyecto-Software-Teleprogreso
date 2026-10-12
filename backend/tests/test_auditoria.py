# backend/tests/test_auditoria.py
"""
Consulta, verificación, exportación y mantenimiento de la bitácora
(HU-S9-03, tareas 5 y 6) sin base de datos.

Lo que exige PostgreSQL real (triggers, cadena, purga con ancla, el rol de la
app sin poder modificar nada, la cobertura de los 31 endpoints) está en
tests/integracion/test_auditoria.py y tests/integracion/test_cobertura_auditoria.py.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import mantenimiento
from app.core.config import Settings
from app.core.deps import require_admin
from app.core.reglas import MAX_FILAS_EXPORTAR_BITACORA
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.routers.auditoria import router
from app.services import auditoria
from app.services.auditoria import FiltrosBitacora


def _dependencias_de(path: str):
    ruta = next(r for r in router.routes if r.path == path)
    return {dependencia.call for dependencia in ruta.dependant.dependencies}


# --- Permisos ----------------------------------------------------------------------

@pytest.mark.parametrize(
    "path", ["/auditoria", "/auditoria/catalogos", "/auditoria/verificacion", "/auditoria/exportar"]
)
def test_toda_la_bitacora_es_solo_del_admin(path):
    # Consulta y exportación con el mismo rol: ningún par JSON/export distinto.
    assert require_admin in _dependencias_de(path)


@pytest.mark.parametrize("rol", ["gerente", "supervisor", "tecnico"])
def test_los_demas_roles_reciben_403(rol, eventos_bitacora):
    persona = SimpleNamespace(
        id_empleado=7, rol=rol, estado="activo", version_token=0, nombre="N", apellido="A",
    )

    async def _db():
        db = AsyncMock()
        db.execute = AsyncMock(
            side_effect=lambda stmt, *a, **k: _resultado(None if "token_revocado" in str(stmt) else persona)
        )
        yield db

    app.dependency_overrides[get_db] = _db
    try:
        token = create_access_token(subject=7, rol=rol)
        respuesta = TestClient(app).get("/auditoria", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.clear()

    assert respuesta.status_code == 403
    # El intento queda en la bitácora como acceso denegado.
    assert any(e["accion"] == "acceso_denegado" for e in eventos_bitacora)


def _resultado(valor):
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = valor
    return resultado


# --- Filtros, exportación y verificación ------------------------------------------

def test_un_rango_al_reves_es_400():
    with pytest.raises(HTTPException) as error:
        auditoria._condiciones(FiltrosBitacora(fecha_inicio=date(2026, 10, 10), fecha_fin=date(2026, 10, 1)))
    assert error.value.status_code == 400


def test_cada_filtro_suma_una_condicion():
    filtros = FiltrosBitacora(
        id_actor=1, rol_actor="admin", accion="crear", entidad="tarea", id_entidad=3,
        request_id="abc", fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 10, 2),
    )
    assert len(auditoria._condiciones(filtros)) == 8
    assert auditoria._condiciones(FiltrosBitacora()) == []


@pytest.mark.asyncio
async def test_exportar_mas_del_tope_es_400_y_no_un_archivo_recortado():
    db = AsyncMock()
    conteo = MagicMock()
    conteo.scalar_one.return_value = MAX_FILAS_EXPORTAR_BITACORA + 1
    db.execute = AsyncMock(return_value=conteo)

    with pytest.raises(HTTPException) as error:
        await auditoria.exportar(db, FiltrosBitacora())

    assert error.value.status_code == 400
    assert "Acota" in error.value.detail
    assert db.execute.await_count == 1  # no llegó a pedir las filas


def test_el_nombre_del_archivo_lleva_el_rango():
    assert (
        auditoria.nombre_archivo(FiltrosBitacora(fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 10, 7)))
        == "bitacora_2026-10-01_2026-10-07.xlsx"
    )
    assert auditoria.nombre_archivo(FiltrosBitacora()) == "bitacora_inicio_hoy.xlsx"


@pytest.mark.parametrize("motivo", list(auditoria.DESCRIPCION_MOTIVO))
def test_cada_motivo_de_rotura_tiene_una_explicacion_con_la_fila(motivo):
    assert "#42" in auditoria.DESCRIPCION_MOTIVO[motivo].format(id=42)


# --- Configuración y comando de mantenimiento ------------------------------------

def test_la_retencion_no_puede_ser_cero():
    with pytest.raises(ValidationError):
        Settings(
            DATABASE_URL="postgresql+asyncpg://a:b@c/d_test", DATABASE_URL_SYNC="postgresql://a:b@c/d_test",
            SECRET_KEY="x" * 40, ENVIRONMENT="test", RETENCION_BITACORA_DIAS=0,
        )


def test_sin_url_de_migraciones_se_usa_la_sincrona():
    base = dict(
        DATABASE_URL="postgresql+asyncpg://app:b@c/d", DATABASE_URL_SYNC="postgresql://app:b@c/d",
        SECRET_KEY="x" * 40, ENVIRONMENT="test",
    )
    assert Settings(**base).url_migraciones == "postgresql://app:b@c/d"
    assert (
        Settings(**base, DATABASE_URL_MIGRACIONES="postgresql://dueno:b@c/d").url_migraciones
        == "postgresql://dueno:b@c/d"
    )


@pytest.mark.parametrize("argumentos", [[], ["borrar-todo"], ["purgar", "extra"]])
def test_el_comando_rechaza_un_uso_desconocido(argumentos):
    assert mantenimiento.main(argumentos) == 2
