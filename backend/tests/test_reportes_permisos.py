# backend/tests/test_reportes_permisos.py
"""
Pruebas de control de acceso del router de Reportes — SCRUM-184.

El módulo tiene una asimetría deliberada que conviene dejar fijada, porque a
simple vista parece un error:

  - Los tres reportes en JSON son de GERENCIA (`require_gerente` → admin y
    gerente). Traen el desempeño individual de cada empleado y no son datos
    de operación diaria.
  - La descarga en Excel sí admite al SUPERVISOR, porque su dashboard tiene
    el botón de "Exportar reporte" (SCRUM-178).

Sin estas pruebas, alguien que "arregle" la inconsistencia abriendo los tres
endpoints a supervisión no rompería ningún test.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.deps import require_admin_supervisor_gerente, require_gerente
from app.routers.reportes import router


RUTAS_SOLO_GERENCIA = [
    "/reportes/asistencia",
    "/reportes/tareas-completadas",
    "/reportes/productividad",
]


def _dependencias_de(path: str):
    ruta = next(r for r in router.routes if r.path == path)
    return {dependencia.call for dependencia in ruta.dependant.dependencies}


def _usuario(rol: str):
    return SimpleNamespace(rol=rol, id_empleado=1)


# ─── Los tres reportes JSON son de gerencia ───────────────────────────────────

@pytest.mark.parametrize("path", RUTAS_SOLO_GERENCIA)
def test_los_reportes_json_exigen_rol_de_gerencia(path):
    assert require_gerente in _dependencias_de(path)


@pytest.mark.parametrize("path", RUTAS_SOLO_GERENCIA)
def test_los_reportes_json_no_se_abren_a_supervision(path):
    # Si alguien cambia la dependencia por la amplia, este test lo señala.
    assert require_admin_supervisor_gerente not in _dependencias_de(path)


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["admin", "gerente"])
async def test_require_gerente_acepta_a_gerencia(rol):
    usuario = _usuario(rol)
    assert await require_gerente(usuario) is usuario


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["supervisor", "tecnico"])
async def test_require_gerente_rechaza_al_resto(rol):
    with pytest.raises(HTTPException) as error:
        await require_gerente(_usuario(rol))

    assert error.value.status_code == 403


# ─── La exportación sí llega al supervisor ────────────────────────────────────

@pytest.mark.asyncio
async def test_el_supervisor_no_lee_el_json_pero_si_descarga_el_excel():
    """
    La asimetría completa, en una sola prueba.

    Es la que sostiene el botón "Exportar reporte" del dashboard del
    supervisor: si `/reportes/{tipo}/exportar` se cerrara a gerencia, ese
    botón devolvería 403 y la pantalla quedaría con un error sin explicación.
    """
    supervisor = _usuario("supervisor")

    with pytest.raises(HTTPException) as error:
        await require_gerente(supervisor)
    assert error.value.status_code == 403

    assert await require_admin_supervisor_gerente(supervisor) is supervisor
    assert require_admin_supervisor_gerente in _dependencias_de(
        "/reportes/{tipo}/exportar"
    )
