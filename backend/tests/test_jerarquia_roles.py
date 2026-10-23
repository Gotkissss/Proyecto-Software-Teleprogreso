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
        estado="activo",
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




# --- Auto-restablecimiento prohibido ----------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["admin", "supervisor", "tecnico"])
async def test_nadie_se_restablece_a_si_mismo_por_esta_puerta(rol, monkeypatch):
    yo = _persona(10, rol)
    with pytest.raises(HTTPException) as error:
        await _restablecer(yo, yo, monkeypatch)

    assert error.value.status_code == 403
    assert "cambiar contraseña" in error.value.detail.lower()
    assert yo.hash_contrasena == "hash-anterior"
    assert yo.version_token == 0


# --- Política de contraseña en EmpleadoPasswordUpdate -----------------------

from pydantic import ValidationError

from app.core.reglas import CONTRASENAS_COMUNES


def test_la_lista_de_comunes_esta_ampliada_y_todas_pasan_el_minimo():
    # HU-S10-01: la lista vive en un archivo de datos y creció de 20 a varios
    # cientos. El tope inferior evita que alguien la vacíe sin querer.
    assert len(CONTRASENAS_COMUNES) >= 200
    assert all(len(c) >= 8 for c in CONTRASENAS_COMUNES)


@pytest.mark.parametrize("comun", sorted(CONTRASENAS_COMUNES) + ["PASSWORD", "Qwerty123"])
def test_contrasenas_comunes_se_rechazan(comun):
    with pytest.raises(ValidationError):
        EmpleadoPasswordUpdate(contrasena=comun, contrasena_confirmacion=comun)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "clave", ["anamaria123@teleprogreso.com", "ANAMARIA123@teleprogreso.com", "anamaria123"]
)
async def test_contrasena_igual_al_correo_se_rechaza(clave, monkeypatch):
    objetivo = _persona(20, "tecnico", correo="anamaria123@teleprogreso.com")
    monkeypatch.setattr(empleados_service, "hash_password", lambda _: "hash-nuevo")

    with pytest.raises(HTTPException) as error:
        await empleados_service.restablecer_contrasena(
            _db_con(objetivo), 20, _payload(clave), current_user=_persona(10, "supervisor")
        )

    assert error.value.status_code == 400
    assert objetivo.hash_contrasena == "hash-anterior"


# --- Por HTTP: PATCH /empleados/{id}/contrasena -----------------------------
#
# Lo de arriba llama al servicio directamente. Esto pasa por la app entera
# (JWT, require_supervisor, router) para fijar el código que ve el frontend.

from fastapi.testclient import TestClient

from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app

http = TestClient(app, raise_server_exceptions=False)


def _db_por_id(*personas):
    """get_db falso: cada SELECT de empleado devuelve a quien tenga ese id."""
    por_id = {p.id_empleado: p for p in personas}

    async def _fake():
        async def _execute(statement, *args, **kwargs):
            resultado = MagicMock()
            if "token_revocado" in str(statement):
                resultado.scalar_one_or_none.return_value = None
            else:
                ids = statement.compile().params.values()
                resultado.scalar_one_or_none.return_value = next(
                    (por_id[i] for i in ids if i in por_id), None
                )
            return resultado

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=_execute)
        yield db

    return _fake


def _patch_contrasena(actor, objetivo, monkeypatch):
    monkeypatch.setattr(empleados_service, "hash_password", lambda _: "hash-nuevo")
    app.dependency_overrides[get_db] = _db_por_id(actor, objetivo)
    token = create_access_token(subject=actor.id_empleado, rol=actor.rol)
    try:
        return http.patch(
            f"/empleados/{objetivo.id_empleado}/contrasena",
            headers={"Authorization": f"Bearer {token}"},
            json={"contrasena": CLAVE_NUEVA, "contrasena_confirmacion": CLAVE_NUEVA},
        )
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize(
    "rol_actor, rol_objetivo, esperado",
    [
        ("supervisor", "admin", 403),
        ("supervisor", "gerente", 403),
        ("supervisor", "tecnico", 200),
        ("admin", "admin", 200),
    ],
)
def test_http_restablecer_respeta_la_jerarquia(
    rol_actor, rol_objetivo, esperado, monkeypatch
):
    objetivo = _persona(20, rol_objetivo)
    res = _patch_contrasena(_persona(10, rol_actor), objetivo, monkeypatch)

    assert res.status_code == esperado, res.text
    if esperado == 200:
        assert objetivo.hash_contrasena == "hash-nuevo"
        assert objetivo.version_token == 1
    else:
        assert objetivo.hash_contrasena == "hash-anterior"
        assert objetivo.version_token == 0


def test_http_supervisor_no_se_restablece_a_si_mismo(monkeypatch):
    yo = _persona(10, "supervisor")
    res = _patch_contrasena(yo, yo, monkeypatch)

    assert res.status_code == 403, res.text
    assert "cambiar contraseña" in res.json()["detail"].lower()
    assert yo.hash_contrasena == "hash-anterior"