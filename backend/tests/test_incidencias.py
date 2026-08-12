# backend/tests/test_incidencias.py
"""
Pruebas de las evidencias de tarea (SCRUM-137 / 138).

Cubre el control de acceso (un técnico solo opera sobre sus tareas), las
reglas de negocio del registro de evidencia y las validaciones del upload de
la foto. Se usan mocks de AsyncSession, igual que en test_alertas.py.
"""

import io
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

from app.models.tarea import Incidencia, Tarea
from app.routers.incidencias import (
    crear_incidencia,
    eliminar_incidencia,
    get_incidencias,
    upload_foto_evidencia,
)
from app.schemas.incidencia import IncidenciaCreate
from app.services.uploads import MAX_FILE_SIZE_MB, guardar_imagen


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _tarea(estado="en_progreso", fecha_inicio=None):
    return Tarea(
        id_tarea=1,
        titulo="Instalación fibra óptica",
        estado_tarea=estado,
        prioridad="alta",
        fecha_inicio=fecha_inicio,
    )


def _empleado(rol="tecnico", id_empleado=2):
    return SimpleNamespace(rol=rol, id_empleado=id_empleado)


def _db(resultados):
    """AsyncSession simulada que devuelve `resultados` en orden por cada execute."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=resultados)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _resultado(valor, *, lista=False):
    res = MagicMock()
    if lista:
        res.scalars.return_value.all.return_value = valor
    else:
        res.scalar_one_or_none.return_value = valor
    return res


def _upload(nombre: str, contenido: bytes) -> UploadFile:
    return UploadFile(filename=nombre, file=io.BytesIO(contenido))


# ─── Schema ──────────────────────────────────────────────────────────────────

def test_descripcion_en_blanco_es_rechazada():
    with pytest.raises(ValidationError):
        IncidenciaCreate(descripcion="        ")


def test_descripcion_demasiado_corta_es_rechazada():
    with pytest.raises(ValidationError):
        IncidenciaCreate(descripcion="ok")


def test_descripcion_se_normaliza():
    data = IncidenciaCreate(descripcion="   Se cambió el splitter dañado.   ")
    assert data.descripcion == "Se cambió el splitter dañado."
    assert data.finalizar_tarea is False


# ─── POST /tareas/{id}/incidencias ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_tecnico_asignado_registra_evidencia():
    tarea = _tarea()
    db = _db([
        _resultado(tarea),                       # la tarea existe
        _resultado(SimpleNamespace()),           # el técnico está asignado
    ])

    incidencia = await crear_incidencia(
        1,
        IncidenciaCreate(descripcion="Se instalaron los 5 puntos de red."),
        db,
        _empleado(),
    )

    assert incidencia.descripcion == "Se instalaron los 5 puntos de red."
    assert incidencia.id_tarea == 1
    # Sin finalizar_tarea la tarea no cambia de estado
    assert tarea.estado_tarea == "en_progreso"
    db.add.assert_called_once()


@pytest.mark.asyncio
async def test_finalizar_tarea_marca_completado_y_fecha_inicio():
    # La tarea debe estar en curso para poder cerrarse: una 'pendiente' no se
    # finaliza (validar_cierre_permitido exige que ya se haya iniciado).
    tarea = _tarea(estado="en_progreso", fecha_inicio=None)
    db = _db([_resultado(tarea), _resultado(SimpleNamespace())])

    await crear_incidencia(
        1,
        IncidenciaCreate(
            descripcion="Trabajo finalizado y verificado con el cliente.",
            finalizar_tarea=True,
        ),
        db,
        _empleado(),
    )

    assert tarea.estado_tarea == "completado"
    assert tarea.fecha_inicio == date.today()


@pytest.mark.asyncio
async def test_no_se_puede_finalizar_una_tarea_pendiente():
    db = _db([_resultado(_tarea(estado="pendiente")), _resultado(SimpleNamespace())])

    with pytest.raises(HTTPException) as error:
        await crear_incidencia(
            1,
            IncidenciaCreate(descripcion="Intento de cierre.", finalizar_tarea=True),
            db,
            _empleado(),
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_no_se_puede_finalizar_una_tarea_cancelada():
    db = _db([_resultado(_tarea(estado="cancelado")), _resultado(SimpleNamespace())])

    with pytest.raises(HTTPException) as error:
        await crear_incidencia(
            1,
            IncidenciaCreate(descripcion="Intento de cierre.", finalizar_tarea=True),
            db,
            _empleado(),
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_tarea_inexistente_devuelve_404():
    db = _db([_resultado(None)])

    with pytest.raises(HTTPException) as error:
        await crear_incidencia(
            999, IncidenciaCreate(descripcion="Descripción válida."), db, _empleado()
        )

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_tecnico_no_asignado_recibe_403():
    db = _db([
        _resultado(_tarea()),
        _resultado(None),      # no hay fila en empleado_tarea
    ])

    with pytest.raises(HTTPException) as error:
        await crear_incidencia(
            1, IncidenciaCreate(descripcion="Descripción válida."), db, _empleado()
        )

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_supervisor_no_necesita_estar_asignado():
    """El supervisor solo dispara una consulta: no se valida la asignación."""
    db = _db([_resultado(_tarea())])

    incidencia = await crear_incidencia(
        1,
        IncidenciaCreate(descripcion="Revisión de calidad del trabajo."),
        db,
        _empleado(rol="supervisor", id_empleado=9),
    )

    assert incidencia.id_tarea == 1
    assert db.execute.await_count == 1


# ─── GET /tareas/{id}/incidencias ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listar_evidencias_de_una_tarea():
    evidencias = [
        Incidencia(id_incidencia=2, id_tarea=1, descripcion="Segunda visita."),
        Incidencia(id_incidencia=1, id_tarea=1, descripcion="Primera visita."),
    ]
    db = _db([_resultado(_tarea()), _resultado(evidencias, lista=True)])

    resultado = await get_incidencias(1, db, _empleado(rol="admin", id_empleado=3))

    assert [e.id_incidencia for e in resultado] == [2, 1]


# ─── POST .../foto ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_foto_actualiza_la_incidencia(tmp_path, monkeypatch):
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    incidencia = Incidencia(id_incidencia=5, id_tarea=1, descripcion="Evidencia.")
    db = _db([_resultado(_tarea()), _resultado(incidencia)])

    respuesta = await upload_foto_evidencia(
        1,
        5,
        db,
        _empleado(rol="supervisor", id_empleado=9),
        file=_upload("evidencia.jpg", b"contenido-de-prueba"),
    )

    assert respuesta.foto_evidencia.startswith("/static/incidencias/incidencia_5_")
    assert respuesta.foto_evidencia.endswith(".jpg")
    assert incidencia.foto_evidencia == respuesta.foto_evidencia


@pytest.mark.asyncio
async def test_subir_foto_con_finalizar_cierra_la_tarea(tmp_path, monkeypatch):
    """
    Es el flujo del modal "Finalizar tarea": la tarea solo se cierra si la
    foto de evidencia llegó a guardarse.
    """
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    tarea = _tarea(estado="en_progreso", fecha_inicio=None)
    incidencia = Incidencia(id_incidencia=5, id_tarea=1, descripcion="Evidencia.")
    db = _db([_resultado(tarea), _resultado(SimpleNamespace()), _resultado(incidencia)])

    await upload_foto_evidencia(
        1,
        5,
        db,
        _empleado(),  # el técnico asignado
        file=_upload("evidencia.jpg", b"contenido"),
        finalizar_tarea=True,
    )

    assert tarea.estado_tarea == "completado"
    assert tarea.fecha_inicio == date.today()
    assert incidencia.foto_evidencia is not None


@pytest.mark.asyncio
async def test_subir_foto_sin_finalizar_no_toca_el_estado(tmp_path, monkeypatch):
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    tarea = _tarea(estado="en_progreso")
    incidencia = Incidencia(id_incidencia=5, id_tarea=1, descripcion="Evidencia.")
    db = _db([_resultado(tarea), _resultado(incidencia)])

    await upload_foto_evidencia(
        1, 5, db, _empleado(rol="supervisor", id_empleado=9),
        file=_upload("evidencia.jpg", b"contenido"),
    )

    assert tarea.estado_tarea == "en_progreso"


@pytest.mark.asyncio
async def test_no_se_puede_finalizar_una_tarea_cancelada_al_subir_la_foto(
    tmp_path, monkeypatch
):
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    incidencia = Incidencia(id_incidencia=5, id_tarea=1, descripcion="Evidencia.")
    db = _db([_resultado(_tarea(estado="cancelado")), _resultado(incidencia)])

    with pytest.raises(HTTPException) as error:
        await upload_foto_evidencia(
            1, 5, db, _empleado(rol="admin"),
            file=_upload("evidencia.jpg", b"contenido"),
            finalizar_tarea=True,
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_incidencia_inexistente_devuelve_404():
    db = _db([_resultado(_tarea()), _resultado(None)])

    with pytest.raises(HTTPException) as error:
        await upload_foto_evidencia(
            1, 77, db, _empleado(rol="admin"), file=_upload("foto.png", b"x")
        )

    assert error.value.status_code == 404


# ─── Servicio de uploads ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extension_no_permitida(tmp_path, monkeypatch):
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    with pytest.raises(HTTPException) as error:
        await guardar_imagen(
            _upload("virus.exe", b"payload"), subcarpeta="incidencias", prefijo="x"
        )

    assert error.value.status_code == 400
    assert "no permitida" in error.value.detail


@pytest.mark.asyncio
async def test_archivo_vacio_es_rechazado(tmp_path, monkeypatch):
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    with pytest.raises(HTTPException) as error:
        await guardar_imagen(
            _upload("foto.png", b""), subcarpeta="incidencias", prefijo="x"
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_archivo_demasiado_grande_es_rechazado(tmp_path, monkeypatch):
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    demasiado_grande = b"0" * (MAX_FILE_SIZE_MB * 1024 * 1024 + 1)

    with pytest.raises(HTTPException) as error:
        await guardar_imagen(
            _upload("grande.jpg", demasiado_grande),
            subcarpeta="incidencias",
            prefijo="x",
        )

    assert error.value.status_code == 400
    assert "MB" in error.value.detail


@pytest.mark.asyncio
async def test_la_imagen_anterior_se_elimina(tmp_path, monkeypatch):
    import os
    import app.services.uploads as uploads
    monkeypatch.setattr(uploads, "STATIC_ROOT", str(tmp_path))

    primera = await guardar_imagen(
        _upload("a.jpg", b"primera"), subcarpeta="incidencias", prefijo="incidencia_1"
    )
    ruta_primera = os.path.join(str(tmp_path), primera.replace("/static/", "", 1))
    assert os.path.isfile(ruta_primera)

    segunda = await guardar_imagen(
        _upload("b.png", b"segunda"),
        subcarpeta="incidencias",
        prefijo="incidencia_1",
        url_anterior=primera,
    )

    assert segunda != primera
    assert not os.path.isfile(ruta_primera)


# ─── DELETE ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_eliminar_evidencia_inexistente_devuelve_404():
    db = _db([_resultado(None)])

    with pytest.raises(HTTPException) as error:
        await eliminar_incidencia(1, 42, db, _empleado(rol="supervisor"))

    assert error.value.status_code == 404
