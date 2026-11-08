# Backend — FastAPI ────────────────────────────────────────
#
# Dos etapas (HU-S10-06): el compilador y las cabeceras de libpq solo hacen
# falta para instalar dependencias. La imagen final lleva el entorno virtual ya
# instalado y nada con qué compilar, y la aplicación corre como el usuario
# `app` (ver entrypoint.sh).

# ---------- Etapa: dependencias (con compilador) ----------
FROM python:3.11-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377 AS dependencias

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


# ---------- Etapa final: sin compilador ----------
FROM python:3.11-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

# 1000 coincide con el usuario habitual de un Linux de desarrollo: con
# docker-compose el código y backend/static se montan desde el host y así
# `app` puede escribir las fotos sin cambiarles el dueño.
ARG APP_UID=1000
RUN groupadd --system --gid "$APP_UID" app \
    && useradd --system --uid "$APP_UID" --gid app --home-dir /app --shell /usr/sbin/nologin app

# pg_dump y gpg: lo que necesita scripts/respaldo.sh (T3 del Sprint 10). Van
# en la imagen porque en un despliegue como Railway la base no se alcanza
# desde fuera: el respaldo solo se puede tomar desde un contenedor con esta
# imagen. Sin ellos, el servicio de respaldo diario que documenta el README
# arrancaba y moría en la primera línea.
#
# Dos clientes de PostgreSQL, no uno, porque el volcado y el motor tienen que
# ser de la MISMA versión mayor y no basta con que el cliente sea más nuevo:
# pg_dump 16 se niega a volcar un servidor 17 («server version mismatch»), y
# pg_dump 17 sí vuelca un servidor 16 pero escribe en el archivo un
# `SET transaction_timeout`, que el 16 no conoce, así que el respaldo se crea
# y no se puede restaurar — el peor de los dos fallos, porque no se nota hasta
# el día que hace falta. respaldo.sh pregunta al servidor su versión y usa el
# cliente que le toca; así la imagen sirve lo mismo contra un 16 que contra un
# 17 y una actualización del motor no rompe los respaldos en silencio.
#
# Debian 13 solo trae el 17, de ahí el repositorio oficial de PostgreSQL
# (PGDG), con su llave guardada aparte y el repositorio firmado con ella.
# Ninguno trae compilador, así que la imagen final sigue sin gcc (HU-S10-06),
# y scripts/verificar-imagen-backend.sh lo comprueba en cada PR.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-client-16 \
        postgresql-client-17 \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencias /opt/venv /opt/venv

# El código es de root y `app` solo lo lee; lo único que escribe es la carpeta
# de las fotos.
COPY . .
RUN mkdir -p /app/static && chown app:app /app/static && chmod 755 /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]

# En local (docker-compose) el command se sobrescribe: el servicio
# `migraciones` hace los tres primeros pasos y `backend` solo arranca uvicorn.
# En Railway / cualquier despliegue plano: aplicamos migraciones + seed,
# purgamos lo que pasó su retención y luego arrancamos uvicorn. El seed.py
# solo inserta datos si la BD está vacía, así que es seguro ejecutarlo en cada
# arranque. Migraciones, seed y purga usan DATABASE_URL_MIGRACIONES (el
# propietario del esquema) si está definida; la purga no impide el arranque.
# Railway inyecta $PORT en runtime; si no existe usamos 8000 por defecto.
# --proxy-headers hace que uvicorn confíe en los X-Forwarded-Proto/For del
# proxy: sin esto cualquier redirect 307 (p.e. /tareas → /tareas/) sale con
# http:// y el navegador lo bloquea por Mixed Content, y todas las peticiones
# parecen venir de la IP del proxy (límites de frecuencia y bitácora). De
# QUIÉN se aceptan lo decide la variable FORWARDED_ALLOW_IPS, que uvicorn lee
# sola; sin definir, solo 127.0.0.1 (HU-S10-06: antes era `*` fijo, y con el
# backend expuesto sin proxy cualquiera falseaba su IP). En Railway el backend
# solo es alcanzable a través de su proxy, así que ahí, si nadie la definió,
# vale `*`: Railway pone RAILWAY_ENVIRONMENT_NAME en todos sus servicios.
CMD ["sh", "-c", "if [ -z \"$FORWARDED_ALLOW_IPS\" ] && [ -n \"$RAILWAY_ENVIRONMENT_NAME\" ]; then export FORWARDED_ALLOW_IPS='*'; fi; alembic upgrade head && python seed.py && (python mantenimiento.py purgar || echo '[mantenimiento] la purga falló; revisa el log') && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
