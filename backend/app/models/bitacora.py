from datetime import datetime

from sqlalchemy import CHAR, BigInteger, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Tablas que solo admiten INSERT (migraciones 0009 y 0010). seed.py --reset las
# deja fuera de su TRUNCATE: la base lo rechazaría de todas formas.
SOLO_INSERCION = {"solo_insercion": True}


class BitacoraAuditoria(Base):
    """
    Fila de la bitácora de auditoría. Solo se inserta, y solo desde
    services/bitacora.py. La base pone `id_bitacora`, `fecha_hora`,
    `hash_anterior` y `hash` (trigger bitacora_auditoria_encadenar): lo que
    mande la aplicación en esas columnas se ignora.
    """
    __tablename__ = "bitacora_auditoria"
    __table_args__ = {"info": SOLO_INSERCION}

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


class BitacoraAncla(Base):
    """
    Una fila por purga de la bitácora (migración 0010): hasta qué id se borró y
    el hash de esa última fila, que es con el que tiene que empezar la cadena
    que sobrevive. Solo la escribe bitacora_auditoria_purgar().
    """
    __tablename__ = "bitacora_ancla"
    __table_args__ = {"info": SOLO_INSERCION}

    id_ancla: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    hasta_id_bitacora: Mapped[int] = mapped_column(BigInteger, nullable=False)
    filas_purgadas: Mapped[int] = mapped_column(Integer, nullable=False)
    retencion_dias: Mapped[int] = mapped_column(Integer, nullable=False)
    hash_ancla: Mapped[str] = mapped_column(CHAR(64), nullable=False)
