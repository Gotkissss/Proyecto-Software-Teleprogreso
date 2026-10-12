from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Filas hijas cuya clave foránea es también su clave primaria y que la base ya
# borra en cascada: el ORM no las carga ni las toca al borrar al padre.
_CASCADA_BD = "all, delete-orphan"


class Activo(Base):
    __tablename__ = "activo"

    id_activo:      Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    nombre_activo:  Mapped[str]        = mapped_column(String(150), nullable=False)
    fecha_registro: Mapped[date]       = mapped_column(Date, nullable=False, server_default=func.now())
    descripcion:    Mapped[str | None] = mapped_column(Text, nullable=True)
    tipo:           Mapped[str]        = mapped_column(String(20), nullable=False)  # carro | material | herramienta
    foto_url:       Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relaciones ISA. El subtipo se borra con su activo, y lo borra la base
    # (ON DELETE CASCADE): sin `passive_deletes` el ORM intentaba dejar en
    # NULL la clave del subtipo, que es a la vez su clave primaria, y
    # DELETE /activos/{id} respondía 500 con cualquier activo.
    carro:       Mapped["Carro | None"]       = relationship(back_populates="activo", uselist=False, cascade=_CASCADA_BD, passive_deletes=True)
    material:    Mapped["Material | None"]    = relationship(back_populates="activo", uselist=False, cascade=_CASCADA_BD, passive_deletes=True)
    herramienta: Mapped["Herramienta | None"] = relationship(back_populates="activo", uselist=False, cascade=_CASCADA_BD, passive_deletes=True)


class Carro(Base):
    __tablename__ = "carro"

    id_activo:       Mapped[int]        = mapped_column(Integer, ForeignKey("activo.id_activo", ondelete="CASCADE"), primary_key=True)
    placa:           Mapped[str]        = mapped_column(String(20), nullable=False, unique=True)
    marca:           Mapped[str | None] = mapped_column(String(80), nullable=True)
    modelo:          Mapped[str | None] = mapped_column(String(80), nullable=True)
    capacidad:       Mapped[int | None] = mapped_column(Integer, nullable=True)
    estado_vehiculo: Mapped[str]        = mapped_column(String(30), nullable=False, default="disponible")

    # Relaciones
    activo:       Mapped["Activo"]               = relationship(back_populates="carro")
    empleado:     Mapped["EmpleadoCarro | None"]  = relationship(back_populates="carro", uselist=False, cascade=_CASCADA_BD, passive_deletes=True)
    herramientas: Mapped[list["CarroHerramienta"]] = relationship(back_populates="carro", cascade=_CASCADA_BD, passive_deletes=True)


class Material(Base):
    __tablename__ = "material"

    id_activo:           Mapped[int]        = mapped_column(Integer, ForeignKey("activo.id_activo", ondelete="CASCADE"), primary_key=True)
    cantidad_disponible: Mapped[int]        = mapped_column(Integer, nullable=False, default=0)
    stock_minimo:        Mapped[int]        = mapped_column(Integer, nullable=False, default=0)
    unidad_medida:       Mapped[str | None] = mapped_column(String(30), nullable=True)
    tipo_material:       Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Relaciones
    activo: Mapped["Activo"] = relationship(back_populates="material")


class Herramienta(Base):
    __tablename__ = "herramienta"

    id_activo:        Mapped[int]        = mapped_column(Integer, ForeignKey("activo.id_activo", ondelete="CASCADE"), primary_key=True)
    tipo_herramienta: Mapped[str | None] = mapped_column(String(80), nullable=True)
    marca:            Mapped[str | None] = mapped_column(String(80), nullable=True)
    modelo:           Mapped[str | None] = mapped_column(String(80), nullable=True)
    estado:           Mapped[str]        = mapped_column(String(30), nullable=False, default="disponible")

    # Relaciones
    activo: Mapped["Activo"]                = relationship(back_populates="herramienta")
    carros: Mapped[list["CarroHerramienta"]] = relationship(back_populates="herramienta", cascade=_CASCADA_BD, passive_deletes=True)


class CarroHerramienta(Base):
    __tablename__ = "carro_herramienta"

    id_carro:         Mapped[int]        = mapped_column(Integer, ForeignKey("carro.id_activo", ondelete="CASCADE"), primary_key=True)
    id_herramienta:   Mapped[int]        = mapped_column(Integer, ForeignKey("herramienta.id_activo", ondelete="CASCADE"), primary_key=True)
    fecha_asignacion: Mapped[datetime]   = mapped_column(DateTime, nullable=False, server_default=func.now())
    estado_entrega:   Mapped[str | None] = mapped_column(String(30), nullable=True)
    comentario:       Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relaciones
    carro:       Mapped["Carro"]       = relationship(back_populates="herramientas")
    herramienta: Mapped["Herramienta"] = relationship(back_populates="carros")