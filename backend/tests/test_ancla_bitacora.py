"""
Ancla externa del final de la bitácora, sin base (HU-S10-05, tarea 4).

La comprobación contra PostgreSQL real (borrar el final y que se note) está en
tests/integracion/test_ancla_bitacora.py.
"""
from types import SimpleNamespace

import pytest

import mantenimiento
from app.services import auditoria

HASH = "a" * 64


@pytest.mark.parametrize(
    "texto, esperado",
    [
        (f"12:{HASH}", (12, HASH)),
        (f"12:{HASH.upper()}", (12, HASH)),
        (f"x:{HASH}", None),
        ("12:corto", None),
        (f"12:{'z' * 64}", None),
        (HASH, None),
        ("", None),
    ],
)
def test_leer_ancla(texto, esperado):
    assert mantenimiento._leer_ancla(texto) == esperado


@pytest.mark.parametrize(
    "argumentos",
    [
        ["anclar", "extra"],
        ["alertas", "--ancla", f"1:{HASH}"],
        ["verificar-bitacora", "--ancla"],
        ["verificar-bitacora", "--otra", f"1:{HASH}"],
    ],
)
def test_usos_invalidos(argumentos):
    assert mantenimiento.main(argumentos) == 2


def test_un_ancla_mal_formada_no_llega_a_conectarse(monkeypatch):
    def sin_base():
        raise AssertionError("no debía conectarse")

    monkeypatch.setattr(mantenimiento, "_motor", sin_base)

    assert mantenimiento.main(["verificar-bitacora", "--ancla", "1:no-es-hash"]) == 2


class _Conexion:
    """Responde las dos consultas de comprobar_ancla_sync."""

    def __init__(self, hash_fila, purgada_hasta):
        self.respuestas = [hash_fila, purgada_hasta]

    def execute(self, _consulta):
        valor = self.respuestas.pop(0)
        return SimpleNamespace(scalar_one_or_none=lambda: valor, scalar=lambda: valor)


@pytest.mark.parametrize(
    "hash_fila, purgada_hasta, esperado",
    [
        (HASH, None, auditoria.ANCLA_PRESENTE),
        ("b" * 64, None, auditoria.ANCLA_ALTERADA),
        (None, 50, auditoria.ANCLA_PURGADA),    # la quitó la retención, no un ataque
        (None, 5, auditoria.ANCLA_FALTA),       # la purga no llegó hasta ella
        (None, None, auditoria.ANCLA_FALTA),    # nunca hubo purga
    ],
)
def test_comprobar_ancla(hash_fila, purgada_hasta, esperado):
    conexion = _Conexion(hash_fila, purgada_hasta)

    assert auditoria.comprobar_ancla_sync(conexion, 12, HASH) == esperado
