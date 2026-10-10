import pytest
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select

from app.db.session import AsyncSessionLocal
from app.models.ubicacion import UbicacionEmpleado
from tests.soporte_bd import LAT_PRUEBA, LNG_PRUEBA, encabezado, token_de


async def _contar_ubicaciones(id_empleado=None):
    consulta = select(func.count(UbicacionEmpleado.id_ubicacion))
    if id_empleado is not None:
        consulta = consulta.where(UbicacionEmpleado.id_empleado == id_empleado)
    async with AsyncSessionLocal() as sesion:
        return (await sesion.execute(consulta)).scalar_one()


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_it02_ubicacion_con_jornada_se_guarda_en_postgis(cliente, tecnico_a, jornada_abierta_a):
    respuesta = await cliente.post(
        "/ubicaciones",
        json={"lat": LAT_PRUEBA, "lng": LNG_PRUEBA},
        headers=encabezado(token_de(tecnico_a)),
    )
    assert respuesta.status_code == 201, respuesta.text
    id_ubicacion = respuesta.json()["id_ubicacion"]

    coord = cast(UbicacionEmpleado.coordenada, Geometry)
    async with AsyncSessionLocal() as sesion:
        fila = (
            await sesion.execute(
                select(UbicacionEmpleado.id_empleado, func.ST_Y(coord), func.ST_X(coord))
                .where(UbicacionEmpleado.id_ubicacion == id_ubicacion)
            )
        ).one()

    assert fila[0] == tecnico_a.id_empleado
    assert fila[1] == pytest.approx(LAT_PRUEBA, abs=1e-9)
    assert fila[2] == pytest.approx(LNG_PRUEBA, abs=1e-9)


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_it02_ubicacion_sin_jornada_se_rechaza(cliente, tecnico_b):
    total_antes = await _contar_ubicaciones()

    respuesta = await cliente.post(
        "/ubicaciones",
        json={"lat": LAT_PRUEBA, "lng": LNG_PRUEBA},
        headers=encabezado(token_de(tecnico_b)),
    )

    assert respuesta.status_code == 409, respuesta.text
    assert await _contar_ubicaciones(tecnico_b.id_empleado) == 0
    assert await _contar_ubicaciones() == total_antes
