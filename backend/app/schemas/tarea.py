from pydantic import BaseModel, Field, model_validator
from typing import List, Optional
from datetime import date, datetime
from enum import Enum

from app.core.archivos_firmados import UrlArchivo


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


class CoordenadasTarea(BaseModel):
    """Coordenadas opcionales de una tarea, siempre enviadas como pareja."""

    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)

    @model_validator(mode="after")
    def coordenadas_completas(self):
        enviados = {campo for campo in ("lat", "lng") if campo in self.model_fields_set}

        if enviados and enviados != {"lat", "lng"}:
            raise ValueError("Debes enviar lat y lng juntos.")

        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat y lng deben tener un valor o ser null al mismo tiempo.")

        return self


# 🔹 BASE
class TareaBase(CoordenadasTarea):
    nombre:      str = Field(..., max_length=150)               # tarea.titulo
    descripcion: Optional[str] = Field(None, max_length=2000)   # TEXT
    direccion:   Optional[str] = Field(None, max_length=255)    # direccion_servicio
    prioridad:   Optional[PrioridadServicio] = PrioridadServicio.media
    id_tecnico:  Optional[int]            = None
    # Fecha límite de la tarea. Es la que usa el detector de alertas para
    # marcar una tarea como vencida; sin ella nunca se genera esa alerta.
    fecha_inicio:       Optional[date] = None
    fecha_finalizacion: Optional[date] = None


# 🔹 CREATE
class TareaCreate(TareaBase):
    """
    Cuerpo de `POST /tareas`.

    Exige saber DÓNDE es el servicio: una dirección, un punto en el mapa, o
    las dos cosas (RTF-01 / R2-5). Los dos campos eran opcionales, así que una
    tarea de campo podía nacer sin ubicación: no aparecía en el mapa del
    técnico, que es por donde se trabaja, y el técnico tenía que preguntar por
    chat a dónde iba.

    Se exige al CREAR y no en el `PATCH`: las tareas que ya existen sin
    ubicación siguen siendo válidas —hay unas cuantas— y el modal de edición
    ahora permite ponérsela (T6 del Sprint 10). Bloquear la edición dejaría
    esas tareas sin forma de arreglarse.
    """

    @model_validator(mode="after")
    def sabe_donde_es(self) -> "TareaCreate":
        sin_direccion = not (self.direccion or "").strip()
        sin_punto = self.lat is None
        if sin_direccion and sin_punto:
            raise ValueError(
                "Indica la dirección del servicio o su ubicación en el mapa: "
                "sin una de las dos, el técnico no sabe a dónde ir y la tarea "
                "no sale en su mapa."
            )
        return self


# 🔹 UPDATE — edición parcial de una tarea existente (PATCH /tareas/{id})
class TareaUpdate(CoordenadasTarea):
    """
    Todos los campos son opcionales: solo se actualiza lo que venga en el body.

    `id_tecnico` acepta null explícito para desasignar la tarea; por eso el
    router distingue entre "campo no enviado" y "campo enviado como null"
    usando model_dump(exclude_unset=True).
    """
    nombre:      Optional[str] = Field(None, max_length=150)
    descripcion: Optional[str] = Field(None, max_length=2000)
    direccion:   Optional[str] = Field(None, max_length=255)
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


# Ruta diaria: lo que el mapa del técnico necesita para pintar el pin y
# rellenar su popup (título, dirección, tipo de servicio y prioridad). Sigue
# siendo más liviana que TareaResponse: no arrastra fechas de planificación ni
# el técnico asignado, que en este mapa siempre es el usuario autenticado.
class TareaRutaResponse(BaseModel):
    id_tarea:           int
    titulo:             str
    descripcion:        Optional[str]      = None
    direccion_servicio: Optional[str]      = None
    estado_tarea:       str
    prioridad:          str
    # Momento real de cierre: es lo que deja al mapa mostrar una tarea como
    # completada solo el día en que se completó.
    fecha_completado:   Optional[datetime] = None
    lat:                Optional[float]    = None
    lng:                Optional[float]    = None
    # Fecha límite: la ruta diaria la usa para avisar qué vence hoy o ya venció.
    fecha_finalizacion: Optional[date]     = None
    # Distancia en metros desde la posición que envió el técnico (HU-3). None
    # si no envió posición o si la tarea no tiene coordenada.
    distancia_m:        Optional[float]    = None


# Mapa del supervisor: los mismos campos de la ruta del técnico más el técnico
# asignado, para que el frontend pueda agrupar los marcadores por él.
class TareaMapaSupervisorResponse(BaseModel):
    id_tarea:           int
    titulo:             str
    descripcion:        Optional[str]             = None
    direccion_servicio: Optional[str]             = None
    estado_tarea:       str
    prioridad:          str
    fecha_completado:   Optional[datetime]        = None
    lat:                Optional[float]           = None
    lng:                Optional[float]           = None
    tecnico:            Optional[TecnicoResponse] = None


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
    foto_evidencia: UrlArchivo = None
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


# ── Cierre de tarea con materiales (HU-S10-07) ──────────────────────────────

class MaterialConsumido(BaseModel):
    """Un material y cuántas unidades gastó la tarea."""

    id_material: int = Field(..., gt=0)
    cantidad: int = Field(..., gt=0, le=100_000)


class FinalizarTareaRequest(BaseModel):
    """
    Body de PATCH /tareas/{id}/finalizar.

    Los tres campos son opcionales y el cuerpo entero también: el endpoint ya
    aceptaba `{lat, lng}` suelto para dejar el lugar del cierre en el recorrido
    del técnico, y los clientes que mandan solo eso siguen funcionando igual
    (este schema tiene los mismos dos campos con los mismos nombres).

    `materiales` es la lista de lo que se gastó. Opcional a propósito: no todas
    las tareas consumen material, y obligar a rellenarla lleva a que alguien
    teclee cualquier cosa para poder cerrar la tarea, que es peor que no tener
    el dato.
    """

    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    materiales: Optional[list[MaterialConsumido]] = Field(None, max_length=50)

    @model_validator(mode="after")
    def coordenada_completa(self) -> "FinalizarTareaRequest":
        if (self.lat is None) != (self.lng is None):
            raise ValueError(
                "Manda lat y lng juntas, o ninguna de las dos."
            )
        return self
