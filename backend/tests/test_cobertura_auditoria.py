# backend/tests/test_cobertura_auditoria.py
"""
HU-S9-03, tarea 4: ningún endpoint que modifique datos puede nacer sin
auditoría. Esta prueba no necesita base: compara las rutas reales de la app
con el catálogo de tests/integracion/casos_auditoria.py, cuya ejecución contra
PostGIS (tests/integracion/test_cobertura_auditoria.py) comprueba que cada
llamada deja su fila en la bitácora.

Si falla porque añadiste un endpoint, escribe su caso en casos_auditoria.py.
"""
from fastapi.routing import APIRoute

from app.main import app
from tests.integracion.casos_auditoria import CASOS

METODOS_QUE_MUTAN = {"POST", "PUT", "PATCH", "DELETE"}


def _endpoints_que_mutan() -> set[tuple[str, str]]:
    return {
        (metodo, ruta.path)
        for ruta in app.routes
        if isinstance(ruta, APIRoute)
        for metodo in ruta.methods & METODOS_QUE_MUTAN
    }


def test_todo_endpoint_que_modifica_datos_tiene_su_caso_de_auditoria():
    sin_caso = sorted(_endpoints_que_mutan() - set(CASOS))
    assert not sin_caso, (
        "Endpoints que modifican datos sin caso en tests/integracion/casos_auditoria.py "
        f"(su auditoría no está comprobada): {sin_caso}"
    )


def test_el_catalogo_no_tiene_casos_de_endpoints_que_ya_no_existen():
    sobrantes = sorted(set(CASOS) - _endpoints_que_mutan())
    assert not sobrantes, f"Casos de auditoría sin endpoint: {sobrantes}"


def test_la_cuenta_cuadra_con_el_plan_del_sprint():
    # 31 endpoints mutantes al cierre de HU-S9-03. Si cambia, que sea a
    # propósito: el catálogo y esta cifra se actualizan juntos.
    assert len(_endpoints_que_mutan()) == len(CASOS) == 31
