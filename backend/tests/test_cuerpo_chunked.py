"""HU-S10-04, tarea 6: un cuerpo de más del tope se corta con 413 tenga o no Content-Length."""
import asyncio
import json

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.middleware_seguridad import LimiteTamanoBody
from app.main import app

MAXIMO = settings.MAX_REQUEST_BODY_MB * 1024 * 1024
BLOQUE = b"a" * (1024 * 1024)


def _bloques(n_mb: int):
    for _ in range(n_mb):
        yield BLOQUE


def _correr(app_asgi, cabeceras, bloques):
    """Ejecuta una petición ASGI cruda y devuelve (status, cuerpo, bytes_leidos_por_la_app)."""
    enviados = []
    pendientes = list(bloques)

    async def receive():
        if pendientes:
            cuerpo = pendientes.pop(0)
            return {"type": "http.request", "body": cuerpo, "more_body": bool(pendientes)}
        return {"type": "http.disconnect"}

    async def send(mensaje):
        enviados.append(mensaje)

    scope = {
        "type": "http", "method": "POST", "path": "/x", "raw_path": b"/x",
        "query_string": b"", "headers": cabeceras, "client": ("127.0.0.1", 1),
        "server": ("test", 80), "scheme": "http", "http_version": "1.1",
    }
    asyncio.run(LimiteTamanoBody(app_asgi)(scope, receive, send))
    inicio = next(m for m in enviados if m["type"] == "http.response.start")
    cuerpo = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
    return inicio["status"], cuerpo


def _app_que_lee_todo(contados):
    async def _app(scope, receive, send):
        total = 0
        while True:
            m = await receive()
            if m["type"] != "http.request":
                break
            total += len(m.get("body", b""))
            if not m.get("more_body"):
                break
        contados.append(total)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})
    return _app


def test_chunked_sin_content_length_de_mas_del_tope_da_413():
    contados = []
    status, cuerpo = _correr(
        _app_que_lee_todo(contados),
        cabeceras=[(b"transfer-encoding", b"chunked")],
        bloques=[BLOQUE] * (settings.MAX_REQUEST_BODY_MB + 2),
    )

    assert status == 413
    assert json.loads(cuerpo)["error"] == "PAYLOAD_TOO_LARGE"


def test_la_aplicacion_no_alcanza_a_leer_mas_del_tope():
    contados = []
    _correr(
        _app_que_lee_todo(contados),
        cabeceras=[(b"transfer-encoding", b"chunked")],
        bloques=[BLOQUE] * (settings.MAX_REQUEST_BODY_MB * 3),
    )
    # La app o no termina de leer, o lo que lee no pasa del tope.
    assert all(total <= MAXIMO for total in contados)


def test_chunked_dentro_del_tope_pasa():
    contados = []
    status, cuerpo = _correr(
        _app_que_lee_todo(contados),
        cabeceras=[(b"transfer-encoding", b"chunked")],
        bloques=[BLOQUE] * 2,
    )

    assert status == 200 and cuerpo == b"ok"
    assert contados == [2 * 1024 * 1024]


def test_content_length_mentiroso_tambien_se_corta():
    """Declara 10 bytes y manda mucho más: cuenta lo que llega, no lo que dice."""
    status, _ = _correr(
        _app_que_lee_todo([]),
        cabeceras=[(b"content-length", b"10")],
        bloques=[BLOQUE] * (settings.MAX_REQUEST_BODY_MB + 2),
    )
    assert status == 413


def test_content_length_no_numerico_da_400():
    status, _ = _correr(
        _app_que_lee_todo([]), cabeceras=[(b"content-length", b"abc")], bloques=[b"{}"]
    )
    assert status == 400


def test_por_http_un_post_chunked_enorme_da_413():
    """Mismo caso a través de la aplicación completa (un generador manda el cuerpo por bloques)."""
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post(
        "/auth/login",
        headers={"Content-Type": "application/json"},
        content=_bloques(settings.MAX_REQUEST_BODY_MB + 2),
    )
    assert res.status_code == 413
    assert res.json()["error"] == "PAYLOAD_TOO_LARGE"
