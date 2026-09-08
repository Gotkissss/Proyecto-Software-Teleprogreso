"""Pruebas del formato común de errores HTTP de la API."""

import json

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core.exceptions import (
    APIException,
    bad_request,
    conflict,
    forbidden,
    http_exception_handler,
    not_found,
)


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/prueba",
            "headers": [],
            "query_string": b"",
            "server": ("testserver", 80),
            "client": ("testclient", 50000),
            "scheme": "http",
        }
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("factory", "status_code", "error_code"),
    [
        (bad_request, 400, "BAD_REQUEST"),
        (forbidden, 403, "FORBIDDEN"),
        (not_found, 404, "NOT_FOUND"),
        (conflict, 409, "CONFLICT"),
    ],
)
async def test_errores_de_aplicacion_comparten_formato(
    factory,
    status_code,
    error_code,
):
    response = await http_exception_handler(_request(), factory("Mensaje de prueba"))

    assert response.status_code == status_code
    assert json.loads(response.body) == {
        "error": error_code,
        "detail": "Mensaje de prueba",
        "status_code": status_code,
    }


@pytest.mark.asyncio
async def test_http_exception_409_tambien_se_normaliza_como_conflicto():
    response = await http_exception_handler(
        _request(),
        HTTPException(status_code=409, detail="Registro duplicado"),
    )

    assert json.loads(response.body) == {
        "error": "CONFLICT",
        "detail": "Registro duplicado",
        "status_code": 409,
    }


def test_api_exception_exige_detail_textual():
    with pytest.raises(TypeError, match="detail debe ser una cadena de texto"):
        APIException(status_code=400, detail={"mensaje": "inválido"})
