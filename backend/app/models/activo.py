from datetime import date, datetime
from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
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

    # Los CHECK de catálogo los crea la migración 0013 (HU-S10-08) y se declaran
# aquí para que `Base.metadata` los conozca: las pruebas de integración crean
# el esquema desde los modelos, y sin esto una restricción que la migración sí
# pone no existiría en la base de pruebas.
    __table_args__ = (
        CheckConstraint(
            "estado_vehiculo IN ('disponible', 'en_uso', 'mantenimiento', 'baja')",
            name="ck_carro_estado",
        ),
    )

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

    # HU-S10-07: el stock no puede quedar negativo. El servicio de kardex ya lo
    # impide (toma el material con FOR UPDATE antes de restar), pero esto vale
    # también para un UPDATE hecho por fuera de la API, donde un número
    # negativo no significaría nada.
    __table_args__ = (
        CheckConstraint(
            "cantidad_disponible >= 0", name="ck_material_cantidad_no_negativa"
        ),
    )

    # Relaciones
    activo: Mapped["Activo"] = relationship(back_populates="material")
    movimientos: Mapped[list["MovimientoMaterial"]] = relationship(
        back_populates="material", cascade=_CASCADA_BD, passive_deletes=True
    )


class MovimientoMaterial(Base):
    """
    Una línea del kardex: cada cambio del stock de un material, con el saldo
    que dejó.

    `saldo_resultante` se guarda y no se recalcula sumando la historia. Dos
    motivos: la pestaña de movimientos se puede paginar sin leer todo el
    pasado, y un descuadre entre el saldo de la última fila y
    `material.cantidad_disponible` se ve en una sola consulta en vez de
    quedarse escondido.
    """

    __tablename__ = "movimiento_material"

    id_movimiento:    Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_material:      Mapped[int]        = mapped_column(Integer, ForeignKey("material.id_activo", ondelete="CASCADE"), nullable=False)
    tipo:             Mapped[str]        = mapped_column(String(20), nullable=False)
    cantidad:         Mapped[int]        = mapped_column(Integer, nullable=False)
    saldo_resultante: Mapped[int]        = mapped_column(Integer, nullable=False)
    motivo:           Mapped[str | None] = mapped_column(String(300), nullable=True)
    # La tarea y el empleado se ponen en NULL si desaparecen: el movimiento no
    # se reescribe, porque el material se gastó igual y el saldo que dejó es el
    # punto de partida de la fila siguiente.
    id_tarea:         Mapped[int | None] = mapped_column(Integer, ForeignKey("tarea.id_tarea", ondelete="SET NULL"), nullable=True)
    id_empleado:      Mapped[int | None] = mapped_column(Integer, ForeignKey("empleado.id_empleado", ondelete="SET NULL"), nullable=True)
    fecha_hora:       Mapped[datetime]   = mapped_column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_movimiento_cantidad_positiva"),
        CheckConstraint(
            "saldo_resultante >= 0", name="ck_movimiento_saldo_no_negativo"
        ),
        CheckConstraint(
            "tipo IN ('entrada', 'consumo', 'ajuste')", name="ck_movimiento_tipo"
        ),
        # "Un consumo nombra su tarea" NO va aquí: es una regla de creación y
        # un CHECK vigila la fila para siempre. `id_tarea` es ON DELETE SET
        # NULL, así que borrar la tarea pondría el campo en NULL y el propio
        # CHECK rechazaría ese UPDATE, dejando la tarea imposible de borrar.
        # La aplica services/kardex.registrar_movimiento.
        CheckConstraint(
            "(tipo <> 'ajuste') OR (motivo IS NOT NULL AND btrim(motivo) <> '')",
            name="ck_movimiento_ajuste_con_motivo",
        ),
        Index(
            "ix_movimiento_material_material_fecha",
            "id_material",
            text("fecha_hora DESC"),
        ),
        Index(
            "ix_movimiento_material_tarea",
            "id_tarea",
            postgresql_where=text("id_tarea IS NOT NULL"),
        ),
    )

    # Relaciones
    material: Mapped["Material"] = relationship(back_populates="movimientos")


class Herramienta(Base):
    __tablename__ = "herramienta"

    id_activo:        Mapped[int]        = mapped_column(Integer, ForeignKey("activo.id_activo", ondelete="CASCADE"), primary_key=True)
    tipo_herramienta: Mapped[str | None] = mapped_column(String(80), nullable=True)
    marca:            Mapped[str | None] = mapped_column(String(80), nullable=True)
    modelo:           Mapped[str | None] = mapped_column(String(80), nullable=True)
    estado:           Mapped[str]        = mapped_column(String(30), nullable=False, default="disponible")

    # Los CHECK de catálogo los crea la migración 0013 (HU-S10-08) y se declaran
# aquí para que `Base.metadata` los conozca: las pruebas de integración crean
# el esquema desde los modelos, y sin esto una restricción que la migración sí
# pone no existiría en la base de pruebas.
    __table_args__ = (
        CheckConstraint(
            "estado IN ('disponible', 'en_uso', 'mantenimiento', 'baja')",
            name="ck_herramienta_estado",
        ),
    )

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