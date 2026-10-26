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
# solo es alcanzable a través de su proxy: ahí se define FORWARDED_ALLOW_IPS=*.
CMD ["sh", "-c", "alembic upgrade head && python seed.py && (python mantenimiento.py purgar || echo '[mantenimiento] la purga falló; revisa el log') && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
