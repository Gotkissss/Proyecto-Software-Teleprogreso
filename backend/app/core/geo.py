# backend/app/core/geo.py
"""
Puntos geográficos para PostGIS — Teleprogreso S.A.
-----------------------------------------------------------------------------
Aquí vive la única forma en que la aplicación escribe una coordenada hacia la
base de datos. Antes esta conversión era una función privada de
services/tareas.py; al aparecer el reporte de ubicación del técnico
(SCRUM-216) habría hecho falta una segunda copia, y una copia es justo lo
peligroso en este caso concreto:

  · WKT escribe el punto como POINT(x y), es decir LONGITUD primero y LATITUD
    después, al revés de como las nombra todo el mundo ("lat, lng") y al revés
    de como las entrega el navegador. Invertirlas no produce ningún error: el
    punto se guarda, la petición responde 200 y el marcador aparece en otro
    continente. Una sola definición compartida evita que una copia quede bien
    y la otra mal.
  · El SRID 4326 (WGS84, el de los GPS) tiene que ser el mismo que declaran
    las columnas Geography; si una parte del código escribiera con otro, las
    distancias saldrían mal sin avisar.

La función devuelve texto porque es el valor de la columna, no SQL: geoalchemy2
lo entrega a PostgreSQL como parámetro ligado del ORM, así que ese texto nunca
se concatena dentro de una sentencia.
-----------------------------------------------------------------------------
"""

import struct
from typing import Optional, Tuple

# Códigos de WKB/EWKB que usa lat_lng_de para reconocer un POINT.
_WKB_POINT = 1
_EWKB_CON_SRID = 0x20000000


def punto_wkt(lat: float, lng: float) -> str:
    """WKT para PostGIS; un POINT almacena longitud antes que latitud."""
    return f"SRID=4326;POINT({lng} {lat})"


def lat_lng_de(valor) -> Optional[Tuple[float, float]]:
    """
    (lat, lng) de un punto leído de una columna Geography, o None.

    Al cargar un modelo, geoalchemy2 entrega la columna como WKBElement: el
    punto en binario (WKB) tal como lo devuelve ST_AsBinary. Se decodifica
    aquí, sin shapely, porque un POINT es fijo y simple:

        1 byte  orden de bytes (1 = little endian, 0 = big endian)
        4 bytes tipo de geometría (1 = POINT; con el bit 0x20000000 lleva SRID)
        4 bytes SRID, solo si el bit anterior está encendido (EWKB)
        8 bytes X = LONGITUD
        8 bytes Y = LATITUD

    Igual que al escribir, X es la longitud: se devuelve (lat, lng) ya en el
    orden en que las usa el resto de la aplicación.
    """
    if valor is None:
        return None

    datos = getattr(valor, "data", valor)
    if isinstance(datos, str):
        datos = bytes.fromhex(datos)
    datos = bytes(datos)

    if len(datos) < 21:
        return None

    orden = "<" if datos[0] == 1 else ">"
    (tipo,) = struct.unpack_from(f"{orden}I", datos, 1)
    desplazamiento = 5
    if tipo & _EWKB_CON_SRID:
        desplazamiento += 4
    if (tipo & 0xFF) != _WKB_POINT or len(datos) < desplazamiento + 16:
        return None

    lng, lat = struct.unpack_from(f"{orden}dd", datos, desplazamiento)
    return lat, lng
