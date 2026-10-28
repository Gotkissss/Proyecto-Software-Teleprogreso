"""
RTF-01 — moderados de validación (R1-3, R1-4 y R2-5).
-----------------------------------------------------------------------------
Los tres son del mismo tipo: un campo que solo comprobaba que no estuviera
vacío, y datos que entraron por ahí.

  · **R1-3** El empleado «1235 Fonzi» y nombres como «@@@». Un nombre que no
    es un nombre no se puede buscar, sale así en los reportes y en la bitácora,
    y convierte la lista de empleados en algo ilegible.
  · **R1-4** Teléfonos de 10 dígitos (6767676767), que no son un número de
    Guatemala y nadie puede marcar. El campo exigía 7 como mínimo.
  · **R2-5** Dirección y ubicación eran las dos opcionales, así que una tarea
    de campo nacía sin saber dónde es: no aparecía en el mapa del técnico.
-----------------------------------------------------------------------------
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app.core.reglas import (
    DIGITOS_TELEFONO,
    MIN_LETRAS_NOMBRE,
    validar_nombre_persona,
    validar_telefono,
)
from app.schemas.empleado import EmpleadoCreate, EmpleadoUpdate
from app.schemas.tarea import TareaCreate, TareaUpdate

CLAVE = "Jacaranda-Fraijanes-84"


def _crear(**campos):
    base = dict(
        nombre="Ana",
        apellido="López",
        correo="ana.lopez@teleprogreso.com",
        contrasena=CLAVE,
        rol="tecnico",
        fecha_contratacion=date(2025, 1, 15),
    )
    base.update(campos)
    return EmpleadoCreate(**base)


# ══ R1-3 — El nombre tiene que parecer un nombre ═══════════════════════════

@pytest.mark.parametrize(
    "nombre",
    [
        "12345",        # el del informe: «1235 Fonzi»
        "@@@",
        "...",
        "   ",
        "",
        "1",
        "A",            # una sola letra
        "Juan3",
        "Ana_María",
        "<script>",
        "O''Neil 99",
    ],
)
def test_un_nombre_que_no_es_un_nombre_se_rechaza(nombre):
    with pytest.raises(ValidationError):
        _crear(nombre=nombre)


@pytest.mark.parametrize(
    "nombre",
    [
        "Ana",
        "María José",
        "Pérez-Luna",
        "D'León",
        "de la Cruz",
        "Ñandú",
        "José Ángel",
    ],
)
def test_los_nombres_reales_pasan(nombre):
    """
    El contrapeso. Un patrón demasiado estricto es peor que ninguno: deja a
    gente sin poder registrarse y obliga a escribir su nombre mal.
    """
    assert _crear(nombre=nombre).nombre == nombre


def test_los_espacios_de_sobra_se_normalizan():
    """Dos personas con el mismo nombre y distinto espaciado son un duplicado."""
    assert _crear(nombre="  María   José  ").nombre == "María José"


def test_el_apellido_sigue_la_misma_regla():
    with pytest.raises(ValidationError):
        _crear(apellido="12345")


def test_editar_no_es_mas_permisivo_que_crear():
    """Si lo fuera, el agujero seguiría abierto por la otra puerta."""
    with pytest.raises(ValidationError):
        EmpleadoUpdate(nombre="12345")


def test_el_minimo_de_letras_esta_declarado():
    assert MIN_LETRAS_NOMBRE >= 2
    with pytest.raises(ValueError):
        validar_nombre_persona("A" * (MIN_LETRAS_NOMBRE - 1))


# ══ R1-4 — Teléfono de 8 dígitos ═══════════════════════════════════════════

@pytest.mark.parametrize(
    "telefono,esperado",
    [
        ("12345678", "1234-5678"),
        ("1234-5678", "1234-5678"),
        ("1234 5678", "1234-5678"),
        ("+502 1234-5678", "1234-5678"),
        ("(1234) 5678", "1234-5678"),
    ],
)
def test_un_telefono_valido_se_normaliza(telefono, esperado):
    """
    Se acepta lo que la gente escribe y se guarda una sola forma: con dos
    formatos en la tabla, la lista de empleados mezcla «55500001» y
    «5550-0001» y no se puede buscar por número.
    """
    assert validar_telefono(telefono) == esperado
    assert _crear(telefono=telefono).telefono == esperado


@pytest.mark.parametrize(
    "telefono",
    [
        "6767676767",   # el del informe: 10 dígitos
        "1234567",      # 7, que es lo que el campo aceptaba
        "123456789",
        "abcdefgh",
        "----",
    ],
)
def test_un_telefono_que_no_es_de_guatemala_se_rechaza(telefono):
    with pytest.raises(ValidationError):
        _crear(telefono=telefono)


def test_el_telefono_sigue_siendo_opcional():
    """
    Hay empleados sin teléfono y eso no es un error: el informe lo menciona
    como dato, no como defecto. Exigirlo ahora dejaría sin poder editar a quien
    no lo tenga.
    """
    assert _crear(telefono=None).telefono is None
    assert _crear(telefono="   ").telefono is None


def test_editar_el_telefono_sigue_la_misma_regla():
    with pytest.raises(ValidationError):
        EmpleadoUpdate(telefono="6767676767")
    assert EmpleadoUpdate(telefono="12345678").telefono == "1234-5678"


def test_la_cantidad_de_digitos_esta_declarada():
    assert DIGITOS_TELEFONO == 8


# ══ R2-5 — Una tarea sabe dónde es ═════════════════════════════════════════

def test_una_tarea_sin_direccion_ni_punto_no_se_crea():
    with pytest.raises(ValidationError) as error:
        TareaCreate(nombre="Instalar acometida")

    mensaje = str(error.value).lower()
    assert "direcci" in mensaje and "mapa" in mensaje


def test_basta_la_direccion():
    tarea = TareaCreate(nombre="Instalar acometida", direccion="Calle 15, Fraijanes")
    assert tarea.lat is None


def test_basta_el_punto_del_mapa():
    tarea = TareaCreate(nombre="Instalar acometida", lat=14.4728, lng=-90.4408)
    assert tarea.direccion is None


def test_una_direccion_en_blanco_no_cuenta():
    with pytest.raises(ValidationError):
        TareaCreate(nombre="Instalar acometida", direccion="  \t ")


def test_editar_una_tarea_no_exige_la_ubicacion():
    """
    La regla es al CREAR. Las tareas que ya existen sin ubicación son válidas
    —hay unas cuantas— y el modal de edición ahora permite ponérsela (T6 del
    Sprint 10). Exigirla al editar dejaría esas tareas sin forma de arreglarse:
    no se podría ni corregirles el título.
    """
    assert TareaUpdate(nombre="Otro título").nombre == "Otro título"


def test_la_coordenada_sigue_viajando_como_par():
    """Lo que no cambia: media coordenada no es una ubicación."""
    with pytest.raises(ValidationError):
        TareaCreate(nombre="Instalar acometida", lat=14.4728)
