import pytest

from tests.soporte_bd import encabezado, token_de

RANGO = {"fecha_inicio": "2026-03-01", "fecha_fin": "2026-03-31"}


@pytest.mark.regresion
@pytest.mark.asyncio
@pytest.mark.parametrize("rol, esperado", [("tecnico", 403), ("supervisor", 403), ("gerente", 200)])
async def test_rg03_reporte_asistencia_json_por_rol(cliente, siembra, rol, esperado):
    empleado = await siembra.empleado(rol)

    respuesta = await cliente.get(
        "/reportes/asistencia", params=RANGO, headers=encabezado(token_de(empleado))
    )

    assert respuesta.status_code == esperado, respuesta.text


@pytest.mark.regresion
@pytest.mark.asyncio
@pytest.mark.parametrize("rol, esperado", [("tecnico", 403), ("supervisor", 200), ("gerente", 200)])
async def test_rg03_reporte_asistencia_excel_por_rol(cliente, siembra, rol, esperado):
    empleado = await siembra.empleado(rol)

    respuesta = await cliente.get(
        "/reportes/asistencia/exportar", params=RANGO, headers=encabezado(token_de(empleado))
    )

    assert respuesta.status_code == esperado, respuesta.text
    if esperado == 200:
        assert respuesta.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
