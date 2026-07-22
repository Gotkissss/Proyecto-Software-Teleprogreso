from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models.alerta import Alerta
from app.routers.alertas import get_alertas, update_alerta
from app.schemas.alerta import AlertaUpdate
from app.services.alertas import generar_alertas


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

    with patch("app.routers.alertas.generar_alertas", new=AsyncMock()):
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


@pytest.mark.asyncio
async def test_generar_alertas_crea_las_tres_condiciones():
    db = MagicMock()
    db.execute = AsyncMock()
    db.add_all = MagicMock()
    db.flush = AsyncMock()

    referencias = MagicMock()
    referencias.all.return_value = []
    tareas = MagicMock()
    tareas.all.return_value = [(10,)]
    tecnicos = MagicMock()
    tecnicos.all.return_value = [(20,)]
    materiales = MagicMock()
    materiales.all.return_value = [(30,)]
    db.execute.side_effect = [referencias, tareas, tecnicos, materiales]

    from app.core import config

    hora_original = config.settings.ALERTA_HORA_LIMITE
    config.settings.ALERTA_HORA_LIMITE = "00:00"
    try:
        creadas = await generar_alertas(db)
    finally:
        config.settings.ALERTA_HORA_LIMITE = hora_original

    assert creadas == 3
    nuevas = db.add_all.call_args.args[0]
    assert {(alerta.tipo, alerta.referencia) for alerta in nuevas} == {
        ("tarea_vencida", "tarea:10"),
        ("tecnico_sin_entrada", "empleado:20"),
        ("stock_critico", "material:30"),
    }
    db.flush.assert_awaited_once()
