# backend/tests/test_archivos_protegidos.py
"""
Las evidencias solo las ve quien puede verlas (HU-S10-02, tareas 2 a 5).

Qué se comprueba:
  1. GET /archivos/... sirve la foto solo con un enlace firmado y vigente, y
     ninguna entrada rara produce un 500.
  2. /static ya no publica nada, y una foto vieja guardada como /static/...
     se sirve bien por /archivos.
  3. Las respuestas que llevan foto la entregan firmada, y en la base sigue la
     ruta relativa.
  4. Los nombres nuevos llevan 128 bits al azar.
  5. El 403 por rol no le dice al cliente qué roles entran, pero la bitácora sí.

El tiempo se controla con el parámetro `ahora` de url_firmada (tarea 2.1): un
enlace emitido hace más de MINUTOS_URL_FIRMADA ya está vencido. Sin base de
datos: TestClient, tmp_path y monkeypatch de uploads.STATIC_ROOT.
"""

import re
import time
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.archivos_firmados import firma_valida, url_firmada
from app.core.reglas import MINUTOS_URL_FIRMADA
from app.db.session import get_db
from app.main import app
from app.models.activo import Activo
from app.models.tarea import Incidencia, Tarea
from app.routers import archivos as router_archivos
from app.routers.activos import upload_imagen_activo
from app.routers.archivos import get_archivo
from app.routers.incidencias import get_incidencias, upload_foto_evidencia
from app.schemas.activo import (
    ActivoDetalleResponse,
    CarroResponse,
    HerramientaEnCarroResponse,
    HerramientaResponse,
    ImagenActivoResponse,
    MaterialResponse,
)
from app.schemas.incidencia import FotoEvidenciaResponse, IncidenciaResponse
from app.schemas.tarea import EvidenciaResumen
from app.services import uploads

from tests.test_bitacora import _db_con, _persona, _token
from tests.test_incidencias import JPEG, PNG, _upload
from tests.test_url_firmada import _partes

VIGENCIA = MINUTOS_URL_FIRMADA * 60
NOMBRE = "incidencia_12_" + "0a1b2c3d" * 4 + ".jpg"
RUTA = f"/static/incidencias/{NOMBRE}"
MENSAJE_ENLACE = (
    "El enlace a este archivo no es válido o ya venció. Recarga la pantalla "
    "para obtener uno nuevo."
)
ROLES = ("admin", "supervisor", "tecnico", "gerente")


@pytest.fixture
def cliente():
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


@pytest.fixture
def carpeta(tmp_path, monkeypatch):
    """STATIC_ROOT temporal con una foto JPEG guardada en incidencias/."""
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))
    (tmp_path / "incidencias").mkdir()
    (tmp_path / "activos").mkdir()
    (tmp_path / "incidencias" / NOMBRE).write_bytes(JPEG)
    return tmp_path


def _con_query(url, **cambios):
    """El mismo enlace con algún parámetro de la consulta cambiado."""
    carpeta, nombre, exp, firma = _partes(url)
    valores = {"exp": exp, "firma": firma, **cambios}
    consulta = "&".join(f"{k}={v}" for k, v in valores.items() if v is not None)
    return f"/archivos/{carpeta}/{nombre}?{consulta}"


def _es_firmada(url, carpeta, nombre):
    """¿Es un enlace /archivos/ válido ahora mismo para esa carpeta y nombre?"""
    c, n, exp, firma = _partes(url)
    return (c, n) == (carpeta, nombre) and firma_valida(c, n, exp, firma)


# --- 1. Acceso por firma -------------------------------------------------------

def test_con_enlace_vigente_sirve_la_foto(cliente, carpeta):
    res = cliente.get(url_firmada(RUTA))

    assert res.status_code == 200
    assert res.content == JPEG


def test_cabeceras_de_la_foto(cliente, carpeta):
    res = cliente.get(url_firmada(RUTA))

    assert res.headers["content-type"] == "image/jpeg"
    assert res.headers["cache-control"] == "private"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert "sandbox allow-same-origin" in res.headers["content-security-policy"]
    assert "allow-scripts" not in res.headers["content-security-policy"]
    assert "content-disposition" not in res.headers


def test_el_tipo_sale_de_los_bytes_y_no_de_la_extension(cliente, carpeta):
    (carpeta / "activos" / "activo_3_png.jpg").write_bytes(PNG)

    res = cliente.get(url_firmada("/static/activos/activo_3_png.jpg"))

    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"


def _vencida():
    return url_firmada(RUTA, ahora=int(time.time()) - VIGENCIA - 5)


def _alterada():
    return _con_query(url_firmada(RUTA), firma="0" * 64)


@pytest.mark.parametrize(
    "construir",
    [
        lambda: f"/archivos/incidencias/{NOMBRE}",                     # sin firma
        lambda: _con_query(url_firmada(RUTA), firma=None),              # sin firma, con exp
        lambda: _con_query(url_firmada(RUTA), exp=None),                # sin exp
        _alterada,
        _vencida,
        lambda: _con_query(url_firmada(RUTA), exp="mañana"),            # exp no numérica
        lambda: _con_query(url_firmada(RUTA), exp="1e9"),
        lambda: _con_query(url_firmada(RUTA), firma="ñ" * 64),          # no ASCII
        lambda: _con_query(url_firmada(RUTA), firma="no-es-hex"),
    ],
    ids=[
        "sin-firma", "sin-firma-con-exp", "sin-exp", "alterada", "vencida",
        "exp-texto", "exp-cientifica", "firma-no-ascii", "firma-no-hex",
    ],
)
def test_sin_enlace_valido_403_con_el_mismo_mensaje(cliente, carpeta, construir):
    res = cliente.get(construir())

    assert res.status_code == 403
    cuerpo = res.json()
    assert cuerpo == {"error": "FORBIDDEN", "detail": MENSAJE_ENLACE, "status_code": 403}


def test_un_enlace_de_otra_foto_no_abre_esta(cliente, carpeta):
    (carpeta / "incidencias" / "otra.jpg").write_bytes(JPEG)
    _, _, exp, firma = _partes(url_firmada(RUTA))

    res = cliente.get(f"/archivos/incidencias/otra.jpg?exp={exp}&firma={firma}")

    assert res.status_code == 403


def test_archivo_inexistente_con_firma_valida_404(cliente, carpeta):
    res = cliente.get(url_firmada("/static/incidencias/no_existe.jpg"))

    assert res.status_code == 404


def test_un_archivo_que_no_es_imagen_no_se_sirve(cliente, carpeta):
    (carpeta / "incidencias" / "pagina.jpg").write_bytes(b"<html><script>x</script>")

    res = cliente.get(url_firmada("/static/incidencias/pagina.jpg"))

    assert res.status_code == 404
    assert b"<script>" not in res.content


def test_si_el_archivo_desaparece_antes_de_leerlo_404(cliente, carpeta, monkeypatch):
    # isfile dice que está, pero al abrirlo ya no existe: no se borra nada del disco.
    monkeypatch.setattr(router_archivos.os.path, "isfile", lambda ruta: True)

    res = cliente.get(url_firmada("/static/incidencias/se_fue.jpg"))

    assert res.status_code == 404
    assert res.json()["detail"] == "Archivo no encontrado."


def test_si_el_archivo_no_se_puede_leer_404(cliente, carpeta, monkeypatch):
    def _sin_permiso(*args, **kwargs):
        raise PermissionError("bloqueado")

    monkeypatch.setattr(router_archivos, "open", _sin_permiso, raising=False)

    res = cliente.get(url_firmada(RUTA))

    assert res.status_code == 404
    assert res.json()["detail"] == "Archivo no encontrado."


def _jpeg_de(tamano):
    """Bytes de un JPEG válido por su cabecera con exactamente `tamano` bytes."""
    return JPEG + b"\x00" * (tamano - len(JPEG))


def test_un_archivo_mayor_al_maximo_404_sin_servir_nada(cliente, carpeta):
    maximo = uploads.MAX_FILE_SIZE_MB * 1024 * 1024
    (carpeta / "incidencias" / "grande.jpg").write_bytes(_jpeg_de(maximo + 1))

    res = cliente.get(url_firmada("/static/incidencias/grande.jpg"))

    assert res.status_code == 404
    assert res.json()["detail"] == "Archivo no encontrado."


def test_un_archivo_justo_en_el_maximo_se_sirve(cliente, carpeta):
    maximo = uploads.MAX_FILE_SIZE_MB * 1024 * 1024
    (carpeta / "incidencias" / "limite.jpg").write_bytes(_jpeg_de(maximo))

    res = cliente.get(url_firmada("/static/incidencias/limite.jpg"))

    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    assert len(res.content) == maximo


@pytest.mark.parametrize(
    "ruta",
    [
        f"/archivos/otra/{NOMBRE}",              # carpeta fuera de la lista
        "/archivos/incidencias/..foto.jpg",       # secuencia ..
        "/archivos/incidencias/foto%00.jpg",      # byte nulo
        "/archivos/incidencias/foto%20x.jpg",     # espacio
        "/archivos/incidencias/foto%5Cx.jpg",     # separador de Windows
    ],
)
def test_ruta_con_formato_invalido_400(cliente, carpeta, ruta):
    res = cliente.get(ruta + "?exp=1&firma=" + "0" * 64)

    assert res.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("nombre", ["../secreto.jpg", "..", "sub/foto.jpg", "..\\foto.jpg"])
async def test_un_nombre_con_salto_de_carpeta_400_antes_de_mirar_la_firma(carpeta, nombre):
    with pytest.raises(HTTPException) as error:
        await get_archivo("incidencias", nombre, exp=None, firma=None)

    assert error.value.status_code == 400


# httpx y los navegadores resuelven ".." literal antes de enviar; las formas
# codificadas sí llegan así al servidor.
@pytest.mark.parametrize(
    "ruta",
    [
        "/archivos/incidencias/%2E%2E%2Fsecreto.jpg",        # ../
        "/archivos/incidencias/..%2F..%2Fapp%2Fmain.py",     # ..%2F
        "/archivos/..%2Fincidencias/foto.jpg",               # .. en la carpeta
        "/archivos/incidencias/%2E%2E",                      # .. solo
        "/archivos/incidencias/sub/..%5Cfoto.jpg",           # barra invertida
        "/archivos/incidencias/sub/c%3Afoto.jpg",            # dos puntos
        "/archivos/incidencias/sub/foto%00.jpg",             # byte nulo
    ],
)
def test_una_ruta_que_intenta_salir_de_la_carpeta_400(cliente, carpeta, ruta):
    res = cliente.get(ruta + "?exp=1&firma=" + "0" * 64)

    assert res.status_code == 400
    assert res.json()["detail"] == "La ruta del archivo no es válida."


@pytest.mark.parametrize(
    "ruta",
    ["/archivos/", "/archivos/incidencias", "/archivos/incidencias/sub/foto.jpg", "/archivos/a/b/c"],
)
def test_una_ruta_desconocida_404_sin_servir_nada(cliente, carpeta, ruta):
    res = cliente.get(ruta + "?exp=1&firma=" + "0" * 64)

    assert res.status_code == 404
    assert res.content != JPEG


def test_lee_static_root_en_cada_peticion(cliente, tmp_path, monkeypatch):
    otra = tmp_path / "otra_raiz"
    (otra / "incidencias").mkdir(parents=True)
    (otra / "incidencias" / NOMBRE).write_bytes(PNG)
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(otra))

    res = cliente.get(url_firmada(RUTA))

    assert res.status_code == 200
    assert res.content == PNG


def test_el_403_queda_en_la_bitacora_sin_la_firma(cliente, carpeta, eventos_bitacora):
    url = _alterada()

    cliente.get(url)

    [evento] = [e for e in eventos_bitacora if e["accion"] == "acceso_denegado"]
    assert evento["cambios"]["ruta"] == f"/archivos/incidencias/{NOMBRE}"
    assert "firma" not in str(evento["cambios"]["ruta"])
    assert "0" * 64 not in str(evento)


# --- 2. Sin /static ------------------------------------------------------------

def test_la_url_static_vieja_ya_no_sirve_nada(cliente, carpeta):
    res = cliente.get(RUTA)

    assert res.status_code == 404
    assert res.content != JPEG


def test_una_foto_vieja_de_8_caracteres_se_sirve_por_archivos(cliente, carpeta):
    (carpeta / "incidencias" / "incidencia_91_66caaba2.jpg").write_bytes(JPEG)

    res = cliente.get(url_firmada("/static/incidencias/incidencia_91_66caaba2.jpg"))

    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"


# --- 3. Las respuestas entregan la foto firmada ----------------------------------

def _activo(**extra):
    return dict(
        id_activo=3, nombre_activo="Pinza", tipo="herramienta",
        fecha_registro=date(2026, 1, 1), foto_url="/static/activos/activo_3_x.jpg", **extra,
    )


@pytest.mark.parametrize(
    "esquema, datos, campo, carpeta_esperada",
    [
        (IncidenciaResponse,
         dict(id_incidencia=1, id_tarea=1, foto_evidencia=RUTA, fecha_reporte=datetime(2026, 1, 1)),
         "foto_evidencia", "incidencias"),
        (FotoEvidenciaResponse,
         dict(detail="ok", id_incidencia=1, foto_evidencia=RUTA),
         "foto_evidencia", "incidencias"),
        (EvidenciaResumen,
         dict(id_incidencia=1, foto_evidencia=RUTA, fecha_reporte=datetime(2026, 1, 1)),
         "foto_evidencia", "incidencias"),
        (MaterialResponse, _activo(cantidad_disponible=1, stock_minimo=0), "foto_url", "activos"),
        (HerramientaResponse, _activo(estado="disponible"), "foto_url", "activos"),
        (CarroResponse, _activo(placa="P-1", estado_vehiculo="disponible"), "foto_url", "activos"),
        (HerramientaEnCarroResponse,
         dict(id_activo=3, nombre_activo="Pinza", estado="disponible",
              foto_url="/static/activos/activo_3_x.jpg"),
         "foto_url", "activos"),
        (ActivoDetalleResponse, _activo(), "foto_url", "activos"),
        (ImagenActivoResponse,
         dict(detail="ok", foto_url="/static/activos/activo_3_x.jpg"), "foto_url", "activos"),
    ],
)
def test_cada_respuesta_con_foto_la_entrega_firmada(esquema, datos, campo, carpeta_esperada):
    modelo = esquema(**datos)
    nombre = datos[campo].rsplit("/", 1)[1]

    url = modelo.model_dump(mode="json")[campo]

    assert _es_firmada(url, carpeta_esperada, nombre)
    assert getattr(modelo, campo) == datos[campo]  # el valor del ORM no cambia


@pytest.mark.parametrize("esquema, campo", [(IncidenciaResponse, "foto_evidencia"), (ActivoDetalleResponse, "foto_url")])
def test_sin_foto_sigue_en_null(esquema, campo):
    if esquema is IncidenciaResponse:
        modelo = esquema(id_incidencia=1, id_tarea=1, fecha_reporte=datetime(2026, 1, 1))
    else:
        modelo = esquema(**{**_activo(), "foto_url": None})

    assert modelo.model_dump(mode="json")[campo] is None


def _db(*valores):
    db = MagicMock()
    resultados = []
    for valor in valores:
        res = MagicMock()
        res.scalar_one_or_none.return_value = valor
        resultados.append(res)
    db.execute = AsyncMock(side_effect=resultados)
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_subir_foto_de_evidencia_responde_firmada_y_guarda_la_ruta(carpeta, monkeypatch):
    import app.routers.incidencias as incidencias_router
    monkeypatch.setattr(incidencias_router, "exigir_jornada_abierta", AsyncMock())
    tarea = Tarea(id_tarea=1, titulo="T", estado_tarea="en_progreso", prioridad="alta")
    incidencia = Incidencia(id_incidencia=5, id_tarea=1, descripcion="Evidencia.")

    respuesta = await upload_foto_evidencia(
        1, 5, _db(tarea, incidencia), SimpleNamespace(rol="supervisor", id_empleado=9),
        file=_upload("e.jpg", JPEG),
    )

    assert incidencia.foto_evidencia.startswith("/static/incidencias/")
    nombre = incidencia.foto_evidencia.rsplit("/", 1)[1]
    assert _es_firmada(respuesta.model_dump(mode="json")["foto_evidencia"], "incidencias", nombre)


@pytest.mark.asyncio
async def test_subir_imagen_de_activo_responde_firmada_y_guarda_la_ruta(carpeta):
    activo = Activo(id_activo=3, nombre_activo="Pinza", tipo="herramienta")

    respuesta = await upload_imagen_activo(
        3, _upload("a.png", PNG), _db(activo), SimpleNamespace(rol="supervisor", id_empleado=9),
    )

    assert activo.foto_url.startswith("/static/activos/activo_3_")
    nombre = activo.foto_url.rsplit("/", 1)[1]
    assert _es_firmada(respuesta.model_dump(mode="json")["foto_url"], "activos", nombre)


def test_mi_equipo_entrega_las_fotos_firmadas_por_http(cliente, monkeypatch):
    tecnico = _persona(5, "tecnico")
    app.dependency_overrides[get_db] = _db_con(tecnico)
    carro = SimpleNamespace(
        id_activo=1, nombre_activo="Hilux", descripcion=None, tipo="carro",
        fecha_registro=date(2026, 1, 1), foto_url="/static/activos/activo_1_a.jpg",
    )
    datos_carro = SimpleNamespace(placa="P-1", marca=None, modelo=None, capacidad=None, estado_vehiculo="en_uso")
    monkeypatch.setattr(
        "app.routers.empleados.empleados_service.obtener_equipo_empleado",
        AsyncMock(return_value=((carro, datos_carro), [])),
    )

    res = cliente.get("/empleados/mi-equipo", headers=_token(tecnico))

    assert res.status_code == 200, res.text
    assert _es_firmada(res.json()["vehiculo"]["foto_url"], "activos", "activo_1_a.jpg")


# --- Técnico de otra tarea --------------------------------------------------------

@pytest.mark.asyncio
async def test_tecnico_de_otra_tarea_no_recibe_ningun_enlace():
    tarea = Tarea(id_tarea=1, titulo="T", estado_tarea="en_progreso", prioridad="alta")
    db = _db(tarea, None)  # la tarea existe, pero no está asignada a este técnico

    with pytest.raises(HTTPException) as error:
        await get_incidencias(1, db, SimpleNamespace(rol="tecnico", id_empleado=99))

    assert error.value.status_code == 403
    assert "/archivos" not in error.value.detail
    assert "firma" not in error.value.detail
    assert db.execute.await_count == 2  # nunca se llegó a consultar las evidencias


# --- 4. Nombres de 128 bits --------------------------------------------------------

@pytest.mark.asyncio
async def test_el_nombre_lleva_32_hexadecimales_tras_el_prefijo(carpeta):
    ruta = await uploads.guardar_imagen(
        _upload("e.jpg", JPEG), subcarpeta="incidencias", prefijo="incidencia_7"
    )

    assert re.fullmatch(r"/static/incidencias/incidencia_7_[0-9a-f]{32}\.jpg", ruta)


@pytest.mark.asyncio
async def test_dos_subidas_seguidas_dan_nombres_distintos(carpeta):
    primera = await uploads.guardar_imagen(_upload("a.jpg", JPEG), subcarpeta="activos", prefijo="activo_1")
    segunda = await uploads.guardar_imagen(_upload("b.jpg", JPEG), subcarpeta="activos", prefijo="activo_1")

    assert primera != segunda


@pytest.mark.asyncio
async def test_lo_que_se_sube_se_puede_ver_con_su_enlace(cliente, carpeta):
    ruta = await uploads.guardar_imagen(_upload("e.png", PNG), subcarpeta="incidencias", prefijo="incidencia_7")

    res = cliente.get(url_firmada(ruta))

    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"


# --- 5. El 403 por rol --------------------------------------------------------------

def test_el_403_por_rol_no_nombra_roles_pero_la_bitacora_si(cliente, eventos_bitacora):
    tecnico = _persona(5, "tecnico")
    app.dependency_overrides[get_db] = _db_con(tecnico)

    res = cliente.get("/activos/materiales", headers=_token(tecnico))

    assert res.status_code == 403
    detalle = res.json()["detail"]
    assert detalle == "No tienes permiso para realizar esta acción."
    assert not any(rol in detalle.lower() for rol in ROLES)

    [evento] = [e for e in eventos_bitacora if e["accion"] == "acceso_denegado"]
    assert "Rol 'tecnico'" in evento["cambios"]["detalle"]
    assert "Se requiere uno de: admin, supervisor, gerente" in evento["cambios"]["detalle"]


def test_el_403_del_gerente_al_registrar_no_nombra_roles_pero_la_bitacora_si(cliente, eventos_bitacora):
    gerente = _persona(7, "gerente")
    app.dependency_overrides[get_db] = _db_con(gerente)

    res = cliente.post(
        "/tareas/1/incidencias",
        json={"descripcion": "Revisión de la instalación."},
        headers=_token(gerente),
    )

    assert res.status_code == 403
    detalle = res.json()["detail"]
    assert detalle == "Puedes consultar las evidencias de esta tarea, pero no registrarlas."
    assert not any(rol in detalle.lower() for rol in ROLES)

    [evento] = [e for e in eventos_bitacora if e["accion"] == "acceso_denegado"]
    assert "El rol gerente es de consulta" in evento["cambios"]["detalle"]
    assert "Coordina el registro con el supervisor" in evento["cambios"]["detalle"]
