from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class EstadoAlerta(str, Enum):
    pendiente = "pendiente"
    atendida = "atendida"
    descartada = "descartada"


class AlertaResponse(BaseModel):
    id_alerta: int
    tipo: str
    severidad: str
    estado: str
    referencia: Optional[str] = None
    fecha: datetime

    class Config:
        from_attributes = True


class AlertaUpdate(BaseModel):
    estado: EstadoAlerta
