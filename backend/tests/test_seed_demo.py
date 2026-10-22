# backend/tests/test_seed_demo.py
"""
El seed de demostración no publica contraseñas (HU-S10-01, tarea 6).

Antes, leer el repositorio bastaba para entrar como admin: el README publicaba
la tabla de credenciales y el seed las imprimía en el log de arranque. Estas
pruebas vigilan las dos puertas que se cerraron:

  1. `imprimir_resumen` no escribe ninguna contraseña en la salida.
  2. README.md, NEUROLAB.md y SEGURIDAD.md no contienen ninguna de las
     contraseñas escritas en `seed.py`.

El seed completo no corre en CI (necesita PostGIS); aquí se prueba lo que es
salida y datos puros, igual que en test_seed_datos.py.
"""
from pathlib import Path

import pytest

import seed

RAIZ = Path(__file__).resolve().parents[2]
DOCUMENTOS = ["README.md", "NEUROLAB.md", "SEGURIDAD.md"]

CONTRASENAS_DEMO = sorted({datos["contrasena"] for datos in seed.EMPLEADOS})


def test_el_seed_tiene_contrasenas_que_vigilar():
    # Si esto falla, las pruebas de abajo pasarían vacías.
    assert CONTRASENAS_DEMO
    assert all(len(clave) >= 8 for clave in CONTRASENAS_DEMO)


def test_el_resumen_no_imprime_ninguna_contrasena(capsys):
    seed.imprimir_resumen()

    salida = capsys.readouterr().out
    for clave in CONTRASENAS_DEMO:
        assert clave not in salida, (
            f"imprimir_resumen escribió una contraseña de demo ({clave!r}) en el log"
        )


def test_el_resumen_sigue_listando_las_cuentas_sin_su_contrasena(capsys):
    # El equipo necesita ver qué cuentas se sembraron; lo que sobra es la clave.
    seed.imprimir_resumen()

    salida = capsys.readouterr().out
    for datos in seed.EMPLEADOS:
        assert datos["correo"] in salida


@pytest.mark.parametrize("nombre", DOCUMENTOS)
def test_los_documentos_no_publican_contrasenas_de_demo(nombre):
    ruta = RAIZ / nombre
    if not ruta.exists():
        pytest.skip(f"{nombre} no está en este checkout")

    texto = ruta.read_text(encoding="utf-8")
    for clave in CONTRASENAS_DEMO:
        assert clave not in texto, (
            f"{nombre} publica la contraseña de demo {clave!r}"
        )