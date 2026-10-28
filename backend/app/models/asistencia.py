from datetime import date, time
from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Time
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
    # True cuando la salida la puso el sistema y no la persona: el técnico
    # olvidó marcarla y la jornada se cerró a las 23:59:59
    # (`_cerrar_jornada_abandonada`). RTF-01 / R3-3: sin esta marca, esas
    # horas se contaban como trabajadas e inflaban el historial y los tres
    # reportes del gerente.
    cierre_automatico:  Mapped[bool]   = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

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
    # HU-S10-08: la clave foránea la crea la migración 0013 y se declara aquí
    # para que `Base.metadata` la conozca (las pruebas de integración crean el
    # esquema desde los modelos). El catálogo de pausas es una tabla desde la
    # 0005, pero esta columna era texto suelto: una pausa con un tipo que no
    # existe sale del historial sin etiqueta y sin duración máxima que comparar.
    #
    # RESTRICT y no CASCADE: retirar un tipo de pausa no puede borrar las
    # pausas que ya se tomaron con él; `tipo_pausa.activo` existe para dar de
    # baja un tipo sin tocar el historial.
    tipo:         Mapped[str | None] = mapped_column(
        String(20),
        ForeignKey("tipo_pausa.id_tipo_pausa", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=True,
    )

    # Relaciones
    asistencia: Mapped["Asistencia"] = relationship(back_populates="descansos")