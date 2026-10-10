from datetime import datetime, timezone

import pytest

import app.core.tiempo as tiempo
from tests.soporte_bd import encabezado, token_de

INSTANTE_UTC = datetime(2026, 3, 11, 2, 0, tzinfo=timezone.utc)


class RelojFijo(datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return INSTANTE_UTC.replace(tzinfo=None)
        return INSTANTE_UTC.astimezone(tz)


@pytest.mark.regresion
@pytest.mark.asyncio
async def test_rg02_ruta_diaria_usa_fecha_local_de_guatemala(cliente, siembra, tecnico_a, monkeypatch):
    del_dia_local = await siembra.tarea(
        tecnico_a, "Cerrada el 10 de marzo hora local", estado="completado",
        fecha_completado=datetime(2026, 3, 10, 19, 30),
    )
    del_dia_utc = await siembra.tarea(
        tecnico_a, "Cerrada el 11 de marzo", estado="completado",
        fecha_completado=datetime(2026, 3, 11, 10, 0),
    )
    monkeypatch.setattr(tiempo, "datetime", RelojFijo)

    assert tiempo.ahora() == datetime(2026, 3, 10, 20, 0)
    respuesta = await cliente.get("/tareas/mi-ruta", headers=encabezado(token_de(tecnico_a)))

    assert respuesta.status_code == 200, respuesta.text
    ids = [tarea["id_tarea"] for tarea in respuesta.json()]
    assert del_dia_local.id_tarea in ids
    assert del_dia_utc.id_tarea not in ids
