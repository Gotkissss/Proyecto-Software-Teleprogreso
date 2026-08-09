# backend/tests/test_consistencia_cascada.py
"""
Efectos en cascada y datos que quedan colgando — Teleprogreso S.A.
-----------------------------------------------------------------------------
Los bugs que cubre esta suite no rompen una pantalla: dejan la base en un
estado que ninguna pantalla sabe explicar. Un vehículo que nadie puede usar
porque su dueño ya no existe, una jornada que nunca cerrará, una tarea
"completada" sin ninguna evidencia detrás.

Se ejecutan con: pytest tests/ -v
"""

from datetime import date, datetime, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.empleados import HORA_CIERRE_FORZADO, desvincular_recursos


def _db(por_consulta):
    """
    AsyncSession falsa que responde según qué tabla se consulte.

    `por_consulta` es {fragmento_del_sql: [filas]}. Se elige la primera clave
    que aparezca en el texto de la consulta.
    """
    db = AsyncMock()
    borrados = []

    async def _execute(statement, *args, **kwargs):
        texto = str(statement).lower()
        filas = []
        for clave, valor in por_consulta.items():
            if clave in texto:
                filas = valor
                break
        resultado = MagicMock()
        resultado.scalars.return_value.all.return_value = filas
        resultado.scalars.return_value.first.return_value = filas[0] if filas else None
        resultado.scalar.return_value = filas[0] if filas else 0
        return resultado

    db.execute = AsyncMock(side_effect=_execute)
    db.delete = AsyncMock(side_effect=lambda obj: borrados.append(obj))
    db.flush = AsyncMock()
    db.borrados = borrados
    return db


def _empleado():
    return SimpleNamespace(id_empleado=4, correo="tec@x.com", rol="tecnico")


# ─── 1. El vehículo se libera ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_desactivar_libera_el_vehiculo():
    """
    Antes el vehículo quedaba en 'en_uso' y asignado a alguien que ya no puede
    entrar: nadie más podía usarlo hasta que un supervisor se acordara de
    liberarlo a mano desde Inventario.
    """
    carro = SimpleNamespace(id_activo=9, placa="P-472BCR", estado_vehiculo="en_uso")
    asignacion = SimpleNamespace(id_empleado=4, id_carro=9)

    db = _db({
        "from empleado_carro": [asignacion],
        "from carro": [carro],
        "from asistencia": [],
        "count": [0],
    })

    resultado = await desvincular_recursos(db, _empleado())

    assert carro.estado_vehiculo == "disponible"
    assert asignacion in db.borrados
    assert resultado.vehiculo_liberado == "P-472BCR"


@pytest.mark.asyncio
async def test_desactivar_a_quien_no_tiene_vehiculo_no_rompe():
    db = _db({"from empleado_carro": [], "from asistencia": [], "count": [0]})

    resultado = await desvincular_recursos(db, _empleado())

    assert resultado.vehiculo_liberado is None


# ─── 2. La jornada abierta se cierra ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_jornada_de_hoy_se_cierra_con_la_hora_actual():
    """Nunca va a marcar salida: si no se cierra aquí, queda abierta siempre."""
    jornada = SimpleNamespace(
        id_asistencia=1, fecha=date.today(), hora_salida=None
    )
    db = _db({
        "from empleado_carro": [],
        "from asistencia": [jornada],
        "from descanso": [],
        "count": [0],
    })

    resultado = await desvincular_recursos(db, _empleado())

    assert jornada.hora_salida is not None
    assert jornada.hora_salida != HORA_CIERRE_FORZADO  # es la hora real, no 23:59
    assert resultado.jornadas_cerradas == 1


@pytest.mark.asyncio
async def test_jornada_vieja_se_cierra_al_final_de_su_dia():
    """
    Una jornada de otro día no se cierra con la hora de hoy: eso inventaría
    horas trabajadas que nadie hizo.
    """
    jornada = SimpleNamespace(
        id_asistencia=1, fecha=date(2020, 1, 1), hora_salida=None
    )
    db = _db({
        "from empleado_carro": [],
        "from asistencia": [jornada],
        "from descanso": [],
        "count": [0],
    })

    await desvincular_recursos(db, _empleado())

    assert jornada.hora_salida == HORA_CIERRE_FORZADO


@pytest.mark.asyncio
async def test_la_pausa_en_curso_se_cierra_con_la_jornada():
    """
    Una pausa abierta dentro de una jornada ya cerrada se contabiliza desde su
    inicio hasta la salida, e infla el tiempo de descanso del historial.
    """
    jornada = SimpleNamespace(id_asistencia=1, fecha=date(2020, 1, 1), hora_salida=None)
    pausa = SimpleNamespace(id_descanso=1, hora_fin=None)
    db = _db({
        "from empleado_carro": [],
        "from asistencia": [jornada],
        "from descanso": [pausa],
        "count": [0],
    })

    await desvincular_recursos(db, _empleado())

    assert pausa.hora_fin == HORA_CIERRE_FORZADO


# ─── 3. Las tareas se cuentan, no se borran ──────────────────────────────────

@pytest.mark.asyncio
async def test_las_tareas_activas_se_reportan_sin_desasignarlas():
    """
    Desasignar automáticamente borraría a quién se le habían dado, que es el
    dato que hace falta para repartirlas. Se informa para que alguien actúe.
    """
    db = _db({
        "from empleado_carro": [],
        "from asistencia": [],
        "count": [3],
    })

    resultado = await desvincular_recursos(db, _empleado())

    assert resultado.tareas_activas == 3
    # Ninguna asignación de tarea se borró.
    assert db.borrados == []
