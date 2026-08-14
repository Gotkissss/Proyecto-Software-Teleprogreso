
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field

from app.core.reglas import ESTADOS_HERRAMIENTA, ESTADOS_VEHICULO


def _validar_estado(valor: Optional[str], permitidos: tuple, campo: str) -> Optional[str]:
    """
    Comprueba que un estado esté dentro de la lista blanca.

    Se hace con una función y no con `Literal[...]` para poder construir el
    mensaje de error con los valores admitidos, que es lo que necesita ver
    quien esté llamando a la API.

    Solo se aplica a los schemas de ENTRADA. Los de respuesta siguen aceptando
    cualquier cadena a propósito: si en la base quedó un estado antiguo de
    antes de la migración 0006, la lectura tiene que seguir funcionando en vez
    de reventar al serializar.
    """
    if valor is None:
        return None
    limpio = valor.strip().lower()
    if limpio not in permitidos:
        raise ValueError(
            f"'{valor}' no es un {campo} válido. "
            f"Valores permitidos: {', '.join(permitidos)}."
        )
    return limpio


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

from pydantic import field_validator


class CarroCreate(BaseModel):
    """Body para POST /activos cuando tipo='carro'."""
    tipo: Literal["carro"] = "carro"
    nombre_activo:   str
    descripcion:     Optional[str] = None
    placa:           str
    marca:           Optional[str] = None
    modelo:          Optional[str] = None
    capacidad:       Optional[int] = Field(None, ge=0)
    estado_vehiculo: str = "disponible"

    @field_validator("estado_vehiculo")
    @classmethod
    def estado_permitido(cls, v):
        return _validar_estado(v, ESTADOS_VEHICULO, "estado de vehículo")


class HerramientaCreate(BaseModel):
    """Body para POST /activos cuando tipo='herramienta'."""
    tipo: Literal["herramienta"] = "herramienta"
    nombre_activo:    str
    descripcion:      Optional[str] = None
    tipo_herramienta: Optional[str] = None
    marca:            Optional[str] = None
    modelo:           Optional[str] = None
    estado:           str = "disponible"

    @field_validator("estado")
    @classmethod
    def estado_permitido(cls, v):
        return _validar_estado(v, ESTADOS_HERRAMIENTA, "estado de herramienta")


class MaterialCreate(BaseModel):
    """Body para POST /activos cuando tipo='material'."""
    tipo: Literal["material"] = "material"
    nombre_activo:       str
    descripcion:         Optional[str] = None
    # ge=0: el inventario admitía cantidades negativas. Se podía dejar un
    # material en -500 unidades, y esa fila además contaba como "bajo stock".
    cantidad_disponible: int = Field(0, ge=0)
    stock_minimo:        int = Field(0, ge=0)
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
    capacidad:           Optional[int] = Field(None, ge=0)
    estado_vehiculo:     Optional[str] = None
    # Herramienta
    tipo_herramienta:    Optional[str] = None
    estado:              Optional[str] = None
    # Material
    cantidad_disponible: Optional[int] = Field(None, ge=0)
    stock_minimo:        Optional[int] = Field(None, ge=0)
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None

    # Estos dos campos eran texto libre. Con `{"estado": "disponible"}` sobre
    # una herramienta ya cargada en un vehículo se conseguía volver a
    # asignarla, dejándola en dos vehículos a la vez; y con
    # `{"estado_vehiculo": "disponible"}` sobre un carro ya asignado, la
    # siguiente asignación borraba al técnico anterior sin avisar.
    @field_validator("estado")
    @classmethod
    def estado_herramienta_permitido(cls, v):
        return _validar_estado(v, ESTADOS_HERRAMIENTA, "estado de herramienta")

    @field_validator("estado_vehiculo")
    @classmethod
    def estado_vehiculo_permitido(cls, v):
        return _validar_estado(v, ESTADOS_VEHICULO, "estado de vehículo")


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

