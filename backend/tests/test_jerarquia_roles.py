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