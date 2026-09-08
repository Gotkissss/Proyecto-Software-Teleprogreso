from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Empleado(Base):
    __tablename__ = "empleado"

    id_empleado:        Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    rol:                Mapped[str]      = mapped_column(String(30), nullable=False)
    estado:             Mapped[str]      = mapped_column(String(20), nullable=False, default="activo")
    hash_contrasena:    Mapped[str]      = mapped_column(String(255), nullable=False)
    version_token:      Mapped[int]      = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    correo:             Mapped[str]      = mapped_column(String(100), nullable=False, unique=True)
    fecha_contratacion: Mapped[date]     = mapped_column(Date, nullable=False)
    fecha_registro:     Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    ultimo_acceso:      Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nombre:             Mapped[str]      = mapped_column(String(100), nullable=False)
    apellido:           Mapped[str]      = mapped_column(String(100), nullable=False)
    telefono:           Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Relaciones
    asistencias:  Mapped[list["Asistencia"]]       = relationship(back_populates="empleado")
    ubicaciones:  Mapped[list["UbicacionEmpleado"]] = relationship(back_populates="empleado")
    tareas:       Mapped[list["EmpleadoTarea"]]     = relationship(back_populates="empleado")
    carro:        Mapped["EmpleadoCarro | None"]    = relationship(back_populates="empleado", uselist=False)


class EmpleadoTarea(Base):
    __tablename__ = "empleado_tarea"

    id_empleado: Mapped[int] = mapped_column(Integer, ForeignKey("empleado.id_empleado", ondelete="CASCADE"), primary_key=True)
    id_tarea:    Mapped[int] = mapped_column(Integer, ForeignKey("tarea.id_tarea", ondelete="CASCADE"), primary_key=True)

    # Relaciones
    empleado: Mapped["Empleado"] = relationship(back_populates="tareas")
    tarea:    Mapped["Tarea"]    = relationship(back_populates="empleados")


class EmpleadoCarro(Base):
    __tablename__ = "empleado_carro"

    id_empleado: Mapped[int] = mapped_column(Integer, ForeignKey("empleado.id_empleado", ondelete="CASCADE"), primary_key=True)
    id_carro:    Mapped[int] = mapped_column(Integer, ForeignKey("carro.id_activo", ondelete="CASCADE"), primary_key=True)

    # Relaciones
    empleado: Mapped["Empleado"] = relationship(back_populates="carro")
    carro:    Mapped["Carro"]    = relationship(back_populates="empleado")
