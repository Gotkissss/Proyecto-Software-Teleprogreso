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
    )


def _db_con_filas(filas):
    """AsyncSession simulada: `filas` son tuplas (tarea, lat, lng)."""
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
    assert parametros == {"db", "current_user"}


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
async def test_ordena_las_paradas_por_id_de_tarea():
    db = _db_con_filas([])

    await get_mi_ruta(db=db, current_user=_empleado())

    assert "ORDER BY tarea.id_tarea" in _sql_de(db)


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
        (_tarea(1, "pendiente"), 14.4744, -90.4425),
        (_tarea(2, "en_progreso"), 14.4751, -90.4437),
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
    db = _db_con_filas([(_tarea(5, "pendiente"), None, None)])

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
