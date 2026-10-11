# backend/tests/test_contexto_peticion.py
"""
Contexto de la petición: lo rellenan el middleware y get_current_empleado, y
cualquier función llamada durante la petición lo lee sin recibir current_user.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.contexto import (
    CABECERA_REQUEST_ID,
    ContextoPeticionMiddleware,
    _ip,
    contexto_actual,
)
from app.core.deps import get_current_empleado
from app.core.security import create_access_token
from app.db.session import get_db

SUPERVISOR = SimpleNamespace(id_empleado=7, rol="supervisor", estado="activo", version_token=0)

app = FastAPI()
app.add_middleware(ContextoPeticionMiddleware)


def _foto():
    ctx = contexto_actual()
    return {
        "ip": ctx.ip,
        "request_id": ctx.request_id,
        "id_actor": ctx.id_actor,
        "rol_actor": ctx.rol_actor,
    }


async def _servicio_profundo():
    # Como el hook de auditoría: no recibe current_user, solo lee el contexto.
    return _foto()


@app.get("/anonimo")
async def anonimo():
    return _foto()


@app.get("/autenticado")
async def autenticado(_=Depends(get_current_empleado)):
    return await _servicio_profundo()


async def _db_falsa():
    async def _execute(statement, *args, **kwargs):
        resultado = MagicMock()
        resultado.scalar_one_or_none.return_value = (
            None if "token_revocado" in str(statement) else SUPERVISOR
        )
        return resultado

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=_execute)
    yield db


app.dependency_overrides[get_db] = _db_falsa
client = TestClient(app)
TOKEN = {"Authorization": f"Bearer {create_access_token(subject=7, rol='supervisor')}"}


def test_autenticado_rellena_actor_y_rol_sin_pasar_current_user():
    res = client.get("/autenticado", headers=TOKEN)

    assert res.status_code == 200, res.text
    assert res.json()["id_actor"] == 7
    assert res.json()["rol_actor"] == "supervisor"
    assert res.json()["request_id"] == res.headers[CABECERA_REQUEST_ID]


def test_sin_sesion_el_actor_queda_vacio():
    datos = client.get("/anonimo").json()

    assert datos["id_actor"] is None
    assert datos["rol_actor"] is None
    assert len(datos["request_id"]) == 32


def test_el_actor_no_se_filtra_a_la_peticion_siguiente():
    primera = client.get("/autenticado", headers=TOKEN).json()
    segunda = client.get("/anonimo").json()

    assert segunda["id_actor"] is None
    assert segunda["request_id"] != primera["request_id"]


def test_respeta_un_request_id_valido():
    res = client.get("/anonimo", headers={CABECERA_REQUEST_ID: "front-abc.123"})

    assert res.json()["request_id"] == "front-abc.123"
    assert res.headers[CABECERA_REQUEST_ID] == "front-abc.123"


def test_reemplaza_un_request_id_invalido():
    for malo in ("<script>", "x" * 65, "con espacio"):
        res = client.get("/anonimo", headers={CABECERA_REQUEST_ID: malo})
        assert res.json()["request_id"] != malo
        assert len(res.json()["request_id"]) == 32


def test_fuera_de_una_peticion_no_hay_contexto():
    assert contexto_actual() is None


def test_ip_solo_si_es_una_ip_valida():
    def peticion(host):
        return SimpleNamespace(client=SimpleNamespace(host=host) if host else None)

    assert _ip(peticion("203.0.113.7")) == "203.0.113.7"
    assert _ip(peticion("2001:db8::1")) == "2001:db8::1"
    assert _ip(peticion("testclient")) is None
    assert _ip(peticion(None)) is None

def test_en_la_app_real_el_contexto_trae_actor_rol_y_request_id():
    from app.main import app as app_real

    @app_real.get("/_prueba_contexto")
    async def _prueba(_=Depends(get_current_empleado)):
        return await _servicio_profundo()

    app_real.dependency_overrides[get_db] = _db_falsa
    try:
        res = TestClient(app_real).get(
            "/_prueba_contexto",
            headers={**TOKEN, CABECERA_REQUEST_ID: "real-123"},
        )
    finally:
        app_real.dependency_overrides.pop(get_db, None)
        app_real.router.routes.pop()

    assert res.status_code == 200, res.text
    assert res.json() == {
        "ip": None,  # TestClient no manda una IP real
        "request_id": "real-123",
        "id_actor": 7,
        "rol_actor": "supervisor",
    }
    assert res.headers[CABECERA_REQUEST_ID] == "real-123"