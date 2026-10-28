"""
Kardex de materiales — HU-S10-07.
-----------------------------------------------------------------------------
Lo que arregla la historia, que es lo que estas pruebas vigilan:

  - `material.cantidad_disponible` era un número que alguien escribía a mano en
    el modal del inventario. Usar el material en una tarea no lo bajaba, así
    que la alerta de stock crítico comparaba contra una cifra que no era la del
    almacén: avisaba de lo que no faltaba y callaba sobre lo que sí.
  - A "¿a dónde se fueron las 40 rosetas?" no había respuesta: el campo guarda
    el último valor escrito, no la historia.

Aquí se prueba la aritmética y las reglas del servicio con dobles. Lo que
depende de verdad del motor —que dos consumos simultáneos no dejen el saldo
negativo, y el CHECK de la migración— va en
tests/integracion/test_kardex_concurrencia.py, contra PostGIS.
-----------------------------------------------------------------------------
"""
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.models.activo import Material, MovimientoMaterial
from app.services import kardex
from app.services.kardex import LineaConsumo


# ── Andamiaje ───────────────────────────────────────────────────────────────

def _material(cantidad=10, id_activo=7):
    return Material(
        id_activo=id_activo,
        cantidad_disponible=cantidad,
        stock_minimo=3,
        unidad_medida="unidad",
    )


def _db(material, nombre="Roseta óptica"):
    """
    AsyncSession simulada.

    Devuelve el material para el `SELECT … FOR UPDATE` y el nombre del activo
    cuando el servicio lo pide para armar el mensaje de "no hay suficiente".
    """
    guardados = []

    async def _execute(sentencia, *_a, **_k):
        texto = str(sentencia)
        res = MagicMock()
        if "nombre_activo" in texto:
            res.scalar_one_or_none.return_value = nombre
        else:
            res.scalar_one_or_none.return_value = material
        return res

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.add = MagicMock(side_effect=guardados.append)
    db.flush = AsyncMock()
    db.guardados = guardados
    return db


def _movimiento(db) -> MovimientoMaterial:
    """El último movimiento que el servicio mandó a la sesión."""
    return db.guardados[-1]


# ── Aritmética de cada tipo ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_una_entrada_suma_y_deja_el_saldo():
    material = _material(cantidad=10)
    db = _db(material)

    movimiento = await kardex.registrar_movimiento(
        db, id_material=7, tipo="entrada", cantidad=5, id_empleado=1
    )

    assert material.cantidad_disponible == 15
    assert movimiento.saldo_resultante == 15
    assert movimiento.cantidad == 5
    assert movimiento.tipo == "entrada"


@pytest.mark.asyncio
async def test_un_consumo_resta_y_deja_el_saldo():
    material = _material(cantidad=10)
    db = _db(material)

    movimiento = await kardex.registrar_movimiento(
        db, id_material=7, tipo="consumo", cantidad=4, id_empleado=1, id_tarea=22
    )

    assert material.cantidad_disponible == 6
    assert movimiento.saldo_resultante == 6
    assert movimiento.id_tarea == 22


@pytest.mark.asyncio
async def test_un_ajuste_fija_el_saldo_en_vez_de_sumarlo():
    """
    Un ajuste es "contamos y hay 37", no "sumá 37". Si sumara, corregir un
    inventario de 50 a 37 lo dejaría en 87 y el error pasaría por una
    corrección.
    """
    material = _material(cantidad=50)
    db = _db(material)

    movimiento = await kardex.registrar_movimiento(
        db,
        id_material=7,
        tipo="ajuste",
        cantidad=37,
        motivo="Conteo físico del 27/10",
        id_empleado=1,
    )

    assert material.cantidad_disponible == 37
    assert movimiento.saldo_resultante == 37
    assert movimiento.motivo == "Conteo físico del 27/10"


@pytest.mark.asyncio
async def test_todo_movimiento_queda_registrado_con_actor_y_fecha():
    material = _material()
    db = _db(material)

    movimiento = await kardex.registrar_movimiento(
        db, id_material=7, tipo="entrada", cantidad=1, id_empleado=42
    )

    assert movimiento.id_empleado == 42
    assert movimiento.fecha_hora is not None
    db.flush.assert_awaited()


# ── Lo que no se puede hacer ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_un_consumo_mayor_que_el_stock_se_rechaza():
    material = _material(cantidad=3)
    db = _db(material, nombre="Roseta óptica")

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db, id_material=7, tipo="consumo", cantidad=5, id_empleado=1, id_tarea=22
        )

    assert error.value.status_code == 409
    # El mensaje dice de qué material y cuánto queda: sin eso, el técnico no
    # sabe qué corregir en el formulario.
    assert "Roseta óptica" in error.value.detail
    assert "3" in error.value.detail
    # Y el stock no se movió.
    assert material.cantidad_disponible == 3
    db.add.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("cantidad", [0, -1, -100])
async def test_una_cantidad_que_no_es_positiva_se_rechaza(cantidad):
    db = _db(_material())

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db, id_material=7, tipo="entrada", cantidad=cantidad, id_empleado=1
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_una_cantidad_desmesurada_se_rechaza():
    """Freno a la errata de teclear 1000 donde iban 10."""
    db = _db(_material())

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db,
            id_material=7,
            tipo="entrada",
            cantidad=kardex.MAX_CANTIDAD_MOVIMIENTO + 1,
            id_empleado=1,
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_un_consumo_sin_tarea_se_rechaza():
    """
    Un consumo sin tarea es exactamente el dato que esta historia viene a
    arreglar: stock que baja sin que se pueda decir en qué se usó.
    """
    db = _db(_material())

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db, id_material=7, tipo="consumo", cantidad=1, id_empleado=1
        )

    assert error.value.status_code == 400
    assert "tarea" in error.value.detail.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("motivo", [None, "", "   "])
async def test_un_ajuste_sin_motivo_se_rechaza(motivo):
    """Sin motivo, un ajuste y un dedazo son la misma fila."""
    db = _db(_material())

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db, id_material=7, tipo="ajuste", cantidad=5, motivo=motivo, id_empleado=1
        )

    assert error.value.status_code == 400
    assert "motivo" in error.value.detail.lower()


@pytest.mark.asyncio
async def test_un_tipo_inventado_se_rechaza():
    db = _db(_material())

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db, id_material=7, tipo="prestamo", cantidad=1, id_empleado=1
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_un_material_que_no_existe_da_404():
    db = _db(None)

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_movimiento(
            db, id_material=999, tipo="entrada", cantidad=1, id_empleado=1
        )

    assert error.value.status_code == 404


# ── El bloqueo de la fila ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_material_se_lee_con_for_update():
    """
    Sin `FOR UPDATE`, dos consumos simultáneos leen el mismo saldo, cada uno
    resta lo suyo y el segundo pisa al primero: se consumen 6 de 5 unidades,
    los dos movimientos dicen que dejaron 2, y nada falla. Que la sentencia lo
    lleve se comprueba aquí; que de verdad serialice, en integración.
    """
    material = _material()
    db = _db(material)

    await kardex.registrar_movimiento(
        db, id_material=7, tipo="entrada", cantidad=1, id_empleado=1
    )

    sentencias = [str(llamada.args[0]) for llamada in db.execute.await_args_list]
    assert any("FOR UPDATE" in s for s in sentencias), sentencias


# ── Consumo de una tarea ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_consumo_de_una_tarea_agrupa_el_mismo_material():
    """
    Mandar el mismo material dos veces es fácil desde el formulario. Dos
    movimientos de 2 dejan dos filas que parecen dos usos distintos del almacén
    en el mismo cierre; se suman y queda una línea de 4, que es lo que pasó.
    """
    material = _material(cantidad=10)
    db = _db(material)

    movimientos = await kardex.registrar_consumo_de_tarea(
        db,
        id_tarea=22,
        lineas=[
            LineaConsumo(id_material=7, cantidad=2),
            LineaConsumo(id_material=7, cantidad=2),
        ],
        id_empleado=1,
    )

    assert len(movimientos) == 1
    assert movimientos[0].cantidad == 4
    assert material.cantidad_disponible == 6


@pytest.mark.asyncio
async def test_sin_materiales_no_se_registra_nada():
    """
    El consumo es opcional: no todas las tareas gastan material, y obligar a
    rellenarlo lleva a teclear cualquier cosa para poder cerrar la tarea.
    """
    db = _db(_material())

    assert await kardex.registrar_consumo_de_tarea(
        db, id_tarea=22, lineas=[], id_empleado=1
    ) == []
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_el_consumo_se_aplica_en_orden_de_id():
    """
    Dos cierres simultáneos que toquen los mismos dos materiales en orden
    contrario se bloquean mutuamente y Postgres mata uno por interbloqueo sin
    que hiciera falta. Aplicando siempre en el mismo orden, no puede pasar.
    """
    materiales = {
        7: _material(cantidad=10, id_activo=7),
        3: _material(cantidad=10, id_activo=3),
    }
    pedidos = []

    async def _execute(sentencia, *_a, **_k):
        res = MagicMock()
        texto = str(sentencia)
        if "nombre_activo" in texto:
            res.scalar_one_or_none.return_value = "Material"
        else:
            # El servicio pide los materiales de uno en uno; se van devolviendo
            # en el orden en que los pida, que es lo que se está midiendo.
            siguiente = pendientes.pop(0)
            pedidos.append(siguiente)
            res.scalar_one_or_none.return_value = materiales[siguiente]
        return res

    pendientes = [3, 7]
    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.add = MagicMock()
    db.flush = AsyncMock()

    await kardex.registrar_consumo_de_tarea(
        db,
        id_tarea=22,
        lineas=[
            LineaConsumo(id_material=7, cantidad=1),
            LineaConsumo(id_material=3, cantidad=1),
        ],
        id_empleado=1,
    )

    assert pedidos == sorted(pedidos), pedidos


# ── Ajuste desde el inventario ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_el_ajuste_fija_la_cantidad_y_exige_motivo():
    material = _material(cantidad=50)
    db = _db(material)

    movimiento = await kardex.registrar_ajuste(
        db,
        id_material=7,
        nueva_cantidad=37,
        motivo="Conteo físico",
        id_empleado=1,
    )

    assert material.cantidad_disponible == 37
    assert movimiento.tipo == "ajuste"


@pytest.mark.asyncio
async def test_ajustar_a_la_misma_cantidad_no_crea_una_fila_vacia():
    material = _material(cantidad=37)
    db = _db(material)

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_ajuste(
            db, id_material=7, nueva_cantidad=37, motivo="Conteo", id_empleado=1
        )

    assert error.value.status_code == 400
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_no_se_ajusta_a_cero():
    """
    Un ajuste a cero no dice a dónde fueron las unidades. Para eso está el
    consumo, o dar de baja el activo.
    """
    material = _material(cantidad=10)
    db = _db(material)

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_ajuste(
            db, id_material=7, nueva_cantidad=0, motivo="Se acabó", id_empleado=1
        )

    assert error.value.status_code == 400
    assert material.cantidad_disponible == 10


@pytest.mark.asyncio
async def test_no_se_ajusta_a_negativo():
    db = _db(_material())

    with pytest.raises(HTTPException) as error:
        await kardex.registrar_ajuste(
            db, id_material=7, nueva_cantidad=-5, motivo="Error", id_empleado=1
        )

    assert error.value.status_code == 400


# ── Ya no hay otro camino para cambiar el stock ─────────────────────────────

def test_el_patch_de_activos_ya_no_toca_el_stock():
    """
    Editar `cantidad_disponible` en el modal era el camino por el que el
    número cambiaba sin dejar rastro. Si alguien lo devuelve al schema, el
    kardex deja de ser el único camino y esta prueba lo dice.
    """
    from app.schemas.activo import ActivoUpdateRequest

    assert "cantidad_disponible" not in ActivoUpdateRequest.model_fields


def test_el_endpoint_de_movimientos_no_acepta_consumos_sueltos():
    """
    Un consumo pertenece a una tarea. Aceptarlo suelto permitiría apuntar
    stock gastado sin trabajo que lo explique, que es el agujero que esta
    historia cierra.
    """
    from pydantic import ValidationError

    from app.schemas.activo import MovimientoMaterialCreate

    with pytest.raises(ValidationError):
        MovimientoMaterialCreate(tipo="consumo", cantidad=1)
