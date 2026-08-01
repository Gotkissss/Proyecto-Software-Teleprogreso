from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography

from app.db.base import Base


class Tarea(Base):
    __tablename__ = "tarea"

    id_tarea:            Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    titulo:              Mapped[str]         = mapped_column(String(150), nullable=False)
    descripcion:         Mapped[str | None]  = mapped_column(Text, nullable=True)
    estado_tarea:        Mapped[str]         = mapped_column(String(30), nullable=False, default="pendiente")
    prioridad:           Mapped[str]         = mapped_column(String(20), nullable=False, default="media")
    fecha_inicio:        Mapped[date | None] = mapped_column(Date, nullable=True)
    fecha_finalizacion:  Mapped[date | None] = mapped_column(Date, nullable=True)
    direccion_servicio:  Mapped[str | None]  = mapped_column(String(255), nullable=True)
    coordenada_servicio: Mapped[str | None]  = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    fecha_asignacion:    Mapped[date | None] = mapped_column(Date, nullable=True)
    # Momento real en que el técnico cerró la tarea. Distinto de
    # `fecha_finalizacion`, que es la fecha *límite* pactada y la que usa el
    # cálculo de tareas retrasadas. Esta es la que alimenta el historial de
    # "tareas hechas por día".
    fecha_completado:    Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    # Relaciones
    empleados:  Mapped[list["EmpleadoTarea"]] = relationship(back_populates="tarea")
    incidencias: Mapped[list["Incidencia"]]   = relationship(back_populates="tarea")


class Incidencia(Base):
    __tablename__ = "incidencia"

    id_incidencia:  Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_tarea:       Mapped[int]        = mapped_column(Integer, ForeignKey("tarea.id_tarea", ondelete="CASCADE"), nullable=False)
    descripcion:    Mapped[str | None] = mapped_column(Text, nullable=True)
    foto_evidencia: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fecha_reporte:  Mapped[datetime]   = mapped_column(DateTime, nullable=False, server_default=func.now())

    # Relaciones
    tarea: Mapped["Tarea"] = relationship(back_populates="incidencias")