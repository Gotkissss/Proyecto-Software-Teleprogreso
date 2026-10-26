"""
Ancla externa del final de la bitácora contra PostgreSQL real (HU-S10-05, tarea 4).

Es la prueba del hueco que el ancla viene a cerrar: un superusuario borra las
últimas filas, la cadena que queda sigue cuadrando y solo el ancla lo nota.
Las filas que se borran son las que la propia prueba acaba de insertar, al
final de la tabla, así que el resto de la cadena queda íntegro.
"""
import asyncio
import re

import pytest
from sqlalchemy import text

import mantenimiento
from app.db.session import engine

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]


async def _insertar(veces=2):
    async with engine.begin() as conexion:
        for _ in range(veces):
            await conexion.execute(
                text("INSERT INTO bitacora_auditoria (accion, entidad) VALUES ('leer', 'prueba_ancla')")
            )


async def _comando(capsys, *argumentos):
    capsys.readouterr()
    codigo = await asyncio.to_thread(mantenimiento.main, list(argumentos))
    salida = capsys.readouterr()
    return codigo, salida.out + salida.err


async def _anclar(capsys):
    codigo, salida = await _comando(capsys, "anclar")
    assert codigo == 0, salida
    encontrado = re.search(r"id=(\d+) hash=([0-9a-f]{64})", salida)
    assert encontrado, salida
    return int(encontrado.group(1)), encontrado.group(2)


async def _como_superusuario(sentencia, parametros):
    # Solo el propietario puede apagar el trigger: así se simula a alguien con
    # acceso de administrador a la base borrando por fuera de la API.
    async with engine.begin() as conexion:
        await conexion.execute(
            text("ALTER TABLE bitacora_auditoria DISABLE TRIGGER trg_bitacora_auditoria_inmutable")
        )
        try:
            await conexion.execute(text(sentencia), parametros)
        finally:
            await conexion.execute(
                text("ALTER TABLE bitacora_auditoria ENABLE TRIGGER trg_bitacora_auditoria_inmutable")
            )


async def test_el_ancla_recien_tomada_se_comprueba_bien(capsys):
    await _insertar()
    id_ancla, hash_ancla = await _anclar(capsys)

    codigo, salida = await _comando(capsys, "verificar-bitacora", "--ancla", f"{id_ancla}:{hash_ancla}")

    assert codigo == 0, salida
    assert f"Ancla #{id_ancla} presente" in salida


async def test_borrar_el_final_de_la_bitacora_solo_lo_detecta_el_ancla(capsys):
    await _insertar()
    id_ancla, hash_ancla = await _anclar(capsys)

    await _como_superusuario("DELETE FROM bitacora_auditoria WHERE id_bitacora >= :id", {"id": id_ancla})

    # La cadena que queda sigue cuadrando: este es el hueco.
    codigo_sin_ancla, salida = await _comando(capsys, "verificar-bitacora")
    assert codigo_sin_ancla == 0, salida
    codigo, salida = await _comando(capsys, "verificar-bitacora", "--ancla", f"{id_ancla}:{hash_ancla}")
    assert codigo == 1
    assert "FALTAN FILAS" in salida


async def test_un_ancla_con_otro_hash_no_cuadra(capsys):
    await _insertar()
    id_ancla, _ = await _anclar(capsys)

    codigo, salida = await _comando(capsys, "verificar-bitacora", "--ancla", f"{id_ancla}:{'0' * 64}")

    assert codigo == 1
    assert "ANCLA NO CUADRA" in salida
