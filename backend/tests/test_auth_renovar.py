# backend/tests/test_auth_renovar.py
"""
HU-S9-05 — POST /auth/renovar.

El JWT dura una hora y no había forma de extenderlo. Un técnico que pasaba de
esa hora rellenando el informe de una tarea recibía 401 al enviarlo, y el
frontend lo mandaba a login recargando la página entera: adiós a lo escrito.

Lo que fijan estas pruebas, que es donde está el riesgo de este endpoint:

  · Renovar extiende algo VIVO, no resucita nada. Un token revocado, uno con
    el `version_token` viejo (le cambiaron la contraseña) o una cuenta
    desactivada no renuevan: ahí la sesión tiene que morir de verdad.
  · El token anterior deja de valer en el acto. Si no, cada renovación dejaría
    un token más circulando y el logout solo mataría el último.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.deps import get_current_empleado
from app.core.security import create_access_token, decode_access_token
from app.routers.auth import renovar


def _empleado(version_token: int = 0, estado: str = "activo"):
    return SimpleNamespace(
        id_empleado=7,
        nombre="Ana",
        apellido="López",
        correo="ana@teleprogreso.com",
        rol="tecnico",
        estado=estado,
        version_token=version_token,
    )


def _credenciales(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _db_para_autenticacion(empleado, revocado: bool = False):
    """get_db falso: resuelve el empleado y si su jti está revocado."""
    db = AsyncMock()

    async def _execute(statement, *args, **kwargs):
        resultado = MagicMock()
        if "token_revocado" in str(statement):
            resultado.scalar_one_or_none.return_value = "jti" if revocado else None
        else:
            resultado.scalar_one_or_none.return_value = empleado
        return resultado

    db.execute = AsyncMock(side_effect=_execute)
    return db


# ─── Camino feliz ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_renovar_devuelve_un_token_nuevo_y_revoca_el_anterior(monkeypatch):
    empleado = _empleado()
    token_viejo = create_access_token(subject=7, rol="tecnico", version_token=0)

    revocados = []

    async def _revocar(_db, payload):
        revocados.append(payload["jti"])
        return True

    monkeypatch.setattr("app.routers.auth.revoke_token", _revocar)
    monkeypatch.setattr("app.routers.auth.anotar_evento", lambda *a, **k: None)

    respuesta = await renovar(
        _credenciales(token_viejo),
        AsyncMock(),
        empleado,
    )

    assert respuesta.access_token != token_viejo
    assert respuesta.rol == "tecnico"
    assert respuesta.id_empleado == 7

    # El viejo queda revocado: no pueden quedar dos tokens vivos de la misma
    # sesión.
    jti_viejo = decode_access_token(token_viejo)["jti"]
    assert revocados == [jti_viejo]

    # Y el nuevo es un token legítimo de ese empleado, con su versión.
    nuevo = decode_access_token(respuesta.access_token)
    assert nuevo["sub"] == "7"
    assert nuevo["version_token"] == 0
    assert nuevo["jti"] != jti_viejo


@pytest.mark.asyncio
async def test_la_renovacion_deja_fila_en_la_bitacora(monkeypatch):
    """
    Criterio de la historia: cada renovación se registra. Una sesión que se
    extiende sola durante horas sin dejar rastro es justo lo que habría que
    poder revisar después.

    Que el evento llegue a la tabla lo comprueba el caso de
    `tests/integracion/casos_auditoria.py` contra una base real; aquí solo se
    fija que el endpoint lo anote y con qué.
    """
    eventos = []

    monkeypatch.setattr(
        "app.routers.auth.anotar_evento",
        lambda accion, entidad, id_entidad=None, cambios=None: eventos.append(
            (accion, entidad, id_entidad)
        ),
    )
    monkeypatch.setattr(
        "app.routers.auth.revoke_token", AsyncMock(return_value=True)
    )

    await renovar(
        _credenciales(create_access_token(subject=7, rol="tecnico")),
        AsyncMock(),
        _empleado(),
    )

    assert eventos == [("renovar_sesion", "empleado", 7)]


# ─── Lo que NO se renueva ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_un_token_revocado_no_renueva():
    """Cerrar sesión en un dispositivo no puede dejar vivo al otro."""
    empleado = _empleado()
    token = create_access_token(subject=7, rol="tecnico", version_token=0)

    with pytest.raises(HTTPException) as error:
        await get_current_empleado(
            _credenciales(token),
            _db_para_autenticacion(empleado, revocado=True),
        )

    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_un_version_token_viejo_no_renueva():
    """
    Le restablecieron la contraseña porque la cuenta pudo quedar expuesta. La
    sesión abierta tiene que caerse, no renovarse sola.
    """
    empleado = _empleado(version_token=3)
    token_viejo = create_access_token(subject=7, rol="tecnico", version_token=2)

    with pytest.raises(HTTPException) as error:
        await get_current_empleado(
            _credenciales(token_viejo),
            _db_para_autenticacion(empleado),
        )

    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_una_cuenta_desactivada_no_renueva():
    empleado = _empleado(estado="inactivo")
    token = create_access_token(subject=7, rol="tecnico", version_token=0)

    with pytest.raises(HTTPException) as error:
        await get_current_empleado(
            _credenciales(token),
            _db_para_autenticacion(empleado),
        )

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_sin_token_no_hay_renovacion():
    with pytest.raises(HTTPException) as error:
        await get_current_empleado(None, AsyncMock())

    assert error.value.status_code == 401


def test_renovar_exige_sesion_valida():
    """
    La validación no es propia del endpoint: es la misma dependencia que
    protege todo lo demás. Escribirlo aquí evita que alguien "simplifique"
    renovar leyendo el token a mano y se salte la revocación.
    """
    from app.routers.auth import router

    ruta = next(r for r in router.routes if r.path == "/auth/renovar")
    dependencias = {d.call for d in ruta.dependant.dependencies}

    assert get_current_empleado in dependencias
