"""
Motor y sesiones de SQLAlchemy — Teleprogreso S.A.
-----------------------------------------------------------------------------
Además de crear el engine, aquí se fijan los límites con los que el backend
habla con Postgres. La idea es que ni un pico de tráfico ni una consulta mal
formada puedan dejar la base fuera de servicio:

  · El pool está acotado. Sin tope, cada petición concurrente abriría una
    conexión nueva hasta agotar `max_connections` del servidor; a partir de
    ahí nadie más puede entrar, ni siquiera el administrador.
  · Cada sesión llega con timeouts puestos del lado del servidor. Aunque el
    proceso de Python se cuelgue o alguien corte la conexión a la mitad,
    Postgres mata la consulta y suelta los bloqueos por su cuenta.
  · `application_name` deja identificable al backend en pg_stat_activity, para
    poder distinguir sus conexiones de cualquier otra en una revisión.
-----------------------------------------------------------------------------
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# Parámetros que Postgres aplica a cada sesión nada más conectarse. asyncpg
# exige que los valores sean cadenas.
_AJUSTES_SERVIDOR = {
    "application_name": "teleprogreso_backend",
    # Corta cualquier consulta que se pase del tiempo previsto.
    "statement_timeout": str(settings.DB_STATEMENT_TIMEOUT_MS),
    # No esperar indefinidamente por un lock que otro tiene tomado.
    "lock_timeout": str(settings.DB_LOCK_TIMEOUT_MS),
    # Una transacción abierta y ociosa mantiene locks y bloquea el vacuum;
    # pasado este tiempo se aborta sola.
    "idle_in_transaction_session_timeout": str(settings.DB_IDLE_TX_TIMEOUT_MS),
}

# Motor async para PostgreSQL
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,        # Cambia a True si quieres ver el SQL en consola para debug
    future=True,
    # ── Pool acotado ─────────────────────────────────────────────────────────
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    # Descarta conexiones viejas: evita usar sockets que el servidor o un
    # firewall ya cerraron por su lado.
    pool_recycle=settings.DB_POOL_RECYCLE,
    # Comprueba que la conexión siga viva antes de entregarla.
    pool_pre_ping=True,
    connect_args={
        "server_settings": _AJUSTES_SERVIDOR,
        # Si la base no responde al conectar, fallar rápido en vez de dejar
        # peticiones colgadas ocupando workers.
        "timeout": 10,
    },
)

# Fábrica de sesiones
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# Dependency injection para los endpoints de FastAPI
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
