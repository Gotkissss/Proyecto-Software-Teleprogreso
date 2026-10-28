"""
El kardex contra PostgreSQL real — HU-S10-07.
-----------------------------------------------------------------------------
Lo que no se puede probar con dobles:

1. **Dos consumos simultáneos del mismo material.** Sin `FOR UPDATE`, las dos
   transacciones leen el mismo saldo, cada una resta lo suyo y la segunda pisa
   a la primera: se consumen 6 de 5 unidades, los dos movimientos dicen que
   dejaron 2, y nada falla. Con dobles no se reproduce, porque no hay dos
   transacciones de verdad. Aquí sí.

2. **El CHECK de la migración 0012.** Es la red de debajo, para un UPDATE que
   entre por fuera de la API. Comprobarlo exige el motor.

3. **Que la alerta de stock crítico se dispare por un consumo**, que es el
   motivo por el que existe la historia: antes vigilaba un número que el
   trabajo no movía.
-----------------------------------------------------------------------------
"""
import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError

from app.db.session import AsyncSessionLocal
from app.models.activo import Activo, Material, MovimientoMaterial
from app.services import kardex
from app.services.alertas import TIPO_STOCK_CRITICO, generar_alertas
from app.services.kardex import LineaConsumo
from app.models.alerta import Alerta

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]


async def _crear_material(cantidad: int, minimo: int = 0) -> int:
    """Material recién creado, con su activo. Devuelve su id."""
    async with AsyncSessionLocal() as sesion:
        activo = Activo(
            nombre_activo=f"Roseta {uuid.uuid4().hex[:8]}",
            tipo="material",
        )
        sesion.add(activo)
        await sesion.flush()
        sesion.add(
            Material(
                id_activo=activo.id_activo,
                cantidad_disponible=cantidad,
                stock_minimo=minimo,
                unidad_medida="unidad",
            )
        )
        await sesion.commit()
        return activo.id_activo


async def _borrar_material(id_material: int) -> None:
    async with AsyncSessionLocal() as sesion:
        await sesion.execute(delete(Activo).where(Activo.id_activo == id_material))
        await sesion.commit()


async def _saldo(id_material: int) -> int:
    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            select(Material.cantidad_disponible).where(
                Material.id_activo == id_material
            )
        )
        return resultado.scalar_one()


@pytest_asyncio.fixture
async def material_con_5():
    id_material = await _crear_material(cantidad=5)
    yield id_material
    await _borrar_material(id_material)


# ── 1. Concurrencia ─────────────────────────────────────────────────────────

async def _consumir(id_material: int, cantidad: int, id_tarea=None):
    """
    Un consumo en su propia transacción, como lo haría una petición.

    Devuelve el código del error si el almacén no dio, o None si pasó.
    """
    async with AsyncSessionLocal() as sesion:
        try:
            await kardex.registrar_movimiento(
                sesion,
                id_material=id_material,
                tipo=kardex.TIPO_CONSUMO,
                cantidad=cantidad,
                id_empleado=None,
                id_tarea=id_tarea,
            )
            await sesion.commit()
            return None
        except Exception as error:
            await sesion.rollback()
            return getattr(error, "status_code", type(error).__name__)


async def test_dos_consumos_simultaneos_no_dejan_el_saldo_negativo(
    material_con_5, siembra, tecnico_a
):
    """
    Dos técnicos cierran su tarea en el mismo instante y cada uno gasta 3 de
    las 5 unidades que hay. Uno de los dos tiene que recibir 409; si los dos
    pasaran, el almacén quedaría en -1 (o en 2, mintiendo) y nadie se
    enteraría.
    """
    tarea_1 = await siembra.tarea(tecnico_a, "Consumo simultáneo 1")
    tarea_2 = await siembra.tarea(tecnico_a, "Consumo simultáneo 2")

    resultados = await asyncio.gather(
        _consumir(material_con_5, 3, tarea_1.id_tarea),
        _consumir(material_con_5, 3, tarea_2.id_tarea),
    )

    exitos = [r for r in resultados if r is None]
    rechazos = [r for r in resultados if r is not None]

    assert len(exitos) == 1, resultados
    assert rechazos == [409], resultados
    assert await _saldo(material_con_5) == 2


async def test_varios_consumos_en_paralelo_cuadran_con_el_kardex(
    material_con_5, siembra, tecnico_a
):
    """
    Cinco consumos de 1 sobre 5 unidades: los cinco caben, el saldo acaba en 0
    y el último movimiento lo dice. Es la comprobación de que `FOR UPDATE`
    serializa en vez de perder escrituras: sin él, alguno de los cinco leería
    un saldo ya obsoleto y el total no cuadraría.
    """
    tareas = [
        await siembra.tarea(tecnico_a, f"Consumo paralelo {i}") for i in range(5)
    ]

    resultados = await asyncio.gather(
        *(_consumir(material_con_5, 1, t.id_tarea) for t in tareas)
    )

    assert resultados == [None] * 5, resultados
    assert await _saldo(material_con_5) == 0

    async with AsyncSessionLocal() as sesion:
        filas = await sesion.execute(
            select(MovimientoMaterial.saldo_resultante)
            .where(MovimientoMaterial.id_material == material_con_5)
            .order_by(MovimientoMaterial.id_movimiento)
        )
        saldos = [s for (s,) in filas]

    # Cada movimiento dejó un saldo distinto y van bajando de uno en uno: si
    # dos hubieran leído el mismo saldo, aquí habría un número repetido.
    assert saldos == [4, 3, 2, 1, 0], saldos


# ── 2. El CHECK de la base ──────────────────────────────────────────────────

async def test_la_base_rechaza_un_stock_negativo_puesto_por_fuera(material_con_5):
    """
    El servicio ya lo impide, pero un UPDATE hecho con psql o por un script no
    pasa por el servicio. El CHECK de la 0012 es lo que queda debajo.
    """
    async with AsyncSessionLocal() as sesion:
        with pytest.raises(IntegrityError) as error:
            await sesion.execute(
                text(
                    "UPDATE material SET cantidad_disponible = -1 "
                    "WHERE id_activo = :id"
                ),
                {"id": material_con_5},
            )
            await sesion.commit()
        await sesion.rollback()

    assert "ck_material_cantidad_no_negativa" in str(error.value)
    assert await _saldo(material_con_5) == 5


async def test_un_consumo_sin_tarea_lo_frena_el_servicio_y_no_la_base():
    """
    La base NO lleva un CHECK de "un consumo nombra su tarea", y es a
    propósito: `id_tarea` es ON DELETE SET NULL, así que borrar una tarea
    pondría el campo en NULL y el CHECK rechazaría ese mismo UPDATE — una
    tarea con consumo registrado no se podría borrar nunca.

    Son reglas de momentos distintos: "nace con tarea" se comprueba al crear
    el movimiento, y eso lo hace el servicio. Esta prueba fija la frontera,
    para que nadie vuelva a añadir el CHECK sin saber qué rompe (ver la nota en
    la migración 0012).
    """
    from app.core.exceptions import APIException

    id_material = await _crear_material(cantidad=5)
    try:
        async with AsyncSessionLocal() as sesion:
            with pytest.raises(APIException) as error:
                await kardex.registrar_movimiento(
                    sesion,
                    id_material=id_material,
                    tipo=kardex.TIPO_CONSUMO,
                    cantidad=1,
                    id_empleado=None,
                )
            await sesion.rollback()

        assert error.value.status_code == 400
        assert await _saldo(id_material) == 5
    finally:
        await _borrar_material(id_material)


async def test_la_base_rechaza_un_ajuste_sin_motivo(material_con_5):
    async with AsyncSessionLocal() as sesion:
        with pytest.raises(IntegrityError) as error:
            await sesion.execute(
                text(
                    "INSERT INTO movimiento_material "
                    "(id_material, tipo, cantidad, saldo_resultante, motivo) "
                    "VALUES (:id, 'ajuste', 3, 3, '   ')"
                ),
                {"id": material_con_5},
            )
            await sesion.commit()
        await sesion.rollback()

    assert "ck_movimiento_ajuste_con_motivo" in str(error.value)


async def test_la_base_rechaza_un_tipo_inventado(material_con_5):
    async with AsyncSessionLocal() as sesion:
        with pytest.raises(IntegrityError) as error:
            await sesion.execute(
                text(
                    "INSERT INTO movimiento_material "
                    "(id_material, tipo, cantidad, saldo_resultante) "
                    "VALUES (:id, 'prestamo', 1, 4)"
                ),
                {"id": material_con_5},
            )
            await sesion.commit()
        await sesion.rollback()

    assert "ck_movimiento_tipo" in str(error.value)


# ── 3. La alerta se dispara por un consumo ──────────────────────────────────

async def test_un_consumo_dispara_la_alerta_de_stock_critico(siembra, tecnico_a):
    """
    El motivo de ser de la historia. Antes la alerta comparaba contra un número
    que el trabajo no movía: un material que se agotaba en campo seguía
    apareciendo con stock de sobra, y la alerta no saltaba hasta que alguien se
    acordaba de editar la cifra a mano.
    """
    id_material = await _crear_material(cantidad=10, minimo=5)
    tarea = await siembra.tarea(tecnico_a, "Consumo que agota el material")
    referencia = f"material:{id_material}"

    try:
        # De salida está por encima del mínimo: no hay alerta que valga.
        async with AsyncSessionLocal() as sesion:
            await generar_alertas(sesion)
            await sesion.commit()
        assert await _alertas_de(referencia) == 0

        # El técnico gasta 6 de 10: queda en 4, por debajo del mínimo de 5.
        assert await _consumir(id_material, 6, tarea.id_tarea) is None
        assert await _saldo(id_material) == 4

        async with AsyncSessionLocal() as sesion:
            await generar_alertas(sesion)
            await sesion.commit()
        assert await _alertas_de(referencia) == 1
    finally:
        async with AsyncSessionLocal() as sesion:
            await sesion.execute(
                delete(Alerta).where(Alerta.referencia == referencia)
            )
            await sesion.commit()
        await _borrar_material(id_material)


async def _alertas_de(referencia: str) -> int:
    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            select(func.count())
            .select_from(Alerta)
            .where(
                Alerta.referencia == referencia,
                Alerta.tipo == TIPO_STOCK_CRITICO,
            )
        )
        return resultado.scalar_one()


# ── 4. El saldo del kardex cuadra con el material ───────────────────────────

async def test_el_ultimo_saldo_del_kardex_es_el_del_material(
    material_con_5, siembra, tecnico_a
):
    """
    `saldo_resultante` se guarda en vez de recalcularse sumando la historia.
    Esa decisión solo se sostiene si las dos cifras no se separan nunca: si lo
    hicieran, el kardex contaría una cosa y el inventario otra, y no habría
    forma de saber cuál creer.
    """
    tarea = await siembra.tarea(tecnico_a, "Mezcla de movimientos")

    async with AsyncSessionLocal() as sesion:
        await kardex.registrar_movimiento(
            sesion,
            id_material=material_con_5,
            tipo=kardex.TIPO_ENTRADA,
            cantidad=20,
            id_empleado=None,
        )
        await sesion.commit()

    assert await _consumir(material_con_5, 7, tarea.id_tarea) is None

    async with AsyncSessionLocal() as sesion:
        await kardex.registrar_ajuste(
            sesion,
            id_material=material_con_5,
            nueva_cantidad=15,
            motivo="Conteo físico",
            id_empleado=None,
        )
        await sesion.commit()

    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            select(MovimientoMaterial.saldo_resultante)
            .where(MovimientoMaterial.id_material == material_con_5)
            .order_by(MovimientoMaterial.id_movimiento.desc())
            .limit(1)
        )
        ultimo = resultado.scalar_one()

    assert ultimo == 15
    assert await _saldo(material_con_5) == 15


async def test_el_historial_sobrevive_a_que_borren_la_tarea(
    material_con_5, siembra, tecnico_a
):
    """
    La tarea se borra y el movimiento se queda con `id_tarea` en NULL: el
    material se gastó igual, y el saldo que dejó es el punto de partida de la
    fila siguiente. Reescribir o borrar el movimiento descuadraría todo lo que
    vino después.
    """
    from app.models.tarea import Tarea

    tarea = await siembra.tarea(tecnico_a, "Tarea que se borra")
    assert await _consumir(material_con_5, 2, tarea.id_tarea) is None

    async with AsyncSessionLocal() as sesion:
        await sesion.execute(delete(Tarea).where(Tarea.id_tarea == tarea.id_tarea))
        await sesion.commit()

    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            select(MovimientoMaterial.id_tarea, MovimientoMaterial.saldo_resultante)
            .where(MovimientoMaterial.id_material == material_con_5)
        )
        filas = resultado.all()

    assert len(filas) == 1
    assert filas[0][0] is None
    assert filas[0][1] == 3
    assert await _saldo(material_con_5) == 3
