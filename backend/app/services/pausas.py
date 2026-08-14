"""
Catálogo de tipos de pausa.

El catálogo (qué pausas existen, cómo se llaman y cuánto pueden durar) vivía
escrito a mano en el router de descanso, así que ajustar la normativa de
Teleprogreso obligaba a modificar código y volver a desplegar. Ahora vive en
la tabla `tipo_pausa` y este módulo es el único punto que la lee.

Las funciones de lectura reciben el catálogo ya cargado en vez de consultarlo
ellas mismas: la serialización de pausas es síncrona y se ejecuta en bucle
sobre las pausas del día, así que una consulta por pausa sería un N+1.
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pausa import TipoPausa

# Tipo de pausa que se aplica cuando el cliente no manda ninguno. Se mantiene
# en código y no en BD porque es el comportamiento por defecto de la API, no
# un dato configurable de la operación.
TIPO_POR_DEFECTO = "personal"

# Valores de emergencia por si el catálogo estuviera vacío (base recién creada
# sin migrar). Evita que la pantalla de Pausas quede inutilizable.
LABEL_GENERICO = "Pausa"
DURACION_GENERICA_MIN = 15

# Estructura del catálogo: {id_tipo: {"label", "duracion_max_min", "orden"}}
Catalogo = dict[str, dict]


async def cargar_catalogo(db: AsyncSession, solo_activos: bool = True) -> Catalogo:
    """Lee los tipos de pausa de la BD, ordenados como se muestran en la UI."""
    query = select(TipoPausa).order_by(TipoPausa.orden, TipoPausa.id_tipo_pausa)
    if solo_activos:
        query = query.where(TipoPausa.activo.is_(True))

    result = await db.execute(query)

    return {
        tipo.id_tipo_pausa: {
            "label": tipo.label,
            "duracion_max_min": tipo.duracion_max_min,
            "orden": tipo.orden,
        }
        for tipo in result.scalars().all()
    }


def tipo_valido(catalogo: Catalogo, tipo: Optional[str]) -> str:
    """Normaliza el tipo recibido; cae al genérico si viene vacío o desconocido."""
    if tipo in catalogo:
        return tipo
    return TIPO_POR_DEFECTO


def label(catalogo: Catalogo, tipo: Optional[str]) -> str:
    return catalogo.get(tipo or "", {}).get("label", LABEL_GENERICO)


def duracion_max_min(catalogo: Catalogo, tipo: Optional[str]) -> int:
    return catalogo.get(tipo or "", {}).get("duracion_max_min", DURACION_GENERICA_MIN)
