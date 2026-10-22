# backend/tests/test_politica_contrasena.py
"""
Política única de contraseña (HU-S10-01, tarea 3).

Los tres caminos que fijan una contraseña (crear empleado, restablecerla y
cambiarla uno mismo) rechazan exactamente lo mismo. Antes crear y cambiar
pedían solo 8 caracteres y únicamente el restablecimiento frenaba las comunes.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.reglas import (
    CONTRASENAS_COMUNES,
    es_contrasena_comun,
    validar_politica_contrasena,
)
from app.schemas.auth import CambiarContrasenaRequest
from app.schemas.empleado import EmpleadoCreate, EmpleadoPasswordUpdate
from app.services import empleados as empleados_service

CLAVE_BUENA = "Ruta-Segura-2026"


# --- Tres puertas, una sola política ----------------------------------------

def _crear(clave, correo="ana.perez@teleprogreso.com"):
    return EmpleadoCreate(
        nombre="Ana", apellido="Pérez", correo=correo, contrasena=clave,
        rol="tecnico", fecha_contratacion=date(2024, 1, 15),
    )


def _restablecer(clave):
    return EmpleadoPasswordUpdate(contrasena=clave, contrasena_confirmacion=clave)


def _cambiar(clave):
    return CambiarContrasenaRequest(
        contrasena_actual="la-que-tenia-antes",
        nueva_contrasena=clave,
        confirmacion_contrasena=clave,
    )


PUERTAS = [_crear, _restablecer, _cambiar]
ids_puertas = ["crear", "restablecer", "cambiar"]


@pytest.mark.parametrize("puerta", PUERTAS, ids=ids_puertas)
@pytest.mark.parametrize(
    "clave",
    [
        "corta1",                 # menos de 8
        " Ruta-Segura-2026",      # espacio al inicio
        "Ruta-Segura-2026 ",      # espacio al final
        "        ",               # solo espacios
        "password",               # común
        "PASSWORD123",            # común, sin distinguir mayúsculas
        "Admin1234!",             # la contraseña de demo que estuvo en el README
        "Tecnico1234!",
    ],
)
def test_las_tres_puertas_rechazan_lo_mismo(puerta, clave):
    with pytest.raises(ValidationError):
        puerta(clave)


@pytest.mark.parametrize("puerta", PUERTAS, ids=ids_puertas)
def test_las_tres_puertas_aceptan_una_contrasena_buena(puerta):
    puerta(CLAVE_BUENA)


# --- Crear: distinta del correo y de su parte local ------------------------

@pytest.mark.parametrize(
    "clave",
    ["ana.perez@teleprogreso.com", "ANA.PEREZ@TELEPROGRESO.COM", "ana.perez"],
)
def test_crear_rechaza_la_contrasena_igual_al_correo(clave):
    with pytest.raises(ValidationError):
        _crear(clave)


# --- La función directamente -----------------------------------------------

def test_devuelve_la_contrasena_intacta():
    assert validar_politica_contrasena(CLAVE_BUENA) == CLAVE_BUENA


def test_rechaza_igual_a_la_actual():
    with pytest.raises(ValueError, match="diferente de la contraseña actual"):
        validar_politica_contrasena(CLAVE_BUENA, contrasena_actual=CLAVE_BUENA)


def test_sin_correo_ni_actual_esas_comprobaciones_se_omiten():
    assert validar_politica_contrasena("ana.perez") == "ana.perez"


def test_la_lista_de_comunes_se_compara_sin_distinguir_mayusculas():
    assert es_contrasena_comun("PaSsWoRd123")
    assert not es_contrasena_comun(CLAVE_BUENA)


def test_las_contrasenas_de_demo_publicadas_estan_en_la_lista():
    for publicada in (
        "Admin1234!", "Super1234!", "Gerente1234!", "Tecnico1234!",
    ):
        assert publicada.lower() in CONTRASENAS_COMUNES


# --- Restablecer: distinta del correo de la cuenta de destino ---------------

def _persona(id_empleado, rol, correo):
    return SimpleNamespace(
        id_empleado=id_empleado, nombre="N", apellido="A", correo=correo,
        rol=rol, estado="activo", hash_contrasena="hash-anterior",
        version_token=0,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("clave", ["ana.perez@teleprogreso.com", "ana.perez"])
async def test_restablecer_rechaza_la_contrasena_igual_al_correo(clave, monkeypatch):
    objetivo = _persona(20, "tecnico", "ana.perez@teleprogreso.com")
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = objetivo
    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    monkeypatch.setattr(empleados_service, "hash_password", lambda _: "hash-nuevo")

    with pytest.raises(HTTPException) as error:
        await empleados_service.restablecer_contrasena(
            db, 20, _restablecer(clave), current_user=_persona(10, "supervisor", "s@x.com")
        )

    assert error.value.status_code == 400
    assert objetivo.hash_contrasena == "hash-anterior"