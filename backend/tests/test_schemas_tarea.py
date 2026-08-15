# backend/tests/test_schemas_tarea.py
"""
Pruebas unitarias de los schemas de Tarea (Pydantic) — Teleprogreso S.A.
------------------------------------------------------------------------
Verifica que la validación de datos de entrada funcione correctamente
antes de llegar a la base de datos.

Se ejecutan con: pytest tests/ -v
"""

import pytest
from pydantic import ValidationError

from app.schemas.tarea import (
    EstadoServicio,
    PrioridadServicio,
    TareaCreate,
    TareaReasignar,
    TareaUpdate,
    TareaUpdateEstado,
)


# 1. CREACIÓN DE TAREAS

def test_tarea_create_valida():
    """Una tarea con nombre y prioridad válida se acepta."""
    tarea = TareaCreate(nombre="Instalar router", prioridad="alta")
    assert tarea.nombre == "Instalar router"
    assert tarea.prioridad == PrioridadServicio.alta


def test_tarea_create_prioridad_por_defecto():
    """Si no se envía prioridad, el valor por defecto es 'media'."""
    tarea = TareaCreate(nombre="Revisión de fibra")
    assert tarea.prioridad == PrioridadServicio.media
    assert tarea.descripcion is None
    assert tarea.id_tecnico is None


def test_tarea_create_sin_nombre_falla():
    """El nombre es obligatorio: sin él debe lanzar ValidationError."""
    with pytest.raises(ValidationError):
        TareaCreate(prioridad="alta")


def test_tarea_create_prioridad_invalida_falla():
    """Una prioridad fuera del enum debe rechazarse."""
    with pytest.raises(ValidationError):
        TareaCreate(nombre="Test", prioridad="urgentisima")


@pytest.mark.parametrize(
    "lat,lng",
    [
        (-90, -180),
        (0, 0),
        (90, 180),
        (14.4744, -90.4425),
    ],
)
def test_tarea_create_acepta_coordenadas_validas(lat, lng):
    tarea = TareaCreate(nombre="Instalar router", lat=lat, lng=lng)

    assert tarea.lat == lat
    assert tarea.lng == lng


@pytest.mark.parametrize("lat", [-90.000001, 90.000001])
def test_tarea_create_rechaza_latitud_fuera_de_rango(lat):
    with pytest.raises(ValidationError):
        TareaCreate(nombre="Instalar router", lat=lat, lng=-90.4425)


@pytest.mark.parametrize("lng", [-180.000001, 180.000001])
def test_tarea_create_rechaza_longitud_fuera_de_rango(lng):
    with pytest.raises(ValidationError):
        TareaCreate(nombre="Instalar router", lat=14.4744, lng=lng)


@pytest.mark.parametrize("datos", [{"lat": 14.4744}, {"lng": -90.4425}])
def test_tarea_create_rechaza_coordenada_incompleta(datos):
    with pytest.raises(ValidationError, match="lat y lng"):
        TareaCreate(nombre="Instalar router", **datos)


def test_tarea_update_acepta_actualizar_y_eliminar_coordenadas():
    actualizar = TareaUpdate(lat=14.4744, lng=-90.4425)
    eliminar = TareaUpdate(lat=None, lng=None)

    assert actualizar.model_dump(exclude_unset=True) == {
        "lat": 14.4744,
        "lng": -90.4425,
    }
    assert eliminar.model_dump(exclude_unset=True) == {"lat": None, "lng": None}


@pytest.mark.parametrize(
    "datos",
    [
        {"lat": 14.4744},
        {"lng": -90.4425},
        {"lat": None},
        {"lng": None},
        {"lat": 14.4744, "lng": None},
        {"lat": None, "lng": -90.4425},
    ],
)
def test_tarea_update_rechaza_coordenada_incompleta(datos):
    with pytest.raises(ValidationError, match="lat y lng"):
        TareaUpdate(**datos)


# 2. CAMBIO DE ESTADO

def test_update_estado_valido():
    """Los cuatro estados del enum se aceptan."""
    for estado in ("pendiente", "en_progreso", "completado", "cancelado"):
        update = TareaUpdateEstado(estado=estado)
        assert update.estado == EstadoServicio(estado)


def test_update_estado_invalido_falla():
    """Un estado inexistente debe lanzar ValidationError."""
    with pytest.raises(ValidationError):
        TareaUpdateEstado(estado="terminado")


# 3. REASIGNACIÓN

def test_reasignar_requiere_id_tecnico():
    """Reasignar sin id_tecnico debe fallar."""
    with pytest.raises(ValidationError):
        TareaReasignar()


def test_reasignar_id_tecnico_no_numerico_falla():
    """id_tecnico debe ser un entero."""
    with pytest.raises(ValidationError):
        TareaReasignar(id_tecnico="abc")
