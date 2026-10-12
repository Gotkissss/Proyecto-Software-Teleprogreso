# backend/tests/test_bitacora.py
"""
Bitácora de auditoría: descripción de cambios del hook, inserciones masivas y
los eventos que no cambian filas (login fallido, bloqueo, logout, 403,
lecturas). Los eventos los recoge el fixture `eventos_bitacora` de conftest.py.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm.attributes import set_committed_value

from app.core.contexto import CABECERA_REQUEST_ID, ContextoPeticionMiddleware
from app.core.deps import auditar_lectura
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.empleado import Empleado
from app.services import bitacora


def _db_con(objeto):
    """get_db falso: token no revocado y cualquier otro SELECT devuelve `objeto`."""
    async def _fake():
        async def _execute(statement, *args, **kwargs):
            resultado = MagicMock()
            resultado.scalar_one_or_none.return_value = (
                None if "token_revocado" in str(statement) else objeto
            )
            return resultado

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=_execute)
        yield db

    return _fake


def _persona(id_empleado, rol):
    return SimpleNamespace(
        id_empleado=id_empleado, rol=rol, estado="activo", version_token=0,
        nombre="N", apellido="A", correo=f"{rol}@teleprogreso.com",
    )


def _token(persona):
    return {"Authorization": f"Bearer {create_access_token(subject=persona.id_empleado, rol=persona.rol)}"}


@pytest.fixture
def cliente():
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def _de(eventos, accion):
    return [e for e in eventos if e["accion"] == accion]


# La cadena de hashes la calcula la base (trigger de la migración 0010): sus
# pruebas están en tests/integracion/test_auditoria.py.


# --- Lo que el hook guarda de cada fila -------------------------------------

def test_crear_guarda_los_valores_y_oculta_el_hash_de_contrasena():
    emp = Empleado(nombre="Ana", correo="ana@teleprogreso.com", hash_contrasena="secreto")
    cambios = bitacora.describir_cambios(emp, "crear")

    assert cambios["nombre"] == "Ana"
    assert cambios["hash_contrasena"] == "***"


def test_la_lista_negra_oculta_el_valor_pero_no_el_hecho():
    emp = Empleado()
    set_committed_value(emp, "hash_contrasena", "viejo")
    set_committed_value(emp, "version_token", 3)
    emp.hash_contrasena = "nuevo"
    emp.version_token = 4

    assert bitacora.describir_cambios(emp, "actualizar") == {
        "hash_contrasena": {"antes": "***", "despues": "***"},
        "version_token": {"antes": "***", "despues": "***"},
    }


def test_actualizar_guarda_solo_lo_que_cambio_con_antes_y_despues():
    emp = Empleado()
    set_committed_value(emp, "nombre", "Ana")
    set_committed_value(emp, "telefono", "5550-0001")
    emp.nombre = "Eva"

    assert bitacora.describir_cambios(emp, "actualizar") == {
        "nombre": {"antes": "Ana", "despues": "Eva"}
    }


def test_eliminar_guarda_la_foto_de_lo_que_habia():
    emp = Empleado()
    set_committed_value(emp, "nombre", "Ana")

    assert bitacora.describir_cambios(emp, "eliminar")["nombre"] == "Ana"


@pytest.fixture
def en_peticion():
    from app.core.contexto import ContextoPeticion, _contexto

    token = _contexto.set(ContextoPeticion(id_actor=2, rol_actor="supervisor", request_id="r1"))
    yield
    _contexto.reset(token)


def _sesion(new=(), dirty=(), deleted=()):
    return SimpleNamespace(
        new=list(new), dirty=list(dirty), deleted=list(deleted), info={}, connection=MagicMock,
        is_modified=lambda _obj: True,
    )


def test_before_flush_captura_y_after_flush_escribe_con_el_id_ya_asignado(en_peticion, monkeypatch):
    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    nuevo = Empleado(nombre="Ana", hash_contrasena="secreto")
    sesion = _sesion(new=[nuevo])

    bitacora._capturar_diff(sesion, None, None)
    nuevo.id_empleado = 42  # lo que hace el INSERT entre los dos eventos
    bitacora._escribir_diff(sesion, None)

    [fila] = escritos
    assert (fila["accion"], fila["entidad"], fila["id_entidad"]) == ("crear", "empleado", 42)
    assert (fila["id_actor"], fila["request_id"]) == (2, "r1")
    assert fila["cambios"]["nombre"] == "Ana"
    assert fila["cambios"]["hash_contrasena"] == "***"


def test_el_diff_es_el_de_antes_del_flush(en_peticion, monkeypatch):
    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    emp = Empleado()
    set_committed_value(emp, "id_empleado", 7)
    set_committed_value(emp, "telefono", "5550-0001")
    emp.telefono = "5550-0002"
    sesion = _sesion(dirty=[emp])

    bitacora._capturar_diff(sesion, None, None)
    set_committed_value(emp, "telefono", "5550-0002")  # el flush consolida el valor
    bitacora._escribir_diff(sesion, None)

    [fila] = escritos
    assert fila["cambios"] == {"telefono": {"antes": "5550-0001", "despues": "5550-0002"}}


def test_los_puntos_gps_quedan_resumidos_sin_coordenadas(en_peticion, monkeypatch):
    from app.models.ubicacion import UbicacionEmpleado

    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    puntos = [
        UbicacionEmpleado(id_empleado=4, coordenada="SRID=4326;POINT(-90.5 14.6)")
        for _ in range(3)
    ]
    sesion = _sesion(new=puntos)

    bitacora._capturar_diff(sesion, None, None)
    for i, punto in enumerate(puntos, start=10):
        punto.id_ubicacion = i
    bitacora._escribir_diff(sesion, None)

    [fila] = escritos
    assert (fila["accion"], fila["entidad"], fila["id_entidad"]) == ("crear", "ubicacion_empleado", None)
    assert fila["cambios"] == {"resumen": True, "filas": 3, "ids": [10, 11, 12]}
    assert "POINT" not in str(fila)


def test_tocar_sin_cambiar_no_deja_fila(en_peticion, monkeypatch):
    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    emp = Empleado()
    set_committed_value(emp, "nombre", "Ana")
    sesion = _sesion(dirty=[emp])

    bitacora._capturar_diff(sesion, None, None)
    bitacora._escribir_diff(sesion, None)

    assert escritos == []


def test_un_delete_masivo_deja_condicion_y_filas(en_peticion, monkeypatch):
    from sqlalchemy import delete

    from app.models.empleado import EmpleadoTarea

    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    resultado = SimpleNamespace(rowcount=2, returns_rows=False)
    estado = SimpleNamespace(
        is_insert=False,
        is_update=False,
        is_delete=True,
        statement=delete(EmpleadoTarea).where(EmpleadoTarea.id_tarea == 260),
        invoke_statement=lambda: resultado,
        session=SimpleNamespace(connection=MagicMock),
    )

    assert bitacora._auditar_masivo(estado) is resultado
    [fila] = escritos
    assert (fila["accion"], fila["entidad"]) == ("eliminar", "empleado_tarea")
    assert fila["cambios"]["filas"] == 2
    assert "260" in fila["cambios"]["condicion"]


def test_un_insert_masivo_con_returning_deja_los_ids_y_no_consume_el_resultado(en_peticion, monkeypatch):
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models.alerta import Alerta

    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    filas = MagicMock()
    filas.all.return_value = [(31,), (32,)]
    congelado = MagicMock(return_value=filas)
    resultado = SimpleNamespace(returns_rows=True, freeze=lambda: congelado)
    estado = SimpleNamespace(
        is_insert=True,
        is_update=False,
        is_delete=False,
        statement=pg_insert(Alerta).values([{"tipo": "x"}]).returning(Alerta.id_alerta),
        invoke_statement=lambda: resultado,
        session=SimpleNamespace(connection=MagicMock),
    )

    devuelto = bitacora._auditar_masivo(estado)

    assert devuelto is filas  # quien llamó recibe una copia intacta
    [fila] = escritos
    assert (fila["accion"], fila["entidad"]) == ("crear", "alerta")
    assert fila["cambios"] == {"masivo": True, "filas": 2, "ids": [31, 32]}


def test_un_masivo_que_no_toca_filas_no_deja_rastro(en_peticion, monkeypatch):
    from sqlalchemy import update

    escritos = []
    monkeypatch.setattr(bitacora, "insertar", lambda _conexion, registro: escritos.append(registro))
    estado = SimpleNamespace(
        is_insert=False,
        is_update=True,
        is_delete=False,
        statement=update(Empleado).where(Empleado.id_empleado == 0).values(nombre="x"),
        invoke_statement=lambda: SimpleNamespace(rowcount=0, returns_rows=False),
        session=SimpleNamespace(connection=MagicMock),
    )

    bitacora._auditar_masivo(estado)
    assert escritos == []


def test_fuera_de_una_peticion_el_hook_no_captura():
    sesion = _sesion(new=[Empleado(nombre="Seed")])
    bitacora._capturar_diff(sesion, None, None)
    assert sesion.info[bitacora._PENDIENTE] == []


def test_fuera_de_una_peticion_no_se_anota_nada():
    bitacora.anotar_evento("leer", "empleado")  # sin contexto: no revienta ni guarda


# --- Eventos que no cambian filas -------------------------------------------

def test_login_fallido_queda_registrado(cliente, eventos_bitacora):
    app.dependency_overrides[get_db] = _db_con(None)  # correo inexistente
    res = cliente.post("/auth/login", json={"correo": "nadie.bitacora@teleprogreso.com", "contrasena": "x" * 10})

    assert res.status_code == 401
    [evento] = _de(eventos_bitacora, "login_fallido")
    assert evento["cambios"]["correo"] == "nadie.bitacora@teleprogreso.com"
    assert evento["id_entidad"] is None
    assert evento["request_id"] == res.headers[CABECERA_REQUEST_ID]


def test_403_por_rol_queda_registrado_con_actor_y_rol(cliente, eventos_bitacora):
    tecnico = _persona(5, "tecnico")
    app.dependency_overrides[get_db] = _db_con(tecnico)
    res = cliente.get("/activos/materiales", headers=_token(tecnico))

    assert res.status_code == 403
    [evento] = _de(eventos_bitacora, "acceso_denegado")
    assert (evento["id_actor"], evento["rol_actor"]) == (5, "tecnico")
    assert evento["cambios"]["ruta"] == "/activos/materiales"


def test_logout_queda_registrado(cliente, eventos_bitacora, monkeypatch):
    monkeypatch.setattr("app.routers.auth.revoke_token", AsyncMock())
    monkeypatch.setattr("app.routers.auth.purgar_tokens_expirados", AsyncMock())
    supervisor = _persona(9, "supervisor")
    app.dependency_overrides[get_db] = _db_con(supervisor)
    res = cliente.post("/auth/logout", headers=_token(supervisor))

    assert res.status_code == 200, res.text
    [evento] = _de(eventos_bitacora, "logout")
    assert (evento["id_actor"], evento["id_entidad"]) == (9, 9)


def test_un_bloqueo_se_anota_una_vez_por_ventana():
    clave = "rate:198.51.100.1"
    assert bitacora.primera_vez(clave) is True
    assert bitacora.primera_vez(clave) is False
    assert bitacora.primera_vez("rate:198.51.100.2") is True


# --- Lecturas sensibles -------------------------------------------------------

mini = FastAPI()
mini.add_middleware(ContextoPeticionMiddleware)


@mini.get("/recorrido/{id_empleado}", dependencies=[auditar_lectura("ubicacion")])
async def _leer(id_empleado: int):
    if id_empleado == 404:
        raise HTTPException(status_code=404)
    return {"ok": True}


def test_una_lectura_sensible_deja_quien_que_y_con_que_filtros(eventos_bitacora):
    mini.dependency_overrides[get_db] = _db_con(_persona(3, "gerente"))
    res = TestClient(mini).get("/recorrido/12?fecha=2026-10-11", headers=_token(_persona(3, "gerente")))

    assert res.status_code == 200
    [evento] = _de(eventos_bitacora, "leer")
    assert (evento["entidad"], evento["id_entidad"], evento["id_actor"]) == ("ubicacion", 12, 3)
    assert evento["cambios"]["consulta"] == {"fecha": "2026-10-11"}


def test_la_misma_lectura_repetida_se_registra_una_vez_por_ventana(eventos_bitacora):
    gerente = _persona(3, "gerente")
    mini.dependency_overrides[get_db] = _db_con(gerente)
    cliente = TestClient(mini)

    for _ in range(4):  # el mapa del supervisor se refresca solo
        assert cliente.get("/recorrido/12?fecha=2026-10-11", headers=_token(gerente)).status_code == 200
    cliente.get("/recorrido/12?fecha=2026-10-12", headers=_token(gerente))  # otro filtro, otra lectura

    assert [e["cambios"]["consulta"]["fecha"] for e in _de(eventos_bitacora, "leer")] == [
        "2026-10-11",
        "2026-10-12",
    ]


def test_una_lectura_fallida_no_cuenta_como_lectura(eventos_bitacora):
    mini.dependency_overrides[get_db] = _db_con(_persona(3, "gerente"))
    res = TestClient(mini, raise_server_exceptions=False).get(
        "/recorrido/404", headers=_token(_persona(3, "gerente"))
    )

    assert res.status_code == 404
    assert _de(eventos_bitacora, "leer") == []
