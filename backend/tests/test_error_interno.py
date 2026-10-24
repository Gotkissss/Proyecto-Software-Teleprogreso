"""
HU-S10-04, tarea 6: todo 500 sale con request_id, sin stack ni mensaje, y deja
su fila `error_interno` en la bitácora. Además, 409/422 de base y 404/405.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import DataError, IntegrityError

from app.core.exceptions import register_exception_handlers
from app.main import app
from app.services import bitacora
from app.services.bitacora import guardar_eventos as guardar_eventos_real

SECRETO = "clave=hunter2 SELECT * FROM empleado"


@pytest.fixture
def ruta_que_revienta():
    async def _boom():
        raise RuntimeError(SECRETO)

    app.add_api_route("/__prueba_500", _boom, methods=["GET"])
    yield "/__prueba_500"
    app.router.routes.pop()


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def test_el_500_lleva_request_id_igual_al_de_la_cabecera(client, ruta_que_revienta):
    res = client.get(ruta_que_revienta, headers={"X-Request-ID": "abc-123"})

    assert res.status_code == 500
    cuerpo = res.json()
    assert cuerpo["error"] == "INTERNAL_ERROR"
    assert cuerpo["request_id"] == "abc-123" == res.headers["X-Request-ID"]


def test_el_500_genera_request_id_si_no_llega_uno(client, ruta_que_revienta):
    res = client.get(ruta_que_revienta)

    assert len(res.json()["request_id"]) >= 16
    assert res.json()["request_id"] == res.headers["X-Request-ID"]


def test_el_500_no_filtra_mensaje_ni_stack(client, ruta_que_revienta):
    texto = client.get(ruta_que_revienta).text

    assert "hunter2" not in texto and "SELECT" not in texto
    assert "Traceback" not in texto and "RuntimeError" not in texto


def test_el_500_deja_una_fila_error_interno_sin_mensaje(client, ruta_que_revienta, eventos_bitacora):
    res = client.get(ruta_que_revienta, headers={"X-Request-ID": "req-fila-1"})

    filas = [e for e in eventos_bitacora if e["accion"] == "error_interno"]
    assert len(filas) == 1
    fila = filas[0]
    assert fila["request_id"] == "req-fila-1" == res.json()["request_id"]
    assert fila["entidad"] == "peticion"
    assert fila["cambios"] == {"metodo": "GET", "ruta": ruta_que_revienta, "excepcion": "RuntimeError"}
    assert "hunter2" not in str(fila)


def test_el_log_lleva_el_mismo_request_id(client, ruta_que_revienta, caplog):
    with caplog.at_level("ERROR"):
        client.get(ruta_que_revienta, headers={"X-Request-ID": "req-log-1"})

    assert any("req-log-1" in r.getMessage() for r in caplog.records)


def test_un_404_normal_no_deja_fila_error_interno(client, eventos_bitacora):
    client.get("/ruta-que-no-existe")
    assert [e for e in eventos_bitacora if e["accion"] == "error_interno"] == []


@pytest.mark.asyncio
async def test_si_guardar_auditoria_falla_se_cuenta(monkeypatch):
    class _SesionRota:
        async def __aenter__(self):
            raise ConnectionError("base caida")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(bitacora, "AsyncSessionLocal", lambda: _SesionRota())
    antes = bitacora.fallos_auditoria()

    await guardar_eventos_real([{"accion": "a"}, {"accion": "b"}])  # no lanza

    despues = bitacora.fallos_auditoria()
    assert despues["total"] == antes["total"] + 1
    assert despues["eventos_perdidos"] == antes["eventos_perdidos"] + 2
    assert despues["ultimo"] is not None


# ─── Tarea 2: errores de base y rutas inexistentes con el formato estándar ───

class _Orig(Exception):
    def __init__(self, sqlstate, texto):
        super().__init__(texto)
        self.sqlstate = sqlstate


@pytest.fixture
def mini_client():
    mini = FastAPI()
    register_exception_handlers(mini)

    @mini.get("/duplicado")
    async def _dup():
        raise IntegrityError("INSERT INTO empleado ...", {"correo": "x@x.com"},
                             _Orig("23505", 'duplicate key value violates unique constraint "uq_empleado_correo"'))

    @mini.get("/fk")
    async def _fk():
        raise IntegrityError("DELETE ...", {}, _Orig("23503", 'violates foreign key constraint "fk_tarea_tecnico"'))

    @mini.get("/largo")
    async def _largo():
        raise DataError("INSERT INTO tarea ...", {"titulo": "x" * 200}, _Orig("22001", "value too long for type character varying(150)"))

    return TestClient(mini, raise_server_exceptions=False)


@pytest.mark.parametrize("ruta", ["/duplicado", "/fk"])
def test_integrity_error_da_409_sin_sql_ni_constraint(mini_client, ruta):
    res = mini_client.get(ruta)

    assert res.status_code == 409
    assert res.json()["error"] == "CONFLICT"
    for prohibido in ("INSERT", "DELETE", "uq_empleado_correo", "fk_tarea_tecnico", "x@x.com"):
        assert prohibido not in res.text


def test_data_error_da_422_sin_sql(mini_client):
    res = mini_client.get("/largo")

    assert res.status_code == 422
    assert res.json()["error"] == "VALIDATION_ERROR"
    assert "INSERT" not in res.text and "character varying" not in res.text


def test_404_de_ruta_inexistente_usa_el_formato_estandar(client):
    res = client.get("/ruta-que-no-existe")

    assert res.status_code == 404
    assert res.json() == {"error": "NOT_FOUND", "detail": "El recurso solicitado no existe.", "status_code": 404}


def test_405_usa_el_formato_estandar(client):
    res = client.delete("/auth/login")

    assert res.status_code == 405
    assert res.json()["error"] == "METHOD_NOT_ALLOWED"
    assert res.json()["status_code"] == 405
