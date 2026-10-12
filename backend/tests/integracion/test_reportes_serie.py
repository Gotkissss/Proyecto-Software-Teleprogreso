"""
HU-S9-04: la serie temporal contra PostgreSQL real cuadra con el reporte
agregado del mismo rango, y el supervisor ya no descarga lo que no consulta.
"""
from datetime import date, datetime, time

import pytest

from app.db.session import AsyncSessionLocal
from app.models.asistencia import Asistencia
from tests.soporte_bd import encabezado, token_de

INICIO, FIN = date(2026, 3, 2), date(2026, 3, 15)  # dos semanas, lunes a domingo


async def _jornada(empleado, dia, entrada, salida):
    async with AsyncSessionLocal() as sesion:
        sesion.add(Asistencia(id_empleado=empleado.id_empleado, fecha=dia, hora_entrada=entrada, hora_salida=salida))
        await sesion.commit()


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_la_serie_suma_lo_mismo_que_el_resumen(cliente, siembra, gerente, tecnico_a):
    await _jornada(tecnico_a, date(2026, 3, 3), time(8), time(16))
    await _jornada(tecnico_a, date(2026, 3, 10), time(9), time(12, 30))
    for dia in (3, 3, 11):
        await siembra.tarea(
            tecnico_a, f"Serie {dia}", estado="completado",
            fecha_completado=datetime(2026, 3, dia, 15, 0),
        )
    cabecera = encabezado(token_de(gerente))
    rango = {"fecha_inicio": INICIO.isoformat(), "fecha_fin": FIN.isoformat(), "empleado": tecnico_a.id_empleado}

    horas = (await cliente.get("/reportes/serie", params={**rango, "metrica": "horas", "agrupar": "semana"}, headers=cabecera)).json()
    tareas = (await cliente.get("/reportes/serie", params={**rango, "metrica": "tareas"}, headers=cabecera)).json()
    resumen = (await cliente.get("/reportes/resumen", params=rango, headers=cabecera)).json()

    assert [p["valor"] for p in horas["puntos"]] == [8.0, 3.5]
    assert horas["total"] * 60 == resumen["total_minutos_trabajados"]
    assert len(tareas["puntos"]) == 14
    assert tareas["total"] == resumen["total_tareas_completadas"] == 3
    assert tareas["puntos"][1]["valor"] == 2  # martes 3


@pytest.mark.integracion
@pytest.mark.asyncio
@pytest.mark.parametrize("ruta", ["/reportes/serie", "/reportes/resumen/exportar"])
async def test_el_supervisor_no_ve_ni_descarga_reportes(cliente, supervisor, ruta):
    respuesta = await cliente.get(
        ruta,
        params={"fecha_inicio": INICIO.isoformat(), "fecha_fin": FIN.isoformat(), "metrica": "horas"},
        headers=encabezado(token_de(supervisor)),
    )
    assert respuesta.status_code == 403
