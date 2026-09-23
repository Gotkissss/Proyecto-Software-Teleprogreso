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


def punto_wkt(lat: float, lng: float) -> str:
    """WKT para PostGIS; un POINT almacena longitud antes que latitud."""
    return f"SRID=4326;POINT({lng} {lat})"
