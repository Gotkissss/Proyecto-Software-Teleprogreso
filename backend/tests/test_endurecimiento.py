# backend/tests/test_endurecimiento.py
"""
Pruebas del endurecimiento de seguridad — Teleprogreso S.A.
-----------------------------------------------------------------------------
La base de datos ya no es alcanzable desde fuera del contenedor del backend
(ver SEGURIDAD.md), así que estas pruebas cubren lo que sí queda expuesto: la
API. Verifican que las defensas siguen puestas y que no se cayeron sin que
nadie se diera cuenta en un refactor.

Se ejecutan con: pytest tests/ -v
"""

import pytest
from fastapi.testclient import TestClient
from jose import JWTError, jwt

from app.core.config import Settings
from app.core.rate_limit import VentanaDeslizante
from app.core.security import create_access_token, decode_access_token
from app.main import app

client = TestClient(app, raise_server_exceptions=False)


# ─── 1. Configuración: la llave de firma no puede ser adivinable ─────────────

BASE_CONFIG = {
    "DATABASE_URL": "postgresql+asyncpg://u:p@localhost:5432/x",
    "DATABASE_URL_SYNC": "postgresql://u:p@localhost:5432/x",
    "ENVIRONMENT": "development",
}


def _settings(**extra):
    return Settings(**{**BASE_CONFIG, **extra})


@pytest.mark.parametrize(
    "clave",
    [
        "secret",                       # valor de ejemplo conocido
        "changeme",                     # plantilla sin rellenar
        "corta",                        # demasiado corta
        "a" * 40,                       # larga pero sin variedad
        "changeme-changeme-changeme-changeme",  # contiene una plantilla
    ],
)
def test_secret_key_debil_impide_arrancar(clave):
    """
    Con una llave adivinable, cualquiera puede firmarse un token de admin y
    leer toda la base sin tocar Postgres. El proceso no debe arrancar.
    """
    with pytest.raises(ValueError):
        _settings(SECRET_KEY=clave)


def test_secret_key_fuerte_es_aceptada():
    _settings(SECRET_KEY="Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM")


def test_entorno_test_permite_llave_de_juguete():
    """La suite necesita poder usar llaves cortas; ese es el único permiso."""
    ajustes = _settings(ENVIRONMENT="test", SECRET_KEY="corta")
    assert ajustes.SECRET_KEY == "corta"


def test_cors_no_admite_comodin():
    """'*' con credenciales = cualquier web puede llamar a la API del usuario."""
    with pytest.raises(ValueError):
        _settings(SECRET_KEY="Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM",
                  BACKEND_CORS_ORIGINS=["*"])


def test_algoritmo_none_rechazado():
    """`alg: none` es el ataque clásico contra JWT."""
    with pytest.raises(ValueError):
        _settings(SECRET_KEY="Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM",
                  ALGORITHM="none")


def test_produccion_exige_allowed_hosts():
    with pytest.raises(ValueError):
        _settings(ENVIRONMENT="production",
                  SECRET_KEY="Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM",
                  BACKEND_CORS_ORIGINS=["https://app.teleprogreso.com"],
                  ALLOWED_HOSTS=[])


def test_produccion_rechaza_origenes_sin_https():
    with pytest.raises(ValueError):
        _settings(ENVIRONMENT="production",
                  SECRET_KEY="Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM",
                  BACKEND_CORS_ORIGINS=["http://app.teleprogreso.com"],
                  ALLOWED_HOSTS=["app.teleprogreso.com"])


# ─── 2. JWT: no se acepta un token sin firma válida ni sin expiración ────────

def test_token_sin_expiracion_rechazado():
    """
    Un token sin `exp` valdría para siempre. Se firma con la llave real para
    aislar la comprobación: lo único inválido aquí es la falta de expiración.
    """
    from app.core.config import settings

    token = jwt.encode(
        {"sub": "1", "rol": "admin"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    with pytest.raises(JWTError):
        decode_access_token(token)


def test_token_firmado_con_otra_llave_rechazado():
    token = jwt.encode(
        {"sub": "1", "rol": "admin", "exp": 9999999999},
        "llave-del-atacante",
        algorithm="HS256",
    )
    with pytest.raises(JWTError):
        decode_access_token(token)


def test_token_legitimo_se_decodifica():
    payload = decode_access_token(create_access_token(subject=1, rol="tecnico"))
    assert payload["sub"] == "1"
    assert payload["rol"] == "tecnico"
    assert "jti" in payload      # necesario para poder revocarlo en el logout


# ─── 3. Fuerza bruta contra el login ─────────────────────────────────────────

def test_ventana_bloquea_tras_el_maximo():
    v = VentanaDeslizante(maximo=3, ventana_segundos=60, bloqueo_segundos=120)
    clave = "login:1.2.3.4:alguien@teleprogreso.com"

    assert v.registrar(clave) == 0
    assert v.registrar(clave) == 0
    assert v.registrar(clave) == 120           # el tercero cierra la puerta
    assert v.segundos_de_bloqueo(clave) > 0


def test_bloqueo_no_afecta_a_otras_cuentas():
    """Bloquear de más dejaría fuera a empleados reales."""
    v = VentanaDeslizante(maximo=1, ventana_segundos=60, bloqueo_segundos=60)
    v.registrar("login:1.2.3.4:victima@teleprogreso.com")
    assert v.segundos_de_bloqueo("login:1.2.3.4:otro@teleprogreso.com") == 0


def test_login_correcto_limpia_el_historial():
    v = VentanaDeslizante(maximo=2, ventana_segundos=60, bloqueo_segundos=60)
    clave = "login:1.2.3.4:alguien@teleprogreso.com"
    v.registrar(clave)
    v.limpiar(clave)
    assert v.registrar(clave) == 0


# ─── 4. Cabeceras de seguridad en las respuestas ─────────────────────────────

def test_cabeceras_de_seguridad_presentes():
    res = client.get("/health")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'none'" in res.headers["Content-Security-Policy"]


# ─── 5. Corte por tamaño del cuerpo ──────────────────────────────────────────

def test_body_demasiado_grande_rechazado():
    """
    Se declara un Content-Length enorme sin llegar a enviar los datos: el corte
    ocurre por la cabecera, antes de leer nada.
    """
    from app.core.config import settings

    exceso = settings.MAX_REQUEST_BODY_MB * 1024 * 1024 + 1
    res = client.post(
        "/auth/login",
        headers={"Content-Length": str(exceso), "Content-Type": "application/json"},
        content=b"{}",
    )
    assert res.status_code == 413


# ─── 6. Superficie pública ───────────────────────────────────────────────────

def test_tipos_de_pausa_requiere_token():
    """
    Era el único endpoint que consultaba la base sin pedir credenciales.
    Cualquiera desde internet podía hacer que el backend abriera una conexión.
    """
    assert client.get("/descanso/tipos").status_code == 401
