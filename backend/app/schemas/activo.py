# backend/app/schemas/activo.py
"""
Schemas Pydantic para el módulo de inventario / activos.
---------------------------------------------------------

Modelo de datos (ISA — herencia por tipo):
    Activo (clase base)
        ├─ Carro          (placa, marca, modelo, capacidad, estado_vehiculo)
        ├─ Material       (cantidad_disponible, stock_minimo, unidad_medida, tipo_material)
        └─ Herramienta    (tipo_herramienta, marca, modelo, estado)

La creación es "tipada": el cliente envía `tipo` y los atributos
específicos del subtipo en el mismo payload; el backend valida que los
campos requeridos del subtipo estén presentes y crea ambos registros
en la misma transacción (Activo + subtipo).

Endpoints que usan estos schemas:
  GET    /activos                  → ActivoListResponse
  GET    /activos/{id}             → ActivoResponse
  POST   /activos                  → ActivoCreate   → ActivoResponse
  PATCH  /activos/{id}             → ActivoUpdate   → ActivoResponse
  DELETE /activos/{id}             → 204 No Content
  POST   /activos/{id}/imagen      → ActivoResponse (con foto_url)
"""

from datetime import date
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator


# ── Enums de dominio ─────────────────────────────────────────────────────

class TipoActivo(str, Enum):
    """Subtipos posibles de un activo (jerarquía ISA)."""
    carro       = "carro"
    material    = "material"
    herramienta = "herramienta"


class EstadoVehiculo(str, Enum):
    """Estados válidos para un carro/vehículo."""
    disponible      = "disponible"
    en_uso          = "en_uso"
    mantenimiento   = "mantenimiento"
    fuera_servicio  = "fuera_servicio"


class EstadoHerramienta(str, Enum):
    """Estados válidos para una herramienta."""
    disponible     = "disponible"
    en_uso         = "en_uso"
    mantenimiento  = "mantenimiento"
    perdida        = "perdida"
    dada_de_baja   = "dada_de_baja"


# ── Sub-schemas por tipo (creación) ──────────────────────────────────────

class CarroCreate(BaseModel):
    """Atributos específicos cuando tipo == 'carro'."""
    placa:           str
    marca:           Optional[str] = None
    modelo:          Optional[str] = None
    capacidad:       Optional[int] = Field(default=None, ge=0)
    estado_vehiculo: EstadoVehiculo = EstadoVehiculo.disponible

    class Config:
        use_enum_values = True


class MaterialCreate(BaseModel):
    """Atributos específicos cuando tipo == 'material'."""
    cantidad_disponible: int = Field(default=0, ge=0)
    stock_minimo:        int = Field(default=0, ge=0)
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None


class HerramientaCreate(BaseModel):
    """Atributos específicos cuando tipo == 'herramienta'."""
    tipo_herramienta: Optional[str] = None
    marca:            Optional[str] = None
    modelo:           Optional[str] = None
    estado:           EstadoHerramienta = EstadoHerramienta.disponible

    class Config:
        use_enum_values = True


# ── Schema principal de creación ─────────────────────────────────────────

class ActivoCreate(BaseModel):
    """
    Payload para crear un nuevo activo (POST /activos).

    El campo `tipo` determina cuál de los tres bloques opcionales
    (`carro`, `material`, `herramienta`) debe venir poblado. Solo se
    acepta UN subtipo por petición.
    """
    nombre_activo: str = Field(min_length=1, max_length=150)
    descripcion:   Optional[str] = None
    tipo:          TipoActivo

    # Bloques específicos por subtipo (solo uno debe venir)
    carro:       Optional[CarroCreate]       = None
    material:    Optional[MaterialCreate]    = None
    herramienta: Optional[HerramientaCreate] = None

    @model_validator(mode="after")
    def validar_subtipo(self) -> "ActivoCreate":
        """Garantiza que viene exactamente el bloque correspondiente a `tipo`."""
        mapping = {
            TipoActivo.carro.value:       ("carro",       self.carro),
            TipoActivo.material.value:    ("material",    self.material),
            TipoActivo.herramienta.value: ("herramienta", self.herramienta),
        }
        # `tipo` puede llegar como Enum o str dependiendo de use_enum_values
        tipo_str = self.tipo.value if isinstance(self.tipo, TipoActivo) else self.tipo

        nombre_esperado, payload_esperado = mapping[tipo_str]
        if payload_esperado is None:
            raise ValueError(
                f"Para tipo='{tipo_str}' debes enviar el objeto "
                f"'{nombre_esperado}' con sus atributos."
            )

        # Evitar que vengan datos de OTROS subtipos en el mismo payload
        for nombre_otro, payload_otro in mapping.values():
            if nombre_otro != nombre_esperado and payload_otro is not None:
                raise ValueError(
                    f"No puedes enviar el bloque '{nombre_otro}' "
                    f"cuando el tipo es '{tipo_str}'."
                )
        return self

    class Config:
        use_enum_values = True


# ── Schema de actualización (PATCH) ──────────────────────────────────────

class CarroUpdate(BaseModel):
    placa:           Optional[str] = None
    marca:           Optional[str] = None
    modelo:          Optional[str] = None
    capacidad:       Optional[int] = Field(default=None, ge=0)
    estado_vehiculo: Optional[EstadoVehiculo] = None

    class Config:
        use_enum_values = True


class MaterialUpdate(BaseModel):
    cantidad_disponible: Optional[int] = Field(default=None, ge=0)
    stock_minimo:        Optional[int] = Field(default=None, ge=0)
    unidad_medida:       Optional[str] = None
    tipo_material:       Optional[str] = None


class HerramientaUpdate(BaseModel):
    tipo_herramienta: Optional[str] = None
    marca:            Optional[str] = None
    modelo:           Optional[str] = None
    estado:           Optional[EstadoHerramienta] = None

    class Config:
        use_enum_values = True


class ActivoUpdate(BaseModel):
    """
    Campos editables de un activo existente.
    El subtipo NO se puede cambiar (ej: un 'carro' no puede convertirse
    en 'herramienta'); para eso se debe eliminar y volver a crear.
    """
    nombre_activo: Optional[str] = Field(default=None, min_length=1, max_length=150)
    descripcion:   Optional[str] = None
    foto_url:      Optional[str] = None

    # Actualizaciones específicas del subtipo (solo aplica si coinciden)
    carro:       Optional[CarroUpdate]       = None
    material:    Optional[MaterialUpdate]    = None
    herramienta: Optional[HerramientaUpdate] = None

    @model_validator(mode="after")
    def al_menos_un_campo(self) -> "ActivoUpdate":
        if not any([
            self.nombre_activo is not None,
            self.descripcion is not None,
            self.foto_url is not None,
            self.carro is not None,
            self.material is not None,
            self.herramienta is not None,
        ]):
            raise ValueError("Debes enviar al menos un campo para actualizar.")
        return self


# ── Schemas de respuesta ─────────────────────────────────────────────────

class CarroResponse(BaseModel):
    placa:           str
    marca:           Optional[str]
    modelo:          Optional[str]
    capacidad:       Optional[int]
    estado_vehiculo: str

    class Config:
        from_attributes = True


class MaterialResponse(BaseModel):
    cantidad_disponible: int
    stock_minimo:        int
    unidad_medida:       Optional[str]
    tipo_material:       Optional[str]

    class Config:
        from_attributes = True


class HerramientaResponse(BaseModel):
    tipo_herramienta: Optional[str]
    marca:            Optional[str]
    modelo:           Optional[str]
    estado:           str

    class Config:
        from_attributes = True


class ActivoResponse(BaseModel):
    """
    Representación pública de un activo. Incluye los datos específicos
    del subtipo cuando estén disponibles (solo uno estará poblado).
    """
    id_activo:      int
    nombre_activo:  str
    tipo:           str
    descripcion:    Optional[str]
    foto_url:       Optional[str]
    fecha_registro: date

    carro:       Optional[CarroResponse]       = None
    material:    Optional[MaterialResponse]    = None
    herramienta: Optional[HerramientaResponse] = None

    class Config:
        from_attributes = True


class ActivoListResponse(BaseModel):
    """Respuesta de listado con metadatos para el frontend."""
    total:   int
    activos: List[ActivoResponse]
