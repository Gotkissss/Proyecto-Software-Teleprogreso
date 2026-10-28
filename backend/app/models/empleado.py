from datetime import date, datetime
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    false,
    func,
)
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
    # HU-S10-01: la contraseña la puso otra persona y hay que cambiarla antes
    # de usar el sistema (ver core/deps.py). Nace en false para las cuentas
    # existentes y las del seed.
    debe_cambiar_contrasena: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    correo:            Mapped[str]      = mapped_column(String(100), nullable=False, unique=True)
    fecha_contratacion: Mapped[date]     = mapped_column(Date, nullable=False)
    fecha_registro:     Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    ultimo_acceso:      Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nombre:             Mapped[str]      = mapped_column(String(100), nullable=False)
    apellido:           Mapped[str]      = mapped_column(String(100), nullable=False)
    telefono:           Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Los CHECK de catálogo los crea la migración 0013 (HU-S10-08) y se declaran
# aquí para que `Base.metadata` los conozca: las pruebas de integración crean
# el esquema desde los modelos, y sin esto una restricción que la migración sí
# pone no existiría en la base de pruebas.
    __table_args__ = (
        CheckConstraint(
            "rol IN ('admin', 'supervisor', 'tecnico', 'gerente')",
            name="ck_empleado_rol",
        ),
        CheckConstraint(
            "estado IN ('activo', 'inactivo')", name="ck_empleado_estado"
        ),
    )

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

    # HU-S10-08: un vehículo por técnico y un técnico por vehículo.
    #
    # La clave primaria es la PAREJA, así que la base aceptaba dos filas con el
    # mismo empleado y vehículos distintos. Lo impedía solo
    # `services/carros.asignar_tecnico`, con dos consultas previas: dos
    # peticiones simultáneas las pasan las dos y el técnico acaba con dos
    # vehículos, el inventario con dos "en uso" y la liberación en cascada
    # soltando uno solo.
    __table_args__ = (
        Index("uq_empleado_carro_empleado", "id_empleado", unique=True),
        Index("uq_empleado_carro_carro", "id_carro", unique=True),
    )

    # Relaciones
    empleado: Mapped["Empleado"] = relationship(back_populates="carro")
    carro:    Mapped["Carro"]    = relationship(back_populates="empleado")
