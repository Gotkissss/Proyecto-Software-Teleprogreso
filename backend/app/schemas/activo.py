
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
    foto_url:       Optional[str] = None

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
    foto_url:         Optional[str] = None

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

# ── Schemas para crear / actualizar activos ────────────────────────────────

from typing import Literal


class CarroCreate(BaseModel):
    """Body para POST /activos cuando tipo='carro'."""
    tipo: Literal["carro"] = "carro"
    nombre_activo:   str
    descripcion:     Optional[str] = None
    placa:           str
    marca:           Optional[str] = None
    modelo:          Optional[str] = None
    capacidad:       Optional[int] = None
    estado_vehiculo: str = "disponible"


class HerramientaCreate(BaseModel):
    """Body para POST /activos cuando tipo='herramienta'."""
    tipo: Literal["herramienta"] = "herramienta"
    nombre_activo:    str
    descripcion:      Optional[str] = None
    tipo_herramienta: Optional[str] = None
    marca:            Optional[str] = None
    modelo:           Optional[str] = None
    estado:           str = "disponible"


class MaterialCreate(BaseModel):
    """Body para POST /activos cuando tipo='material'."""
    tipo: Literal["material"] = "material"
    nombre_activo:       str
    descripcion:         Optional[str] = None
    cantidad_disponible: int = 0
    stock_minimo:        int = 0
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None


class ActivoUpdateRequest(BaseModel):
    """
    Body para PATCH /activos/{id}.
    Todos los campos son opcionales — solo se actualizan los enviados.
    Sirve para los tres subtipos.
    """
    nombre_activo:       Optional[str] = None
    descripcion:         Optional[str] = None
    # Carro
    placa:               Optional[str] = None
    marca:               Optional[str] = None
    modelo:              Optional[str] = None
    capacidad:           Optional[int] = None
    estado_vehiculo:     Optional[str] = None
    # Herramienta
    tipo_herramienta:    Optional[str] = None
    estado:              Optional[str] = None
    # Material
    cantidad_disponible: Optional[int] = None
    stock_minimo:        Optional[int] = None
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None


class ActivoDetalleResponse(BaseModel):
    """
    Respuesta genérica para POST /activos y PATCH /activos/{id}.
    Incluye todos los campos posibles; los que no apliquen al tipo quedan null.
    """
    id_activo:      int
    nombre_activo:  str
    descripcion:    Optional[str] = None
    tipo:           str
    fecha_registro: date
    foto_url:       Optional[str] = None

    # Carro
    placa:               Optional[str] = None
    marca:               Optional[str] = None
    modelo:              Optional[str] = None
    capacidad:           Optional[int] = None
    estado_vehiculo:     Optional[str] = None
    id_empleado_asignado:     Optional[int] = None
    nombre_empleado_asignado: Optional[str] = None

    # Herramienta
    tipo_herramienta: Optional[str] = None
    estado:           Optional[str] = None

    # Material
    cantidad_disponible: Optional[int] = None
    stock_minimo:        Optional[int] = None
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None

    class Config:
        from_attributes = True

