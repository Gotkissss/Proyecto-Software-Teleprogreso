"""Contratos HTTP de las respuestas públicas de tareas y carros."""

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.deps import (
    get_current_empleado,
    require_admin_supervisor_gerente,
    require_supervisor,
    require_tecnico,
)
from app.db.session import get_db
from app.routers import carros, tareas


def _app_con_dependencias_simuladas() -> FastAPI:
    app = FastAPI()
    app.include_router(tareas.router)
    app.include_router(carros.router)

    async def db_simulada():
        yield object()

    async def usuario_simulado():
        return SimpleNamespace(id_empleado=2, rol="supervisor", estado="activo")

    app.dependency_overrides[get_db] = db_simulada
    for dependencia in (
        get_current_empleado,
        require_admin_supervisor_gerente,
        require_supervisor,
        require_tecnico,
    ):
        app.dependency_overrides[dependencia] = usuario_simulado

    return app


async def _request(app: FastAPI, method: str, url: str, **kwargs):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, url, **kwargs)


def _schema_respuesta(app, ruta, metodo, codigo):
    return app.openapi()["paths"][ruta][metodo]["responses"][str(codigo)][
        "content"
    ]["application/json"]["schema"]


def _assert_schema(app, ruta, metodo, codigo, nombre, *, lista=False):
    schema = _schema_respuesta(app, ruta, metodo, codigo)
    referencia = f"#/components/schemas/{nombre}"
    if lista:
        assert schema["type"] == "array"
        assert schema["items"]["$ref"] == referencia
    else:
        assert schema["$ref"] == referencia


def test_openapi_conserva_los_modelos_de_respuesta_de_tareas():
    app = _app_con_dependencias_simuladas()

    contratos = [
        ("/tareas", "get", 200, "TareaResponse", True),
        ("/tareas", "post", 201, "TareaResponse", False),
        ("/tareas/mi-ruta", "get", 200, "TareaRutaResponse", True),
        (
            "/tareas/mapa-supervisor",
            "get",
            200,
            "TareaMapaSupervisorResponse",
            True,
        ),
        ("/tareas/{id}", "patch", 200, "TareaResponse", False),
        ("/tareas/{id}/estado", "patch", 200, "TareaResponse", False),
        ("/tareas/{id}/reasignar", "patch", 200, "TareaResponse", False),
        ("/tareas/{id}/finalizar", "patch", 200, "TareaResponse", False),
        (
            "/tareas/completadas",
            "get",
            200,
            "HistorialTareasResponse",
            False,
        ),
    ]

    for ruta, metodo, codigo, nombre, lista in contratos:
        _assert_schema(app, ruta, metodo, codigo, nombre, lista=lista)


def test_openapi_conserva_los_modelos_de_respuesta_de_carros():
    app = _app_con_dependencias_simuladas()

    contratos = [
        ("/activos/carros", "get", 200, "CarroResponse", True),
        ("/activos/carros/{id}", "get", 200, "CarroResponse", False),
        (
            "/activos/carros/{id}/herramientas",
            "get",
            200,
            "HerramientaEnCarroResponse",
            True,
        ),
        (
            "/activos/carros/{id}/herramientas",
            "post",
            201,
            "HerramientaEnCarroResponse",
            False,
        ),
    ]

    for ruta, metodo, codigo, nombre, lista in contratos:
        _assert_schema(app, ruta, metodo, codigo, nombre, lista=lista)


@pytest.mark.asyncio
async def test_get_tareas_mantiene_el_json_publico(monkeypatch):
    tarea = {
        "id_tarea": 12,
        "titulo": "Instalación de fibra",
        "descripcion": "Instalar equipo óptico",
        "direccion_servicio": "Fraijanes, Guatemala",
        "estado_tarea": "pendiente",
        "prioridad": "alta",
        "fecha_inicio": date(2026, 9, 8),
        "fecha_finalizacion": date(2026, 9, 9),
        "fecha_asignacion": date(2026, 9, 7),
        "fecha_completado": None,
        "lat": 14.4653,
        "lng": -90.4408,
        "tecnico": {"id_empleado": 7, "nombre": "Ana López"},
        "total_incidencias": 2,
    }
    monkeypatch.setattr(
        tareas.tareas_service,
        "listar_tareas",
        AsyncMock(return_value=[tarea]),
    )

    response = await _request(_app_con_dependencias_simuladas(), "GET", "/tareas")

    assert response.status_code == 200
    assert response.json() == [
        {
            **tarea,
            "fecha_inicio": "2026-09-08",
            "fecha_finalizacion": "2026-09-09",
            "fecha_asignacion": "2026-09-07",
        }
    ]


@pytest.mark.asyncio
async def test_get_carros_mantiene_el_json_publico(monkeypatch):
    activo = SimpleNamespace(
        id_activo=5,
        nombre_activo="Camioneta operativa",
        descripcion="Unidad para instalaciones",
        tipo="vehiculo",
        fecha_registro=date(2026, 8, 1),
    )
    carro = SimpleNamespace(
        placa="P-123ABC",
        marca="Toyota",
        modelo="Hilux",
        capacidad=5,
        estado_vehiculo="en_uso",
    )
    asignacion = SimpleNamespace(
        id_empleado=7,
        empleado=SimpleNamespace(nombre="Ana", apellido="López"),
    )
    monkeypatch.setattr(
        carros.carros_service,
        "listar_carros",
        AsyncMock(return_value=[(activo, carro, asignacion)]),
    )

    response = await _request(
        _app_con_dependencias_simuladas(),
        "GET",
        "/activos/carros",
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "id_activo": 5,
            "nombre_activo": "Camioneta operativa",
            "descripcion": "Unidad para instalaciones",
            "tipo": "vehiculo",
            "fecha_registro": "2026-08-01",
            "foto_url": None,
            "placa": "P-123ABC",
            "marca": "Toyota",
            "modelo": "Hilux",
            "capacidad": 5,
            "estado_vehiculo": "en_uso",
            "id_empleado_asignado": 7,
            "nombre_empleado_asignado": "Ana López",
        }
    ]


@pytest.mark.asyncio
async def test_get_herramientas_de_carro_mantiene_el_json_publico(monkeypatch):
    relacion = SimpleNamespace(
        fecha_asignacion=datetime(2026, 9, 8, 7, 30),
        estado_entrega="Buenas condiciones",
        comentario="Incluye batería",
    )
    herramienta = SimpleNamespace(
        tipo_herramienta="medicion",
        marca="Fluke",
        modelo="Pro",
        estado="en_uso",
    )
    activo = SimpleNamespace(
        id_activo=20,
        nombre_activo="Medidor óptico",
        descripcion="Medidor de potencia",
    )
    monkeypatch.setattr(
        carros.carros_service,
        "listar_herramientas_de_carro",
        AsyncMock(return_value=[(relacion, herramienta, activo)]),
    )

    response = await _request(
        _app_con_dependencias_simuladas(),
        "GET",
        "/activos/carros/5/herramientas",
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "id_activo": 20,
            "nombre_activo": "Medidor óptico",
            "tipo_herramienta": "medicion",
            "marca": "Fluke",
            "modelo": "Pro",
            "estado": "en_uso",
            "descripcion": "Medidor de potencia",
            "foto_url": None,
            "fecha_asignacion": "2026-09-08T07:30:00",
            "estado_entrega": "Buenas condiciones",
            "comentario": "Incluye batería",
        }
    ]


@pytest.mark.asyncio
async def test_asignar_y_liberar_tecnico_mantiene_sus_respuestas(monkeypatch):
    monkeypatch.setattr(
        carros.carros_service,
        "asignar_tecnico",
        AsyncMock(
            return_value=(
                SimpleNamespace(placa="P-123ABC"),
                SimpleNamespace(nombre="Ana", apellido="López"),
            )
        ),
    )
    monkeypatch.setattr(
        carros.carros_service,
        "liberar_tecnico",
        AsyncMock(return_value=(7, "Ana López")),
    )
    app = _app_con_dependencias_simuladas()

    asignacion = await _request(
        app,
        "POST",
        "/activos/carros/5/asignar",
        json={"id_empleado": 7},
    )
    liberacion = await _request(
        app,
        "DELETE",
        "/activos/carros/5/asignacion",
    )

    assert asignacion.status_code == 200
    assert asignacion.json() == {
        "detail": "Tecnico asignado al vehiculo correctamente.",
        "id_carro": 5,
        "placa": "P-123ABC",
        "id_empleado": 7,
        "nombre_empleado": "Ana López",
    }
    assert liberacion.status_code == 200
    assert liberacion.json() == {
        "detail": "Tecnico 'Ana López' liberado del vehiculo id=5 correctamente.",
        "id_carro": 5,
        "id_empleado": 7,
    }
