# backend/tests/test_dependencias_bd.py
"""
T2 del Sprint 9 (FastAPI 0.133): toda dependencia con `yield` que toque la
base o la bitácora tiene que declararse con scope="function".

Desde FastAPI 0.118 el código tras el `yield` corre por defecto DESPUÉS de
enviar la respuesta. Para get_db eso significa que el commit llega tarde (el
cliente ve 200 aunque falle) y, si un endpoint usara otro scope, la petición
abriría DOS sesiones (la caché de dependencias distingue el scope). Esta
prueba recorre el árbol de dependencias de cada ruta y falla si alguna se
salta la regla.
"""
from fastapi.routing import APIRoute

from app.db.session import get_db
from app.main import app


def _recorrer(dependant):
    for sub in dependant.dependencies:
        yield sub
        yield from _recorrer(sub)


def _dependencias_con_yield():
    for ruta in app.routes:
        if not isinstance(ruta, APIRoute):
            continue
        for dependencia in _recorrer(ruta.dependant):
            if dependencia.is_gen_callable or dependencia.is_async_gen_callable:
                yield ruta, dependencia


def test_get_db_siempre_con_scope_function():
    mal = sorted(
        {
            f"{sorted(ruta.methods)[0]} {ruta.path}"
            for ruta, dependencia in _dependencias_con_yield()
            if dependencia.call is get_db and dependencia.computed_scope != "function"
        }
    )
    assert not mal, f"Rutas con get_db fuera de scope='function': {mal}"


def test_ninguna_dependencia_con_yield_corre_despues_de_responder():
    mal = sorted(
        {
            f"{sorted(ruta.methods)[0]} {ruta.path}: {dependencia.call.__name__}"
            for ruta, dependencia in _dependencias_con_yield()
            if dependencia.computed_scope != "function"
        }
    )
    assert not mal, f"Dependencias con yield que se cierran tras la respuesta: {mal}"
