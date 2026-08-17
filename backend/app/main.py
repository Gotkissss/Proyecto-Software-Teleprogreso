# backend/app/main.py
"""
Punto de entrada de la aplicacion FastAPI — Teleprogreso S.A.
-------
este archivo configura:
  - CORS para el frontend React
  - Middlewares de seguridad (frecuencia, tamaño de body, cabeceras, Host)
  - Manejadores globales de errores de autenticacion
  - Registro de todos los routers de la API

Nota de seguridad: el contenedor de PostgreSQL no publica ningun puerto y vive
en una red Docker sin salida a internet (ver docker-compose.yml). Es decir,
este proceso es el UNICO camino hacia los datos, y por eso todo lo que entra
por aqui pasa antes por los filtros de abajo.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.middleware_seguridad import (
    CabecerasSeguridad,
    LimiteFrecuencia,
    LimiteTamanoBody,
)

# Importar todos los modelos para que SQLAlchemy los registre correctamente
import app.models  # noqa: F401

# ── Routers ──────────────────────────────────────────────────────────────────
from app.routers.auth   import router as auth_router
from app.routers.tareas     import router as tareas_router
from app.routers.incidencias import router as incidencias_router
from app.routers.asistencia import router as asistencia_router
from app.routers.descanso   import router as descanso_router
from app.routers.empleados  import router as empleados_router
from app.routers.metricas   import router as metricas_router
from app.routers.inventario import router as inventario_router
from app.routers.carros     import router as carros_router
from app.routers.activos    import router as activos_router
from app.routers.alertas    import router as alertas_router
from app.routers.reportes   import router as reportes_router

# En produccion no se publica la documentacion interactiva: es un mapa completo
# de la superficie de ataque (rutas, parametros, esquemas) servido a cualquiera
# que pase por ahi. En desarrollo sigue disponible igual que siempre.
_docs = None if settings.es_produccion else "/docs"
_redoc = None if settings.es_produccion else "/redoc"
_openapi = None if settings.es_produccion else "/openapi.json"

app = FastAPI(
    title="Teleprogreso S.A. — API",
    description=(
        "API REST para supervision de personal, gestion de tareas "
        "y control de asistencia.\n\n"
        "Todos los endpoints (excepto POST /auth/login) requieren "
        "autenticacion JWT mediante Bearer token.\n\n"
        "Los endpoints bajo /empleados requieren rol admin.\n\n"
    ),
    version="1.0.0",
    docs_url=_docs,
    redoc_url=_redoc,
    openapi_url=_openapi,
)

# ── Middlewares ──────────────────────────────────────────────────────────────
# En Starlette el ultimo middleware registrado es el PRIMERO en ejecutarse, asi
# que se registran del mas interno al mas externo: lo mas barato de evaluar
# (tamaño y frecuencia) queda arriba y descarta el trafico abusivo antes de que
# llegue a tocar la base de datos.

# 1. Cabeceras de seguridad en la respuesta (el mas interno).
app.add_middleware(CabecerasSeguridad)

# 2. CORS. Los origenes se validan en config.py: nunca puede ser "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    # Antes era ["*"] en ambos. Se enumeran los que la aplicacion usa de verdad
    # para no anunciar permisos que nadie necesita.
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    max_age=600,
)

# 3. Solo se atienden peticiones dirigidas a un Host conocido. Con la lista
#    vacia (desarrollo) se acepta cualquiera; en produccion config.py exige
#    que ALLOWED_HOSTS este definido.
if settings.ALLOWED_HOSTS:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list(settings.ALLOWED_HOSTS),
    )

# 4. Tope de peticiones por minuto y por IP.
app.add_middleware(LimiteFrecuencia)

# 5. Corte por tamaño de cuerpo (el mas externo: se decide sin leer nada).
app.add_middleware(LimiteTamanoBody)

# ── Archivos estaticos para imagenes de activos ───────────────────────
# Crea el directorio si no existe para no fallar en arranque
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# ── Manejadores globales de error ─────────────────────────────────────────────
register_exception_handlers(app)

# ── Registro de routers ───────────────────────────────────────────────────────
app.include_router(auth_router)        # POST /auth/login | logout | GET /auth/me
app.include_router(tareas_router)      # GET/POST/PATCH /tareas/*
app.include_router(incidencias_router) # POST/GET/DELETE /tareas/{id}/incidencias/*
app.include_router(asistencia_router)  # POST /asistencia/entrada | salida | GET /hoy | /historial
app.include_router(descanso_router)    # POST /descanso/iniciar | finalizar | GET /activo
app.include_router(empleados_router)   # GET/POST/PATCH /empleados/*
app.include_router(metricas_router)    # GET /metricas/supervisor | /empleados/tecnicos/disponibles
# Los tres routers comparten el prefijo /activos. Antes lo único que evitaba
# que /activos/{id} se tragara /activos/carros era este orden de registro, así
# que reordenar estas líneas rompía el inventario en silencio. Ahora activos.py
# declara /{id:int}, que no puede casar con una ruta de texto; el orden se
# mantiene por claridad, pero ya no es lo que sostiene el enrutamiento.
app.include_router(inventario_router)
app.include_router(carros_router)
app.include_router(activos_router)     # GET/POST/DELETE /activos/* (inventario, herramientas, asignaciones)
app.include_router(alertas_router)     # GET/PATCH /alertas/*
app.include_router(reportes_router)    # GET /reportes/asistencia | tareas-completadas | productividad


# ── Health checks ─────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
async def root():
    """Endpoint raiz — confirma que la API esta corriendo."""
    return {"message": "Teleprogreso API corriendo correctamente"}


@app.get("/health", tags=["Health"])
async def health():
    """Health check para Docker y load balancers."""
    return {"status": "ok"}
