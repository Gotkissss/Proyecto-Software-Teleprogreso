"""
HU-S10-04, tarea 6: un texto largo se rechaza con 422, nunca llega a Postgres
y vuelve como 500.

test_cobertura_limites.py comprueba por reflexión que cada campo tenga tope;
aquí se comprueba por HTTP que el tope de verdad corta la petición, y que el
valor justo en el límite sigue pasando la validación.
"""
import pytest
from fastapi.testclient import TestClient

from app.core.reglas import LONGITUD_MAXIMA_CONTRASENA
from app.main import app
from tests.test_permisos_roles import auth, override_db, _empleado

client = TestClient(app, raise_server_exceptions=False)


def _hay_error_en(res, campo: str) -> bool:
    return any(e["field"].split(" → ")[-1] == campo for e in res.json().get("errors", []))


# (método, ruta, rol, cuerpo base, campo, tope)
CASOS_CUERPO = [
    ("post", "/tareas", "supervisor", {"nombre": "x"}, "nombre", 150),
    ("post", "/tareas", "supervisor", {"nombre": "x"}, "descripcion", 2000),
    ("post", "/tareas", "supervisor", {"nombre": "x"}, "direccion", 255),
    ("patch", "/tareas/1", "supervisor", {}, "nombre", 150),
    ("patch", "/activos/1", "supervisor", {}, "nombre_activo", 150),  # el hueco de 4.1
    ("patch", "/activos/1", "supervisor", {}, "descripcion", 2000),
    ("patch", "/activos/1", "supervisor", {}, "placa", 20),
    ("patch", "/activos/1", "supervisor", {}, "marca", 80),
    ("patch", "/activos/1", "supervisor", {}, "unidad_medida", 30),
    ("post", "/descanso/iniciar", "tecnico", {}, "tipo", 20),
]


@pytest.mark.parametrize("metodo,ruta,rol,base,campo,tope", CASOS_CUERPO)
def test_texto_un_caracter_sobre_el_tope_da_422_y_nunca_500(metodo, ruta, rol, base, campo, tope):
    app.dependency_overrides[__import__("app.db.session", fromlist=["get_db"]).get_db] = override_db(_empleado(rol))
    try:
        res = getattr(client, metodo)(ruta, headers=auth(rol), json={**base, campo: "a" * (tope + 1)})
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 422, res.text
    assert res.json()["error"] == "VALIDATION_ERROR"
    assert _hay_error_en(res, campo)


@pytest.mark.parametrize("metodo,ruta,rol,base,campo,tope", CASOS_CUERPO)
def test_texto_justo_en_el_tope_no_falla_por_longitud(metodo, ruta, rol, base, campo, tope):
    app.dependency_overrides[__import__("app.db.session", fromlist=["get_db"]).get_db] = override_db(_empleado(rol))
    try:
        res = getattr(client, metodo)(ruta, headers=auth(rol), json={**base, campo: "a" * tope})
    finally:
        app.dependency_overrides.clear()

    # Puede fallar por otra razón (la BD es un doble), pero no por el largo.
    assert not (res.status_code == 422 and _hay_error_en(res, campo))


def test_login_correo_demasiado_largo_da_422():
    res = client.post("/auth/login", json={"correo": "a" * 95 + "@x.com", "contrasena": "x"})
    assert res.status_code == 422


def test_login_contrasena_demasiado_larga_da_422():
    res = client.post(
        "/auth/login",
        json={"correo": "a@x.com", "contrasena": "a" * (LONGITUD_MAXIMA_CONTRASENA + 1)},
    )
    assert res.status_code == 422
    assert _hay_error_en(res, "contrasena")


@pytest.mark.parametrize(
    "ruta,rol,parametro,tope",
    [
        ("/tareas", "supervisor", "estado", 30),
        ("/empleados", "admin", "buscar", 100),
        ("/empleados", "admin", "rol", 30),
        ("/alertas", "supervisor", "tipo", 50),
    ],
)
def test_filtro_de_consulta_demasiado_largo_da_422(ruta, rol, parametro, tope):
    app.dependency_overrides[__import__("app.db.session", fromlist=["get_db"]).get_db] = override_db(_empleado(rol))
    try:
        res = client.get(ruta, headers=auth(rol), params={parametro: "a" * (tope + 1)})
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 422
    assert _hay_error_en(res, parametro)
