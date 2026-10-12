"""
Schemas de la bitácora de auditoría (HU-S9-03) — Teleprogreso S.A.
"""

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel


class FilaBitacoraResponse(BaseModel):
    """Una acción registrada. `cambios` trae el antes/después o el detalle del evento."""

    id_bitacora: int
    fecha_hora: datetime
    id_actor: Optional[int] = None
    # Nombre actual del empleado; None si la acción no tuvo sesión (login
    # fallido, procesos del sistema) o si el id ya no existe.
    nombre_actor: Optional[str] = None
    rol_actor: Optional[str] = None
    ip: Optional[str] = None
    request_id: Optional[str] = None
    accion: str
    entidad: str
    id_entidad: Optional[int] = None
    cambios: Optional[Any] = None
    hash: str
    hash_anterior: Optional[str] = None


class BitacoraListResponse(BaseModel):
    """Respuesta paginada de GET /auditoria (misma forma que /asistencia/historial)."""

    total: int
    page: int
    page_size: int
    total_pages: int
    items: List[FilaBitacoraResponse]


class CatalogosBitacoraResponse(BaseModel):
    """Valores que existen en la bitácora, para poblar los filtros de la pantalla."""

    acciones: List[str]
    entidades: List[str]
    roles: List[str]


class UltimaPurgaResponse(BaseModel):
    fecha_hora: datetime
    hasta_id_bitacora: int
    filas_purgadas: int
    retencion_dias: int


class VerificacionBitacoraResponse(BaseModel):
    """
    Resultado de recorrer la cadena de hashes completa.

    - `integra`: ninguna fila fue alterada ni eliminada por fuera de una purga.
    - `id_rota` / `motivo`: la primera fila donde la cadena deja de cuadrar.
    - `protegida`: la conexión del backend NO puede modificar ni borrar filas
      (no es superusuario ni propietaria de la tabla).
    """

    integra: bool
    filas: int
    id_rota: Optional[int] = None
    motivo: Optional[str] = None
    descripcion: str
    protegida: bool
    detalle_proteccion: str
    ultima_purga: Optional[UltimaPurgaResponse] = None
    verificada_en: datetime
