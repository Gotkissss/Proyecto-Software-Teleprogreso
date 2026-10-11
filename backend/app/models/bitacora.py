from datetime import datetime

from sqlalchemy import CHAR, BigInteger, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BitacoraAuditoria(Base):
    """
    Fila de la bitácora de auditoría (migración 0009). Solo se inserta, y solo
    desde services/bitacora.py: un trigger rechaza UPDATE y DELETE.
    """
    __tablename__ = "bitacora_auditoria"

    id_bitacora: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    id_actor: Mapped[int | None] = mapped_column(Integer)
    rol_actor: Mapped[str | None] = mapped_column(String(20))
    ip: Mapped[str | None] = mapped_column(INET)
    request_id: Mapped[str | None] = mapped_column(String(64))
    accion: Mapped[str] = mapped_column(String(50), nullable=False)
    entidad: Mapped[str] = mapped_column(String(50), nullable=False)
    id_entidad: Mapped[int | None] = mapped_column(Integer)
    cambios: Mapped[dict | None] = mapped_column(JSONB)
    hash_anterior: Mapped[str | None] = mapped_column(CHAR(64))
    hash: Mapped[str] = mapped_column(CHAR(64), nullable=False, unique=True)
