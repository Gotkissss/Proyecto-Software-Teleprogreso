from datetime import date, time
from sqlalchemy import Date, ForeignKey, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography

from app.db.base import Base


class Asistencia(Base):
    __tablename__ = "asistencia"

    id_asistencia:      Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_empleado:        Mapped[int]        = mapped_column(Integer, ForeignKey("empleado.id_empleado", ondelete="CASCADE"), nullable=False)
    fecha:              Mapped[date]       = mapped_column(Date, nullable=False)
    hora_entrada:       Mapped[time]       = mapped_column(Time, nullable=False)
    hora_salida:        Mapped[time | None] = mapped_column(Time, nullable=True)
    coordenada_entrada: Mapped[str | None] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    coordenada_salida:  Mapped[str | None] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)

    # Relaciones
    empleado:  Mapped["Empleado"]      = relationship(back_populates="asistencias")
    descansos: Mapped[list["Descanso"]] = relationship(back_populates="asistencia")


class Descanso(Base):
    __tablename__ = "descanso"

    id_descanso:  Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_asistencia: Mapped[int]       = mapped_column(Integer, ForeignKey("asistencia.id_asistencia", ondelete="CASCADE"), nullable=False)
    hora_inicio:  Mapped[time]       = mapped_column(Time, nullable=False)
    hora_fin:     Mapped[time | None] = mapped_column(Time, nullable=True)
    # Tipo de pausa según la normativa (almuerzo | tecnica | personal).
    # Nullable porque los descansos creados antes de la migración 0004 no lo
    # tienen; la UI los muestra como "Pausa".
    tipo:         Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Relaciones
    asistencia: Mapped["Asistencia"] = relationship(back_populates="descansos")