# backend/app/schemas/empleado.py
"""
Schemas Pydantic para el modulo de gestion de empleados.
Define los modelos de entrada (request) y salida (response)
para los endpoints de la API de empleados.

Esquema de validacion de roles:
Roles validos: admin | supervisor | tecnico | gerente
Estados validos: activo | inactivo

Usado por los routers:
  GET  /empleados              = EmpleadoResponse (lista)
  POST /empleados              = EmpleadoCreate = EmpleadoResponse
  PATCH /empleados/{id}        = EmpleadoUpdate = EmpleadoResponse
  PATCH /empleados/{id}/estado = EmpleadoEstadoUpdate = EmpleadoResponse
"""

from datetime import date, datetime
from typing import Optional
from enum import Enum

from pydantic import (
    BaseModel,
    EmailStr,
    ValidationInfo,
    field_validator,
    model_validator,
    Field
)
from app.core.reglas import (
    validar_correo_de_empleado,
    validar_nombre_persona,
    validar_politica_contrasena,
    validar_telefono,
)
from app.core.reglas import LONGITUD_MAXIMA_CONTRASENA
from app.core.config import settings


# ── Enums de dominio ───────────────────────────────────────────────────────

class RolEmpleado(str, Enum):
    """Roles permitidos en el sistema."""
    admin      = "admin"
    supervisor = "supervisor"
    tecnico    = "tecnico"
    gerente    = "gerente"


class EstadoEmpleado(str, Enum):
    """Estado de la cuenta del empleado."""
    activo   = "activo"
    inactivo = "inactivo"


# ------ Schemas de Peticion (entrada) -----

class EmpleadoCreate(BaseModel):
    """Datos requeridos para crear un nuevo empleado."""
    nombre:     str = Field(..., max_length=100)
    apellido:   str = Field(..., max_length=100)
    correo:     EmailStr = Field(..., max_length=100)
    contrasena: str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)
    rol:                RolEmpleado
    fecha_contratacion: date
    telefono:   Optional[str] = Field(None, max_length=20)

    # RTF-01 / R1-5: el informe encontró a «Luis Fonzi» registrado dos veces,
    # como técnico y como supervisor. Un homónimo real existe —hay muchos
    # «José García»— así que no se puede prohibir sin más: el alta se rechaza
    # con el registro que ya existe a la vista, y el admin la repite con este
    # campo en true si de verdad son dos personas.
    permitir_homonimo: bool = False

    @field_validator("correo")
    @classmethod
    def correo_de_la_empresa(cls, v):
        # RTF-01 / R1-5: había cuentas @gmail.com en la lista de
        # colaboradores. Un correo personal no se puede dar de baja cuando la
        # persona se va, y es por donde llega el aviso de contraseña.
        if v is None:
            return v
        return validar_correo_de_empleado(v, settings.dominios_correo_empleado)

    @field_validator("contrasena")
    @classmethod
    def validar_contrasena(cls, v: str, info: ValidationInfo) -> str:
        # Política única (HU-S10-01). `correo` se declara antes que `contrasena`,
        # así que ya está en info.data (si venía mal formado no está y esa
        # comprobación se omite; el error del correo ya se reporta aparte).
        return validar_politica_contrasena(v, correo=info.data.get("correo"))

    @field_validator("fecha_contratacion")
    @classmethod
    def fecha_no_futura(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("La fecha de contratacion no puede ser una fecha futura.")
        return v

    @field_validator("nombre", "apellido")
    @classmethod
    def nombre_parece_un_nombre(cls, v: str, info: ValidationInfo) -> str:
        # RTF-01 / R1-3: antes solo se comprobaba que no estuviera vacío, así
        # que «12345» y «@@@» entraban. Un nombre que no es un nombre no se
        # puede buscar y sale así en los reportes y en la bitácora.
        return validar_nombre_persona(v, info.field_name or "nombre")

    @field_validator("telefono")
    @classmethod
    def telefono_de_ocho_digitos(cls, v: Optional[str]) -> Optional[str]:
        # RTF-01 / R1-4: el campo solo exigía 7 dígitos y había registrados de
        # 10, que no son un teléfono de Guatemala y nadie puede marcar.
        if v is None or not v.strip():
            return None
        return validar_telefono(v)

    class Config:
        use_enum_values = True


class EmpleadoUpdate(BaseModel):
    """Campos editables de un empleado existente (todos opcionales)."""
    nombre:   Optional[str] = Field(None, max_length=100)
    apellido: Optional[str] = Field(None, max_length=100)
    correo:   Optional[EmailStr] = Field(None, max_length=100)
    rol:                Optional[RolEmpleado] = None
    telefono: Optional[str] = Field(None, max_length=20)
    fecha_contratacion: Optional[date]        = None

    # RTF-01 / R1-5: el informe encontró a «Luis Fonzi» registrado dos veces,
    # como técnico y como supervisor. Un homónimo real existe —hay muchos
    # «José García»— así que no se puede prohibir sin más: el alta se rechaza
    # con el registro que ya existe a la vista, y el admin la repite con este
    # campo en true si de verdad son dos personas.
    permitir_homonimo: bool = False

    @field_validator("correo")
    @classmethod
    def correo_de_la_empresa(cls, v):
        # RTF-01 / R1-5: había cuentas @gmail.com en la lista de
        # colaboradores. Un correo personal no se puede dar de baja cuando la
        # persona se va, y es por donde llega el aviso de contraseña.
        if v is None:
            return v
        return validar_correo_de_empleado(v, settings.dominios_correo_empleado)

    @field_validator("nombre", "apellido")
    @classmethod
    def nombre_parece_un_nombre(
        cls, v: Optional[str], info: ValidationInfo
    ) -> Optional[str]:
        # La misma regla que al crear: si editar fuera más permisivo, el
        # agujero seguiría abierto por la otra puerta (RTF-01 / R1-3).
        if v is not None:
            return validar_nombre_persona(v, info.field_name or "nombre")
        return v

    @field_validator("telefono")
    @classmethod
    def telefono_de_ocho_digitos(cls, v: Optional[str]) -> Optional[str]:
        # La misma regla que al crear (RTF-01 / R1-4). Una cadena vacía se
        # trata como «quitar el teléfono», no como un número inválido.
        if v is None or not v.strip():
            return None
        return validar_telefono(v)
        return v

    @field_validator("fecha_contratacion")
    @classmethod
    def fecha_no_futura(cls, v: Optional[date]) -> Optional[date]:
        if v is not None and v > date.today():
            raise ValueError("La fecha de contratacion no puede ser una fecha futura.")
        return v

    @model_validator(mode="after")
    def al_menos_un_campo(self) -> "EmpleadoUpdate":
        campos = [
            self.nombre, self.apellido, self.correo,
            self.rol, self.telefono, self.fecha_contratacion,
        ]
        if all(c is None for c in campos):
            raise ValueError("Debes enviar al menos un campo para actualizar.")
        return self

    class Config:
        use_enum_values = True


class EmpleadoEstadoUpdate(BaseModel):
    """Payload para activar o desactivar la cuenta de un empleado."""
    estado: EstadoEmpleado

    class Config:
        use_enum_values = True


class EmpleadoPasswordUpdate(BaseModel):
    """
    Payload para PATCH /empleados/{id}/contrasena.

    No pide la contrasena actual: quien la cambia es un administrador o un
    supervisor asignando una nueva a otra persona, no el propio usuario. El
    caso tipico es "se me olvido la clave" y el empleado no puede aportarla.

    Se pide dos veces para evitar el error mas caro de este flujo: escribir mal
    la clave nueva y dejar al empleado sin poder entrar, sin que nadie sepa
    cual quedo guardada.
    """
    contrasena:              str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)
    contrasena_confirmacion: str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)

    @field_validator("contrasena")
    @classmethod
    def validar_contrasena(cls, v: str) -> str:
        # Política única (HU-S10-01). La parte "distinta del correo" no se ve
        # desde aquí (solo viaja el id en la ruta) y se aplica en
        # services/empleados.restablecer_contrasena.
        return validar_politica_contrasena(v)

    @model_validator(mode="after")
    def contrasenas_coinciden(self) -> "EmpleadoPasswordUpdate":
        if self.contrasena != self.contrasena_confirmacion:
            raise ValueError("Las contrasenas no coinciden.")
        return self


# ------- Schemas de Respuesta (salida) -------

class EmpleadoResponse(BaseModel):
    """
    Representacion publica de un empleado.
    Nunca expone hash_contrasena.
    placa_vehiculo es el vehiculo asignado al tecnico (None si no tiene).
    """
    id_empleado:        int
    nombre:             str
    apellido:           str
    correo:             str
    rol:                str
    estado:             str
    telefono:           Optional[str]
    fecha_contratacion: date
    fecha_registro:     datetime
    ultimo_acceso:      Optional[datetime]
    placa_vehiculo:     Optional[str] = None

    class Config:
        from_attributes = True


class EmpleadoEstadoResponse(EmpleadoResponse):
    """
    Respuesta de PATCH /empleados/{id}/estado.

    Añade lo que ocurrió en cascada al desactivar. Importa sobre todo
    `tareas_activas_sin_reasignar`: esas tareas siguen asignadas a alguien que
    ya no puede entrar al sistema, y si nadie lo dice se quedan ahí sin que se
    entere ninguna persona.
    """
    vehiculo_liberado: Optional[str] = None
    jornadas_cerradas: int = 0
    tareas_activas_sin_reasignar: int = 0


class EmpleadoListResponse(BaseModel):
    """Respuesta paginada/filtrada de la lista de empleados."""
    total:     int
    empleados: list[EmpleadoResponse]