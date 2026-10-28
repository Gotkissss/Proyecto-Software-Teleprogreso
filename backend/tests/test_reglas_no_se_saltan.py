"""
Las reglas del negocio no se saltan — HU-S10-08.
-----------------------------------------------------------------------------
Dos reglas que el sistema promete y que hasta ahora solo cumplía el camino por
el que entra el técnico:

1. **Ninguna tarea se completa sin evidencia.** La comprobación vivía en
   `PATCH /tareas/{id}/finalizar`. Un admin o un supervisor cerraban la misma
   tarea con `PATCH /tareas/{id}` o con `PATCH /tareas/{id}/estado` y nadie
   miraba nada. El dato sale en los tres reportes del gerente, así que "trabajo
   hecho" significaba dos cosas distintas según por qué pantalla se hubiera
   cerrado la tarea, y el reporte no permitía distinguirlas.

2. **Los vehículos son de los técnicos.** `asignar_tecnico` aceptaba cualquier
   empleado activo, así que un supervisor podía quedar con un vehículo
   asignado: el inventario lo contaba "en uso", el reporte de activos lo
   atribuía a quien no sale a campo, y la liberación en cascada al desactivar
   la cuenta está escrita pensando en técnicos.

Lo que se prueba no es cada camino por separado, sino que los tres coinciden:
una prueba que solo cubriera `/finalizar` seguiría pasando con el agujero
abierto, porque ese era el único camino que ya cumplía la regla.
-----------------------------------------------------------------------------
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.schemas.tarea import TareaUpdate, TareaUpdateEstado
from app.services import carros as carros_service
from app.services import tareas as tareas_service


# ── Andamiaje ───────────────────────────────────────────────────────────────

def _tarea(estado="en_progreso"):
    return Tarea(
        id_tarea=1,
        titulo="Instalación fibra óptica",
        estado_tarea=estado,
        prioridad="alta",
    )


def _resultado(valor):
    res = MagicMock()
    res.scalar_one_or_none.return_value = valor
    res.scalar.return_value = valor
    return res


def _db(resultados):
    """
    AsyncSession simulada que devuelve `resultados` en orden.

    Agotada la lista sigue devolviendo un resultado vacío en vez de romper con
    StopIteration: así una prueba solo tiene que declarar las consultas que le
    importan, y no todas las que haga de paso el armado de la respuesta.
    """
    pendientes = list(resultados)

    async def _execute(*_args, **_kwargs):
        return pendientes.pop(0) if pendientes else _resultado(None)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


@pytest.fixture(autouse=True)
def _sin_jornada(monkeypatch):
    monkeypatch.setattr(tareas_service, "exigir_jornada_abierta", AsyncMock())
    monkeypatch.setattr(tareas_service, "registrar_evento_tarea", AsyncMock())


# ── 1. Evidencia obligatoria por los tres caminos ───────────────────────────

@pytest.mark.asyncio
async def test_patch_tarea_no_completa_sin_evidencia():
    """El camino del admin y del supervisor: PATCH /tareas/{id}."""
    tarea = _tarea()
    db = _db([
        _resultado(tarea),      # la tarea
        _resultado(0),          # tareas activas del técnico (límite al reabrir)
        _resultado(0),          # incidencias: ninguna
    ])

    with pytest.raises(HTTPException) as error:
        await tareas_service.editar_tarea(
            db, 1, TareaUpdate(estado="completado")
        )

    assert error.value.status_code == 409
    assert "evidencia" in error.value.detail.lower()
    # Y la tarea no se movió: el rechazo va ANTES de tocar el estado.
    assert tarea.estado_tarea == "en_progreso"
    assert tarea.fecha_completado is None


@pytest.mark.asyncio
async def test_patch_estado_no_completa_sin_evidencia():
    """El otro camino: PATCH /tareas/{id}/estado."""
    tarea = _tarea()
    db = _db([_resultado(tarea), _resultado(0), _resultado(0)])

    with pytest.raises(HTTPException) as error:
        await tareas_service.actualizar_estado(
            db, 1, TareaUpdateEstado(estado="completado")
        )

    assert error.value.status_code == 409
    assert tarea.estado_tarea == "en_progreso"


@pytest.mark.asyncio
async def test_finalizar_no_completa_sin_evidencia():
    """El camino del técnico, que es el que ya cumplía la regla."""
    tarea = _tarea()
    db = _db([
        _resultado(tarea),
        _resultado(EmpleadoTarea(id_empleado=2, id_tarea=1)),
        _resultado(0),
    ])

    with pytest.raises(HTTPException) as error:
        await tareas_service.finalizar_tarea(
            db, 1, SimpleNamespace(rol="tecnico", id_empleado=2)
        )

    assert error.value.status_code == 409
    assert tarea.estado_tarea == "en_progreso"


@pytest.mark.asyncio
async def test_los_tres_caminos_dan_el_mismo_codigo_y_el_mismo_motivo():
    """
    Que las tres respuestas coincidan es el punto de la historia: con códigos
    distintos, el frontend tendría que saber por qué pantalla se cerró la tarea
    para decidir qué mensaje enseñar.
    """
    respuestas = []

    tarea = _tarea()
    with pytest.raises(HTTPException) as e1:
        await tareas_service.editar_tarea(
            _db([_resultado(tarea), _resultado(0), _resultado(0)]),
            1,
            TareaUpdate(estado="completado"),
        )
    respuestas.append((e1.value.status_code, e1.value.detail))

    tarea = _tarea()
    with pytest.raises(HTTPException) as e2:
        await tareas_service.actualizar_estado(
            _db([_resultado(tarea), _resultado(0), _resultado(0)]),
            1,
            TareaUpdateEstado(estado="completado"),
        )
    respuestas.append((e2.value.status_code, e2.value.detail))

    tarea = _tarea()
    with pytest.raises(HTTPException) as e3:
        await tareas_service.finalizar_tarea(
            _db([
                _resultado(tarea),
                _resultado(EmpleadoTarea(id_empleado=2, id_tarea=1)),
                _resultado(0),
            ]),
            1,
            SimpleNamespace(rol="tecnico", id_empleado=2),
        )
    respuestas.append((e3.value.status_code, e3.value.detail))

    assert len(set(respuestas)) == 1, respuestas


@pytest.mark.asyncio
async def test_con_evidencia_si_se_completa_por_patch():
    """
    El contrapeso: sin esta prueba, un `raise` incondicional dejaría pasar
    todas las de arriba y nadie podría cerrar una tarea nunca.
    """
    tarea = _tarea()
    db = _db([
        _resultado(tarea),
        _resultado(2),          # dos evidencias registradas
        _resultado(None),       # el técnico asignado, al armar la respuesta
    ])

    await tareas_service.editar_tarea(
        db, 1, TareaUpdate(estado="completado")
    )

    assert tarea.estado_tarea == "completado"
    assert tarea.fecha_completado is not None


@pytest.mark.asyncio
async def test_reabrir_o_cancelar_no_pide_evidencia():
    """
    La regla es sobre 'completado' y solo sobre eso. Pedir evidencia para
    cancelar dejaría sin salida a una tarea creada por error, que es
    precisamente el caso para el que existe 'cancelado'.
    """
    tarea = _tarea(estado="completado")
    db = _db([
        _resultado(tarea),
        _resultado(0),
        _resultado(None),
    ])

    await tareas_service.actualizar_estado(
        db, 1, TareaUpdateEstado(estado="cancelado")
    )

    assert tarea.estado_tarea == "cancelado"


# ── 2. Los vehículos son de los técnicos ────────────────────────────────────

def _empleado(rol: str, estado: str = "activo") -> Empleado:
    return Empleado(
        id_empleado=5,
        nombre="Lucía",
        apellido="Ramírez",
        correo=f"{rol}@teleprogreso.com",
        rol=rol,
        estado=estado,
        hash_contrasena="hash",
    )


def _db_asignacion(empleado):
    """
    Resultados en el orden en que `asignar_tecnico` los pide: el vehículo (con
    su activo), el empleado y, si llegara tan lejos, las asignaciones previas.
    """
    from app.models.activo import Activo, Carro

    activo = Activo(id_activo=9, nombre_activo="Pick-up 4x4")
    carro = Carro(id_activo=9, placa="P-123ABC", estado_vehiculo="disponible")

    fila_carro = MagicMock()
    fila_carro.one_or_none.return_value = (activo, carro)

    def _sin_filas():
        """`scalars().first()` tiene que dar None: en un MagicMock daría otro
        MagicMock, que es truthy, y el servicio lo leería como una asignación
        que ya existe."""
        res = MagicMock()
        res.scalars.return_value.first.return_value = None
        return res

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[
        fila_carro,
        _resultado(empleado),
        _sin_filas(),   # el técnico no tiene otro vehículo
        _sin_filas(),   # el vehículo no tiene otro técnico
    ])
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db, carro


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["supervisor", "admin", "gerente"])
async def test_un_vehiculo_no_se_asigna_a_quien_no_es_tecnico(rol):
    empleado = _empleado(rol)
    db, carro = _db_asignacion(empleado)

    with pytest.raises(HTTPException) as error:
        await carros_service.asignar_tecnico(db, 9, empleado.id_empleado)

    assert error.value.status_code == 400
    assert "tecnico" in error.value.detail.lower()
    # El vehículo se queda disponible: el rechazo va antes de marcarlo en uso.
    assert carro.estado_vehiculo == "disponible"
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_a_un_tecnico_si_se_le_asigna():
    empleado = _empleado("tecnico")
    db, carro = _db_asignacion(empleado)

    await carros_service.asignar_tecnico(db, 9, empleado.id_empleado)

    assert carro.estado_vehiculo == "en_uso"
    db.add.assert_called_once()


@pytest.mark.asyncio
async def test_un_tecnico_inactivo_sigue_rechazandose_por_su_estado():
    """
    La comprobación de rol se añadió DESPUÉS de la de estado, a propósito: un
    técnico desactivado tiene que seguir recibiendo el mensaje de siempre y no
    uno nuevo sobre roles.
    """
    empleado = _empleado("tecnico", estado="inactivo")
    db, _ = _db_asignacion(empleado)

    with pytest.raises(HTTPException) as error:
        await carros_service.asignar_tecnico(db, 9, empleado.id_empleado)

    assert error.value.status_code == 400
    assert "activo" in error.value.detail.lower()
