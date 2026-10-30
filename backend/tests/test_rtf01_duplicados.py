# backend/tests/test_rtf01_duplicados.py
"""
RTF-01 / R1-5 — empleados duplicados y correos personales.

El informe: «Hay registros duplicados ("Luis Fonzi" como técnico y como
supervisor) y correos personales @gmail.com junto a los corporativos.»

Son dos problemas con una causa común: nada impedía meter los dos.

  1. El duplicado parte en dos el historial de una persona —sus tareas, sus
     jornadas y sus horas quedan repartidas entre dos ids— y los reportes del
     gerente la cuentan a medias. No se prohíbe del todo: los homónimos
     existen, así que el alta se para con el registro que ya existe a la vista
     y se repite con `permitir_homonimo` si de verdad son dos personas.
  2. Un correo personal no se puede dar de baja cuando la persona se va, y es
     el canal por el que llega el aviso de restablecimiento de contraseña.
     El dominio se configura y se puede dejar vacío, para quien despliegue
     esto con otro dominio.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.reglas import (
    dominio_de,
    normalizar_correo,
    validar_correo_de_empleado,
)
from app.schemas.empleado import EmpleadoCreate, EmpleadoUpdate
from app.services import empleados as empleados_service

CLAVE = "Tele.2026!clave"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _datos(**campos):
    base = dict(
        nombre="Luis",
        apellido="Fonzi",
        correo="luis.fonzi@teleprogreso.com",
        contrasena=CLAVE,
        rol="tecnico",
        fecha_contratacion=date(2024, 1, 15),
    )
    base.update(campos)
    return EmpleadoCreate(**base)


def _bd(*, correo_libre=True, gemelo=None, empleado=None):
    """
    Doble de sesión. `db.execute` devuelve siempre el mismo resultado, que
    responde a las tres formas de leerlo que usa el servicio.
    """
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = (
        None if correo_libre else SimpleNamespace(id_empleado=9)
    )
    if empleado is not None:
        resultado.scalar_one_or_none.return_value = empleado
    resultado.scalars.return_value.first.return_value = gemelo

    bd = MagicMock()
    bd.execute = AsyncMock(return_value=resultado)
    bd.add = MagicMock()
    bd.flush = AsyncMock()
    bd.refresh = AsyncMock()
    return bd


def _gemelo(**campos):
    base = dict(
        id_empleado=7,
        nombre="Luis",
        apellido="Fonzi",
        rol="supervisor",
        estado="activo",
    )
    base.update(campos)
    return SimpleNamespace(**base)


# ─── El correo tiene que ser de la empresa ───────────────────────────────────

def test_normalizar_y_leer_el_dominio():
    assert normalizar_correo("  Luis.Fonzi@Teleprogreso.COM ") == (
        "luis.fonzi@teleprogreso.com"
    )
    assert dominio_de("a@Teleprogreso.com") == "teleprogreso.com"
    assert dominio_de("sin-arroba") == ""


def test_el_correo_corporativo_pasa():
    assert validar_correo_de_empleado(
        "Luis.Fonzi@Teleprogreso.com", ("teleprogreso.com",)
    ) == "luis.fonzi@teleprogreso.com"


def test_un_subdominio_de_la_empresa_tambien_pasa():
    # `sistemas.teleprogreso.com` sigue siendo correo de la empresa.
    assert validar_correo_de_empleado(
        "ana@sistemas.teleprogreso.com", ("teleprogreso.com",)
    )


def test_el_correo_personal_se_rechaza():
    # El caso del informe.
    with pytest.raises(ValueError) as error:
        validar_correo_de_empleado("luisfonzi@gmail.com", ("teleprogreso.com",))
    assert "@teleprogreso.com" in str(error.value)


def test_un_dominio_que_solo_termina_parecido_no_cuela():
    # «noteleprogreso.com» acaba en «teleprogreso.com» como cadena, pero es
    # otro dominio: el que lo registre podría leer el correo de la empresa.
    with pytest.raises(ValueError):
        validar_correo_de_empleado("x@noteleprogreso.com", ("teleprogreso.com",))


def test_sin_dominios_configurados_no_se_restringe_nada():
    # Quien despliegue esto con otro dominio, o sin dominio propio, no debe
    # quedarse sin poder registrar a nadie.
    assert validar_correo_de_empleado("cualquiera@gmail.com", ()) == (
        "cualquiera@gmail.com"
    )


def test_varios_dominios_admitidos():
    dominios = ("teleprogreso.com", "teleprogreso.gt")
    assert validar_correo_de_empleado("a@teleprogreso.gt", dominios)


def test_el_schema_rechaza_el_correo_personal():
    with pytest.raises(ValidationError):
        _datos(correo="luisfonzi@gmail.com")


def test_editar_aplica_la_misma_regla_del_correo():
    # Si editar fuera más permisivo, el correo personal entraría por la otra
    # puerta.
    with pytest.raises(ValidationError):
        EmpleadoUpdate(correo="luisfonzi@gmail.com")


def test_editar_sin_tocar_el_correo_sigue_funcionando():
    # Las cuentas con correo personal que ya existen tienen que poder
    # editarse en lo demás; si no, quedarían congeladas.
    assert EmpleadoUpdate(telefono="1234-5678").correo is None


# ─── Un nombre repetido para el alta ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_alta_se_para_si_ya_hay_alguien_con_ese_nombre():
    bd = _bd(gemelo=_gemelo())

    with pytest.raises(HTTPException) as error:
        await empleados_service.crear_empleado(bd, _datos())

    assert error.value.status_code == 409
    # Código propio: la pantalla tiene que poder distinguirlo del 409 del
    # correo repetido, que se resuelve de otra forma.
    assert error.value.error_code == empleados_service.ERROR_EMPLEADO_DUPLICADO
    # El mensaje dice CON QUIÉN choca: es lo que permite ver que es la misma
    # persona y no un homónimo.
    assert "Luis Fonzi" in error.value.detail
    assert "#7" in error.value.detail
    assert "supervisor" in error.value.detail
    bd.add.assert_not_called()


@pytest.mark.asyncio
async def test_el_nombre_se_compara_sin_mayusculas_ni_espacios_de_sobra():
    # Por aquí entran los duplicados que no se ven a simple vista.
    bd = _bd(gemelo=_gemelo())

    with pytest.raises(HTTPException):
        await empleados_service.crear_empleado(
            bd, _datos(nombre="  luis ", apellido="FONZI")
        )

    # La consulta se armó con el nombre ya normalizado.
    assert bd.execute.await_count >= 2


@pytest.mark.asyncio
async def test_un_homonimo_declarado_si_entra():
    # Hay muchos «José García»: prohibirlo del todo dejaría gente real sin
    # poder registrarse.
    bd = _bd(gemelo=_gemelo())

    nuevo = await empleados_service.crear_empleado(
        bd, _datos(permitir_homonimo=True)
    )

    assert nuevo.nombre == "Luis"
    bd.add.assert_called_once()


@pytest.mark.asyncio
async def test_sin_nadie_que_se_llame_igual_el_alta_pasa():
    bd = _bd(gemelo=None)

    nuevo = await empleados_service.crear_empleado(bd, _datos())

    assert nuevo.apellido == "Fonzi"
    bd.add.assert_called_once()


@pytest.mark.asyncio
async def test_el_correo_repetido_se_sigue_rechazando_primero():
    # La regla de antes no se pierde.
    bd = _bd(correo_libre=False, gemelo=None)

    with pytest.raises(HTTPException) as error:
        await empleados_service.crear_empleado(bd, _datos())

    assert error.value.status_code == 409
    assert "correo" in error.value.detail
    # Y no lleva el código del duplicado: son dos conflictos distintos.
    assert error.value.error_code != empleados_service.ERROR_EMPLEADO_DUPLICADO


# ─── Un nombre repetido al editar ────────────────────────────────────────────

def _existente(**campos):
    base = dict(
        id_empleado=3,
        nombre="Luis",
        apellido="Fonseca",
        correo="luis.fonseca@teleprogreso.com",
        rol="tecnico",
        estado="activo",
        telefono=None,
        fecha_contratacion=date(2024, 1, 1),
    )
    base.update(campos)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_renombrar_hacia_un_nombre_que_ya_existe_se_para():
    existente = _existente()
    bd = _bd(empleado=existente, gemelo=_gemelo())
    actor = SimpleNamespace(id_empleado=1, rol="admin")

    with pytest.raises(HTTPException) as error:
        await empleados_service.editar_empleado(
            bd, 3, EmpleadoUpdate(apellido="Fonzi"), actor
        )

    assert error.value.status_code == 409
    # El nombre no se tocó.
    assert existente.apellido == "Fonseca"


@pytest.mark.asyncio
async def test_editar_sin_tocar_el_nombre_no_dispara_la_comprobacion():
    # Si la comprobación corriera siempre, nadie podría editar su propio
    # teléfono: choca consigo mismo... y de hecho se excluye por id, pero la
    # consulta de más tampoco tiene por qué hacerse.
    existente = _existente()
    bd = _bd(empleado=existente, gemelo=_gemelo())
    actor = SimpleNamespace(id_empleado=1, rol="admin")

    await empleados_service.editar_empleado(
        bd, 3, EmpleadoUpdate(telefono="1234-5678"), actor
    )

    assert existente.telefono == "1234-5678"


@pytest.mark.asyncio
async def test_permitir_homonimo_no_se_guarda_como_columna():
    # Es permiso para esta petición, no un campo del empleado.
    existente = _existente()
    bd = _bd(empleado=existente, gemelo=None)
    actor = SimpleNamespace(id_empleado=1, rol="admin")

    await empleados_service.editar_empleado(
        bd, 3, EmpleadoUpdate(apellido="Fonzi", permitir_homonimo=True), actor
    )

    assert existente.apellido == "Fonzi"
    assert not hasattr(existente, "permitir_homonimo")
