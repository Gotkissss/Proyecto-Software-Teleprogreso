# backend/tests/test_almacenamiento_estatico.py
"""
Dónde viven las fotos subidas (evidencias e imágenes de activos).

Esto no es una preferencia de estilo: el disco del contenedor es efímero. En
Railway cada deploy y cada reinicio arrancan un contenedor nuevo y vacío, así
que una foto escrita dentro de la imagen desaparece y su URL pasa a devolver
404. En la pantalla eso se ve como una evidencia rota, sin ningún mensaje, y el
archivo ya no se puede recuperar. Apuntando `STATIC_DIR` al montaje de un
volumen persistente los archivos sobreviven.

Los dos invariantes que se fijan aquí:

  1. La carpeta sale de la configuración, no está incrustada en el código.
  2. El que ESCRIBE los archivos y el que los SIRVE usan exactamente la misma
     carpeta. Si se separan, la subida responde 200 y la imagen sale rota: un
     fallo que no deja rastro en ningún log. Desde HU-S10-02 la carpeta ya no
     se monta en /static: la sirve GET /archivos/... leyendo
     uploads.STATIC_ROOT en cada petición (ver test_archivos_protegidos.py).
"""

import os

from app.services.uploads import resolver_static_root


# ─── De dónde sale la carpeta ────────────────────────────────────────────────

def test_usa_la_carpeta_configurada(tmp_path):
    assert resolver_static_root(str(tmp_path)) == str(tmp_path)


def test_sin_configurar_cae_en_backend_static():
    """En local y en docker-compose no hay volumen: `backend/static` sirve."""
    por_defecto = resolver_static_root("")

    assert os.path.isabs(por_defecto)
    assert os.path.basename(por_defecto) == "static"
    # …y es la carpeta que está junto al código, no una ruta cualquiera.
    assert os.path.basename(os.path.dirname(por_defecto)) == "backend"


def test_none_se_trata_como_sin_configurar():
    assert resolver_static_root(None) == resolver_static_root("")


def test_la_ruta_devuelta_es_absoluta(tmp_path):
    """
    Una ruta relativa dependería del directorio de trabajo del proceso, que no
    es el mismo al arrancar uvicorn que al correr alembic o el seed.
    """
    relativa = os.path.relpath(tmp_path, os.getcwd())

    assert os.path.isabs(resolver_static_root(relativa))


# ─── Publicación: ya no hay /static ──────────────────────────────────────────

def test_no_queda_montaje_publico_en_static():
    from app.main import app

    rutas = [getattr(r, "path", "") for r in app.routes]

    assert all(not ruta.startswith("/static") for ruta in rutas)
    assert not any(getattr(r, "name", "") == "static" for r in app.routes)


def test_la_ruta_de_archivos_firmados_existe():
    from app.main import app

    rutas = [getattr(r, "path", "") for r in app.routes]

    assert "/archivos/{carpeta}/{nombre}" in rutas
