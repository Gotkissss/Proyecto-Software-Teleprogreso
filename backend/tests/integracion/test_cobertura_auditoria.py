"""
HU-S9-03, tarea 4: cada endpoint que modifica datos deja al menos una fila en
la bitácora, con el actor real, su rol, la IP y el request_id de la respuesta.

Los casos están en casos_auditoria.py; tests/test_cobertura_auditoria.py
comprueba (sin base) que no falte ninguno.
"""
import pytest
from sqlalchemy import select

from app.core.contexto import CABECERA_REQUEST_ID
from app.db.session import AsyncSessionLocal
from app.models.bitacora import BitacoraAuditoria
from tests.integracion.casos_auditoria import CASOS, Escenario
from tests.soporte_bd import IP_CLIENTE


@pytest.mark.integracion
@pytest.mark.asyncio
@pytest.mark.parametrize("metodo, ruta", sorted(CASOS), ids=[f"{m} {r}" for m, r in sorted(CASOS)])
async def test_el_endpoint_deja_fila_en_la_bitacora(cliente, siembra, metodo, ruta):
    escenario = Escenario(cliente, siembra)

    respuesta = await CASOS[(metodo, ruta)](escenario)

    assert respuesta.status_code < 400, respuesta.text
    request_id = respuesta.headers[CABECERA_REQUEST_ID]
    async with AsyncSessionLocal() as sesion:
        filas = (
            await sesion.execute(
                select(BitacoraAuditoria).where(BitacoraAuditoria.request_id == request_id)
            )
        ).scalars().all()

    assert filas, f"{metodo} {ruta} no dejó ninguna fila en la bitácora"
    for fila in filas:
        assert fila.id_actor == escenario.actor.id_empleado
        assert fila.rol_actor == escenario.actor.rol
        assert str(fila.ip) == IP_CLIENTE
        assert len(fila.hash) == 64
