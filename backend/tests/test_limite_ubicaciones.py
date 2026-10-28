"""
Tope de reporte de posición del lado del servidor — HU-S10-08, tarea 4.
-----------------------------------------------------------------------------
Cuántos puntos manda un técnico lo decidía solo el cliente
(`utils/reglasUbicacion.js`: uno cada 2 minutos si se mueve, uno de control
cada 5 si está quieto). Eso vale para el uso normal, pero el cliente es
justamente la parte que no se puede garantizar: con el token de un técnico y un
bucle de tres líneas se insertaban miles de filas en `ubicacion_empleado`, que
es una tabla que crece sin tope y guarda un dato sensible —dónde estuvo una
persona y a qué hora—.

El freno general por IP no servía: es de 240 por minuto y cuenta por IP, así
que un solo técnico podía gastarlo entero en ubicaciones y, de paso, dejar sin
cupo a los compañeros que salieran a internet por la misma salida.
-----------------------------------------------------------------------------
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.core.rate_limit import (
    lotes_ubicaciones_por_empleado,
    ubicaciones_por_empleado,
)
from app.core.reglas import (
    MAX_LOTES_UBICACIONES_POR_VENTANA,
    MAX_UBICACIONES_POR_VENTANA,
    VENTANA_UBICACIONES_SEGUNDOS,
)
from app.routers import ubicaciones as router_ubicaciones
from app.schemas.ubicacion import UbicacionCreate, UbicacionLoteCreate

PUNTO = {"lat": 14.4728, "lng": -90.4408}

# `VentanaDeslizante.registrar` corta con `>=`: el evento número `maximo` ya es
# el que se rechaza (el comentario del propio método lo dice: "con
# LOGIN_MAX_INTENTOS=5, el quinto fallo ya cierra la puerta"). Así que las
# peticiones que SÍ pasan son una menos que el tope.
CUPO_PUNTOS = MAX_UBICACIONES_POR_VENTANA - 1
CUPO_LOTES = MAX_LOTES_UBICACIONES_POR_VENTANA - 1


def _tecnico(id_empleado=7):
    return SimpleNamespace(
        id_empleado=id_empleado, rol="tecnico", correo="t@teleprogreso.com"
    )


def _db_con_jornada():
    """
    Sesión simulada con la jornada abierta.

    `flush` rellena el id de la fila nueva, como lo haría Postgres: la
    respuesta del endpoint lo exige y sin eso el schema falla al serializar.
    """
    db = MagicMock()
    jornada = SimpleNamespace(id_asistencia=1, hora_salida=None)
    resultado = MagicMock()
    resultado.scalar_one_or_none.return_value = jornada
    resultado.scalars.return_value.first.return_value = jornada
    db.execute = AsyncMock(return_value=resultado)

    guardados = []

    def _add(objeto):
        guardados.append(objeto)

    async def _flush():
        for objeto in guardados:
            if getattr(objeto, "id_ubicacion", None) is None:
                objeto.id_ubicacion = len(guardados)

    db.add = MagicMock(side_effect=_add)
    db.flush = AsyncMock(side_effect=_flush)
    return db


@pytest.fixture(autouse=True)
def _limpiar_ventanas(monkeypatch):
    """
    Las ventanas son globales del proceso: sin limpiarlas, una prueba gasta el
    cupo de la siguiente y el orden de ejecución decide qué pasa.
    """
    for ventana in (ubicaciones_por_empleado, lotes_ubicaciones_por_empleado):
        for sufijo in ("punto", "lote"):
            for id_empleado in range(1, 30):
                ventana.limpiar(f"ubic:{sufijo}:{id_empleado}")
    monkeypatch.setattr("app.services.bitacora._ULTIMO_AVISO", {})
    # La jornada y el guardado no son lo que se prueba aquí.
    monkeypatch.setattr(
        router_ubicaciones, "_jornada_en_curso", AsyncMock(return_value=object())
    )
    monkeypatch.setattr(
        router_ubicaciones,
        "registrar_lote",
        AsyncMock(return_value=(1, 0)),
    )
    yield


# ── POST /ubicaciones ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_uso_normal_no_se_topa_con_el_limite():
    """
    El cliente manda como mucho un punto cada dos minutos: en la ventana de
    cinco caben dos o tres. El tope tiene que dejar mucho aire sobre eso para
    que un reintento o dos pestañas abiertas no molesten a nadie.
    """
    tecnico = _tecnico(11)
    for _ in range(3):
        respuesta = await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
        )
        assert respuesta.id_ubicacion is not None


@pytest.mark.asyncio
async def test_pasado_el_tope_responde_429_con_retry_after():
    tecnico = _tecnico(12)

    for _ in range(CUPO_PUNTOS):
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
        )

    with pytest.raises(HTTPException) as error:
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
        )

    assert error.value.status_code == 429
    # La cola sin conexión del frontend necesita saber cuánto esperar; sin esto
    # reintenta en bucle y el tope no sirve de nada.
    assert "Retry-After" in error.value.headers
    assert int(error.value.headers["Retry-After"]) > 0


@pytest.mark.asyncio
async def test_el_tope_es_por_empleado_y_no_por_ip():
    """
    Por empleado porque es lo que identifica al dueño de los puntos: la IP de
    un teléfono con datos móviles cambia sola, y varios técnicos pueden
    compartir la de la oficina. Si fuera por IP, el primero en gastarse el cupo
    dejaría sin reportar a todo el equipo.
    """
    uno, otro = _tecnico(13), _tecnico(14)

    for _ in range(CUPO_PUNTOS):
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), uno
        )

    with pytest.raises(HTTPException):
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), uno
        )

    # El compañero sigue con su cupo intacto.
    await router_ubicaciones.registrar_ubicacion(
        UbicacionCreate(**PUNTO), _db_con_jornada(), otro
    )


@pytest.mark.asyncio
async def test_el_corte_va_antes_de_tocar_la_base(monkeypatch):
    """
    El 429 se decide sin consultar la jornada ni escribir nada: si el tope
    llegara después, un bucle seguiría costando una consulta por petición y el
    freno no protegería a la base, que es de lo que se trata.
    """
    tecnico = _tecnico(15)
    for _ in range(CUPO_PUNTOS):
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
        )

    db = _db_con_jornada()
    with pytest.raises(HTTPException):
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), db, tecnico
        )

    db.execute.assert_not_awaited()
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_el_corte_deja_fila_en_la_bitacora(eventos_bitacora):
    tecnico = _tecnico(16)
    for _ in range(CUPO_PUNTOS):
        await router_ubicaciones.registrar_ubicacion(
            UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
        )

    from app.core.contexto import ContextoPeticion, _contexto

    ctx = ContextoPeticion(ip="10.0.0.5", request_id="abc")
    token = _contexto.set(ctx)
    try:
        with pytest.raises(HTTPException):
            await router_ubicaciones.registrar_ubicacion(
                UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
            )
    finally:
        _contexto.reset(token)

    acciones = [evento["accion"] for evento in ctx.eventos]
    assert "limite_ubicaciones" in acciones


# ── POST /ubicaciones/lote ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_lote_tiene_su_propio_tope_mas_bajo():
    """
    Un lote trae hasta 500 puntos de una vez, así que se cuenta aparte: con el
    mismo tope que los puntos sueltos, veinte lotes serían 10 000 filas.
    """
    assert MAX_LOTES_UBICACIONES_POR_VENTANA < MAX_UBICACIONES_POR_VENTANA

    tecnico = _tecnico(17)
    cuerpo = UbicacionLoteCreate(
        puntos=[{**PUNTO, "fecha_hora": "2026-10-27T10:00:00"}]
    )

    for _ in range(CUPO_LOTES):
        await router_ubicaciones.registrar_ubicaciones_lote(
            cuerpo, _db_con_jornada(), tecnico
        )

    with pytest.raises(HTTPException) as error:
        await router_ubicaciones.registrar_ubicaciones_lote(
            cuerpo, _db_con_jornada(), tecnico
        )

    assert error.value.status_code == 429


@pytest.mark.asyncio
async def test_los_dos_topes_se_cuentan_por_separado():
    """
    Vaciar la cola sin conexión no puede dejar al técnico sin poder reportar su
    posición en vivo, ni al revés.
    """
    tecnico = _tecnico(18)
    cuerpo = UbicacionLoteCreate(
        puntos=[{**PUNTO, "fecha_hora": "2026-10-27T10:00:00"}]
    )

    for _ in range(CUPO_LOTES):
        await router_ubicaciones.registrar_ubicaciones_lote(
            cuerpo, _db_con_jornada(), tecnico
        )
    with pytest.raises(HTTPException):
        await router_ubicaciones.registrar_ubicaciones_lote(
            cuerpo, _db_con_jornada(), tecnico
        )

    # El punto suelto sigue pasando.
    await router_ubicaciones.registrar_ubicacion(
        UbicacionCreate(**PUNTO), _db_con_jornada(), tecnico
    )


def test_los_umbrales_viven_en_reglas_y_dejan_aire_sobre_el_uso_real():
    """
    Los números están en `core/reglas.py` como el resto de las políticas, y la
    relación con el ritmo del cliente es lo que los justifica: un punto cada
    dos minutos son 2 o 3 por ventana de cinco. Si alguien baja el tope cerca
    de eso, un reintento normal empezaría a dar 429.
    """
    puntos_de_uso_normal = VENTANA_UBICACIONES_SEGUNDOS / 120
    assert MAX_UBICACIONES_POR_VENTANA >= puntos_de_uso_normal * 5
    assert VENTANA_UBICACIONES_SEGUNDOS >= 60
