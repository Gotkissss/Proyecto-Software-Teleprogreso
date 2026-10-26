"""
Kardex de materiales contra PostgreSQL real (HU-S10-07, tareas 1 a 3).

El bloqueo de la fila (SELECT ... FOR UPDATE) solo se puede probar con una
base de verdad y dos transacciones a la vez.
"""
import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.core.exceptions import APIException
from app.db.session import AsyncSessionLocal
from app.models.activo import Activo, Material, MovimientoMaterial
from app.services import kardex
from tests.soporte_bd import encabezado, token_de

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]

_CREADOS: list[int] = []


@pytest_asyncio.fixture(autouse=True)
async def borrar_materiales(siembra):
    # Se borran antes que las tareas de `siembra`: el kardex se va con su
    # material (CASCADE) y una tarea con consumos no se puede borrar (RESTRICT).
    yield
    if _CREADOS:
        async with AsyncSessionLocal() as sesion:
            await sesion.execute(delete(Activo).where(Activo.id_activo.in_(_CREADOS)))
            await sesion.commit()
        _CREADOS.clear()


async def _material(cliente, supervisor, cantidad, unidad="m"):
    respuesta = await cliente.post(
        "/activos",
        json={
            "tipo": "material",
            "nombre_activo": f"Cable {uuid.uuid4().hex[:8]}",
            "cantidad_disponible": cantidad,
            "stock_minimo": 1,
            "unidad_medida": unidad,
        },
        headers=encabezado(token_de(supervisor)),
    )
    assert respuesta.status_code == 201, respuesta.text
    _CREADOS.append(respuesta.json()["id_activo"])
    return respuesta.json()["id_activo"]


async def _estado(id_material):
    async with AsyncSessionLocal() as sesion:
        stock = (
            await sesion.execute(select(Material.cantidad_disponible).where(Material.id_activo == id_material))
        ).scalar_one()
        movimientos = (
            await sesion.execute(
                select(MovimientoMaterial)
                .where(MovimientoMaterial.id_material == id_material)
                .order_by(MovimientoMaterial.id_movimiento)
            )
        ).scalars().all()
    return stock, movimientos


# --- Alta y edición (tarea 2) -------------------------------------------------------

async def test_el_stock_inicial_entra_como_primer_movimiento(cliente, supervisor):
    id_material = await _material(cliente, supervisor, 40)

    stock, movimientos = await _estado(id_material)

    assert stock == 40
    assert [(m.tipo, m.cantidad, m.saldo_resultante, m.motivo, m.id_empleado) for m in movimientos] == [
        ("entrada", 40, 40, kardex.MOTIVO_ALTA, supervisor.id_empleado)
    ]


async def test_un_material_que_nace_en_cero_no_tiene_movimientos(cliente, supervisor):
    id_material = await _material(cliente, supervisor, 0)

    assert await _estado(id_material) == (0, [])


async def test_la_cantidad_ya_no_se_edita_a_mano(cliente, supervisor):
    id_material = await _material(cliente, supervisor, 10)
    cabeceras = encabezado(token_de(supervisor))

    cambiada = await cliente.patch(f"/activos/{id_material}", json={"cantidad_disponible": 3}, headers=cabeceras)
    misma = await cliente.patch(
        f"/activos/{id_material}", json={"cantidad_disponible": 10, "stock_minimo": 4}, headers=cabeceras
    )

    assert cambiada.status_code == 400
    assert "kardex" in cambiada.json()["detail"]
    # Reenviar la que ya tiene no es un cambio: el modal manda el formulario entero.
    assert misma.status_code == 200, misma.text
    assert misma.json()["stock_minimo"] == 4
    assert (await _estado(id_material))[0] == 10


# --- Reglas del servicio (tarea 2) ------------------------------------------------------

@pytest.mark.parametrize(
    "tipo, cantidad, motivo, con_tarea",
    [
        ("entrada", 0, None, False),
        ("entrada", -1, None, False),
        ("consumo", -1, None, False),
        ("consumo", 2, None, True),
        ("ajuste", 2, "   ", False),
        ("regalo", 2, None, False),
    ],
)
async def test_un_movimiento_sin_sentido_es_400(cliente, siembra, supervisor, tecnico_a, tipo, cantidad, motivo, con_tarea):
    id_material = await _material(cliente, supervisor, 10)
    tarea = await siembra.tarea(tecnico_a, "Tarea kardex") if con_tarea else None

    async with AsyncSessionLocal() as sesion:
        with pytest.raises(APIException) as error:
            await kardex.registrar_movimiento(
                sesion, id_material, tipo, cantidad,
                id_empleado=supervisor.id_empleado, motivo=motivo,
                id_tarea=tarea.id_tarea if tarea else None,
            )

    assert error.value.status_code == 400


async def test_un_ajuste_con_motivo_puede_restar(cliente, supervisor):
    id_material = await _material(cliente, supervisor, 10)

    async with AsyncSessionLocal() as sesion:
        await kardex.registrar_movimiento(
            sesion, id_material, "ajuste", -4, id_empleado=supervisor.id_empleado, motivo="Conteo físico"
        )
        await sesion.commit()

    stock, movimientos = await _estado(id_material)
    assert stock == 6
    assert (movimientos[-1].tipo, movimientos[-1].cantidad, movimientos[-1].saldo_resultante) == ("ajuste", -4, 6)


async def test_sacar_mas_de_lo_que_hay_es_409_y_no_toca_el_stock(cliente, siembra, supervisor, tecnico_a):
    id_material = await _material(cliente, supervisor, 5, unidad="m")
    tarea = await siembra.tarea(tecnico_a, "Tarea kardex")

    async with AsyncSessionLocal() as sesion:
        with pytest.raises(APIException) as error:
            await kardex.consumir_en_tarea(
                sesion, tarea.id_tarea, [kardex.Consumo(id_material, 6)], id_empleado=tecnico_a.id_empleado
            )

    assert error.value.status_code == 409
    assert "quedan 5 m" in error.value.detail
    assert (await _estado(id_material))[0] == 5


async def test_un_material_repetido_se_descuenta_en_un_solo_movimiento(cliente, siembra, supervisor, tecnico_a):
    id_material = await _material(cliente, supervisor, 10)
    tarea = await siembra.tarea(tecnico_a, "Tarea kardex")

    async with AsyncSessionLocal() as sesion:
        await kardex.consumir_en_tarea(
            sesion, tarea.id_tarea,
            [kardex.Consumo(id_material, 2), kardex.Consumo(id_material, 3)],
            id_empleado=tecnico_a.id_empleado,
        )
        await sesion.commit()

    stock, movimientos = await _estado(id_material)
    assert stock == 5
    assert [(m.tipo, m.cantidad, m.id_tarea) for m in movimientos[1:]] == [("consumo", -5, tarea.id_tarea)]


async def test_dos_consumos_a_la_vez_no_dejan_el_stock_negativo(cliente, siembra, supervisor, tecnico_a, tecnico_b):
    id_material = await _material(cliente, supervisor, 5)
    tarea_a = await siembra.tarea(tecnico_a, "Tarea kardex A")
    tarea_b = await siembra.tarea(tecnico_b, "Tarea kardex B")
    primero_bloqueo = asyncio.Event()

    async def consumir(tarea, tecnico, esperar):
        async with AsyncSessionLocal() as sesion:
            if esperar:
                await primero_bloqueo.wait()
            try:
                await kardex.consumir_en_tarea(
                    sesion, tarea.id_tarea, [kardex.Consumo(id_material, 3)], id_empleado=tecnico.id_empleado
                )
                if not esperar:
                    # Con la fila tomada, se deja pasar al otro y se tarda un
                    # poco en confirmar: el otro tiene que esperar al commit.
                    primero_bloqueo.set()
                    await asyncio.sleep(0.3)
                await sesion.commit()
                return "ok"
            except APIException as error:
                await sesion.rollback()
                return error.status_code

    resultados = await asyncio.gather(
        consumir(tarea_a, tecnico_a, esperar=False),
        consumir(tarea_b, tecnico_b, esperar=True),
    )

    assert sorted(map(str, resultados)) == ["409", "ok"]
    stock, movimientos = await _estado(id_material)
    assert stock == 2
    assert [m.tipo for m in movimientos] == ["entrada", "consumo"]


# --- Consumo al finalizar (tarea 3) ----------------------------------------------------

async def _tarea_lista_para_cerrar(cliente, siembra, tecnico):
    tarea = await siembra.tarea(tecnico, "Instalación con materiales", estado="en_progreso")
    respuesta = await cliente.post(
        f"/tareas/{tarea.id_tarea}/incidencias",
        json={"descripcion": "Se instaló la acometida", "finalizar_tarea": False},
        headers=encabezado(token_de(tecnico)),
    )
    assert respuesta.status_code == 201, respuesta.text
    return tarea


async def test_finalizar_con_materiales_los_descuenta_una_sola_vez(
    cliente, siembra, supervisor, tecnico_a, jornada_abierta_a
):
    id_material = await _material(cliente, supervisor, 10)
    tarea = await _tarea_lista_para_cerrar(cliente, siembra, tecnico_a)
    cuerpo = {"lat": 14.6, "lng": -90.5, "materiales": [{"id_material": id_material, "cantidad": 3}]}
    cabeceras = encabezado(token_de(tecnico_a))

    primera = await cliente.patch(f"/tareas/{tarea.id_tarea}/finalizar", json=cuerpo, headers=cabeceras)
    # El frontend reintenta el cierre si se pierde la respuesta.
    reintento = await cliente.patch(f"/tareas/{tarea.id_tarea}/finalizar", json=cuerpo, headers=cabeceras)

    assert primera.status_code == 200, primera.text
    assert primera.json()["estado_tarea"] == "completado"
    assert reintento.status_code == 200
    stock, movimientos = await _estado(id_material)
    assert stock == 7
    consumos = [m for m in movimientos if m.tipo == "consumo"]
    assert [(m.cantidad, m.id_tarea, m.id_empleado) for m in consumos] == [
        (-3, tarea.id_tarea, tecnico_a.id_empleado)
    ]


async def test_sin_stock_suficiente_la_tarea_no_se_cierra(
    cliente, siembra, supervisor, tecnico_a, jornada_abierta_a
):
    id_material = await _material(cliente, supervisor, 2)
    tarea = await _tarea_lista_para_cerrar(cliente, siembra, tecnico_a)

    respuesta = await cliente.patch(
        f"/tareas/{tarea.id_tarea}/finalizar",
        json={"materiales": [{"id_material": id_material, "cantidad": 5}]},
        headers=encabezado(token_de(tecnico_a)),
    )

    assert respuesta.status_code == 409
    assert "quedan 2" in respuesta.json()["detail"]
    tareas = await cliente.get("/tareas", headers=encabezado(token_de(tecnico_a)))
    estado = next(t["estado_tarea"] for t in tareas.json() if t["id_tarea"] == tarea.id_tarea)
    assert estado == "en_progreso"
    assert (await _estado(id_material))[0] == 2


async def test_finalizar_sin_cuerpo_sigue_funcionando(cliente, siembra, tecnico_a, jornada_abierta_a):
    tarea = await _tarea_lista_para_cerrar(cliente, siembra, tecnico_a)

    respuesta = await cliente.patch(
        f"/tareas/{tarea.id_tarea}/finalizar", headers=encabezado(token_de(tecnico_a))
    )

    assert respuesta.status_code == 200, respuesta.text


@pytest.mark.parametrize(
    "cuerpo",
    [
        {"lat": 14.6},                                          # ubicación a medias
        {"materiales": [{"id_material": 1, "cantidad": 0}]},    # cantidad 0
        {"materiales": [{"id_material": 1, "cantidad": 1}] * 31},  # demasiados
    ],
)
async def test_un_cuerpo_invalido_es_422(cliente, siembra, tecnico_a, jornada_abierta_a, cuerpo):
    tarea = await _tarea_lista_para_cerrar(cliente, siembra, tecnico_a)

    respuesta = await cliente.patch(
        f"/tareas/{tarea.id_tarea}/finalizar", json=cuerpo, headers=encabezado(token_de(tecnico_a))
    )

    assert respuesta.status_code == 422


async def test_el_tecnico_ve_que_materiales_declarar_sin_ver_el_stock(cliente, supervisor, tecnico_a):
    con_stock = await _material(cliente, supervisor, 4, unidad="u")
    agotado = await _material(cliente, supervisor, 0)

    respuesta = await cliente.get("/activos/materiales/para-consumo", headers=encabezado(token_de(tecnico_a)))

    assert respuesta.status_code == 200
    por_id = {m["id_activo"]: m for m in respuesta.json()}
    assert set(por_id[con_stock]) == {"id_activo", "nombre_activo", "unidad_medida"}
    assert por_id[con_stock]["unidad_medida"] == "u"
    assert agotado not in por_id


async def test_el_gerente_no_lista_materiales_para_consumo(cliente, gerente):
    respuesta = await cliente.get("/activos/materiales/para-consumo", headers=encabezado(token_de(gerente)))

    assert respuesta.status_code == 403
