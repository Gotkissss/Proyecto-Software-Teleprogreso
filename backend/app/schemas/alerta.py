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
    # Nombre real de lo que provoca la alerta (título de la tarea, nombre del
    # técnico o del material). Sin esto la pantalla solo podía mostrar
    # "La tarea #7 venció", y había que ir a buscar a mano cuál es la tarea 7.
    referencia_label: Optional[str] = None
    fecha: datetime

    class Config:
        from_attributes = True


class AlertaUpdate(BaseModel):
    estado: EstadoAlerta
