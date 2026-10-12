import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Cargar la configuración de la app para obtener DATABASE_URL_SYNC
from app.core.config import settings

# Importar Base para que Alembic detecte los modelos automáticamente
# Los modelos expandidos en app/models/ solo se importarán aquí
from app.db.base import Base  # noqa: F401

# Ejemplo de importación de modelos
# from app.models import usuario, servicio, activo  # noqa: F401

config = context.config

# Sobreescribir la URL con la variable de entorno. Se migra con el propietario
# del esquema (DATABASE_URL_MIGRACIONES) cuando está definido: el rol de la app
# no crea tablas ni es dueño de la bitácora (ver migración 0010).
config.set_main_option("sqlalchemy.url", settings.url_migraciones.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()


    
