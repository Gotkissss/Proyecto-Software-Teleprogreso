"""
Las alertas se crean al abrir la pantalla (regresión encontrada en HU-S10-05).

El hook de auditoría de las sentencias masivas (services/bitacora._auditar_masivo)
preguntaba `resultado.returns_rows`, que solo tiene el resultado síncrono. Con
AsyncSession el INSERT ... RETURNING de las alertas devuelve otro tipo de
resultado, el hook reventaba, la generación hacía rollback en silencio y la
pantalla de Alertas nunca creaba ninguna: solo se veían las de antes.
"""
from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app.core.tiempo import hoy
from app.db.session import AsyncSessionLocal, engine
from app.models.alerta import Alerta
from app.models.bitacora import BitacoraAuditoria
from tests.soporte_bd import encabezado, token_de


@pytest.mark.regresion
@pytest.mark.asyncio
async def test_abrir_alertas_crea_la_de_una_tarea_vencida_y_la_audita(cliente, siembra, tecnico_a, supervisor):
    tarea = await siembra.tarea(tecnico_a, "Tarea vencida de regresión")
    async with engine.begin() as conexion:
        await conexion.execute(
            text("UPDATE tarea SET fecha_finalizacion = :ayer WHERE id_tarea = :id"),
            {"ayer": hoy() - timedelta(days=1), "id": tarea.id_tarea},
        )

    respuesta = await cliente.get("/alertas", headers=encabezado(token_de(supervisor)))

    assert respuesta.status_code == 200, respuesta.text
    referencia = f"tarea:{tarea.id_tarea}"
    assert any(a["referencia"] == referencia for a in respuesta.json())

    async with AsyncSessionLocal() as sesion:
        id_alerta = (
            await sesion.execute(select(Alerta.id_alerta).where(Alerta.referencia == referencia))
        ).scalar_one()
        # Y el INSERT masivo dejó su fila con los ids que creó.
        filas = (
            await sesion.execute(
                select(BitacoraAuditoria.cambios).where(
                    BitacoraAuditoria.entidad == "alerta",
                    BitacoraAuditoria.accion == "crear",
                )
            )
        ).scalars().all()
    assert any(id_alerta in (cambios or {}).get("ids", []) for cambios in filas)
