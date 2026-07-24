from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Alerta(Base):
    __tablename__ = "alerta"

    id_alerta: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    tipo:       Mapped[str]        = mapped_column(String(50), nullable=False)
    severidad:  Mapped[str]        = mapped_column(String(20), nullable=False)
    estado:     Mapped[str]        = mapped_column(String(20), nullable=False, default="pendiente")
    referencia: Mapped[str | None] = mapped_column(String(255), nullable=True)
    fecha:      Mapped[datetime]   = mapped_column(DateTime, nullable=False, server_default=func.now())
