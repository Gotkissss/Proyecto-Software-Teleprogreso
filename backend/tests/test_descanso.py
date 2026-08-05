# backend/tests/test_descanso.py
"""
Pruebas del router de descansos.

Motivación: la pantalla de Pausas del técnico perdía todo su estado al salir
(cronómetro en cero, historial vacío, pausas ya usadas olvidadas) porque ese
estado solo existía en React. Estas pruebas cubren la parte del backend que lo
hace persistente: el tipo de pausa guardado en BD, la regla de "una pausa de
cada tipo por jornada" y la reconstrucción del día vía GET /descanso/hoy.

Se usan mocks de AsyncSession, igual que en test_incidencias.py.
"""

from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.core.tiempo import hora_actual as hora_local

from app.models.asistencia import Asistencia, Descanso
from app.models.pausa import TipoPausa
from app.routers.descanso import (
    DescansoIniciar,
    _serializar_descanso,
    finalizar_descanso,
    get_descanso_activo,
    get_descansos_hoy,
    get_tipos_pausa,
    iniciar_descanso,
)
from app.services.pausas import tipo_valido


# ─── Helpers ─────────────────────────────────────────────────────────────────

# El catálogo ya no está escrito en el router: vive en la tabla `tipo_pausa`.
# Estos son los mismos valores que siembra la migración 0005, para que las
# pruebas sigan comprobando las duraciones reales de la normativa.
TIPOS_PAUSA_BD = [
    TipoPausa(id_tipo_pausa="almuerzo", label="Pausa de Almuerzo",
              duracion_max_min=60, orden=1, activo=True),
    TipoPausa(id_tipo_pausa="tecnica", label="Pausa Técnica (Soporte)",
              duracion_max_min=15, orden=2, activo=True),
    TipoPausa(id_tipo_pausa="personal", label="Pausa Personal",
              duracion_max_min=10, orden=3, activo=True),
]

CATALOGO = {
    t.id_tipo_pausa: {
        "label": t.label,
        "duracion_max_min": t.duracion_max_min,
        "orden": t.orden,
    }
    for t in TIPOS_PAUSA_BD
}


def _empleado(id_empleado=2):
    return SimpleNamespace(
        id_empleado=id_empleado, nombre="Juan", apellido="Pérez", rol="tecnico"
    )


def _restar_minutos(referencia: time, minutos: int) -> time:
    """Hora `minutos` antes de `referencia`, dentro del mismo día."""
    base = datetime.combine(date.today(), referencia) - timedelta(minutes=minutos)
    return base.time()


def _jornada(hora_entrada=time(8, 0), hora_salida=None, descansos=None):
    asistencia = Asistencia(
        id_asistencia=1,
        id_empleado=2,
        fecha=date.today(),
        hora_entrada=hora_entrada,
        hora_salida=hora_salida,
    )
    asistencia.descansos = descansos or []
    return asistencia


def _descanso(id_descanso=1, tipo="almuerzo", inicio=time(12, 0), fin=time(12, 30)):
    return Descanso(
        id_descanso=id_descanso,
        id_asistencia=1,
        hora_inicio=inicio,
        hora_fin=fin,
        tipo=tipo,
    )


def _resultado(valor, *, lista=False):
    res = MagicMock()
    if lista:
        res.scalars.return_value.first.return_value = valor[0] if valor else None
        res.scalars.return_value.all.return_value = valor
    else:
        res.scalars.return_value.first.return_value = valor
        res.scalar_one_or_none.return_value = valor
    return res


def _resultado_catalogo():
    res = MagicMock()
    res.scalars.return_value.all.return_value = TIPOS_PAUSA_BD
    return res


def _db(resultados):
    """
    AsyncSession simulada que va devolviendo `resultados` en orden.

    Las consultas al catálogo de pausas se responden aparte y no consumen la
    lista: el router lo lee cuando le hace falta, y obligar a cada test a
    intercalar ese resultado en la posición correcta los volvía ilegibles y
    frágiles ante cualquier reordenamiento del código.
    """
    pendientes = list(resultados)

    async def _execute(statement, *args, **kwargs):
        if "tipo_pausa" in str(statement):
            return _resultado_catalogo()
        return pendientes.pop(0)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


# ─── Catálogo de tipos ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_catalogo_de_tipos_trae_id_label_y_maximo():
    tipos = await get_tipos_pausa(_db([]))

    assert {t["id"] for t in tipos} == set(CATALOGO)
    for tipo in tipos:
        assert tipo["label"]
        assert tipo["duracion_max_min"] > 0


def test_tipo_desconocido_cae_en_el_generico():
    assert tipo_valido(CATALOGO, "almuerzo") == "almuerzo"
    assert tipo_valido(CATALOGO, None) == "personal"
    assert tipo_valido(CATALOGO, "siesta") == "personal"


# ─── Serialización (lo que alimenta el cronómetro del navegador) ─────────────

def test_una_pausa_cerrada_reporta_su_duracion_real():
    serializado = _serializar_descanso(
        _descanso(inicio=time(12, 0), fin=time(12, 30)), time(15, 0), CATALOGO
    )

    assert serializado["duracion_segundos"] == 30 * 60
    assert serializado["en_curso"] is False
    assert serializado["segundos_restantes"] == 0


def test_una_pausa_en_curso_se_mide_contra_la_hora_actual():
    """
    Es el arreglo de la persistencia: el cronómetro no arranca en cero, sino
    en los segundos que la pausa lleva realmente corriendo según la BD.
    """
    serializado = _serializar_descanso(
        _descanso(tipo="tecnica", inicio=time(12, 0), fin=None), time(12, 5), CATALOGO
    )

    assert serializado["en_curso"] is True
    assert serializado["duracion_segundos"] == 5 * 60
    assert serializado["segundos_restantes"] == 10 * 60  # tecnica = 15 min
    assert serializado["excedida"] is False


def test_una_pausa_pasada_de_tiempo_se_marca_como_excedida():
    serializado = _serializar_descanso(
        _descanso(tipo="personal", inicio=time(12, 0), fin=None), time(12, 25), CATALOGO
    )

    assert serializado["excedida"] is True
    assert serializado["segundos_restantes"] == 0


# ─── POST /descanso/iniciar ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_iniciar_pausa_guarda_el_tipo():
    db = _db([
        _resultado(_jornada()),  # jornada activa
        _resultado(None),        # sin pausa en curso
        _resultado(None),        # ese tipo aún no se usó
    ])

    respuesta = await iniciar_descanso(db, _empleado(), DescansoIniciar(tipo="almuerzo"))

    assert respuesta["tipo"] == "almuerzo"
    assert respuesta["duracion_max_seg"] == 60 * 60
    guardado = db.add.call_args[0][0]
    assert guardado.tipo == "almuerzo"


@pytest.mark.asyncio
async def test_iniciar_pausa_sin_body_usa_el_tipo_generico():
    db = _db([_resultado(_jornada()), _resultado(None), _resultado(None)])

    respuesta = await iniciar_descanso(db, _empleado(), None)

    assert respuesta["tipo"] == "personal"


@pytest.mark.asyncio
async def test_no_se_repite_el_mismo_tipo_de_pausa_en_la_jornada():
    """
    La regla vivía solo en el estado de React: recargar la pantalla dejaba
    volver a tomar el mismo almuerzo. Ahora la impone el backend.
    """
    db = _db([
        _resultado(_jornada()),
        _resultado(None),
        _resultado(_descanso(tipo="almuerzo")),  # ya se usó hoy
    ])

    with pytest.raises(HTTPException) as exc:
        await iniciar_descanso(db, _empleado(), DescansoIniciar(tipo="almuerzo"))

    assert exc.value.status_code == 400
    assert "Almuerzo" in exc.value.detail


@pytest.mark.asyncio
async def test_no_se_inicia_pausa_sin_jornada_activa():
    db = _db([_resultado(None)])

    with pytest.raises(HTTPException) as exc:
        await iniciar_descanso(db, _empleado(), DescansoIniciar(tipo="tecnica"))

    assert exc.value.status_code == 400
    assert "jornada activa" in exc.value.detail


@pytest.mark.asyncio
async def test_no_se_inicia_una_segunda_pausa_simultanea():
    db = _db([
        _resultado(_jornada()),
        _resultado(_descanso(tipo="tecnica", fin=None)),
    ])

    with pytest.raises(HTTPException) as exc:
        await iniciar_descanso(db, _empleado(), DescansoIniciar(tipo="almuerzo"))

    assert exc.value.status_code == 400
    assert "en curso" in exc.value.detail


# ─── POST /descanso/finalizar ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_finalizar_pausa_cierra_y_devuelve_la_duracion():
    activa = _descanso(tipo="tecnica", inicio=time(12, 0), fin=None)
    db = _db([_resultado(_jornada()), _resultado(activa)])

    respuesta = await finalizar_descanso(db, _empleado())

    assert activa.hora_fin is not None
    assert respuesta["tipo"] == "tecnica"
    assert respuesta["duracion_segundos"] >= 0


@pytest.mark.asyncio
async def test_finalizar_sin_pausa_en_curso_devuelve_400():
    db = _db([_resultado(_jornada()), _resultado(None)])

    with pytest.raises(HTTPException) as exc:
        await finalizar_descanso(db, _empleado())

    assert exc.value.status_code == 400


# ─── GET /descanso/activo ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sin_jornada_el_endpoint_activo_responde_sin_pausa():
    """No estar en pausa es un estado válido, no un 404."""
    db = _db([_resultado(None)])

    respuesta = await get_descanso_activo(db, _empleado())

    assert respuesta == {"jornada_activa": False, "pausa_activa": None}


@pytest.mark.asyncio
async def test_endpoint_activo_devuelve_la_pausa_en_curso():
    db = _db([
        _resultado(_jornada()),
        _resultado(_descanso(tipo="almuerzo", inicio=time(12, 0), fin=None)),
    ])

    respuesta = await get_descanso_activo(db, _empleado())

    assert respuesta["pausa_activa"]["tipo"] == "almuerzo"
    assert respuesta["pausa_activa"]["en_curso"] is True


# ─── GET /descanso/hoy ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_hoy_sin_jornada_devuelve_estructura_vacia():
    db = _db([_resultado(None)])

    respuesta = await get_descansos_hoy(db, _empleado())

    assert respuesta["jornada_activa"] is False
    assert respuesta["descansos"] == []
    assert respuesta["tipos_usados"] == []
    assert respuesta["segundos_en_pausa"] == 0


@pytest.mark.asyncio
async def test_hoy_reconstruye_el_dia_completo():
    """
    Con esto la pantalla se puede repintar entera tras un reinicio: entrada,
    pausas cerradas, pausa en curso y tipos ya consumidos.

    Las horas se construyen relativas al reloj real y no fijas (08:00, 15:00):
    la jornada y la pausa abierta se miden contra "ahora", así que con horas
    fijas el resultado dependía de a qué hora del día se corrieran las pruebas
    y el test fallaba solo por las mañanas.
    """
    ahora = hora_local()
    entrada = _restar_minutos(ahora, 180)          # entró hace 3 horas
    almuerzo_ini = _restar_minutos(ahora, 120)     # almorzó hace 2 horas
    almuerzo_fin = _restar_minutos(ahora, 90)      # 30 minutos de almuerzo
    tecnica_ini = _restar_minutos(ahora, 10)       # pausa técnica en curso

    jornada = _jornada(
        hora_entrada=entrada,
        descansos=[
            _descanso(1, "almuerzo", almuerzo_ini, almuerzo_fin),
            _descanso(2, "tecnica", tecnica_ini, None),
        ],
    )
    db = _db([_resultado(jornada)])

    respuesta = await get_descansos_hoy(db, _empleado())

    assert respuesta["jornada_activa"] is True
    assert respuesta["hora_entrada"] == entrada.strftime("%H:%M:%S")
    assert len(respuesta["descansos"]) == 2
    assert sorted(respuesta["tipos_usados"]) == ["almuerzo", "tecnica"]
    assert respuesta["pausa_activa"]["tipo"] == "tecnica"
    # El acumulado incluye la pausa aún abierta: 30 min de almuerzo + ~10 de
    # la técnica que sigue corriendo.
    assert respuesta["segundos_en_pausa"] >= 30 * 60
    # Lo trabajado es el bruto menos las pausas, nunca negativo.
    assert respuesta["segundos_trabajados"] == max(
        0, respuesta["segundos_brutos"] - respuesta["segundos_en_pausa"]
    )
    assert respuesta["segundos_trabajados"] > 0


@pytest.mark.asyncio
async def test_hoy_con_jornada_cerrada_no_sigue_sumando_tiempo():
    jornada = _jornada(
        hora_entrada=time(8, 0),
        hora_salida=time(17, 0),
        descansos=[_descanso(1, "almuerzo", time(12, 0), time(13, 0))],
    )
    db = _db([_resultado(jornada)])

    respuesta = await get_descansos_hoy(db, _empleado())

    assert respuesta["jornada_activa"] is False
    assert respuesta["segundos_brutos"] == 9 * 3600
    assert respuesta["segundos_en_pausa"] == 3600
    assert respuesta["segundos_trabajados"] == 8 * 3600
    assert respuesta["pausa_activa"] is None
