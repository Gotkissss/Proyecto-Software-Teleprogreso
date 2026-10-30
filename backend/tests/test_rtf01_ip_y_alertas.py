"""
RTF-01 — severos R1-1 (IP real en la bitácora) y R2-2 (alertas sin entrada).
-----------------------------------------------------------------------------
**R1-1.** La columna IP de la bitácora guardaba `100.64.0.x`, una dirección de
la red interna de Railway que además cambia en cada petición del mismo usuario.
Una bitácora existe para poder decir quién hizo qué desde dónde; con esa
columna no identificaba a nadie.

El motivo de fondo: el `startCommand` del despliegue arranca uvicorn **sin**
`--proxy-headers`, así que `request.client.host` es el peer TCP, o sea el
proxy. La solución no puede depender de que alguien se acuerde de añadir la
bandera a un comando escrito a mano en un panel: `ip_cliente` lee la cabecera
por su cuenta, y solo cuando el peer está en una red de proxy declarada.

**R2-2.** Los avisos de «técnico sin entrada» del 21/08, 02/09 y 01/10 seguían
«pendientes» dos meses después. No se cerraban a propósito —que hoy sí marcara
no borra que ese día faltó— pero quedarse pendientes para siempre infla el
contador y entierra los del día.
-----------------------------------------------------------------------------
"""
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core import config
from app.core.rate_limit import ip_cliente
from app.core.reglas import DIAS_VIGENCIA_ALERTA_SIN_ENTRADA
from app.models.alerta import Alerta
from app.services import alertas as alertas_service


# ══ R1-1 — La IP que llega a la bitácora ═══════════════════════════════════

def _peticion(ip_peer, xff=None):
    """Request mínima: el peer TCP y, si se pasa, la cabecera reenviada."""
    cabeceras = {}
    if xff is not None:
        cabeceras["x-forwarded-for"] = xff
    return SimpleNamespace(
        client=SimpleNamespace(host=ip_peer) if ip_peer else None,
        headers=cabeceras,
    )


@pytest.fixture
def _con_proxy(monkeypatch):
    """Declara la red interna de Railway como proxy confiable."""
    monkeypatch.setattr(config.settings, "PROXIES_CONFIABLES", "100.64.0.0/10")
    return config.settings


@pytest.fixture
def _sin_proxy(monkeypatch):
    monkeypatch.setattr(config.settings, "PROXIES_CONFIABLES", "")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    return config.settings


def test_sin_proxy_declarado_se_usa_el_peer(_sin_proxy):
    """
    Lo de siempre: sin proxy delante, la cabecera no se mira. Creerla sin más
    permitiría saltarse los límites de frecuencia mandando una IP distinta en
    cada intento.
    """
    assert ip_cliente(_peticion("203.0.113.8", xff="1.2.3.4")) == "203.0.113.8"


def test_detras_del_proxy_se_lee_la_ip_real(_con_proxy):
    """El caso del informe: el peer es Railway, el cliente real va en la cabecera."""
    peticion = _peticion("100.64.0.7", xff="190.56.1.20")

    assert ip_cliente(peticion) == "190.56.1.20"


def test_una_cabecera_falseada_por_el_cliente_no_gana(_con_proxy):
    """
    Lo que hace que esto sea seguro y no un agujero: los proxies AÑADEN su
    vista al final. Si el cliente manda su propia cabecera, el proxy la deja a
    la izquierda y escribe detrás la dirección que él vio. Se recorre de
    derecha a izquierda, así que gana la del proxy.
    """
    peticion = _peticion("100.64.0.7", xff="8.8.8.8, 190.56.1.20")

    assert ip_cliente(peticion) == "190.56.1.20"


def test_varios_proxies_internos_se_saltan(_con_proxy):
    """Con dos saltos internos, la primera dirección externa desde la derecha."""
    peticion = _peticion("100.64.0.7", xff="190.56.1.20, 100.64.0.9, 100.64.0.3")

    assert ip_cliente(peticion) == "190.56.1.20"


def test_una_cadena_entera_interna_cae_al_peer(_con_proxy):
    """No hay dato mejor: se devuelve el peer en vez de inventar nada."""
    peticion = _peticion("100.64.0.7", xff="100.64.0.9")

    assert ip_cliente(peticion) == "100.64.0.7"


def test_sin_cabecera_detras_del_proxy_cae_al_peer(_con_proxy):
    assert ip_cliente(_peticion("100.64.0.7")) == "100.64.0.7"


def test_una_cabecera_con_basura_no_rompe_nada(_con_proxy):
    """Se descarta lo que no es una IP y se sigue buscando."""
    peticion = _peticion("100.64.0.7", xff="no-es-una-ip, 190.56.1.20")

    assert ip_cliente(peticion) == "190.56.1.20"


def test_sin_cliente_se_dice_desconocido():
    assert ip_cliente(_peticion(None)) == "desconocido"


def test_en_railway_las_redes_internas_se_confian_solas(monkeypatch):
    """
    El despliegue no tiene que configurar nada: el backend de Railway solo es
    alcanzable a través de su proxy, así que el peer siempre es interno.
    """
    monkeypatch.setattr(config.settings, "PROXIES_CONFIABLES", "")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")

    assert ip_cliente(_peticion("100.64.0.7", xff="190.56.1.20")) == "190.56.1.20"


def test_fuera_de_railway_no_se_asume_nada(monkeypatch):
    monkeypatch.setattr(config.settings, "PROXIES_CONFIABLES", "")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)

    assert config.settings.redes_proxy_confiables == ()


def test_una_red_mal_escrita_se_ignora_en_vez_de_confiarse(monkeypatch):
    """
    Una entrada con un error de tecleo no puede acabar en que se confíe en algo
    que nadie quiso, ni tumbar el arranque.
    """
    monkeypatch.setattr(
        config.settings, "PROXIES_CONFIABLES", "10.0.0.0/8, esto-no-es-una-red"
    )

    redes = config.settings.redes_proxy_confiables
    assert len(redes) == 1
    assert str(redes[0]) == "10.0.0.0/8"


# ══ R2-2 — Las alertas «sin entrada» caducan ═══════════════════════════════

HOY = date(2026, 10, 28)


def _alerta_sin_entrada(dias_atras, estado="pendiente"):
    return Alerta(
        id_alerta=100 + dias_atras,
        tipo=alertas_service.TIPO_TECNICO_SIN_ENTRADA,
        severidad="advertencia",
        estado=estado,
        referencia="empleado:4",
        fecha=datetime.combine(HOY - timedelta(days=dias_atras), time(8, 30)),
    )


def _db_con(alertas):
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = list(alertas)
    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_un_aviso_viejo_se_cierra_solo():
    """
    El del informe: 21/08 todavía «pendiente» en octubre. Nadie va a marcar una
    entrada de hace dos meses, así que el aviso dejó de ser accionable.
    """
    vieja = _alerta_sin_entrada(dias_atras=DIAS_VIGENCIA_ALERTA_SIN_ENTRADA + 1)
    db = _db_con([vieja])

    cerradas = await alertas_service._resolver_alertas_obsoletas(
        db, set(), hoy=HOY, evaluar_sin_entrada=True
    )

    assert cerradas == 1
    assert vieja.estado == alertas_service.ESTADO_RESUELTA


@pytest.mark.asyncio
async def test_un_aviso_reciente_sigue_pendiente():
    """
    Dentro de la ventana el aviso todavía sirve: el supervisor puede hablar con
    el técnico de la ausencia de ayer.
    """
    reciente = _alerta_sin_entrada(dias_atras=1)
    db = _db_con([reciente])

    cerradas = await alertas_service._resolver_alertas_obsoletas(
        db, set(), hoy=HOY, evaluar_sin_entrada=True
    )

    assert cerradas == 0
    assert reciente.estado == "pendiente"


@pytest.mark.asyncio
async def test_el_aviso_de_hoy_no_se_cierra_antes_de_la_hora_limite():
    """
    Antes de las 08:00 todavía es válido que un técnico no haya marcado: cerrar
    el aviso ahí lo borraría justo cuando empieza a tener sentido.
    """
    de_hoy = _alerta_sin_entrada(dias_atras=0)
    db = _db_con([de_hoy])

    cerradas = await alertas_service._resolver_alertas_obsoletas(
        db, set(), hoy=HOY, evaluar_sin_entrada=False
    )

    assert cerradas == 0
    assert de_hoy.estado == "pendiente"


@pytest.mark.asyncio
async def test_el_aviso_de_hoy_se_cierra_si_marco_entrada():
    """Pasada la hora límite y con la condición resuelta, se cierra."""
    de_hoy = _alerta_sin_entrada(dias_atras=0)
    db = _db_con([de_hoy])

    cerradas = await alertas_service._resolver_alertas_obsoletas(
        db, set(), hoy=HOY, evaluar_sin_entrada=True
    )

    assert cerradas == 1
    assert de_hoy.estado == alertas_service.ESTADO_RESUELTA


@pytest.mark.asyncio
async def test_un_aviso_viejo_se_cierra_tambien_antes_de_la_hora_limite():
    """
    La caducidad no depende de la hora: antes, el tipo se dejaba fuera de la
    revisión hasta las 08:00, así que las ejecuciones de la madrugada no
    cerraban nada y los viejos sobrevivían un día más por cada vuelta.
    """
    vieja = _alerta_sin_entrada(dias_atras=30)
    db = _db_con([vieja])

    cerradas = await alertas_service._resolver_alertas_obsoletas(
        db, set(), hoy=HOY, evaluar_sin_entrada=False
    )

    assert cerradas == 1


@pytest.mark.asyncio
async def test_lo_que_una_persona_ya_cerro_no_se_toca():
    """
    'atendida' y 'descartada' las puso alguien: su estado es parte del registro
    de lo que hizo.
    """
    atendida = _alerta_sin_entrada(dias_atras=30, estado="atendida")
    # La consulta filtra por 'pendiente', así que estas no llegan aquí; se
    # comprueba que, si llegaran, tampoco se reescribirían.
    db = _db_con([atendida])

    await alertas_service._resolver_alertas_obsoletas(
        db, set(), hoy=HOY, evaluar_sin_entrada=True
    )

    assert atendida.estado == "atendida"


@pytest.mark.asyncio
async def test_un_aviso_cuya_condicion_sigue_viva_no_se_cierra():
    """El contrapeso: si el técnico sigue sin marcar, el aviso se queda."""
    de_hoy = _alerta_sin_entrada(dias_atras=0)
    vigentes = {(alertas_service.TIPO_TECNICO_SIN_ENTRADA, "empleado:4")}
    db = _db_con([de_hoy])

    cerradas = await alertas_service._resolver_alertas_obsoletas(
        db, vigentes, hoy=HOY, evaluar_sin_entrada=True
    )

    assert cerradas == 0
    assert de_hoy.estado == "pendiente"


def test_la_ventana_de_vigencia_esta_en_reglas():
    """
    Como el resto de las políticas. Si alguien la cambia, se ve en un solo
    sitio y no repartida por el servicio.
    """
    assert DIAS_VIGENCIA_ALERTA_SIN_ENTRADA >= 1
    import inspect

    fuente = inspect.getsource(alertas_service._resolver_alertas_obsoletas)
    assert "DIAS_VIGENCIA_ALERTA_SIN_ENTRADA" in fuente
