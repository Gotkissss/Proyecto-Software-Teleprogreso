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
