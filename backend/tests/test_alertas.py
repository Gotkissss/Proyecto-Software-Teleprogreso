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
    # Dos consultas: la de alertas y la que resuelve las referencias a nombres
    # ("tarea:7" → "Cambio de poste dañado"). Antes se exigía una sola, pero
    # sin la segunda la pantalla solo puede mostrar el id crudo.
    assert db.execute.await_count == 2


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
    # El quinto execute es el INSERT de las alertas nuevas y el sexto es la
    # consulta de _resolver_alertas_obsoletas, que no devuelve nada pendiente.
    obsoletas = MagicMock()
    obsoletas.scalars.return_value.all.return_value = []
    db.execute.side_effect = [
        referencias, tareas, tecnicos, materiales, MagicMock(), obsoletas
    ]

    from app.core import config

    hora_original = config.settings.ALERTA_HORA_LIMITE
    config.settings.ALERTA_HORA_LIMITE = "00:00"
    try:
        creadas = await generar_alertas(db)
    finally:
        config.settings.ALERTA_HORA_LIMITE = hora_original

    assert creadas == 3

    # El INSERT es la penúltima consulta: la última es la del resolutor.
    insert = db.execute.await_args_list[-2].args[0]
    sql = str(insert.compile(compile_kwargs={"literal_binds": True}))

    assert "INSERT INTO alerta" in sql
    for tipo, referencia in (
        ("tarea_vencida", "tarea:10"),
        ("tecnico_sin_entrada", "empleado:20"),
        ("stock_critico", "material:30"),
    ):
        assert tipo in sql
        assert referencia in sql

    # Sin ON CONFLICT, dos supervisores abriendo la pantalla a la vez chocan
    # contra el índice único y se cae la generación entera.
    assert "ON CONFLICT DO NOTHING" in sql
    db.flush.assert_awaited_once()
