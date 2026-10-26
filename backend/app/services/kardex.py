"""
Kardex de materiales — Teleprogreso S.A. (HU-S10-07)
-----------------------------------------------------------------------------
El único camino para cambiar `material.cantidad_disponible`. Cada cambio deja
un `MovimientoMaterial` con la cantidad (con signo), el saldo que quedó, el
motivo, la tarea y quién lo hizo, así que el stock siempre se puede explicar
movimiento a movimiento.

Concurrencia: dos técnicos cerrando a la vez tareas que usan el mismo material
leerían el mismo stock y podrían dejarlo negativo. Por eso cada movimiento toma
la fila del material con SELECT ... FOR UPDATE hasta el commit, y un consumo de
varios materiales los bloquea en orden de id, para que dos cierres no se
esperen el uno al otro en círculo.

Tipos:
  - entrada: llega stock (alta del material, compra). Suma.
  - consumo: lo usó una tarea al cerrarse. Resta, y siempre lleva la tarea.
  - ajuste:  corrección con motivo obligatorio (conteo físico, merma). Suma o
             resta.
-----------------------------------------------------------------------------
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, conflict, not_found
from app.core.tiempo import ahora as ahora_local
from app.models.activo import Activo, Material, MovimientoMaterial

TIPO_ENTRADA = "entrada"
TIPO_CONSUMO = "consumo"
TIPO_AJUSTE = "ajuste"
TIPOS_MOVIMIENTO = (TIPO_ENTRADA, TIPO_CONSUMO, TIPO_AJUSTE)

MOTIVO_ALTA = "Alta del material"


@dataclass(frozen=True)
class Consumo:
    """Un material usado en una tarea: cuánto (en su unidad) y cuál."""
    id_material: int
    cantidad: int


async def _material_bloqueado(db: AsyncSession, id_material: int) -> tuple[Material, str]:
    """
    La fila del material, bloqueada hasta el commit, y su nombre (para los
    mensajes). `populate_existing`: si la sesión ya tenía el material cargado,
    se relee el stock que hay ahora en la base y no el de antes del bloqueo.
    """
    fila = (
        await db.execute(
            select(Material, Activo.nombre_activo)
            .join(Activo, Activo.id_activo == Material.id_activo)
            .where(Material.id_activo == id_material)
            .with_for_update(of=Material)
            .execution_options(populate_existing=True)
        )
    ).first()
    if fila is None:
        raise not_found(f"Material con id={id_material} no encontrado.")
    return fila[0], fila[1]


async def registrar_movimiento(
    db: AsyncSession,
    id_material: int,
    tipo: str,
    cantidad: int,
    *,
    id_empleado: int | None,
    motivo: str | None = None,
    id_tarea: int | None = None,
) -> MovimientoMaterial:
    """
    Aplica un movimiento al stock y lo deja en el kardex. `cantidad` lleva
    signo: positiva suma, negativa resta.

    Errores: 400 si el movimiento no tiene sentido (cantidad 0, una entrada que
    resta, un consumo que suma o sin tarea, un ajuste sin motivo), 404 si el
    material no existe y 409 si dejaría el stock negativo.
    """
    motivo = (motivo or "").strip() or None
    if tipo not in TIPOS_MOVIMIENTO:
        raise bad_request(f"Tipo de movimiento '{tipo}' no válido.")
    if cantidad == 0:
        raise bad_request("La cantidad de un movimiento no puede ser 0.")
    if tipo == TIPO_ENTRADA and cantidad < 0:
        raise bad_request("Una entrada suma stock: la cantidad tiene que ser positiva.")
    if tipo == TIPO_CONSUMO and (cantidad > 0 or id_tarea is None):
        raise bad_request("Un consumo resta stock y siempre es de una tarea.")
    if tipo == TIPO_AJUSTE and motivo is None:
        raise bad_request("Un ajuste de stock necesita un motivo.")

    material, nombre = await _material_bloqueado(db, id_material)
    saldo = material.cantidad_disponible + cantidad
    if saldo < 0:
        unidad = f" {material.unidad_medida}" if material.unidad_medida else ""
        raise conflict(
            f"No hay suficiente «{nombre}»: quedan {material.cantidad_disponible}{unidad} "
            f"y se quieren sacar {-cantidad}{unidad}."
        )

    material.cantidad_disponible = saldo
    movimiento = MovimientoMaterial(
        id_material=id_material,
        tipo=tipo,
        cantidad=cantidad,
        saldo_resultante=saldo,
        motivo=motivo,
        id_tarea=id_tarea,
        id_empleado=id_empleado,
        fecha_hora=ahora_local(),
    )
    db.add(movimiento)
    await db.flush()
    return movimiento


async def consumir_en_tarea(
    db: AsyncSession,
    id_tarea: int,
    consumos: list[Consumo],
    *,
    id_empleado: int | None,
) -> list[MovimientoMaterial]:
    """
    Descuenta lo que una tarea usó. Si un material aparece dos veces se suma
    en un solo movimiento. O se descuenta todo o nada: si a uno le falta stock,
    el 409 deshace la transacción entera, incluido el cierre de la tarea.
    """
    totales: dict[int, int] = {}
    for consumo in consumos:
        totales[consumo.id_material] = totales.get(consumo.id_material, 0) + consumo.cantidad

    movimientos = []
    for id_material in sorted(totales):
        movimientos.append(
            await registrar_movimiento(
                db,
                id_material,
                TIPO_CONSUMO,
                -totales[id_material],
                id_empleado=id_empleado,
                id_tarea=id_tarea,
            )
        )
    return movimientos


async def registrar_alta(
    db: AsyncSession, id_material: int, cantidad_inicial: int, *, id_empleado: int | None
) -> MovimientoMaterial | None:
    """El stock con el que nace un material entra como el primer movimiento."""
    if cantidad_inicial <= 0:
        return None
    return await registrar_movimiento(
        db,
        id_material,
        TIPO_ENTRADA,
        cantidad_inicial,
        id_empleado=id_empleado,
        motivo=MOTIVO_ALTA,
    )
