from pydantic import BaseModel
from typing import List, Optional
from datetime import date, datetime
from enum import Enum


# 🔹 ENUMS
class EstadoServicio(str, Enum):
    pendiente   = "pendiente"
    en_progreso = "en_progreso"
    completado  = "completado"
    cancelado   = "cancelado"


class PrioridadServicio(str, Enum):
    baja    = "baja"
    media   = "media"
    alta    = "alta"
    urgente = "urgente"


# 🔹 TecnicoResponse va ANTES de TareaResponse porque lo usa
class TecnicoResponse(BaseModel):
    id_empleado: int
    nombre:      str

    class Config:
        from_attributes = True


# 🔹 BASE
class TareaBase(BaseModel):
    nombre:     str
    descripcion: Optional[str]            = None
    direccion:   Optional[str]            = None
    prioridad:   Optional[PrioridadServicio] = PrioridadServicio.media
    id_tecnico:  Optional[int]            = None
    # Fecha límite de la tarea. Es la que usa el detector de alertas para
    # marcar una tarea como vencida; sin ella nunca se genera esa alerta.
    fecha_inicio:       Optional[date] = None
    fecha_finalizacion: Optional[date] = None


# 🔹 CREATE
class TareaCreate(TareaBase):
    pass


# 🔹 UPDATE — edición parcial de una tarea existente (PATCH /tareas/{id})
class TareaUpdate(BaseModel):
    """
    Todos los campos son opcionales: solo se actualiza lo que venga en el body.

    `id_tecnico` acepta null explícito para desasignar la tarea; por eso el
    router distingue entre "campo no enviado" y "campo enviado como null"
    usando model_dump(exclude_unset=True).
    """
    nombre:             Optional[str]                = None
    descripcion:        Optional[str]                = None
    direccion:          Optional[str]                = None
    prioridad:          Optional[PrioridadServicio]  = None
    estado:             Optional[EstadoServicio]     = None
    fecha_inicio:       Optional[date]               = None
    fecha_finalizacion: Optional[date]               = None
    id_tecnico:         Optional[int]                = None


# 🔹 RESPONSE — ahora TecnicoResponse ya está definido arriba
class TareaResponse(BaseModel):
    id_tarea:           int
    titulo:             str
    descripcion:        Optional[str]             = None
    direccion_servicio: Optional[str]             = None
    estado_tarea:       str
    prioridad:          str
    fecha_inicio:       Optional[date]            = None
    fecha_finalizacion: Optional[date]            = None
    fecha_asignacion:   Optional[date]            = None
    # Momento real de cierre. Es lo que permite al frontend distinguir "esto
    # se completó hoy" de "esto se completó la semana pasada" sin adivinar.
    fecha_completado:   Optional[datetime]        = None
    # Coordenadas del servicio ya serializadas desde coordenada_servicio
    # (PostGIS): lat = ST_Y, lng = ST_X. None si la tarea no tiene ubicación.
    lat:                Optional[float]           = None
    lng:                Optional[float]           = None
    tecnico:            Optional[TecnicoResponse] = None
    # Cuántas evidencias (incidencias) tiene registradas la tarea. Permite al
    # dashboard del supervisor mostrar el acceso a "ver evidencias" sin pedir
    # el detalle de cada tarea por separado.
    total_incidencias:  int                       = 0

    class Config:
        from_attributes = True


# Ruta diaria: respuesta liviana solo con lo que el mapa necesita pintar
class TareaRutaResponse(BaseModel):
    id_tarea:     int
    estado_tarea: str
    lat:          Optional[float] = None
    lng:          Optional[float] = None


# 🔹 UPDATE ESTADO
class TareaUpdateEstado(BaseModel):
    estado: EstadoServicio


# 🔹 REASIGNAR
class TareaReasignar(BaseModel):
    id_tecnico: int


# 🔹 HISTORIAL DE TAREAS COMPLETADAS ─────────────────────────────────────────

class EvidenciaResumen(BaseModel):
    """Evidencia de una tarea, tal como se muestra en el historial diario."""

    id_incidencia:  int
    descripcion:    Optional[str] = None
    foto_evidencia: Optional[str] = None
    fecha_reporte:  datetime

    class Config:
        from_attributes = True


class TareaCompletadaResponse(TareaResponse):
    """Una tarea cerrada, con sus evidencias ya incluidas."""

    evidencias: List[EvidenciaResumen] = []


class DiaCompletadas(BaseModel):
    """Bloque de un día del historial: la fecha y lo que se cerró ese día."""

    fecha:  date
    total:  int
    tareas: List[TareaCompletadaResponse]


class HistorialTareasResponse(BaseModel):
    """
    Respuesta de GET /tareas/completadas.

    Viene agrupada por día desde el backend para que la pantalla no tenga que
    reagrupar ni preocuparse por zonas horarias: el corte por día lo hace el
    servidor, que es quien guardó `fecha_completado`.
    """

    total: int
    desde: date
    hasta: date
    dias:  List[DiaCompletadas]