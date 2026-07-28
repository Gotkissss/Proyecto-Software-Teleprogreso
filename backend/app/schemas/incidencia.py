# backend/app/schemas/incidencia.py
"""
Schemas de Incidencias (evidencias de trabajo) — Teleprogreso S.A.
-----------------------------------------------------------------------------
Una incidencia es el registro que deja el técnico al finalizar una tarea:
descripción de lo realizado y, opcionalmente, una foto de evidencia.
-----------------------------------------------------------------------------
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class IncidenciaCreate(BaseModel):
    """Body de POST /tareas/{id}/incidencias."""

    descripcion: str = Field(
        ...,
        min_length=5,
        max_length=2000,
        description="Descripción de lo realizado o del problema encontrado.",
    )
    finalizar_tarea: bool = Field(
        False,
        description=(
            "Si es true, además de registrar la evidencia marca la tarea como "
            "'completado'. El flujo recomendado del modal 'Finalizar tarea' es: "
            "crear la incidencia, subir la foto y recién entonces finalizar, "
            "para no cerrar una tarea cuya evidencia falló al subirse."
        ),
    )

    @field_validator("descripcion")
    @classmethod
    def descripcion_no_vacia(cls, v: str) -> str:
        # min_length no basta: "     " pasaría la validación de longitud.
        limpia = v.strip()
        if len(limpia) < 5:
            raise ValueError("La descripción debe tener al menos 5 caracteres.")
        return limpia


class IncidenciaResponse(BaseModel):
    """Una evidencia registrada en una tarea."""

    id_incidencia: int
    id_tarea: int
    descripcion: Optional[str] = None
    foto_evidencia: Optional[str] = None
    fecha_reporte: datetime

    class Config:
        from_attributes = True


class FotoEvidenciaResponse(BaseModel):
    """Respuesta del upload de foto de evidencia."""

    detail: str
    id_incidencia: int
    foto_evidencia: str
