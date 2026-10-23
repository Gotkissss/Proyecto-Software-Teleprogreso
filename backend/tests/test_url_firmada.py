# backend/tests/test_url_firmada.py
"""
Enlaces firmados a las fotos subidas (HU-S10-02, tarea 1).

Qué se comprueba:
  1. La API firma solo rutas que escribió guardar_imagen (/static/carpeta/nombre).
  2. Un enlace recién emitido es válido y vence a los MINUTOS_URL_FIRMADA.
  3. Cambiar la carpeta, el nombre, el vencimiento o la firma lo invalida, y
     tampoco vale uno firmado con otra llave.
  4. El tipo UrlArchivo firma el campo al serializar una respuesta.
  5. La configuración: la llave es obligatoria y fuerte en producción, nunca
     igual a SECRET_KEY, y fuera de producción se genera si falta.
"""
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import BaseModel

from app.core import archivos_firmados
from app.core.archivos_firmados import UrlArchivo, firma_valida, url_firmada
from app.core.config import Settings
from app.core.reglas import MINUTOS_URL_FIRMADA

AHORA = 1_790_000_000
VIGENCIA = MINUTOS_URL_FIRMADA * 60
RUTA = "/static/incidencias/incidencia_12_0a1b2c3d.jpg"


def _partes(url):
    """('carpeta', 'nombre', exp, firma) de un enlace firmado."""
    separada = urlsplit(url)
    _, prefijo, carpeta, nombre = separada.path.split("/")
    assert prefijo == "archivos"
    consulta = parse_qs(separada.query)
    return carpeta, nombre, int(consulta["exp"][0]), consulta["firma"][0]


# --- 1. Qué se firma ---------------------------------------------------------

@pytest.mark.parametrize("ruta", [None, ""])
def test_sin_imagen_no_hay_enlace(ruta):
    assert url_firmada(ruta, ahora=AHORA) is None


@pytest.mark.parametrize(
    "ruta",
    [
        "https://otro-sitio.com/foto.jpg",       # no es nuestra
        "/static/foto.jpg",                      # sin carpeta
        "/static/incidencias/sub/foto.jpg",      # un nivel de más
        "/static/../secretos/foto.jpg",          # sale de la carpeta
        "/static/incidencias/..",
        "/static/incidencias/",
    ],
)
def test_una_ruta_que_no_escribio_guardar_imagen_no_se_firma(ruta):
    assert url_firmada(ruta, ahora=AHORA) is None


def test_el_enlace_apunta_a_archivos_con_la_misma_carpeta_y_nombre():
    url = url_firmada(RUTA, ahora=AHORA)

    carpeta, nombre, exp, firma = _partes(url)
    assert (carpeta, nombre) == ("incidencias", "incidencia_12_0a1b2c3d.jpg")
    assert exp == AHORA + VIGENCIA
    assert len(firma) == 64  # SHA-256 en hexadecimal


# --- 2. Vigencia ---------------------------------------------------------------

def test_un_enlace_recien_emitido_es_valido():
    carpeta, nombre, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))

    assert firma_valida(carpeta, nombre, exp, firma, ahora=AHORA)


def test_sigue_valiendo_hasta_el_ultimo_segundo():
    carpeta, nombre, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))

    assert firma_valida(carpeta, nombre, exp, firma, ahora=AHORA + VIGENCIA)


def test_vencido_deja_de_valer():
    carpeta, nombre, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))

    assert not firma_valida(carpeta, nombre, exp, firma, ahora=AHORA + VIGENCIA + 1)


# --- 3. Manipulaciones -----------------------------------------------------------

def test_cambiar_el_nombre_invalida_la_firma():
    carpeta, _, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))

    assert not firma_valida(carpeta, "incidencia_13_ffffffff.jpg", exp, firma, ahora=AHORA)


def test_cambiar_la_carpeta_invalida_la_firma():
    _, nombre, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))

    assert not firma_valida("activos", nombre, exp, firma, ahora=AHORA)


def test_alargar_el_vencimiento_invalida_la_firma():
    carpeta, nombre, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))

    assert not firma_valida(carpeta, nombre, exp + 60, firma, ahora=AHORA)


def test_un_vencimiento_mas_lejano_que_la_vigencia_se_rechaza():
    # Ni con la llave se emite un enlace así: si aparece, no lo hizo la API.
    lejano = AHORA + VIGENCIA + 3600
    firma = archivos_firmados._firma("incidencias", "x.jpg", lejano)

    assert not firma_valida("incidencias", "x.jpg", lejano, firma, ahora=AHORA)


@pytest.mark.parametrize("firma", ["", "0" * 64, "no-es-hex"])
def test_una_firma_inventada_no_vale(firma):
    carpeta, nombre, exp, _ = _partes(url_firmada(RUTA, ahora=AHORA))

    assert not firma_valida(carpeta, nombre, exp, firma, ahora=AHORA)


def test_un_enlace_firmado_con_otra_llave_no_vale(monkeypatch):
    monkeypatch.setattr(
        archivos_firmados.settings, "CLAVE_FIRMA_ARCHIVOS", "otra-llave-" + "x1y2z3" * 6
    )
    carpeta, nombre, exp, firma = _partes(url_firmada(RUTA, ahora=AHORA))
    monkeypatch.undo()

    assert not firma_valida(carpeta, nombre, exp, firma, ahora=AHORA)


# --- 4. Al serializar una respuesta ----------------------------------------------

class _Respuesta(BaseModel):
    foto_url: UrlArchivo = None


def test_el_campo_sale_firmado_al_serializar():
    datos = _Respuesta(foto_url=RUTA).model_dump()

    carpeta, nombre, exp, firma = _partes(datos["foto_url"])
    assert firma_valida(carpeta, nombre, exp, firma)


def test_un_campo_sin_foto_sigue_en_null():
    assert _Respuesta().model_dump() == {"foto_url": None}
    assert _Respuesta(foto_url=None).model_dump_json() == '{"foto_url":null}'


# --- 5. Configuración --------------------------------------------------------------

SECRET_KEY = "Xk7pQ2mW9zR4tY6uI8oP1aS3dF5gH0jK2lZ4xC6vB8nM"
CLAVE_VALIDA = "Qw3eR5tY7uI9oP2aS4dF6gH8jK1lZ3xC5vB7nM9qW2eR"
BASE = {
    "DATABASE_URL": "postgresql+asyncpg://u:p@localhost:5432/x",
    "DATABASE_URL_SYNC": "postgresql://u:p@localhost:5432/x",
    "SECRET_KEY": SECRET_KEY,
}
PRODUCCION = {
    **BASE,
    "ENVIRONMENT": "production",
    "BACKEND_CORS_ORIGINS": ["https://app.teleprogreso.com"],
    "ALLOWED_HOSTS": ["api.teleprogreso.com"],
}


def test_produccion_sin_llave_no_arranca(monkeypatch):
    monkeypatch.delenv("CLAVE_FIRMA_ARCHIVOS", raising=False)

    with pytest.raises(ValueError, match="CLAVE_FIRMA_ARCHIVOS es obligatoria"):
        Settings(**PRODUCCION)


def test_produccion_con_llave_fuerte_arranca():
    ajustes = Settings(**PRODUCCION, CLAVE_FIRMA_ARCHIVOS=CLAVE_VALIDA)

    assert ajustes.CLAVE_FIRMA_ARCHIVOS == CLAVE_VALIDA


@pytest.mark.parametrize("entorno", ["production", "development"])
@pytest.mark.parametrize("clave", ["secret", "corta", "a" * 40])
def test_una_llave_debil_no_arranca(entorno, clave):
    with pytest.raises(ValueError, match="CLAVE_FIRMA_ARCHIVOS insegura"):
        Settings(**{**PRODUCCION, "ENVIRONMENT": entorno}, CLAVE_FIRMA_ARCHIVOS=clave)


@pytest.mark.parametrize("entorno", ["production", "development", "test"])
def test_la_llave_no_puede_ser_la_del_jwt(entorno):
    with pytest.raises(ValueError, match="no puede ser igual a SECRET_KEY"):
        Settings(**{**PRODUCCION, "ENVIRONMENT": entorno}, CLAVE_FIRMA_ARCHIVOS=SECRET_KEY)


@pytest.mark.parametrize("entorno", ["development", "test"])
def test_fuera_de_produccion_sin_llave_se_genera_una(monkeypatch, entorno):
    monkeypatch.delenv("CLAVE_FIRMA_ARCHIVOS", raising=False)

    ajustes = Settings(**BASE, ENVIRONMENT=entorno)

    assert len(ajustes.CLAVE_FIRMA_ARCHIVOS) >= 32
    assert ajustes.CLAVE_FIRMA_ARCHIVOS != SECRET_KEY


def test_la_llave_se_limpia_de_espacios_y_retornos():
    # Los .env editados en Windows dejan \r al final, igual que con SECRET_KEY.
    ajustes = Settings(**PRODUCCION, CLAVE_FIRMA_ARCHIVOS=f"  {CLAVE_VALIDA}\r")

    assert ajustes.CLAVE_FIRMA_ARCHIVOS == CLAVE_VALIDA
