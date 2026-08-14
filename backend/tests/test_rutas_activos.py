# backend/tests/test_rutas_activos.py
"""
Pruebas de enrutamiento del prefijo /activos.

Tres routers distintos (inventario, carros y activos) cuelgan del mismo
prefijo. Lo único que impedía que `/activos/{id}` capturara `/activos/carros`
era el orden en que main.py los registraba: mover una línea rompía el
inventario en silencio, sin que fallara ningún test.

Al declarar `/{id:int}` la ruta genérica no puede casar con un segmento de
texto, así que el enrutamiento deja de depender del orden. Esto lo fija.
"""

from app.main import app


def _rutas():
    return {
        (ruta.path, metodo)
        for ruta in app.routes
        if hasattr(ruta, "methods")
        for metodo in ruta.methods
    }


def test_la_ruta_generica_de_activos_solo_acepta_enteros():
    """Si vuelve a ser /{id} a secas, se traga /activos/carros y compañía."""
    rutas = {path for path, _ in _rutas()}

    assert "/activos/{id}" not in rutas
    assert "/activos/{id:int}" in rutas


def test_las_rutas_de_texto_bajo_activos_siguen_registradas():
    rutas = {path for path, _ in _rutas()}

    assert "/activos/carros" in rutas
    assert "/activos/materiales" in rutas
    assert "/activos/herramientas" in rutas
    assert "/activos/materiales/bajo-stock" in rutas


def test_carros_no_colisiona_con_la_ruta_generica():
    """
    `/activos/carros` se resuelve contra su router aunque se evalúe después
    que la ruta genérica: 'carros' no es un entero.
    """
    genericas = [p for p, _ in _rutas() if p.startswith("/activos/{")]

    assert genericas, "debería existir la ruta por id"
    assert all(":int" in p for p in genericas)
