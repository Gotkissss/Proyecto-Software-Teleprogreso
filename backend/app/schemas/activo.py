
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


# ── Activo base ────────────────────────────────────────────────────────────

class ActivoBase(BaseModel):
    id_activo:      int
    nombre_activo:  str
    descripcion:    Optional[str] = None
    tipo:           str
    fecha_registro: date

    class Config:
        from_attributes = True


# ── Material ───────────────────────────────────────────────────────────────

class MaterialResponse(ActivoBase):
    """
    Respuesta para un material, incluyendo stock.
    Usado por GET /activos/materiales y GET /activos/materiales/bajo-stock.
    """
    cantidad_disponible: int
    stock_minimo:        int
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None


# ── Herramienta ────────────────────────────────────────────────────────────

class HerramientaResponse(ActivoBase):
    """
    Respuesta para una herramienta.
    Usado por GET /activos/herramientas y GET /activos/carros/{id}/herramientas.
    """
    tipo_herramienta: Optional[str] = None
    marca:            Optional[str] = None
    modelo:           Optional[str] = None
    estado:           str


class HerramientaEnCarroResponse(BaseModel):
    """
    Herramienta asignada a un carro, incluyendo datos de la relacion CarroHerramienta.
    """
    # Campos de la herramienta
    id_activo:        int
    nombre_activo:    str
    tipo_herramienta: Optional[str] = None
    marca:            Optional[str] = None
    modelo:           Optional[str] = None
    estado:           str
    descripcion:      Optional[str] = None

    # Campos de la relacion CarroHerramienta
    fecha_asignacion: Optional[datetime] = None
    estado_entrega:   Optional[str]      = None
    comentario:       Optional[str]      = None

    class Config:
        from_attributes = True


# ── Carro ──────────────────────────────────────────────────────────────────

class CarroResponse(ActivoBase):
    """
    Respuesta para un vehículo.
    """
    placa:           str
    marca:           Optional[str] = None
    modelo:          Optional[str] = None
    capacidad:       Optional[int] = None
    estado_vehiculo: str

    # Tecnico asignado (opcional, viene de EmpleadoCarro JOIN)
    id_empleado_asignado:     Optional[int] = None
    nombre_empleado_asignado: Optional[str] = None


# ── Requests (bodies de POST) ──────────────────────────────────────────────

class AsignarHerramientaRequest(BaseModel):
    """
    Body para POST /activos/carros/{id}/herramientas
    """
    id_herramienta: int


class AsignarTecnicoRequest(BaseModel):
    """
    Body para POST /activos/carros/{id}/asignar
    """
    id_empleado: int