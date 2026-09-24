# backend/tests/test_ubicaciones.py
"""
Pruebas de POST /ubicaciones — SCRUM-216 / SCRUM-217.

Lo que se fija aquí:
  · el punto PostGIS se arma con la longitud delante de la latitud, que es el
    error que no avisa: la petición responde 201 y el marcador acaba en otro
    continente;
  · sin jornada abierta el registro se rechaza con 409, no con 400;
  · el dueño de la ubicación sale del token y nunca del cuerpo.

La sesión está simulada, igual que en test_asistencia_historial.py: estas
pruebas comprueban la decisión del endpoint y el objeto que manda a guardar,
no el viaje hasta PostgreSQL.
"""

from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_current_empleado
from app.core.exceptions import register_exception_handlers
from app.core.tiempo import ahora as ahora_local
from app.db.session import get_db
from app.routers import ubicaciones
from app.services.asistencia import es_del_turno_en_curso
from app.core.reglas import DURACION_MAXIMA_TURNO_HORAS

# Coordenadas de la Ciudad de Guatemala: latitud positiva (hemisferio norte) y
# longitud negativa (al oeste de Greenwich). Cruzarlas se nota a simple vista.
LAT = 14.6349
LNG = -90.5069

ID_TECNICO = 7
ID_UBICACION = 55


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _empleado(id_empleado=ID_TECNICO, rol="tecnico"):
    return SimpleNamespace(
        id_empleado=id_empleado,
        nombre="Ana",
        apellido="López",
        rol=rol,
        estado="activo",
    )


def _jornada(fecha=None, hora_entrada=time(8, 0), hora_salida=None):
    """
    Fila de `asistencia`; sigue abierta mientras no tenga hora de salida.

    La fecha por defecto es la de hoy en Guatemala y no una fija: con una
    fecha escrita a mano la prueba pasaba el día en que se escribió y fallaba
    al siguiente, porque esa jornada dejaba de ser la del turno en curso.
    """
    return SimpleNamespace(
        id_asistencia=10,
        id_empleado=ID_TECNICO,
        fecha=fecha or ahora_local().date(),
        hora_entrada=hora_entrada,
        hora_salida=hora_salida,
    )


def _db_simulada(jornada):
    """
    AsyncSession simulada que responde la búsqueda de jornada abierta.

    `flush` asigna la llave primaria porque eso es justo lo que hace en
    PostgreSQL; sin ese paso el id_ubicacion seguiría en None y la respuesta
    no pasaría su propia validación.
    """
    resultado = MagicMock()
    resultado.scalars.return_value.all.return_value = [jornada] if jornada else []

    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    db.add = MagicMock()

    async def _flush():
        for llamada in db.add.call_args_list:
            llamada.args[0].id_ubicacion = ID_UBICACION

    db.flush = AsyncMock(side_effect=_flush)
    return db


def _generador(db):
    """Envuelve la sesión simulada con la forma que espera Depends(get_db)."""
    async def _get_db():
        yield db

    return _get_db


def _app(db, empleado=None):
    """Aplicación mínima con el router y las dependencias sustituidas."""
    aplicacion = FastAPI()
    aplicacion.include_router(ubicaciones.router)
    register_exception_handlers(aplicacion)

    async def usuario_actual():
        return empleado or _empleado()

    aplicacion.dependency_overrides[get_db] = _generador(db)
    aplicacion.dependency_overrides[get_current_empleado] = usuario_actual
    return aplicacion


async def _post(aplicacion, cuerpo):
    transport = ASGITransport(app=aplicacion)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/ubicaciones", json=cuerpo)


def _guardado(db):
    """Objeto UbicacionEmpleado que el router mandó a la sesión."""
    return db.add.call_args_list[0].args[0]


def _sql_de(db, indice=0):
    """SQL compilado de la consulta número `indice`, con valores literales."""
    statement = db.execute.await_args_list[indice].args[0]
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


# ─── Camino feliz: el técnico está en jornada ────────────────────────────────

@pytest.mark.asyncio
async def test_con_jornada_abierta_responde_201_con_el_comprobante():
    db = _db_simulada(_jornada())

    respuesta = await _post(_app(db), {"lat": LAT, "lng": LNG})

    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["id_ubicacion"] == ID_UBICACION
    assert cuerpo["fecha_hora_registro"] is not None
    assert "correctamente" in cuerpo["mensaje"]


@pytest.mark.asyncio
async def test_la_coordenada_guarda_longitud_antes_que_latitud():
    # WKT escribe POINT(x y): primero la longitud. Al revés el punto se guarda
    # igual, sin ningún error, y el técnico aparece en el océano Índico.
    db = _db_simulada(_jornada())

    await _post(_app(db), {"lat": LAT, "lng": LNG})

    assert _guardado(db).coordenada == f"SRID=4326;POINT({LNG} {LAT})"


@pytest.mark.asyncio
async def test_la_hora_registrada_es_la_de_guatemala():
    """
    La columna trae server_default NOW(), que PostgreSQL resuelve en UTC.

    El router fija la hora con el reloj de la operación para que el rastro no
    quede seis horas por delante de las entradas, pausas y tareas del mismo
    día.
    """
    db = _db_simulada(_jornada())

    await _post(_app(db), {"lat": LAT, "lng": LNG})

    registrada = _guardado(db).fecha_hora_registro
    assert isinstance(registrada, datetime)
    assert abs(registrada - ahora_local()) < timedelta(minutes=1)


# ─── SCRUM-217: fuera de jornada no se registra nada ─────────────────────────

@pytest.mark.asyncio
async def test_sin_jornada_abierta_responde_409():
    db = _db_simulada(None)

    respuesta = await _post(_app(db), {"lat": LAT, "lng": LNG})

    assert respuesta.status_code == 409
    assert "jornada" in respuesta.json()["detail"].lower()
    # Y sobre todo: no se guardó nada.
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_el_mensaje_de_error_no_filtra_detalles_internos():
    # El detalle lo lee el técnico en su teléfono: nombres de tabla, SQL o
    # trazas ahí solo le sirven a quien ande buscando por dónde entrar.
    db = _db_simulada(None)

    respuesta = await _post(_app(db), {"lat": LAT, "lng": LNG})

    detalle = respuesta.json()["detail"].lower()
    for filtracion in ("asistencia", "select", "traceback", "ubicacion_empleado"):
        assert filtracion not in detalle


# ─── SCRUM-217: qué cuenta como "jornada del turno en curso" ─────────────────
#
# Se fija el reloj para que los casos no dependan de la hora a la que corra la
# suite: el turno nocturno solo se distingue de una jornada olvidada por la
# relación entre la hora actual y la hora de entrada.

HOY = date(2026, 9, 23)
AYER = HOY - timedelta(days=1)
MADRUGADA = datetime(2026, 9, 23, 2, 0)   # dentro de un turno de 22:00 a 06:00
MANANA = datetime(2026, 9, 23, 9, 0)
TOPE = timedelta(hours=DURACION_MAXIMA_TURNO_HORAS)


def test_la_jornada_de_hoy_es_del_turno_en_curso():
    assert es_del_turno_en_curso(_jornada(fecha=HOY), MANANA)


def test_el_turno_nocturno_de_ayer_sigue_en_curso_de_madrugada():
    nocturna = _jornada(fecha=AYER, hora_entrada=time(22, 0))

    assert es_del_turno_en_curso(nocturna, MADRUGADA)


def test_una_jornada_diurna_de_ayer_sin_salida_ya_no_esta_en_curso():
    # Entró ayer a las 08:00 y hoy son las 09:00: no es un turno nocturno,
    # es una salida que se olvidó marcar.
    olvidada = _jornada(fecha=AYER, hora_entrada=time(8, 0))

    assert not es_del_turno_en_curso(olvidada, MANANA)


def test_el_turno_de_ayer_sigue_en_curso_hasta_el_tope_de_duracion():
    # Entrada 22:00 de ayer: sigue en curso hasta 22:00 + el tope, ni un
    # minuto más.
    nocturna = _jornada(fecha=AYER, hora_entrada=time(22, 0))
    limite = datetime(2026, 9, 22, 22, 0) + TOPE

    assert es_del_turno_en_curso(nocturna, limite)
    assert not es_del_turno_en_curso(nocturna, limite + timedelta(minutes=1))


@pytest.mark.parametrize(
    "duracion, en_curso",
    [
        (TOPE - timedelta(minutes=1), True),
        (TOPE, True),                                     # el corte es inclusivo
        (TOPE + timedelta(seconds=1), False),
        (TOPE + timedelta(minutes=1), False),
    ],
)
def test_borde_exacto_del_tope_de_duracion(duracion, en_curso):
    """
    Fija el límite exacto: la regla compara `transcurrido <= tope`, así que el
    tope en punto todavía cuenta como turno en curso y un segundo después ya
    no. Se calcula desde la constante para que ajustar el número en
    reglas.py no obligue a reescribir la prueba.
    """
    entrada = datetime(2026, 9, 22, 22, 0)
    nocturna = _jornada(fecha=entrada.date(), hora_entrada=entrada.time())

    assert es_del_turno_en_curso(nocturna, entrada + duracion) is en_curso


def test_una_salida_olvidada_no_pasa_por_turno_nocturno():
    """
    Entró ayer a las 09:00 y hoy llega a las 08:00: la hora actual es anterior
    a la de entrada, que era la única señal que usaba la regla. Pasaron 23
    horas, así que es una salida olvidada y no un turno en curso.
    """
    olvidada = _jornada(fecha=AYER, hora_entrada=time(9, 0))

    assert not es_del_turno_en_curso(olvidada, datetime(2026, 9, 23, 8, 0))


def test_una_jornada_abandonada_hace_dias_no_esta_en_curso():
    abandonada = _jornada(fecha=HOY - timedelta(days=3), hora_entrada=time(22, 0))

    assert not es_del_turno_en_curso(abandonada, MADRUGADA)


@pytest.mark.asyncio
async def test_acepta_la_ubicacion_de_un_turno_nocturno(monkeypatch):
    monkeypatch.setattr(ubicaciones, "ahora_local", lambda: MADRUGADA)
    db = _db_simulada(_jornada(fecha=AYER, hora_entrada=time(22, 0)))

    respuesta = await _post(_app(db), {"lat": LAT, "lng": LNG})

    assert respuesta.status_code == 201


@pytest.mark.asyncio
async def test_rechaza_si_la_unica_jornada_abierta_quedo_abandonada(monkeypatch):
    """
    El caso que motivó la corrección: el técnico se fue el lunes sin marcar
    salida y el jueves, sin haber marcado entrada, el endpoint le aceptaba
    posiciones como si estuviera en turno.
    """
    monkeypatch.setattr(ubicaciones, "ahora_local", lambda: MANANA)
    db = _db_simulada(_jornada(fecha=HOY - timedelta(days=3)))

    respuesta = await _post(_app(db), {"lat": LAT, "lng": LNG})

    assert respuesta.status_code == 409
    db.add.assert_not_called()


# ─── Control de acceso: el dueño de la ubicación sale del token ──────────────

@pytest.mark.asyncio
async def test_el_id_empleado_del_cuerpo_se_ignora():
    """
    Un técnico no puede sembrar ubicaciones a nombre de un compañero.

    El esquema de entrada solo declara lat y lng, así que el id_empleado que
    venga en el cuerpo se descarta antes de llegar al router.
    """
    db = _db_simulada(_jornada())

    respuesta = await _post(
        _app(db, _empleado(id_empleado=ID_TECNICO)),
        {"lat": LAT, "lng": LNG, "id_empleado": 99},
    )

    assert respuesta.status_code == 201
    assert _guardado(db).id_empleado == ID_TECNICO


@pytest.mark.asyncio
async def test_la_jornada_se_busca_por_el_empleado_del_token():
    db = _db_simulada(_jornada())

    await _post(_app(db, _empleado(id_empleado=ID_TECNICO)), {"lat": LAT, "lng": LNG})

    sql = _sql_de(db)
    assert f"asistencia.id_empleado = {ID_TECNICO}" in sql
    assert "asistencia.hora_salida IS NULL" in sql


# ─── Validación de la entrada ────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "cuerpo",
    [
        {"lat": 200, "lng": LNG},         # latitud imposible
        {"lat": LAT, "lng": -500},        # longitud imposible
        {"lat": LAT},                     # falta la longitud
        {},                               # no llega ninguna coordenada
        {"lat": "por alla", "lng": LNG},  # texto en lugar de número
    ],
)
async def test_coordenadas_invalidas_responden_422(cuerpo):
    db = _db_simulada(_jornada())

    respuesta = await _post(_app(db), cuerpo)

    assert respuesta.status_code == 422
    db.add.assert_not_called()


# ─── Autenticación contra la aplicación real ─────────────────────────────────

def test_sin_token_responde_401(test_client):
    # Sin cabecera Authorization no se llega ni a mirar el cuerpo.
    respuesta = test_client.post("/ubicaciones", json={"lat": LAT, "lng": LNG})

    assert respuesta.status_code == 401


def _db_autenticada(empleado, jornada):
    """
    Sesión simulada para la aplicación real: atiende las tres consultas de la
    petición (token revocado, empleado del token y jornada abierta).
    """
    async def _execute(statement, *args, **kwargs):
        sql = str(statement)
        resultado = MagicMock()
        if "token_revocado" in sql:
            resultado.scalar_one_or_none.return_value = None
        elif "asistencia" in sql:
            resultado.scalars.return_value.all.return_value = [jornada] if jornada else []
        else:
            resultado.scalar_one_or_none.return_value = empleado
        return resultado

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.add = MagicMock()

    async def _flush():
        for llamada in db.add.call_args_list:
            llamada.args[0].id_ubicacion = ID_UBICACION

    db.flush = AsyncMock(side_effect=_flush)
    return db


def test_con_token_valido_la_ruta_completa_responde_201(
    test_client, token_tecnico, empleado_tecnico
):
    """
    Recorrido completo por la aplicación real: middlewares, validación del JWT
    y router, sin sustituir la dependencia de autenticación.
    """
    from app.main import app

    # El empleado de la fixture es un MagicMock; la versión del token tiene que
    # ser un entero de verdad porque get_current_empleado la compara con la que
    # viaja dentro del JWT (0 en los tokens recién emitidos).
    empleado_tecnico.version_token = 0

    app.dependency_overrides[get_db] = _generador(
        _db_autenticada(empleado_tecnico, _jornada())
    )
    try:
        respuesta = test_client.post(
            "/ubicaciones",
            headers={"Authorization": f"Bearer {token_tecnico}"},
            json={"lat": LAT, "lng": LNG},
        )
    finally:
        app.dependency_overrides.clear()

    assert respuesta.status_code == 201
    assert respuesta.json()["id_ubicacion"] == ID_UBICACION
