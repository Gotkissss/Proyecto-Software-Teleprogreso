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

from datetime import date, datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, model_validator

from app.core.reglas import MAX_PUNTOS_LOTE


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


class MarcaAsistencia(BaseModel):
    """
    Cuerpo de `POST /asistencia/entrada` y `/salida`.

    Los clientes que mandaban `{lat, lng}` siguen funcionando: son los mismos
    dos campos con los mismos nombres y las mismas validaciones de rango.

    `motivo_sin_ubicacion` es lo que el técnico escribe cuando el GPS no dio
    nada (RTF-01 / R3-4). Solo tiene sentido sin coordenada: con ubicación no
    hay nada que explicar, y aceptarlo en ese caso dejaría filas con las dos
    cosas que se contradicen.
    """

    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    motivo_sin_ubicacion: Optional[str] = Field(None, max_length=200)

    @model_validator(mode="after")
    def coherente(self) -> "MarcaAsistencia":
        if (self.lat is None) != (self.lng is None):
            raise ValueError("Manda lat y lng juntas, o ninguna de las dos.")
        if self.lat is not None and (self.motivo_sin_ubicacion or "").strip():
            raise ValueError(
                "No se manda un motivo de «sin ubicación» junto con una "
                "ubicación."
            )
        return self

    @property
    def coordenadas(self) -> "Optional[UbicacionCreate]":
        """La parte de ubicación, o None si la marca no la trae."""
        if self.lat is None or self.lng is None:
            return None
        return UbicacionCreate(lat=self.lat, lng=self.lng)

    @property
    def motivo(self) -> Optional[str]:
        limpio = (self.motivo_sin_ubicacion or "").strip()
        return limpio or None


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


# ─── HU-5: envío en lote (cola sin conexión) ─────────────────────────────────

class PuntoLote(UbicacionCreate):
    """Punto tomado sin conexión, con la hora real de la lectura del GPS."""

    fecha_hora: datetime = Field(
        ...,
        description=(
            "Momento en que se tomó la lectura, en ISO 8601 con zona "
            "(p. ej. el `toISOString()` del navegador)."
        ),
    )


class UbicacionLoteCreate(BaseModel):
    """Puntos acumulados sin señal que el técnico envía al reconectarse."""

    puntos: List[PuntoLote] = Field(..., min_length=1, max_length=MAX_PUNTOS_LOTE)


class UbicacionLoteResponse(BaseModel):
    """
    Cuántos puntos se guardaron y cuántos se descartaron (fuera de jornada,
    con hora futura o ya guardados en un envío anterior).
    """

    guardados: int
    descartados: int


# ─── HU-5: recorrido del día ─────────────────────────────────────────────────

class PuntoRecorrido(BaseModel):
    """Un punto del recorrido, en orden cronológico."""

    lat: float
    lng: float
    fecha_hora: datetime
    evento: Literal["periodico", "inicio_tarea", "fin_tarea", "entrada", "salida"]
    id_tarea: Optional[int] = None
    titulo_tarea: Optional[str] = None
    # True si antes de este punto pasaron más de `minutos_hueco` sin datos: el
    # tramo que llega a él no es un trayecto real y se dibuja distinto.
    tras_hueco: bool = False


class RecorridoResponse(BaseModel):
    """Recorrido de un técnico en un día (GET /ubicaciones/{id}/recorrido)."""

    id_empleado: int
    nombre: str
    fecha: date
    minutos_hueco: int
    puntos: List[PuntoRecorrido] = []
