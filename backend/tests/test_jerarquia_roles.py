# backend/tests/test_jerarquia_roles.py
"""
Jerarquía de roles (HU-S9-02): quién puede administrar la cuenta de quién.
"""
import pytest

from app.core.reglas import NIVEL_ROL, puede_administrar


@pytest.mark.parametrize(
    "actor, objetivo, esperado",
    [
        # admin puede sobre cualquiera, incluido otro admin
        ("admin", "admin", True),
        ("admin", "gerente", True),
        ("admin", "supervisor", True),
        ("admin", "tecnico", True),
        # supervisor solo sobre nivel estrictamente menor
        ("supervisor", "tecnico", True),
        ("supervisor", "supervisor", False),
        ("supervisor", "gerente", False),
        ("supervisor", "admin", False),
        # gerente y supervisor comparten nivel: ninguno manda sobre el otro
        ("gerente", "tecnico", True),
        ("gerente", "supervisor", False),
        ("gerente", "admin", False),
        # el técnico no manda sobre nadie
        ("tecnico", "tecnico", False),
        ("tecnico", "supervisor", False),
        ("tecnico", "admin", False),
    ],
)
def test_puede_administrar(actor, objetivo, esperado):
    assert puede_administrar(actor, objetivo) is esperado


def test_rol_desconocido_no_manda_sobre_nadie():
    assert puede_administrar("intruso", "tecnico") is False


def test_nivel_rol_cubre_todos_los_roles_validos():
    from app.core.reglas import ROLES_VALIDOS

    assert set(NIVEL_ROL) == set(ROLES_VALIDOS)



# --- Aplicación en services/empleados.restablecer_contrasena ---------------

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException

from app.schemas.empleado import EmpleadoPasswordUpdate
from app.services import empleados as empleados_service

CLAVE_NUEVA = "ClaveNueva1"


def _persona(id_empleado, rol, correo=None):
    return SimpleNamespace(
        id_empleado=id_empleado,
        nombre="Nombre",
        apellido="Apellido",
        correo=correo or f"{rol}{id_empleado}@teleprogreso.com",
        rol=rol,
        hash_contrasena="hash-anterior",
        version_token=0,
    )


def _db_con(objetivo):
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = objetivo
    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _payload(clave=CLAVE_NUEVA):
    return EmpleadoPasswordUpdate(contrasena=clave, contrasena_confirmacion=clave)


async def _restablecer(actor, objetivo, monkeypatch):
    monkeypatch.setattr(empleados_service, "hash_password", lambda _: "hash-nuevo")
    return await empleados_service.restablecer_contrasena(
        _db_con(objetivo), objetivo.id_empleado, _payload(), current_user=actor
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("rol_objetivo", ["admin", "gerente", "supervisor"])
async def test_supervisor_no_restablece_cuentas_de_igual_o_mayor_nivel(
    rol_objetivo, monkeypatch
):
    objetivo = _persona(20, rol_objetivo)
    with pytest.raises(HTTPException) as error:
        await _restablecer(_persona(10, "supervisor"), objetivo, monkeypatch)

    assert error.value.status_code == 403
    # No se tocó nada: ni el hash ni las sesiones.
    assert objetivo.hash_contrasena == "hash-anterior"
    assert objetivo.version_token == 0


@pytest.mark.asyncio
async def test_el_403_no_revela_el_rol_del_objetivo(monkeypatch):
    detalles = set()
    for rol_objetivo in ("admin", "gerente", "supervisor"):
        with pytest.raises(HTTPException) as error:
            await _restablecer(
                _persona(10, "supervisor"), _persona(20, rol_objetivo), monkeypatch
            )
        detalles.add(error.value.detail)

    assert len(detalles) == 1
    assert not any(rol in detalles.copy().pop().lower() for rol in ("admin", "gerente"))


@pytest.mark.asyncio
async def test_supervisor_si_restablece_a_un_tecnico_e_invalida_sesiones(monkeypatch):
    objetivo = _persona(20, "tecnico")
    devuelto = await _restablecer(_persona(10, "supervisor"), objetivo, monkeypatch)

    assert devuelto.hash_contrasena == "hash-nuevo"
    assert devuelto.version_token == 1


@pytest.mark.asyncio
async def test_admin_restablece_a_otro_admin(monkeypatch):
    objetivo = _persona(20, "admin")
    devuelto = await _restablecer(_persona(10, "admin"), objetivo, monkeypatch)

    assert devuelto.hash_contrasena == "hash-nuevo"