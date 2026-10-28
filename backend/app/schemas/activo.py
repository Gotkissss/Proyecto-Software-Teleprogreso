
from datetime import date, datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

from app.core.archivos_firmados import UrlArchivo
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
    foto_url:       UrlArchivo = None

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
    foto_url:         UrlArchivo = None

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
    nombre_activo:   str = Field(..., max_length=150)
    descripcion:     Optional[str] = Field(None, max_length=2000)
    placa:           str = Field(..., max_length=20)
    marca:           Optional[str] = Field(None, max_length=80)
    modelo:          Optional[str] = Field(None, max_length=80)
    capacidad:       Optional[int] = Field(None, ge=0)
    estado_vehiculo: str = Field("disponible", max_length=30)

    @field_validator("estado_vehiculo")
    @classmethod
    def estado_permitido(cls, v):
        return _validar_estado(v, ESTADOS_VEHICULO, "estado de vehículo")


class HerramientaCreate(BaseModel):
    """Body para POST /activos cuando tipo='herramienta'."""
    tipo: Literal["herramienta"] = "herramienta"
    nombre_activo:    str = Field(..., max_length=150)
    descripcion:      Optional[str] = Field(None, max_length=2000)
    tipo_herramienta: Optional[str] = Field(None, max_length=80)
    marca:            Optional[str] = Field(None, max_length=80)
    modelo:           Optional[str] = Field(None, max_length=80)
    estado:           str = Field("disponible", max_length=30)

    @field_validator("estado")
    @classmethod
    def estado_permitido(cls, v):
        return _validar_estado(v, ESTADOS_HERRAMIENTA, "estado de herramienta")


class MaterialCreate(BaseModel):
    """Body para POST /activos cuando tipo='material'."""
    tipo: Literal["material"] = "material"
    nombre_activo: str = Field(..., max_length=150)
    descripcion:   Optional[str] = Field(None, max_length=2000)
    # ge=0: el inventario admitía cantidades negativas. Se podía dejar un
    # material en -500 unidades, y esa fila además contaba como "bajo stock".
    cantidad_disponible: int = Field(0, ge=0)
    stock_minimo:        int = Field(0, ge=0)
    unidad_medida: Optional[str] = Field(None, max_length=30)
    tipo_material: Optional[str] = Field(None, max_length=80)


class ActivoUpdateRequest(BaseModel):
    """
    Body para PATCH /activos/{id}.
    Todos los campos son opcionales — solo se actualizan los enviados.
    Sirve para los tres subtipos.
    """
    nombre_activo:       Optional[str] = Field(None, max_length=150)
    descripcion:         Optional[str] = Field(None, max_length=2000)
    # Carro
    placa:               Optional[str] = Field(None, max_length=20)
    marca:               Optional[str] = Field(None, max_length=80)
    modelo:              Optional[str] = Field(None, max_length=80)
    capacidad:           Optional[int] = Field(None, ge=0)
    estado_vehiculo:     Optional[str] = Field(None, max_length=30)
    # Herramienta
    tipo_herramienta:    Optional[str] = Field(None, max_length=80)
    estado:              Optional[str] = Field(None, max_length=30)
    # Material
    #
    # `cantidad_disponible` NO está aquí a propósito (HU-S10-07). Editar el
    # stock a mano por este PATCH era el camino por el que el número cambiaba
    # sin dejar rastro: nadie podía saber si las 40 unidades que faltaban se
    # habían usado en tareas, se habían perdido o alguien se había equivocado
    # al teclear. El stock se mueve con POST
    # /activos/materiales/{id}/movimientos, que exige decir por qué.
    stock_minimo:        Optional[int] = Field(None, ge=0)
    unidad_medida:       Optional[str] = Field(None, max_length=30)
    tipo_material:       Optional[str] = Field(None, max_length=80)

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
    foto_url:       UrlArchivo = None

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


class ImagenActivoResponse(BaseModel):
    """Respuesta de POST /activos/{id}/imagen."""

    detail:   str
    foto_url: UrlArchivo = None


# ── Kardex de materiales (HU-S10-07) ────────────────────────────────────────

class MovimientoMaterialCreate(BaseModel):
    """
    Body de POST /activos/materiales/{id}/movimientos.

    `tipo` decide qué significa `cantidad`:

      - `entrada`: unidades que llegan al almacén. Se suman.
      - `ajuste`:  el saldo al que queda el material tras contarlo. Se fija,
                   no se suma, porque un ajuste es "contamos y hay 37", no
                   "sumá 37". Lleva motivo obligatorio: sin él, un ajuste y un
                   dedazo son la misma fila.

    No se acepta `consumo` por aquí. Un consumo pertenece a una tarea, y la
    tarea es la que lo registra al cerrarse: dejarlo suelto permitiría apuntar
    consumos sin trabajo que los explique, que es el agujero que esta historia
    cierra.
    """

    tipo: Literal["entrada", "ajuste"]
    cantidad: int = Field(..., gt=0)
    motivo: Optional[str] = Field(None, max_length=300)

    @model_validator(mode="after")
    def ajuste_con_motivo(self) -> "MovimientoMaterialCreate":
        if self.tipo == "ajuste" and not (self.motivo or "").strip():
            raise ValueError(
                "Un ajuste de inventario necesita un motivo."
            )
        return self


class MovimientoMaterialResponse(BaseModel):
    """Una línea del kardex, como la pinta la pestaña de movimientos."""

    id_movimiento: int
    tipo: str
    cantidad: int
    saldo_resultante: int
    motivo: Optional[str] = None
    fecha_hora: datetime
    # Null cuando la tarea o el empleado se borraron: el movimiento no se
    # reescribe, así que la fila sigue contando lo que pasó aunque ya no se
    # pueda decir quién.
    id_tarea: Optional[int] = None
    titulo_tarea: Optional[str] = None
    id_empleado: Optional[int] = None
    nombre_empleado: Optional[str] = None

    class Config:
        from_attributes = True


class MovimientosMaterialResponse(BaseModel):
    """Respuesta de GET /activos/materiales/{id}/movimientos."""

    id_material: int
    nombre_material: str
    cantidad_disponible: int
    stock_minimo: int
    total: int
    movimientos: list[MovimientoMaterialResponse]
