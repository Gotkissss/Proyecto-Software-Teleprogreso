import pytest

from tests.soporte_bd import CONTRASENA_PRUEBA, encabezado


def _alterar_firma(token):
    cabecera, carga, firma = token.split(".")
    reemplazo = "A" if firma[10] != "A" else "B"
    return f"{cabecera}.{carga}.{firma[:10]}{reemplazo}{firma[11:]}"


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_it01_login_y_endpoint_protegido(cliente, tecnico_a):
    respuesta = await cliente.post(
        "/auth/login",
        json={"correo": tecnico_a.correo, "contrasena": CONTRASENA_PRUEBA},
    )
    assert respuesta.status_code == 200, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo["id_empleado"] == tecnico_a.id_empleado
    assert cuerpo["rol"] == "tecnico"
    token = cuerpo["access_token"]

    con_token = await cliente.get("/tareas/mi-ruta", headers=encabezado(token))
    assert con_token.status_code == 200, con_token.text
    assert con_token.json() == []

    sin_token = await cliente.get("/tareas/mi-ruta")
    assert sin_token.status_code == 401

    alterado = await cliente.get("/tareas/mi-ruta", headers=encabezado(_alterar_firma(token)))
    assert alterado.status_code == 401
