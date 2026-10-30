"""
RTF-01 — los tres severos de jornada y pausas (R3-1, R3-2, R3-3).
-----------------------------------------------------------------------------
Los tres atacan lo mismo: el sistema existe para decir cuánto trabajó cada
persona, y los tres dejaban ese número sin significado.

  · **R3-1** Con una pausa en curso se podía iniciar una tarea. Las horas de la
    pausa se descuentan de la jornada mientras la tarea avanza, así que el
    reporte de productividad contaba trabajo hecho en tiempo que el mismo
    reporte restaba.
  · **R3-2** Se podía cerrar la jornada con una tarea «En curso». La tarea
    quedaba huérfana y el técnico sin poder terminarla: finalizar exige
    jornada abierta, así que la única salida era marcar una entrada nueva al
    día siguiente, falseando la asistencia.
  · **R3-3** Las jornadas que el sistema cierra a las 23:59:59 porque nadie
    marcó salida se contaban como trabajadas: una entrada a las 19:01 aparecía
    como 4 h 58.
-----------------------------------------------------------------------------
"""
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.models.asistencia import Asistencia, Descanso
from app.routers import asistencia as router_asistencia
from app.services import ubicaciones as ubicaciones_service
from app.services.asistencia import calcular_jornada

HOY = date(2026, 10, 28)


def _resultado(filas):
    res = MagicMock()
    res.scalars.return_value.all.return_value = list(filas)
    res.scalars.return_value.first.return_value = filas[0] if filas else None
    res.scalar_one_or_none.return_value = filas[0] if filas else None
    return res


def _db(*resultados):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(resultados))
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _tecnico(id_empleado=2):
    return SimpleNamespace(
        id_empleado=id_empleado, nombre="Juan", apellido="Pérez", rol="tecnico"
    )


# ══ R3-1 — No se trabaja en tareas con una pausa en curso ══════════════════

@pytest.mark.asyncio
async def test_con_una_pausa_en_curso_no_se_puede_trabajar(monkeypatch):
    jornada = SimpleNamespace(id_asistencia=5)
    pausa = Descanso(id_descanso=9, id_asistencia=5, hora_inicio=time(12, 0))
    monkeypatch.setattr(
        ubicaciones_service, "jornada_en_curso", AsyncMock(return_value=jornada)
    )
    monkeypatch.setattr(
        ubicaciones_service, "pausa_en_curso", AsyncMock(return_value=pausa)
    )

    with pytest.raises(HTTPException) as error:
        await ubicaciones_service.exigir_jornada_abierta(MagicMock(), _tecnico())

    assert error.value.status_code == 409
    assert "pausa" in error.value.detail.lower()


@pytest.mark.asyncio
async def test_sin_pausa_se_puede_trabajar(monkeypatch):
    """El contrapeso: sin esto, un `raise` incondicional pasaría la de arriba."""
    monkeypatch.setattr(
        ubicaciones_service,
        "jornada_en_curso",
        AsyncMock(return_value=SimpleNamespace(id_asistencia=5)),
    )
    monkeypatch.setattr(
        ubicaciones_service, "pausa_en_curso", AsyncMock(return_value=None)
    )

    await ubicaciones_service.exigir_jornada_abierta(MagicMock(), _tecnico())


@pytest.mark.asyncio
async def test_la_pausa_no_estorba_al_supervisor(monkeypatch):
    """
    Admin y supervisor no marcan jornada ni pausas: operan las tareas desde el
    panel. La comprobación sale antes de consultar nada.
    """
    jornada = AsyncMock()
    pausa = AsyncMock()
    monkeypatch.setattr(ubicaciones_service, "jornada_en_curso", jornada)
    monkeypatch.setattr(ubicaciones_service, "pausa_en_curso", pausa)

    await ubicaciones_service.exigir_jornada_abierta(
        MagicMock(), SimpleNamespace(id_empleado=1, rol="supervisor")
    )

    jornada.assert_not_awaited()
    pausa.assert_not_awaited()


@pytest.mark.asyncio
async def test_pausa_en_curso_devuelve_la_pausa_sin_cerrar():
    """
    `pausa_en_curso` es la consulta sobre la que se apoya la regla: tiene que
    ver la pausa sin `hora_fin` y la más reciente si hubiera varias.
    """
    abierta = Descanso(id_descanso=9, id_asistencia=5, hora_inicio=time(12, 0))
    db = _db(_resultado([abierta]))

    assert await ubicaciones_service.pausa_en_curso(db, 5) is abierta


@pytest.mark.asyncio
async def test_sin_pausas_abiertas_devuelve_none():
    db = _db(_resultado([]))

    assert await ubicaciones_service.pausa_en_curso(db, 5) is None


# ══ R3-2 — No se cierra la jornada con tareas en curso ═════════════════════

def _jornada_abierta():
    # `cierre_automatico=False` explícito: el default del modelo solo se aplica
    # al insertar, así que un objeto recién construido en Python lo tiene en
    # None. Una fila leída de la base siempre trae False, que es lo que esta
    # prueba representa.
    return Asistencia(
        id_asistencia=5,
        id_empleado=2,
        fecha=HOY,
        hora_entrada=time(8, 0),
        hora_salida=None,
        cierre_automatico=False,
    )


@pytest.fixture
def _reloj(monkeypatch):
    from datetime import datetime

    monkeypatch.setattr(
        router_asistencia, "ahora_local",
        lambda: datetime.combine(HOY, time(17, 5)),
    )


@pytest.mark.asyncio
async def test_no_se_cierra_la_jornada_con_una_tarea_en_curso(_reloj):
    jornada = _jornada_abierta()
    db = _db(
        _resultado([jornada]),                       # jornadas abiertas
        _resultado(["Instalación Los Álamos"]),      # tareas en curso
    )

    with pytest.raises(HTTPException) as error:
        await router_asistencia.registrar_salida(db=db, current_user=_tecnico())

    assert error.value.status_code == 409
    # El mensaje nombra la tarea: «tienes tareas en curso» obliga al técnico a
    # buscar cuáles, y desde el móvil eso son tres pantallas.
    assert "Instalación Los Álamos" in error.value.detail
    # Y la jornada sigue abierta.
    assert jornada.hora_salida is None


@pytest.mark.asyncio
async def test_el_mensaje_resume_cuando_hay_muchas_tareas(_reloj):
    jornada = _jornada_abierta()
    titulos = [f"Tarea {i}" for i in range(1, 6)]
    db = _db(_resultado([jornada]), _resultado(titulos))

    with pytest.raises(HTTPException) as error:
        await router_asistencia.registrar_salida(db=db, current_user=_tecnico())

    assert "5 tarea" in error.value.detail
    assert "2 más" in error.value.detail


@pytest.mark.asyncio
async def test_sin_tareas_en_curso_la_jornada_cierra(_reloj):
    jornada = _jornada_abierta()
    db = _db(
        _resultado([jornada]),
        _resultado([]),   # ninguna tarea en curso
        _resultado([]),   # ninguna pausa abierta
    )

    await router_asistencia.registrar_salida(db=db, current_user=_tecnico())

    assert jornada.hora_salida == time(17, 5)
    # Y no se marca como cierre automático: la puso la persona.
    assert jornada.cierre_automatico is False


@pytest.mark.asyncio
async def test_una_tarea_pendiente_no_impide_cerrar(_reloj):
    """
    La regla es sobre «en_progreso» y solo sobre eso. Una tarea pendiente es
    trabajo que no se empezó: impedir cerrar la jornada por ella dejaría al
    técnico sin poder marcar salida ningún día que le sobre trabajo.
    """
    jornada = _jornada_abierta()
    # La consulta filtra por estado, así que una pendiente no aparece.
    db = _db(_resultado([jornada]), _resultado([]), _resultado([]))

    await router_asistencia.registrar_salida(db=db, current_user=_tecnico())

    assert jornada.hora_salida == time(17, 5)


@pytest.mark.asyncio
async def test_al_supervisor_no_se_le_comprueban_tareas(_reloj):
    """
    Un admin o un supervisor que marque jornada no tiene tareas asignadas en
    el sentido de este flujo; comprobarlo gastaría una consulta por salida.
    """
    jornada = _jornada_abierta()
    db = _db(_resultado([jornada]), _resultado([]))

    await router_asistencia.registrar_salida(
        db=db,
        current_user=SimpleNamespace(
            id_empleado=3, nombre="Lucía", apellido="R", rol="supervisor"
        ),
    )

    assert jornada.hora_salida == time(17, 5)
    # Dos consultas, no tres: la de tareas no se hizo.
    assert db.execute.await_count == 2


# ══ R3-3 — Un cierre automático no cuenta como trabajo ═════════════════════

def _jornada_cerrada_por_el_sistema():
    """La del informe: entrada a las 19:01, cierre a las 23:59:59."""
    return Asistencia(
        id_asistencia=7,
        id_empleado=2,
        fecha=HOY,
        hora_entrada=time(19, 1),
        hora_salida=time(23, 59, 59),
        cierre_automatico=True,
    )


def test_un_cierre_automatico_no_reporta_horas():
    resumen = calcular_jornada(_jornada_cerrada_por_el_sistema(), descansos=[])

    # Antes esto daba 298 minutos (04:58) y entraba en los reportes.
    assert resumen.minutos_trabajados == 0
    assert resumen.minutos_brutos == 0
    assert resumen.sin_salida is True
    # No está activa: la jornada cerró, lo que falta es la hora real.
    assert resumen.jornada_activa is False


def test_una_salida_real_a_la_misma_hora_si_cuenta():
    """
    El cierre automático se distingue por la marca, no por la hora: un turno
    nocturno que de verdad termina a las 23:59 tiene que seguir contando.
    """
    jornada = _jornada_cerrada_por_el_sistema()
    jornada.cierre_automatico = False

    resumen = calcular_jornada(jornada, descansos=[])

    assert resumen.minutos_trabajados == 298
    assert resumen.sin_salida is False


def test_una_jornada_normal_no_cambia():
    jornada = Asistencia(
        id_asistencia=8,
        id_empleado=2,
        fecha=HOY,
        hora_entrada=time(8, 0),
        hora_salida=time(17, 0),
        cierre_automatico=False,
    )

    resumen = calcular_jornada(jornada, descansos=[])

    assert resumen.minutos_trabajados == 540
    assert resumen.sin_salida is False


def test_las_pausas_de_un_cierre_automatico_se_siguen_viendo():
    """
    Las horas no son un dato, pero las pausas que el técnico sí registró
    ocurrieron: borrarlas de la vista esconde información real.
    """
    jornada = _jornada_cerrada_por_el_sistema()
    pausa = Descanso(
        id_descanso=1, id_asistencia=7, hora_inicio=time(20, 0),
        hora_fin=time(20, 30), tipo="personal",
    )

    resumen = calcular_jornada(jornada, descansos=[pausa])

    assert resumen.total_pausas == 1
    # Pero no se restan de nada: no hay jornada de la que restarlas.
    assert resumen.minutos_pausa == 0


def test_una_jornada_sin_cerrar_sigue_reportando_su_avance():
    """
    Lo que no cambia: una jornada abierta de HOY sigue mostrando el avance del
    día con la hora de referencia. Solo el cierre automático reporta cero.
    """
    jornada = Asistencia(
        id_asistencia=9,
        id_empleado=2,
        fecha=HOY,
        hora_entrada=time(8, 0),
        hora_salida=None,
        cierre_automatico=False,
    )

    resumen = calcular_jornada(jornada, descansos=[], referencia=time(12, 0))

    assert resumen.minutos_trabajados == 240
    assert resumen.jornada_activa is True
    assert resumen.sin_salida is False


def test_el_cierre_abandonado_deja_la_marca():
    """
    La marca la pone quien cierra. Si alguien añade otro camino que cierre
    jornadas sin ponerla, sus horas volverían a los reportes.
    """
    import inspect

    fuente = inspect.getsource(router_asistencia._cerrar_jornada_abandonada)
    assert "cierre_automatico = True" in fuente

    from app.services import empleados as empleados_service

    fuente_cascada = inspect.getsource(empleados_service.desvincular_recursos)
    assert "cierre_automatico = True" in fuente_cascada
