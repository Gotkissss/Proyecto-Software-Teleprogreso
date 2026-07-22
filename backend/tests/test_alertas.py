from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.models.alerta import Alerta
from app.routers.alertas import get_alertas, update_alerta
from app.schemas.alerta import AlertaUpdate


def _alerta(id_alerta: int = 1) -> Alerta:
    return Alerta(
        id_alerta=id_alerta,
        tipo="tarea_vencida",
        severidad="critica",
        estado="pendiente",
        referencia="tarea:10",
        fecha=datetime(2026, 7, 22, 10, 0),
    )


@pytest.mark.asyncio
async def test_get_alertas_devuelve_alertas_filtradas():
    db = MagicMock()
    db.execute = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [_alerta()]
    db.execute.return_value = result

    alertas = await get_alertas(
        db,
        MagicMock(),
        tipo="tarea_vencida",
        severidad="critica",
        estado="pendiente",
    )

    assert len(alertas) == 1
    assert alertas[0].estado == "pendiente"
    db.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_alerta_marca_como_atendida():
    db = MagicMock()
    db.execute = AsyncMock()
    result = MagicMock()
    alerta = _alerta()
    result.scalar_one_or_none.return_value = alerta
    db.execute.return_value = result

    actualizada = await update_alerta(
        1,
        AlertaUpdate(estado="atendida"),
        db,
        MagicMock(),
    )

    assert actualizada.estado == "atendida"


@pytest.mark.asyncio
async def test_update_alerta_inexistente_devuelve_404():
    db = MagicMock()
    db.execute = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute.return_value = result

    with pytest.raises(HTTPException) as error:
        await update_alerta(999, AlertaUpdate(estado="descartada"), db, MagicMock())

    assert error.value.status_code == 404
