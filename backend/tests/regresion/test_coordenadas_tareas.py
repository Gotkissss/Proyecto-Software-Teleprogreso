import pytest

from tests.soporte_bd import LAT_PRUEBA, LNG_PRUEBA, encabezado, token_de


@pytest.mark.regresion
@pytest.mark.asyncio
async def test_rg01_get_tareas_convierte_coordenadas(cliente, siembra, tecnico_a):
    con_punto = await siembra.tarea(tecnico_a, "Tarea con coordenada", lat=LAT_PRUEBA, lng=LNG_PRUEBA)
    sin_punto = await siembra.tarea(tecnico_a, "Tarea sin coordenada")

    respuesta = await cliente.get("/tareas", headers=encabezado(token_de(tecnico_a)))

    assert respuesta.status_code == 200, respuesta.text
    tareas = {tarea["id_tarea"]: tarea for tarea in respuesta.json()}
    assert set(tareas) == {con_punto.id_tarea, sin_punto.id_tarea}
    assert tareas[con_punto.id_tarea]["lat"] == pytest.approx(LAT_PRUEBA, abs=1e-9)
    assert tareas[con_punto.id_tarea]["lng"] == pytest.approx(LNG_PRUEBA, abs=1e-9)
    assert tareas[sin_punto.id_tarea]["lat"] is None
    assert tareas[sin_punto.id_tarea]["lng"] is None
