# backend/tests/test_cambio_obligatorio.py
"""
Cambio obligatorio de contraseña (HU-S10-01, tarea 6).

Una cuenta con `debe_cambiar_contrasena = true` (contraseña puesta por otra
persona) no puede hacer nada hasta cambiarla: el backend solo deja pasar
/auth/me, /auth/perfil, /auth/cambiar-contrasena, /auth/renovar y
/auth/logout; todo lo demás responde 403 con `error: PASSWORD_CHANGE_REQUIRED`.

Qué se comprueba:
  1. Con la bandera en true, cualquier ruta fuera de la lista responde 403
     PASSWORD_CHANGE_REQUIRED (sin importar el método HTTP).
  2. Las cinco rutas permitidas siguen respondiendo.
  3. Con la bandera en false (cuentas del seed y filas existentes) nada
     cambia: no quedan bloqueadas.
  4. Cambiar la contraseña apaga la bandera.
  5. Crear un empleado y restablecerle la contraseña la encienden.
  6. La columna nace en false para las filas que ya existían.

Las pruebas 1 a 3 pasan por `get_current_empleado` real (JWT real, base
simulada), así que no dependen de cómo se implemente el bloqueo por dentro.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_current_empleado
from app.core.exceptions import register_exception_handlers
from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.models.empleado import Empleado
from app.routers import auth
from app.schemas.auth import CambiarContrasenaRequest
from app.schemas.empleado import EmpleadoCreate, EmpleadoPasswordUpdate
from app.services import empleados as empleados_service

CODIGO = "PASSWORD_CHANGE_REQUIRED"
CLAVE_ACTUAL = "Clave-Temporal-2026"
CLAVE_NUEVA = "Ruta-Segura-2026"

METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"]

# Las únicas rutas que una cuenta con cambio pendiente puede usar.
RUTAS_PERMITIDAS = [
    ("GET", "/auth/me"),
    ("GET", "/auth/perfil"),
    ("POST", "/auth/cambiar-contrasena"),
    ("POST", "/auth/renovar"),
    ("POST", "/auth/logout"),
]

# Una muestra de todo lo demás: lecturas, escrituras y rutas de cada rol.
RUTAS_BLOQUEADAS = [
    ("GET", "/tareas"),
    ("GET", "/tareas/mis-tareas"),
    ("PATCH", "/tareas/1"),
    ("POST", "/ubicaciones"),
    ("GET", "/empleados"),
    ("POST", "/empleados"),
    ("GET", "/alertas"),
    ("GET", "/activos/materiales"),
    ("GET", "/reportes/horas"),
    ("GET", "/auth/otra-ruta"),
]


# --- Ayudas -------------------------------------------------------------------

def _empleado(debe_cambiar, rol="tecnico", id_empleado=7):
    return SimpleNamespace(
        id_empleado=id_empleado,
        nombre="Ana",
        apellido="López",
        correo="ana.lopez@teleprogreso.com",
        rol=rol,
        estado="activo",
        hash_contrasena=hash_password(CLAVE_ACTUAL),
        version_token=0,
        debe_cambiar_contrasena=debe_cambiar,
    )


class _BDSimulada:
    """
    Responde las dos consultas de `get_current_empleado`: la del token
    revocado (nadie está revocado) y la del empleado.
    """

    def __init__(self, empleado):
        self.empleado = empleado
        self.flush = AsyncMock()

    async def execute(self, consulta):
        resultado = MagicMock()
        if "token_revocado" in str(consulta):
            resultado.scalar_one_or_none.return_value = None
        else:
            resultado.scalar_one_or_none.return_value = self.empleado
        return resultado


def _app_sonda(empleado):
    """
    App mínima con la dependencia REAL `get_current_empleado` en cada ruta
    de las listas de arriba: lo único que se prueba es el bloqueo.
    """
    aplicacion = FastAPI()
    register_exception_handlers(aplicacion)

    async def sonda(actual=Depends(get_current_empleado)):
        return {"ok": True}

    for _, ruta in RUTAS_PERMITIDAS + RUTAS_BLOQUEADAS:
        aplicacion.add_api_route(ruta, sonda, methods=METODOS)

    bd = _BDSimulada(empleado)

    async def db_simulada():
        yield bd

    aplicacion.dependency_overrides[get_db] = db_simulada
    return aplicacion


def _cabeceras(empleado):
    token = create_access_token(
        subject=empleado.id_empleado,
        rol=empleado.rol,
        version_token=empleado.version_token,
    )
    return {"Authorization": f"Bearer {token}"}


async def _llamar(aplicacion, metodo, ruta, empleado):
    async with AsyncClient(
        transport=ASGITransport(app=aplicacion), base_url="http://test"
    ) as cliente:
        return await cliente.request(metodo, ruta, headers=_cabeceras(empleado))


# --- 1. Con cambio pendiente, todo lo demás responde 403 ----------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("metodo,ruta", RUTAS_BLOQUEADAS)
async def test_con_cambio_pendiente_cualquier_otra_ruta_responde_403(metodo, ruta):
    empleado = _empleado(debe_cambiar=True)

    respuesta = await _llamar(_app_sonda(empleado), metodo, ruta, empleado)

    assert respuesta.status_code == 403
    assert respuesta.json()["error"] == CODIGO


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["admin", "supervisor", "gerente", "tecnico"])
async def test_el_bloqueo_vale_para_los_cuatro_roles(rol):
    empleado = _empleado(debe_cambiar=True, rol=rol)

    respuesta = await _llamar(_app_sonda(empleado), "GET", "/tareas", empleado)

    assert respuesta.status_code == 403
    assert respuesta.json()["error"] == CODIGO


@pytest.mark.asyncio
@pytest.mark.parametrize("metodo", METODOS)
async def test_el_metodo_http_no_esquiva_el_bloqueo(metodo):
    empleado = _empleado(debe_cambiar=True)

    respuesta = await _llamar(_app_sonda(empleado), metodo, "/empleados", empleado)

    assert respuesta.status_code == 403
    assert respuesta.json()["error"] == CODIGO


# --- 2. Las cinco rutas permitidas siguen respondiendo ------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("metodo,ruta", RUTAS_PERMITIDAS)
async def test_con_cambio_pendiente_las_rutas_permitidas_responden(metodo, ruta):
    empleado = _empleado(debe_cambiar=True)

    respuesta = await _llamar(_app_sonda(empleado), metodo, ruta, empleado)

    assert respuesta.status_code == 200, respuesta.text


# --- 3. Sin cambio pendiente nadie queda bloqueado ----------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("metodo,ruta", RUTAS_PERMITIDAS + RUTAS_BLOQUEADAS)
async def test_sin_cambio_pendiente_ninguna_ruta_se_bloquea(metodo, ruta):
    # Es el caso de las cuentas del seed y de las filas que ya existían: la
    # demo entra directo, sin pasar por la pantalla de cambio.
    empleado = _empleado(debe_cambiar=False)

    respuesta = await _llamar(_app_sonda(empleado), metodo, ruta, empleado)

    assert respuesta.status_code == 200, respuesta.text


# --- 4. Cambiar la contraseña apaga la bandera --------------------------------

@pytest.mark.asyncio
async def test_cambiar_la_contrasena_apaga_la_bandera():
    empleado = _empleado(debe_cambiar=True)
    bd = _BDSimulada(empleado)
    cuerpo = CambiarContrasenaRequest(
        contrasena_actual=CLAVE_ACTUAL,
        nueva_contrasena=CLAVE_NUEVA,
        confirmacion_contrasena=CLAVE_NUEVA,
    )

    await auth.cambiar_contrasena(cuerpo, bd, empleado)

    assert empleado.debe_cambiar_contrasena is False
    # Y la sesión con la que entró deja de valer, como en cualquier cambio.
    assert empleado.version_token == 1


@pytest.mark.asyncio
async def test_si_el_cambio_se_rechaza_la_bandera_sigue_encendida():
    empleado = _empleado(debe_cambiar=True)
    bd = _BDSimulada(empleado)
    cuerpo = CambiarContrasenaRequest(
        contrasena_actual="no-es-la-actual-1",
        nueva_contrasena=CLAVE_NUEVA,
        confirmacion_contrasena=CLAVE_NUEVA,
    )

    with pytest.raises(Exception):
        await auth.cambiar_contrasena(cuerpo, bd, empleado)

    assert empleado.debe_cambiar_contrasena is True


# --- 5. Crear y restablecer la encienden --------------------------------------

@pytest.mark.asyncio
async def test_crear_un_empleado_lo_deja_con_cambio_pendiente():
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = None  # correo libre
    bd = MagicMock()
    bd.execute = AsyncMock(return_value=resultado)
    bd.add = MagicMock()
    bd.flush = AsyncMock()
    bd.refresh = AsyncMock()
    datos = EmpleadoCreate(
        nombre="Ana",
        apellido="Pérez",
        correo="ana.perez@teleprogreso.com",
        contrasena=CLAVE_NUEVA,
        rol="tecnico",
        fecha_contratacion=date(2024, 1, 15),
    )

    nuevo = await empleados_service.crear_empleado(bd, datos)

    assert nuevo.debe_cambiar_contrasena is True


@pytest.mark.asyncio
async def test_restablecer_la_contrasena_vuelve_a_encender_la_bandera():
    objetivo = _empleado(debe_cambiar=False, rol="tecnico", id_empleado=20)
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = objetivo
    bd = MagicMock()
    bd.execute = AsyncMock(return_value=resultado)
    admin = _empleado(debe_cambiar=False, rol="admin", id_empleado=1)
    datos = EmpleadoPasswordUpdate(
        contrasena=CLAVE_NUEVA, contrasena_confirmacion=CLAVE_NUEVA
    )

    await empleados_service.restablecer_contrasena(bd, 20, datos, admin)

    assert objetivo.debe_cambiar_contrasena is True


# --- 6. La columna nace en false para lo que ya existía -----------------------

def test_la_columna_nace_apagada_para_las_filas_existentes():
    columna = Empleado.__table__.c.debe_cambiar_contrasena

    assert columna.nullable is False
    # server_default: lo que reciben las filas que ya estaban en la base al
    # correr la migración y las que inserta el seed sin mencionar la columna.
    assert str(columna.server_default.arg).lower() in ("false", "0")