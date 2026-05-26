# backend/app/main.py
"""
Punto de entrada de la aplicacion FastAPI — Teleprogreso S.A.
-------
este archivo configura:
  - CORS para el frontend React
  - Manejadores globales de errores de autenticacion
  - Registro de todos los routers de la API
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.core.config import settings
from app.core.exceptions import register_exception_handlers

# Importar todos los modelos para que SQLAlchemy los registre correctamente
import app.models  # noqa: F401

# ── Routers ──────────────────────────────────────────────────────────────────
from app.api.routers.auth   import router as auth_router
from app.routers.tareas     import router as tareas_router
from app.routers.asistencia import router as asistencia_router
from app.routers.descanso   import router as descanso_router
from app.routers.empleados  import router as empleados_router
from app.routers.metricas   import router as metricas_router
from app.routers.activos    import router as activos_router 

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
)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(asistencia_router)  # POST /asistencia/entrada | salida | GET /hoy
app.include_router(descanso_router)    # POST /descanso/iniciar | finalizar | GET /activo
app.include_router(empleados_router)   # GET/POST/PATCH /empleados/*
app.include_router(metricas_router)    # GET /metricas/supervisor | /empleados/tecnicos/disponibles
app.include_router(activos_router)     # GET/POST/DELETE /activos/* (inventario, herramientas, asignaciones)


# ── Health checks ─────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
async def root():
    """Endpoint raiz — confirma que la API esta corriendo."""
    return {"message": "Teleprogreso API corriendo correctamente"}


@app.get("/health", tags=["Health"])
async def health():
    """Health check para Docker y load balancers."""
    return {"status": "ok"}