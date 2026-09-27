# backend/tests/test_tareas_mi_ruta.py
"""
Pruebas de GET /tareas/mi-ruta — SCRUM-160/184.

Es el endpoint que alimenta el mapa de ruta del técnico: devuelve las tareas
del empleado autenticado que van en el mapa de HOY, con lat/lng listas para
pintar.

Tres cosas lo hacen delicado y son las que se fijan aquí:

  1. No recibe ningún parámetro de empleado. El recorte sale de `current_user`,
     así que un técnico no puede pedir la ruta de otro ni "probando" con un
     query string. Si alguien agrega ese parámetro, un test falla.
  2. "Hoy" es el día en hora de Guatemala, no en UTC. El contenedor corre en
     UTC: con `date.today()` la ruta cambiaba de día a las 18:00 hora local y
     el técnico se quedaba con el mapa vacío en plena jornada.
  3. Una tarea completada se pinta solo el día en que se cerró. El recorte va
     por `fecha_completado`, no por `fecha_inicio`: con `fecha_inicio` el punto
     verde seguía en el mapa todos los días de su rango y el mapa del técnico
     se llenaba de trabajo ya hecho.

Como la sesión está mockeada, el filtrado se comprueba sobre el SQL generado,
igual que en test_tareas_visibilidad.py.
"""

import inspect
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.tiempo import hoy as hoy_local
from app.routers.tareas import get_mi_ruta


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _tarea(id_tarea, estado, **campos):
    """Fila ORM simulada con lo mínimo que arma la respuesta del mapa."""
    return SimpleNamespace(
        id_tarea=id_tarea,
        titulo=campos.get("titulo", f"Tarea {id_tarea}"),
        descripcion=campos.get("descripcion"),
        direccion_servicio=campos.get("direccion_servicio"),
        estado_tarea=estado,
        prioridad=campos.get("prioridad", "media"),
        fecha_completado=campos.get("fecha_completado"),
        fecha_finalizacion=campos.get("fecha_finalizacion"),
    )


def _db_con_filas(filas):
    """AsyncSession simulada: `filas` son tuplas (tarea, lat, lng, distancia_m)."""
    resultado = MagicMock()
    resultado.all.return_value = filas

    db = MagicMock()
    db.execute = AsyncMock(return_value=resultado)
    return db


def _sql_de(db):
    """SQL compilado, con los valores incrustados, de la última consulta."""
    statement = db.execute.await_args.args[0]
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


def _empleado(id_empleado=2, rol="tecnico"):
    return SimpleNamespace(id_empleado=id_empleado, rol=rol)


# ─── Recorte por empleado autenticado ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_filtra_por_el_empleado_autenticado():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado(id_empleado=7))

    sql = _sql_de(db)
    assert "empleado_tarea" in sql
    assert "id_empleado = 7" in sql


@pytest.mark.asyncio
async def test_dos_tecnicos_distintos_generan_recortes_distintos():
    db_uno = _db_con_filas([])
    db_dos = _db_con_filas([])

    await get_mi_ruta(db=db_uno, current_user=_empleado(id_empleado=3))
    await get_mi_ruta(db=db_dos, current_user=_empleado(id_empleado=9))

    assert "id_empleado = 3" in _sql_de(db_uno)
    assert "id_empleado = 9" in _sql_de(db_dos)


def test_el_endpoint_no_acepta_un_empleado_por_parametro():
    """
    El recorte tiene que venir del token, no de la petición.

    Si alguien agrega un `id_tecnico` o `id_empleado` a la firma, cualquier
    técnico podría leer la ruta de un compañero pasándolo por query string.
    """
    parametros = set(inspect.signature(get_mi_ruta).parameters)

    assert "id_tecnico" not in parametros
    assert "id_empleado" not in parametros
    # lat/lng (HU-3) son la posición del propio técnico para ordenar su ruta,
    # no un selector de empleado.
    assert parametros == {"db", "current_user", "lat", "lng"}


# ─── Recorte por día ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_las_completadas_se_recortan_por_el_dia_en_que_se_cerraron():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    sql = _sql_de(db)

    # hoy_local(), no date.today(): en UTC el día cambia 6 horas antes.
    assert f"fecha_completado >= '{hoy_local()}" in sql
    assert f"fecha_completado < '{hoy_local() + timedelta(days=1)}" in sql

    # El recorte del mapa ya no depende de la fecha planificada: con
    # `fecha_inicio` una tarea cerrada seguía pintada días enteros.
    # (Aparece en el SELECT porque se trae la fila entera; lo que importa es
    # que no forme parte del WHERE.)
    assert "fecha_inicio" not in sql.split("WHERE", 1)[1]


@pytest.mark.asyncio
async def test_el_trabajo_abierto_entra_sin_importar_su_fecha_planificada():
    """
    Pendiente y en progreso son trabajo vivo: van al mapa aunque su fecha ya
    se haya pasado. Antes una tarea vencida desaparecía del mapa justo cuando
    más urgía verla.
    """
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    assert "estado_tarea IN ('pendiente', 'en_progreso')" in _sql_de(db)


@pytest.mark.asyncio
async def test_las_canceladas_no_entran_al_mapa():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    assert "cancelado" not in _sql_de(db)


@pytest.mark.asyncio
async def test_el_id_de_tarea_cierra_el_orden_para_que_sea_estable():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    orden = _sql_de(db).split("ORDER BY", 1)[1]
    assert orden.rstrip().endswith("tarea.id_tarea")


# ─── Serialización de coordenadas ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_consulta_convierte_geography_a_geometry():
    # ST_X/ST_Y solo operan sobre geometry; sin el cast, PostGIS revienta.
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    # SQLAlchemy compila el tipo como `geometry(GEOMETRY,-1)`, así que se
    # comprueba el prefijo y no la firma completa.
    assert "CAST(tarea.coordenada_servicio AS geometry" in _sql_de(db)


@pytest.mark.asyncio
async def test_lat_es_ST_Y_y_lng_es_ST_X():
    """
    Con SRID 4326, ST_Y es la latitud y ST_X la longitud.

    Intercambiarlas no rompe nada en el backend: la respuesta sale con dos
    números perfectamente válidos y el mapa deja al técnico en medio del
    océano Índico. Por eso se fija el par aquí.
    """
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    sql = _sql_de(db)

    # Se comparan posiciones en vez de usar comodines: el CAST lleva comas y
    # paréntesis dentro (`geometry(GEOMETRY,-1)`), así que cualquier regex
    # laxa termina cruzando de una columna a la otra y da un falso verde.
    # El orden tiene que ser exactamente: ST_Y … AS lat, ST_X … AS lng.
    posicion_st_y = sql.index("ST_Y(")
    posicion_st_x = sql.index("ST_X(")
    posicion_lat = sql.index(" AS lat")
    posicion_lng = sql.index(" AS lng")

    assert posicion_st_y < posicion_lat < posicion_st_x < posicion_lng, (
        f"lat y lng están cruzadas en el SELECT: {sql}"
    )


@pytest.mark.asyncio
async def test_devuelve_las_paradas_con_sus_coordenadas():
    db = _db_con_filas([
        (_tarea(1, "pendiente"), 14.4744, -90.4425, None),
        (_tarea(2, "en_progreso"), 14.4751, -90.4437, None),
    ])

    ruta = await get_mi_ruta(db=db, current_user=_empleado())

    assert len(ruta) == 2
    assert ruta[0].id_tarea == 1
    assert ruta[0].estado_tarea == "pendiente"
    assert ruta[0].lat == 14.4744
    assert ruta[0].lng == -90.4425
    assert ruta[1].id_tarea == 2
    assert ruta[1].estado_tarea == "en_progreso"


@pytest.mark.asyncio
async def test_la_parada_trae_lo_que_el_popup_del_mapa_necesita():
    """
    El popup del marcador muestra título, dirección y prioridad. Si el
    endpoint solo devolviera id/estado/lat/lng, el mapa tendría que pedir
    otra vez la lista completa de tareas para rellenarlo.
    """
    db = _db_con_filas([
        (
            _tarea(
                3,
                "pendiente",
                titulo="Instalación fibra óptica",
                direccion_servicio="Calle 15, Fraijanes",
                prioridad="urgente",
            ),
            14.47,
            -90.44,
            None,
        ),
    ])

    ruta = await get_mi_ruta(db=db, current_user=_empleado())

    assert ruta[0].titulo == "Instalación fibra óptica"
    assert ruta[0].direccion_servicio == "Calle 15, Fraijanes"
    assert ruta[0].prioridad == "urgente"


@pytest.mark.asyncio
async def test_una_tarea_sin_ubicacion_no_rompe_la_ruta():
    # La coordenada es opcional (SCRUM-169): las tareas viejas solo tienen
    # dirección escrita. El mapa las omite, pero la respuesta no debe fallar.
    db = _db_con_filas([(_tarea(5, "pendiente"), None, None, None)])

    ruta = await get_mi_ruta(db=db, current_user=_empleado())

    assert len(ruta) == 1
    assert ruta[0].lat is None
    assert ruta[0].lng is None


@pytest.mark.asyncio
async def test_sin_tareas_hoy_devuelve_lista_vacia():
    # Un día libre no es un error: la pantalla muestra su estado vacío.
    db = _db_con_filas([])

    ruta = await get_mi_ruta(db=db, current_user=_empleado())

    assert ruta == []


# ─── HU-3: orden por cercanía y distancia ─────────────────────────────────────
#
# La regla está documentada en app/core/reglas.py: abiertas antes que
# completadas; con posición, urgentes primero y luego la más cercana; sin
# posición, orden por prioridad. Como la sesión está mockeada, el orden se
# verifica sobre el ORDER BY generado, igual que el recorte del día.

FRAIJANES = {"lat": 14.4653, "lng": -90.4408}


def _orden_de(db):
    """Solo la cláusula ORDER BY del SQL de la última consulta."""
    return _sql_de(db).split("ORDER BY", 1)[1]


@pytest.mark.asyncio
async def test_con_posicion_calcula_la_distancia_con_ST_Distance():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado(), **FRAIJANES)

    sql = _sql_de(db)
    assert "ST_Distance(tarea.coordenada_servicio" in sql
    assert " AS distancia_m" in sql


@pytest.mark.asyncio
async def test_el_punto_del_tecnico_se_arma_con_longitud_primero():
    """
    WKT es POINT(lng lat). Invertirlo no da error: solo mide la distancia a
    un punto en otro continente y el orden sale al azar.
    """
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado(), **FRAIJANES)

    assert "ST_GeogFromText('SRID=4326;POINT(-90.4408 14.4653)')" in _sql_de(db)


@pytest.mark.asyncio
async def test_con_posicion_ordena_por_cercania():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado(), **FRAIJANES)

    orden = _orden_de(db)
    assert "ST_Distance(" in orden
    # Las tareas sin coordenada no tienen distancia: van al final del grupo.
    assert "ASC NULLS LAST" in orden


@pytest.mark.asyncio
async def test_las_urgentes_van_antes_que_la_cercania():
    """
    Una urgente lejana va antes que una baja a la vuelta de la esquina: el
    criterio de urgente aparece en el ORDER BY antes que la distancia.
    """
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado(), **FRAIJANES)

    orden = _orden_de(db)
    assert "tarea.prioridad = 'urgente'" in orden
    assert orden.index("tarea.prioridad = 'urgente'") < orden.index("ST_Distance(")


@pytest.mark.asyncio
async def test_lo_completado_va_al_final_incluso_si_esta_mas_cerca():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado(), **FRAIJANES)

    orden = _orden_de(db)
    assert orden.index("tarea.estado_tarea = 'completado'") < orden.index(
        "tarea.prioridad = 'urgente'"
    )


@pytest.mark.asyncio
async def test_sin_posicion_ordena_solo_por_prioridad():
    """
    GPS denegado o sin señal: no se inventa una distancia y la ruta cae al
    orden por prioridad (urgente, alta, media, baja), como antes de HU-3.
    """
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    sql = _sql_de(db)
    orden = _orden_de(db)
    assert "ST_Distance" not in sql
    assert "NULL AS distancia_m" in sql
    posiciones = [
        orden.index(f"tarea.prioridad = '{prioridad}'")
        for prioridad in ("urgente", "alta", "media", "baja")
    ]
    assert posiciones == sorted(posiciones)


@pytest.mark.asyncio
async def test_devuelve_la_distancia_de_cada_parada():
    db = _db_con_filas([
        (_tarea(1, "pendiente", prioridad="urgente"), 14.47, -90.44, 2400.5),
        (_tarea(2, "pendiente"), 14.46, -90.45, 350.0),
        (_tarea(3, "pendiente"), None, None, None),
    ])

    ruta = await get_mi_ruta(db=db, current_user=_empleado(), **FRAIJANES)

    # El orden es el que decide la base de datos; el servicio no lo altera.
    assert [p.id_tarea for p in ruta] == [1, 2, 3]
    assert ruta[0].distancia_m == 2400.5
    assert ruta[1].distancia_m == 350.0
    assert ruta[2].distancia_m is None


@pytest.mark.asyncio
async def test_la_parada_trae_su_fecha_limite():
    from datetime import date as _date

    db = _db_con_filas([
        (_tarea(4, "pendiente", fecha_finalizacion=_date(2026, 9, 30)), 14.47, -90.44, None),
    ])

    ruta = await get_mi_ruta(db=db, current_user=_empleado())

    assert ruta[0].fecha_finalizacion == _date(2026, 9, 30)


@pytest.mark.asyncio
@pytest.mark.parametrize("coordenadas", [{"lat": 14.46}, {"lng": -90.44}])
async def test_una_sola_coordenada_se_rechaza(coordenadas):
    from app.core.exceptions import APIException

    db = _db_con_filas([])

    with pytest.raises(APIException) as error:
        await get_mi_ruta(db=db, current_user=_empleado(), **coordenadas)

    assert error.value.status_code == 400
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query",
    ["lat=91&lng=-90.44", "lat=14.46&lng=-181", "lat=abc&lng=-90.44"],
)
async def test_coordenadas_fuera_de_rango_devuelven_422(query):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core.deps import get_current_empleado
    from app.db.session import get_db
    from app.routers import tareas

    app = FastAPI()
    app.include_router(tareas.router)

    async def db_simulada():
        yield _db_con_filas([])

    async def usuario_simulado():
        return _empleado()

    app.dependency_overrides[get_db] = db_simulada
    app.dependency_overrides[get_current_empleado] = usuario_simulado

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        respuesta = await client.get(f"/tareas/mi-ruta?{query}")

    assert respuesta.status_code == 422
