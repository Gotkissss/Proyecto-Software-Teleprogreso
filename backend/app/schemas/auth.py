"""
Schemas Pydantic para el modulo de autenticación.
"""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator, model_validator


class LoginRequest(BaseModel):
    correo: EmailStr
    contrasena: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    rol: str
    id_empleado: int
    nombre: str


class TokenPayload(BaseModel):
    sub: str          # id_empleado como str
    rol: str


class PerfilResponse(BaseModel):
    """Datos que el usuario autenticado puede consultar sobre sí mismo."""

    id_empleado: int
    nombre: str
    apellido: str
    correo: str
    rol: str
    estado: str
    telefono: Optional[str]
    fecha_contratacion: date
    fecha_registro: datetime
    ultimo_acceso: Optional[datetime]

    class Config:
        from_attributes = True


class CambiarContrasenaRequest(BaseModel):
    """Contraseña actual y confirmación de la nueva contraseña."""

    contrasena_actual: str
    nueva_contrasena: str
    confirmacion_contrasena: str

    @field_validator("nueva_contrasena")
    @classmethod
    def validar_nueva_contrasena(cls, valor: str) -> str:
        if len(valor) < 8:
            raise ValueError("La contrasena debe tener al menos 8 caracteres.")
        if valor.strip() != valor:
            raise ValueError(
                "La contrasena no puede empezar ni terminar con espacios."
            )
        return valor

    @model_validator(mode="after")
    def contrasenas_coinciden(self) -> "CambiarContrasenaRequest":
        if self.nueva_contrasena != self.confirmacion_contrasena:
            raise ValueError("Las contrasenas no coinciden.")
        return self
