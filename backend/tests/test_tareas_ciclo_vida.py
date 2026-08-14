# backend/tests/test_tareas_ciclo_vida.py
"""
Pruebas del ciclo de vida de una tarea: iniciar → finalizar.

Cubre los dos fallos que se estaban viendo en producción:

1. El técnico no podía iniciar ninguna tarea que el supervisor hubiera creado
   con fecha programada: el endpoint validaba `fecha_inicio` en lugar del
   estado y respondía "La tarea ya fue iniciada anteriormente".

2. Una tarea cerrada con evidencia seguía apareciendo "en progreso" en el
   panel, porque el cierre no dejaba marca temporal y dependía de un flag que
   viajaba dentro del multipart de la foto.

Se usan mocks de AsyncSession, igual que en test_incidencias.py.
"""

from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.core.tiempo import ahora as ahora_local, hoy as hoy_local
from app.models.empleado import EmpleadoTarea
from app.models.tarea import Tarea
from app.routers.tareas import (
    create_tarea,
    finalizar_tarea,
    iniciar_tarea,
    reasignar_tarea,
    update_tarea,
)
from app.schemas.tarea import TareaCreate, TareaReasignar, TareaUpdate
from app.services.tareas import es_de_hoy, marcar_completada, marcar_reabierta


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _tarea(estado="pendiente", fecha_inicio=None, fecha_completado=None):
    return Tarea(
        id_tarea=1,
        titulo="Instalación fibra óptica",
        estado_tarea=estado,
        prioridad="alta",
        fecha_inicio=fecha_inicio,
        fecha_completado=fecha_completado,
    )


def _empleado(rol="tecnico", id_empleado=2):
    return SimpleNamespace(rol=rol, id_empleado=id_empleado)


def _resultado(valor):
    res = MagicMock()
    res.scalar_one_or_none.return_value = valor
    res.scalar.return_value = valor
    return res


def _db(resultados):
    """AsyncSession simulada que devuelve `resultados` en orden por cada execute."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=resultados)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _asignacion():
    return EmpleadoTarea(id_empleado=2, id_tarea=1)


# ─── Coordenadas en POST/PATCH /tareas ──────────────────────────────────────

@pytest.mark.asyncio
async def test_crear_tarea_guarda_coordenada_servicio():
    db = _db([_resultado(0), _resultado(None)])

    def asignar_id(objeto):
        if isinstance(objeto, Tarea):
            objeto.id_tarea = 1

    db.add.side_effect = asignar_id

    await create_tarea(
        TareaCreate(
            nombre="Instalación en Fraijanes",
            lat=14.4744,
            lng=-90.4425,
        ),
        db,
        _empleado("supervisor"),
    )

    tarea_guardada = db.add.call_args_list[0].args[0]
    assert tarea_guardada.coordenada_servicio == (
        "SRID=4326;POINT(-90.4425 14.4744)"
    )


@pytest.mark.asyncio
async def test_editar_tarea_actualiza_coordenada_servicio():
    tarea = _tarea()
    db = _db([_resultado(tarea), _resultado(0), _resultado(None)])

    await update_tarea(
        1,
        TareaUpdate(lat=14.5, lng=-90.5),
        db,
        _empleado("supervisor"),
    )

    assert tarea.coordenada_servicio == "SRID=4326;POINT(-90.5 14.5)"


@pytest.mark.asyncio
async def test_editar_tarea_permite_eliminar_coordenada_servicio():
    tarea = _tarea()
    tarea.coordenada_servicio = "SRID=4326;POINT(-90.5 14.5)"
    db = _db([_resultado(tarea), _resultado(0), _resultado(None)])

    await update_tarea(
        1,
        TareaUpdate(lat=None, lng=None),
        db,
        _empleado("supervisor"),
    )

    assert tarea.coordenada_servicio is None


# ─── marcar_completada / marcar_reabierta ────────────────────────────────────

def test_marcar_completada_deja_fecha_de_cierre():
    tarea = _tarea(estado="en_progreso", fecha_inicio=date(2026, 7, 30))

    marcar_completada(tarea)

    assert tarea.estado_tarea == "completado"
    assert tarea.fecha_completado is not None
    # No se pisa la fecha de inicio que ya tenía.
    assert tarea.fecha_inicio == date(2026, 7, 30)


def test_marcar_completada_rellena_fecha_inicio_si_falta():
    tarea = _tarea(estado="pendiente")

    marcar_completada(tarea)

    # hoy_local(), no date.today(): marcar_completada usa ahora() de
    # app.core.tiempo, que es hora de Guatemala, no UTC.
    assert tarea.fecha_inicio == hoy_local()


def test_marcar_completada_es_idempotente():
    """Un reintento no debe mover la tarea al día de hoy en el historial."""
    cierre_original = datetime(2026, 7, 25, 14, 30)
    tarea = _tarea(estado="completado", fecha_completado=cierre_original)

    marcar_completada(tarea)

    assert tarea.fecha_completado == cierre_original


def test_reabrir_una_tarea_borra_la_marca_de_cierre():
    tarea = _tarea(estado="completado", fecha_completado=datetime.now())

    marcar_reabierta(tarea)

    assert tarea.fecha_completado is None


def test_es_de_hoy_distingue_el_dia():
    # ahora_local(), no datetime.now(): es_de_hoy compara contra hoy() de
    # app.core.tiempo, que es hora de Guatemala, no UTC.
    assert es_de_hoy(ahora_local()) is True
    assert es_de_hoy(ahora_local() - timedelta(days=1)) is False
    assert es_de_hoy(None) is False


# ─── PATCH /tareas/{id}/iniciar ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tarea_con_fecha_programada_si_se_puede_iniciar():
    """
    Regresión del bug principal: el supervisor crea la tarea con fecha de
    inicio planificada y el técnico debe poder arrancarla igual.
    """
    tarea = _tarea(estado="pendiente", fecha_inicio=date(2026, 7, 31))
    db = _db([_resultado(tarea), _resultado(_asignacion())])

    respuesta = await iniciar_tarea(1, db, _empleado())

    assert respuesta["estado"] == "en_progreso"
    assert tarea.estado_tarea == "en_progreso"
    # La fecha planificada se respeta, no se sobreescribe con hoy.
    assert tarea.fecha_inicio == date(2026, 7, 31)


@pytest.mark.asyncio
async def test_iniciar_tarea_sin_fecha_registra_hoy():
    tarea = _tarea(estado="pendiente")
    db = _db([_resultado(tarea), _resultado(_asignacion())])

    await iniciar_tarea(1, db, _empleado())

    # hoy_local(), no date.today(): iniciar_tarea usa hoy_local() de
    # app.core.tiempo, que es hora de Guatemala, no UTC.
    assert tarea.fecha_inicio == hoy_local()


@pytest.mark.asyncio
async def test_iniciar_una_tarea_ya_en_curso_es_idempotente():
    """Si al técnico se le fue la señal y reintenta, no debe recibir un error."""
    tarea = _tarea(estado="en_progreso", fecha_inicio=date.today())
    db = _db([_resultado(tarea), _resultado(_asignacion())])

    respuesta = await iniciar_tarea(1, db, _empleado())

    assert respuesta["estado"] == "en_progreso"
    assert "ya estaba en curso" in respuesta["message"]


@pytest.mark.asyncio
async def test_no_se_puede_reiniciar_una_tarea_completada():
    tarea = _tarea(estado="completado", fecha_completado=datetime.now())
    db = _db([_resultado(tarea), _resultado(_asignacion())])

    with pytest.raises(HTTPException) as exc:
        await iniciar_tarea(1, db, _empleado())

    assert exc.value.status_code == 400
    assert "completada" in exc.value.detail


@pytest.mark.asyncio
async def test_no_se_puede_iniciar_una_tarea_cancelada():
    tarea = _tarea(estado="cancelado")
    db = _db([_resultado(tarea), _resultado(_asignacion())])

    with pytest.raises(HTTPException) as exc:
        await iniciar_tarea(1, db, _empleado())

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_un_tecnico_no_asignado_no_puede_iniciar():
    tarea = _tarea()
    db = _db([_resultado(tarea), _resultado(None)])  # sin asignación

    with pytest.raises(HTTPException) as exc:
        await iniciar_tarea(1, db, _empleado())

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_iniciar_tarea_inexistente_devuelve_404():
    db = _db([_resultado(None)])

    with pytest.raises(HTTPException) as exc:
        await iniciar_tarea(99, db, _empleado())

    assert exc.value.status_code == 404


# ─── PATCH /tareas/{id}/finalizar ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_finalizar_tarea_marca_completado_y_fecha(monkeypatch):
    tarea = _tarea(estado="en_progreso", fecha_inicio=date.today())

    db = _db([
        _resultado(tarea),        # SELECT tarea
        _resultado(_asignacion()),  # SELECT asignación del técnico
        _resultado(1),            # COUNT de incidencias → hay evidencia
        _resultado(1),            # COUNT dentro de _tarea_a_response
        _resultado(None),         # SELECT del técnico para la respuesta
    ])

    respuesta = await finalizar_tarea(1, db, _empleado())

    assert tarea.estado_tarea == "completado"
    assert tarea.fecha_completado is not None
    assert respuesta.estado_tarea == "completado"
    assert respuesta.fecha_completado is not None


@pytest.mark.asyncio
async def test_no_se_finaliza_una_tarea_sin_evidencia():
    tarea = _tarea(estado="en_progreso")
    db = _db([
        _resultado(tarea),
        _resultado(_asignacion()),
        _resultado(0),  # sin incidencias registradas
    ])

    with pytest.raises(HTTPException) as exc:
        await finalizar_tarea(1, db, _empleado())

    assert exc.value.status_code == 400
    assert "evidencia" in exc.value.detail.lower()
    assert tarea.estado_tarea == "en_progreso"


@pytest.mark.asyncio
async def test_no_se_finaliza_una_tarea_cancelada():
    tarea = _tarea(estado="cancelado")
    db = _db([_resultado(tarea), _resultado(_asignacion())])

    with pytest.raises(HTTPException) as exc:
        await finalizar_tarea(1, db, _empleado())

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_un_tecnico_no_asignado_no_puede_finalizar():
    tarea = _tarea(estado="en_progreso")
    db = _db([_resultado(tarea), _resultado(None)])

    with pytest.raises(HTTPException) as exc:
        await finalizar_tarea(1, db, _empleado())

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_el_supervisor_finaliza_sin_estar_asignado():
    """admin/supervisor se saltan la validación de asignación."""
    tarea = _tarea(estado="en_progreso")
    db = _db([
        _resultado(tarea),
        _resultado(1),     # COUNT incidencias
        _resultado(1),     # COUNT dentro de _tarea_a_response
        _resultado(None),  # técnico de la respuesta
    ])

    await finalizar_tarea(1, db, _empleado(rol="supervisor"))

    assert tarea.estado_tarea == "completado"


# ─── PATCH /tareas/{id}/reasignar ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_no_se_reasigna_una_tarea_completada():
    """
    La pantalla de reasignación ya no las lista, pero la regla tiene que estar
    también en el backend: el trabajo entregado queda ligado a quien lo hizo.
    """
    tarea = _tarea(estado="completado", fecha_completado=datetime.now())
    db = _db([_resultado(tarea)])

    with pytest.raises(HTTPException) as exc:
        await reasignar_tarea(1, TareaReasignar(id_tecnico=5), db, _empleado("supervisor"))

    assert exc.value.status_code == 400
    assert "completado" in exc.value.detail


@pytest.mark.asyncio
async def test_no_se_reasigna_una_tarea_cancelada():
    tarea = _tarea(estado="cancelado")
    db = _db([_resultado(tarea)])

    with pytest.raises(HTTPException) as exc:
        await reasignar_tarea(1, TareaReasignar(id_tecnico=5), db, _empleado("supervisor"))

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_una_tarea_abierta_si_se_reasigna():
    tarea = _tarea(estado="en_progreso")
    tecnico_destino = SimpleNamespace(
        id_empleado=5, nombre="Ana", apellido="López", estado="activo"
    )
    db = _db([
        _resultado(tarea),             # SELECT tarea
        _resultado(tecnico_destino),   # SELECT técnico destino
        _resultado(0),                 # COUNT tareas activas del destino
        _resultado(None),              # DELETE asignaciones previas
        _resultado(0),                 # COUNT incidencias (respuesta)
        _resultado(None),              # técnico de la respuesta
    ])

    respuesta = await reasignar_tarea(
        1, TareaReasignar(id_tecnico=5), db, _empleado("supervisor")
    )

    assert respuesta.id_tarea == 1
    db.add.assert_called_once()
