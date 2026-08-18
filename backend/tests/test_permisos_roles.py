# backend/tests/test_permisos_roles.py
"""
Pruebas del modelo de permisos por rol — Teleprogreso S.A.
-----------------------------------------------------------------------------
Fijan por escrito quién puede hacer qué, para que un refactor no relaje un
permiso sin que nadie se entere:

  - El gerente CONSULTA. No registra evidencias ni toca el inventario.
  - El técnico ve únicamente su vehículo y las herramientas que lleva.
  - Solo admin y supervisor restablecen contraseñas.

Se ejecutan con: pytest tests/ -v
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.reglas import ROLES_GESTION, ROLES_SUPERVISION
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.routers.incidencias import _obtener_tarea_autorizada
from app.schemas.empleado import EmpleadoPasswordUpdate

client = TestClient(app, raise_server_exceptions=False)


def _empleado(rol: str, id_empleado: int = 1):
    emp = MagicMock()
    emp.id_empleado = id_empleado
    emp.nombre, emp.apellido = "Prueba", "Usuario"
    emp.correo = f"{rol}@teleprogreso.com"
    emp.rol = rol
    emp.estado = "activo"
    return emp


def auth(rol: str, id_empleado: int = 1):
    return {"Authorization": f"Bearer {create_access_token(subject=id_empleado, rol=rol)}"}


def override_db(empleado, extra=None):
    """get_db falso que resuelve al empleado y, opcionalmente, a otro objeto."""
    async def _fake():
        db = AsyncMock()

        async def _execute(statement, *args, **kwargs):
            result = MagicMock()
            texto = str(statement)
            if "token_revocado" in texto:
                result.scalar_one_or_none.return_value = None
            elif "empleado" in texto and "empleado_carro" not in texto:
                result.scalar_one_or_none.return_value = empleado
            else:
                result.scalar_one_or_none.return_value = extra
                result.scalars.return_value.first.return_value = extra
            return result

        db.execute = AsyncMock(side_effect=_execute)
        yield db
    return _fake


# ─── 1. El gerente consulta, no registra ───────────────────────────────────── 

def test_roles_gestion_no_incluye_al_gerente():
    """
    Es la distinción que hace todo lo demás. ROLES_SUPERVISION es "quién ve";
    ROLES_GESTION es "quién opera", y el gerente no está en el segundo.
    """
    assert "gerente" in ROLES_SUPERVISION
    assert "gerente" not in ROLES_GESTION
    assert set(ROLES_GESTION) == {"admin", "supervisor"}


@pytest.mark.asyncio
async def test_gerente_puede_leer_evidencias_de_cualquier_tarea():
    db = AsyncMock()
    tarea = MagicMock(id_tarea=7)
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = tarea
    db.execute = AsyncMock(return_value=resultado)

    devuelta = await _obtener_tarea_autorizada(db, 7, _empleado("gerente"))
    assert devuelta is tarea


@pytest.mark.asyncio
async def test_gerente_no_puede_registrar_evidencias():
    """Su trabajo es revisar y coordinar con el supervisor, no dejar constancia."""
    db = AsyncMock()
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = MagicMock(id_tarea=7)
    db.execute = AsyncMock(return_value=resultado)

    with pytest.raises(HTTPException) as exc:
        await _obtener_tarea_autorizada(db, 7, _empleado("gerente"), escritura=True)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["admin", "supervisor"])
async def test_admin_y_supervisor_si_pueden_registrar(rol):
    db = AsyncMock()
    tarea = MagicMock(id_tarea=7)
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = tarea
    db.execute = AsyncMock(return_value=resultado)

    assert await _obtener_tarea_autorizada(db, 7, _empleado(rol), escritura=True) is tarea


# ─── 2. El técnico no ve el inventario completo ──────────────────────────────

@pytest.mark.parametrize(
    "ruta",
    [
        "/activos/materiales",
        "/activos/materiales/bajo-stock",
        "/activos/herramientas",
        "/activos/carros",
    ],
)
def test_tecnico_no_lista_el_inventario(ruta):
    """
    Un técnico solo ve lo que lleva asignado (GET /empleados/mi-equipo). Si
    necesita otra herramienta o material, lo pide al supervisor.
    """
    app.dependency_overrides[get_db] = override_db(_empleado("tecnico"))
    try:
        assert client.get(ruta, headers=auth("tecnico")).status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("ruta", ["/activos/materiales", "/activos/carros"])
@pytest.mark.parametrize("rol", ["admin", "supervisor", "gerente"])
def test_supervision_si_lista_el_inventario(ruta, rol):
    """El gerente sí consulta el inventario: es un rol de revisión."""
    app.dependency_overrides[get_db] = override_db(_empleado(rol))
    try:
        assert client.get(ruta, headers=auth(rol)).status_code != 403
    finally:
        app.dependency_overrides.clear()


def test_sin_token_el_inventario_tampoco_responde():
    assert client.get("/activos/materiales").status_code == 401


# ─── 3. Restablecer contraseña ───────────────────────────────────────────────

def test_tecnico_no_puede_cambiar_contrasenas():
    app.dependency_overrides[get_db] = override_db(_empleado("tecnico"))
    try:
        res = client.patch(
            "/empleados/2/contrasena",
            headers=auth("tecnico"),
            json={"contrasena": "clave-nueva-1", "contrasena_confirmacion": "clave-nueva-1"},
        )
        assert res.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_gerente_no_puede_cambiar_contrasenas():
    app.dependency_overrides[get_db] = override_db(_empleado("gerente"))
    try:
        res = client.patch(
            "/empleados/2/contrasena",
            headers=auth("gerente"),
            json={"contrasena": "clave-nueva-1", "contrasena_confirmacion": "clave-nueva-1"},
        )
        assert res.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_contrasena_corta_se_rechaza():
    with pytest.raises(ValidationError):
        EmpleadoPasswordUpdate(contrasena="corta", contrasena_confirmacion="corta")


def test_contrasenas_que_no_coinciden_se_rechazan():
    """
    Evita el error más caro del flujo: dejar a alguien fuera con una clave que
    nadie sabe cuál quedó.
    """
    with pytest.raises(ValidationError):
        EmpleadoPasswordUpdate(
            contrasena="clave-buena-1",
            contrasena_confirmacion="clave-buena-2",
        )


def test_contrasena_con_espacios_al_borde_se_rechaza():
    with pytest.raises(ValidationError):
        EmpleadoPasswordUpdate(
            contrasena=" clave-con-espacio ",
            contrasena_confirmacion=" clave-con-espacio ",
        )


def test_contrasena_valida_se_acepta():
    payload = EmpleadoPasswordUpdate(
        contrasena="clave-larga-y-buena",
        contrasena_confirmacion="clave-larga-y-buena",
    )
    assert payload.contrasena == "clave-larga-y-buena"
