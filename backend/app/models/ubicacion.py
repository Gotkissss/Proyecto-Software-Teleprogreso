from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography

from app.db.base import Base


class UbicacionEmpleado(Base):
    __tablename__ = "ubicacion_empleado"

    id_ubicacion:        Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_empleado:         Mapped[int]      = mapped_column(Integer, ForeignKey("empleado.id_empleado", ondelete="CASCADE"), nullable=False)
    fecha_hora_registro: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    coordenada:          Mapped[str]      = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    # HU-5: por qué se guardó el punto (ver EVENTOS_UBICACION en core/reglas.py)
    # y, si fue al iniciar o finalizar una tarea, cuál.
    evento:              Mapped[str]      = mapped_column(String(20), nullable=False, default="periodico", server_default="periodico")
    id_tarea:            Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("tarea.id_tarea", ondelete="SET NULL"), nullable=True)

    # Relaciones
    empleado: Mapped["Empleado"] = relationship(back_populates="ubicaciones")