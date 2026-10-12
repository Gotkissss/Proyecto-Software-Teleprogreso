# backend/tests/test_reportes_permisos.py
"""
Pruebas de control de acceso del router de Reportes — SCRUM-184 y HU-S9-04.

Todos los reportes son de GERENCIA (`require_gerente` → admin y gerente):
traen el desempeño individual de cada empleado y no son datos de operación
diaria.

Hasta el Sprint 9 la descarga en Excel admitía además al supervisor, que así
bajaba en un archivo los datos que no podía consultar en JSON (agujero L).
Ahora cada reporte y su exportación exigen el mismo rol, y estas pruebas
fallan si alguien vuelve a abrir una de las dos puertas sin la otra.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.core.deps import require_admin_supervisor_gerente, require_gerente
from app.routers.reportes import router
from app.services.exportacion_reportes import TIPOS_REPORTES_EXPORTABLES

ROLES = ("admin", "gerente", "supervisor", "tecnico")


def _ruta(path: str) -> APIRoute:
    return next(r for r in router.routes if r.path == path)


def _dependencias_de(path: str):
    return {dependencia.call for dependencia in _ruta(path).dependant.dependencies}


def _usuario(rol: str):
    return SimpleNamespace(rol=rol, id_empleado=1)


async def _roles_admitidos(path: str) -> set[str]:
    """Qué roles pasan TODAS las dependencias de rol de la ruta."""
    chequeos = [
        dependencia.call
        for dependencia in _ruta(path).dependant.dependencies
        if getattr(dependencia.call, "__name__", "") == "_check"
    ]
    assert chequeos, f"{path} no tiene dependencia de rol"
    admitidos = set()
    for rol in ROLES:
        try:
            for chequeo in chequeos:
                await chequeo(_usuario(rol))
        except HTTPException:
            continue
        admitidos.add(rol)
    return admitidos


# ─── Todo el módulo es de gerencia ───────────────────────────────────────────

def test_todas_las_rutas_de_reportes_exigen_rol_de_gerencia():
    rutas = [r.path for r in router.routes if isinstance(r, APIRoute)]
    assert len(rutas) == 5  # 4 reportes + exportación
    for path in rutas:
        assert require_gerente in _dependencias_de(path), path
        # Si alguien cambia la dependencia por la amplia, esto lo señala.
        assert require_admin_supervisor_gerente not in _dependencias_de(path), path


@pytest.mark.asyncio
@pytest.mark.parametrize("tipo", TIPOS_REPORTES_EXPORTABLES)
async def test_el_reporte_y_su_exportacion_admiten_exactamente_los_mismos_roles(tipo):
    # DoD del Sprint 9: ningún par JSON/export con roles distintos.
    json = await _roles_admitidos(f"/reportes/{tipo}")
    exportacion = await _roles_admitidos("/reportes/{tipo}/exportar")
    assert json == exportacion == {"admin", "gerente"}


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
