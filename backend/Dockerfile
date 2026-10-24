# Backend — FastAPI ────────────────────────────────────────
FROM python:3.11-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377

# Variables de entorno para Python
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Instalar dependencias del sistema necesarias para psycopg2 / asyncpg
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código fuente
COPY . .

EXPOSE 8000

# En local (docker-compose) el command se sobrescribe: el servicio
# `migraciones` hace los tres primeros pasos y `backend` solo arranca uvicorn.
# En Railway / cualquier despliegue plano: aplicamos migraciones + seed,
# purgamos lo que pasó su retención y luego arrancamos uvicorn. El seed.py
# solo inserta datos si la BD está vacía, así que es seguro ejecutarlo en cada
# arranque. Migraciones, seed y purga usan DATABASE_URL_MIGRACIONES (el
# propietario del esquema) si está definida; la purga no impide el arranque.
# Railway inyecta $PORT en runtime; si no existe usamos 8000 por defecto.
# --proxy-headers + --forwarded-allow-ips=* hacen que uvicorn confíe
# en los X-Forwarded-Proto/For que envía el proxy de Railway. Sin esto,
# cualquier redirect 307 (p.e. /tareas → /tareas/) se genera con esquema
# http:// y el navegador lo bloquea por Mixed Content al venir desde una
# página HTTPS.
CMD ["sh", "-c", "alembic upgrade head && python seed.py && (python mantenimiento.py purgar || echo '[mantenimiento] la purga falló; revisa el log') && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
