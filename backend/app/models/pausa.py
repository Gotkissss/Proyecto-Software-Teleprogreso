from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TipoPausa(Base):
    """
    Catálogo de pausas permitidas por la normativa de Teleprogreso.

    Estaba escrito a mano en un dict dentro del router de descanso, así que
    cambiar la duración máxima de una pausa o dar de alta un tipo nuevo exigía
    tocar el código y volver a desplegar. Al vivir en la base de datos, el
    catálogo se administra como cualquier otro dato de la operación.
    """

    __tablename__ = "tipo_pausa"

    # Identificador estable que viaja en la API y se guarda en descanso.tipo
    # ("almuerzo", "tecnica", "personal"). No se usa un autoincrement porque
    # las filas de `descanso` ya existentes referencian estas cadenas.
    id_tipo_pausa: Mapped[str] = mapped_column(String(20), primary_key=True)

    label: Mapped[str] = mapped_column(String(80), nullable=False)
    duracion_max_min: Mapped[int] = mapped_column(Integer, nullable=False)

    # Orden de presentación en la pantalla del técnico.
    orden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Permite retirar un tipo de pausa sin borrarlo, para no dejar huérfanas
    # las pausas históricas que ya lo usaron.
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
