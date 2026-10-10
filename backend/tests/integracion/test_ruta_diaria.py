from datetime import timedelta

import pytest

from app.core.tiempo import ahora
from tests.soporte_bd import LAT_PRUEBA, LNG_PRUEBA, encabezado, token_de


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_it03_ruta_diaria_solo_trae_la_tarea_del_dia_del_tecnico(
    cliente, siembra, tecnico_a, tecnico_b
):
    momento = ahora()
    ayer = momento - timedelta(days=1)
    tarea_hoy_a = await siembra.tarea(
        tecnico_a, "Instalacion hoy tecnico A",
        lat=LAT_PRUEBA, lng=LNG_PRUEBA, fecha_asignacion=momento.date(),
    )
    await siembra.tarea(tecnico_b, "Instalacion hoy tecnico B", fecha_asignacion=momento.date())
    await siembra.tarea(
        tecnico_a, "Reparacion ayer tecnico A", estado="completado",
        fecha_asignacion=ayer.date(), fecha_completado=ayer,
    )

    respuesta = await cliente.get("/tareas/mi-ruta", headers=encabezado(token_de(tecnico_a)))

    assert respuesta.status_code == 200, respuesta.text
    ruta = respuesta.json()
    assert len(ruta) == 1
    assert ruta[0]["id_tarea"] == tarea_hoy_a.id_tarea
    assert ruta[0]["estado_tarea"] == "pendiente"
    assert ruta[0]["lat"] == pytest.approx(LAT_PRUEBA, abs=1e-9)
    assert ruta[0]["lng"] == pytest.approx(LNG_PRUEBA, abs=1e-9)
