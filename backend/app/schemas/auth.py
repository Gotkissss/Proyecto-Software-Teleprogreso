"""
Schemas Pydantic para el modulo de autenticación.
"""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator, model_validator, Field

from app.core.reglas import validar_politica_contrasena
from app.core.reglas import LONGITUD_MAXIMA_CONTRASENA  


class LoginRequest(BaseModel):
    correo: EmailStr = Field(..., max_length=100)
    contrasena: str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)


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

    contrasena_actual: str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)
    nueva_contrasena: str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)
    confirmacion_contrasena: str = Field(..., max_length=LONGITUD_MAXIMA_CONTRASENA)
    
    @field_validator("nueva_contrasena")
    @classmethod
    def validar_nueva_contrasena(cls, valor: str) -> str:
        # Política única (HU-S10-01). "Distinta del correo" y "distinta de la
        # actual" se comprueban en el router, que conoce la cuenta.
        return validar_politica_contrasena(valor)

    @model_validator(mode="after")
    def contrasenas_coinciden(self) -> "CambiarContrasenaRequest":
        if self.nueva_contrasena != self.confirmacion_contrasena:
            raise ValueError("Las contrasenas no coinciden.")
        return self