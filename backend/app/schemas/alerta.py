from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class EstadoAlerta(str, Enum):
    pendiente = "pendiente"
    atendida = "atendida"
    descartada = "descartada"
    # La puso el sistema, no una persona: la condición que originó la alerta
    # dejó de cumplirse (se cerró la tarea, se repuso el material, el técnico
    # marcó entrada). Se distingue de 'atendida' a propósito, para que el
    # supervisor pueda separar lo que resolvió él de lo que se arregló solo.
    resuelta = "resuelta"


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
