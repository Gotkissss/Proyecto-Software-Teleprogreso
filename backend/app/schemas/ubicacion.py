# backend/app/schemas/ubicacion.py
"""
Schemas del reporte de ubicación del técnico — Teleprogreso S.A. (SCRUM-216)
-----------------------------------------------------------------------------
El técnico envía la posición que le entrega el GPS del teléfono y la API
responde con el comprobante de lo que quedó guardado.

La entrada solo declara `lat` y `lng` a propósito. Pydantic descarta cualquier
otro campo del cuerpo, así que un cliente que intente colar `id_empleado` no
llega a ninguna parte: el router toma ese dato del token y nunca del cuerpo.
-----------------------------------------------------------------------------
"""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class UbicacionCreate(BaseModel):
    """Posición reportada por el técnico durante su jornada."""

    # Los rangos se validan aquí y no en el router: el navegador puede mandar
    # cualquier cosa (una lectura corrupta del GPS, o directamente un valor
    # inventado con curl) y un punto fuera del planeta se guardaría sin que
    # PostGIS proteste, dejando un marcador imposible en el mapa.
    lat: float = Field(
        ...,
        ge=-90,
        le=90,
        description="Latitud en grados decimales (WGS84), entre -90 y 90.",
    )
    lng: float = Field(
        ...,
        ge=-180,
        le=180,
        description="Longitud en grados decimales (WGS84), entre -180 y 180.",
    )


class UbicacionResponse(BaseModel):
    """Comprobante del registro guardado."""

    id_ubicacion: int
    fecha_hora_registro: datetime
    mensaje: str = "Ubicación registrada correctamente."

class UbicacionTecnicoResponse(BaseModel):
    id_empleado: int
    nombre: str
    lat: float
    lng: float
    fecha_hora_registro: datetime
    estado: Literal["en_tarea", "en_pausa", "disponible"]
