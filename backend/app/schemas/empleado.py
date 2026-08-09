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

from pydantic import BaseModel, EmailStr, field_validator, model_validator


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
    nombre:             str
    apellido:           str
    correo:             EmailStr
    contrasena:         str
    rol:                RolEmpleado
    fecha_contratacion: date
    telefono:           Optional[str] = None

    @field_validator("contrasena")
    @classmethod
    def contrasena_minima(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contrasena debe tener al menos 8 caracteres.")
        return v

    @field_validator("fecha_contratacion")
    @classmethod
    def fecha_no_futura(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("La fecha de contratacion no puede ser una fecha futura.")
        return v

    @field_validator("nombre", "apellido")
    @classmethod
    def nombre_no_vacio(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Este campo no puede estar vacio.")
        return v

    class Config:
        use_enum_values = True


class EmpleadoUpdate(BaseModel):
    """Campos editables de un empleado existente (todos opcionales)."""
    nombre:             Optional[str]         = None
    apellido:           Optional[str]         = None
    correo:             Optional[EmailStr]    = None
    rol:                Optional[RolEmpleado] = None
    telefono:           Optional[str]         = None
    fecha_contratacion: Optional[date]        = None

    @field_validator("nombre", "apellido")
    @classmethod
    def nombre_no_vacio(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Este campo no puede estar vacio.")
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
    contrasena:         str
    contrasena_confirmacion: str

    @field_validator("contrasena")
    @classmethod
    def contrasena_minima(cls, v: str) -> str:
        # Mismo minimo que al crear el empleado, para que no haya dos reglas
        # distintas segun por donde se establezca la clave.
        if len(v) < 8:
            raise ValueError("La contrasena debe tener al menos 8 caracteres.")
        if v.strip() != v:
            raise ValueError("La contrasena no puede empezar ni terminar con espacios.")
        if not v.strip():
            raise ValueError("La contrasena no puede estar vacia.")
        return v

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


class EmpleadoListResponse(BaseModel):
    """Respuesta paginada/filtrada de la lista de empleados."""
    total:     int
    empleados: list[EmpleadoResponse]
