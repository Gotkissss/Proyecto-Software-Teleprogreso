from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TokenRevocado(Base):
    """
    JWT invalidado antes de su expiración natural (logout).

    Antes esto era un `set()` en memoria del proceso, lo que fallaba de tres
    formas: se vaciaba en cada reinicio o redeploy, no se compartía entre
    workers de uvicorn (el logout hecho en uno no invalidaba nada en el otro)
    y crecía sin límite mientras el proceso viviera.

    Se guarda el `jti` y no el token completo: identifica igual y evita tener
    credenciales utilizables escritas en la base de datos.
    """

    __tablename__ = "token_revocado"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)

    # Se conserva para poder auditar quién cerró sesión y cuándo. ondelete
    # SET NULL: borrar un empleado no debe resucitar sus tokens revocados.
    id_empleado: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("empleado.id_empleado", ondelete="SET NULL"),
        nullable=True,
    )

    # Momento en que el token habría expirado por su cuenta. Pasada esa fecha
    # la fila ya no aporta nada y se puede purgar.
    expira: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    fecha_revocacion: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
