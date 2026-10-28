"""
Kardex de materiales — Teleprogreso S.A. (HU-S10-07)
-----------------------------------------------------------------------------
Todo cambio de `material.cantidad_disponible` pasa por aquí y deja su fila en
`movimiento_material`. No hay un segundo camino: el `PATCH /activos/{id}` dejó
de aceptar `cantidad_disponible` y el router llama a `registrar_ajuste`.

Qué arregla, en concreto:

  - El stock era un número que alguien escribía en el modal del inventario.
    Usar el material en una tarea no lo bajaba, así que la alerta de stock
    crítico comparaba contra una cifra que no era la del almacén: avisaba de lo
    que no faltaba y callaba sobre lo que sí.
  - A "¿a dónde se fueron las 40 rosetas?" no había respuesta. El campo guarda
    el último valor escrito, no la historia.

Por qué `SELECT … FOR UPDATE`:

    Dos técnicos cierran su tarea en el mismo segundo y las dos transacciones
    leen 5 unidades disponibles. Cada una resta 3 y escribe 2. Se consumieron
    6 de 5, el saldo dice 2, y los dos movimientos dicen que dejaron 2. Nada
    falla y el inventario queda mintiendo. `FOR UPDATE` hace que la segunda
    transacción espere a la primera y lea el 2 real, con lo que su consumo de
    3 se rechaza con 409.

    El CHECK de la migración 0012 es la red de debajo, para lo que entre por
    fuera de la API.
-----------------------------------------------------------------------------
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, conflict, not_found
from app.core.tiempo import ahora
from app.models.activo import Activo, Material, MovimientoMaterial

# Los tres motivos por los que el stock cambia. Mismo juego que el CHECK de la
# migración 0012: si aquí se añade uno, allí también.
TIPO_ENTRADA = "entrada"
TIPO_CONSUMO = "consumo"
TIPO_AJUSTE = "ajuste"
TIPOS_MOVIMIENTO = (TIPO_ENTRADA, TIPO_CONSUMO, TIPO_AJUSTE)

# Tope por línea. No es una regla del negocio: es un freno a la errata de
# teclear 1000 donde iban 10, que con `FOR UPDATE` y el CHECK dejaría el
# almacén descuadrado sin que nada se quejara.
MAX_CANTIDAD_MOVIMIENTO = 100_000


@dataclass(frozen=True)
class LineaConsumo:
    """Un material y cuántas unidades consumió una tarea."""

    id_material: int
    cantidad: int


async def _material_bloqueado(db: AsyncSession, id_material: int) -> Material:
    """
    El material, con su fila bloqueada hasta el final de la transacción.

    `with_for_update()` es lo que serializa dos consumos simultáneos del mismo
    material; ver el encabezado del módulo.
    """
    resultado = await db.execute(
        select(Material)
        .where(Material.id_activo == id_material)
        .with_for_update()
    )
    material = resultado.scalar_one_or_none()
    if material is None:
        raise not_found(f"No existe ningún material con id={id_material}.")
    return material


async def _nombre_material(db: AsyncSession, id_material: int) -> str:
    resultado = await db.execute(
        select(Activo.nombre_activo).where(Activo.id_activo == id_material)
    )
    return resultado.scalar_one_or_none() or f"material {id_material}"


def _validar_cantidad(cantidad: int) -> None:
    if cantidad <= 0:
        raise bad_request("La cantidad del movimiento tiene que ser mayor que 0.")
    if cantidad > MAX_CANTIDAD_MOVIMIENTO:
        raise bad_request(
            "La cantidad del movimiento supera el máximo de "
            f"{MAX_CANTIDAD_MOVIMIENTO:,} unidades. Si es correcta, "
            "regístrala en varias entradas."
        )


async def registrar_movimiento(
    db: AsyncSession,
    *,
    id_material: int,
    tipo: str,
    cantidad: int,
    id_empleado: int | None,
    motivo: str | None = None,
    id_tarea: int | None = None,
) -> MovimientoMaterial:
    """
    Aplica un movimiento al stock y devuelve la fila que lo registra.

    `cantidad` es siempre positiva: el signo lo da `tipo`. Una entrada suma, un
    consumo resta, y un ajuste FIJA el saldo en `cantidad` (es una corrección
    de inventario: "contamos y hay 37", no "sumá 37").

    No hace commit. La transacción la cierra quien llame, que normalmente está
    a mitad de otra cosa —cerrar una tarea— y necesita que las dos escrituras
    vivan o mueran juntas: un consumo apuntado sin que la tarea se cerrara
    descuadra el almacén, y una tarea cerrada sin apuntar el consumo deja el
    stock alto.
    """
    if tipo not in TIPOS_MOVIMIENTO:
        raise bad_request(
            f"Tipo de movimiento '{tipo}' no válido. "
            f"Usa: {', '.join(TIPOS_MOVIMIENTO)}."
        )
    _validar_cantidad(cantidad)

    if tipo == TIPO_CONSUMO and id_tarea is None:
        raise bad_request(
            "Un consumo tiene que decir en qué tarea se usó el material."
        )

    motivo_limpio = (motivo or "").strip() or None
    if tipo == TIPO_AJUSTE and not motivo_limpio:
        raise bad_request(
            "Un ajuste de inventario necesita un motivo: sin él no se puede "
            "distinguir de un error de captura."
        )

    material = await _material_bloqueado(db, id_material)

    if tipo == TIPO_ENTRADA:
        saldo = material.cantidad_disponible + cantidad
    elif tipo == TIPO_CONSUMO:
        saldo = material.cantidad_disponible - cantidad
        if saldo < 0:
            nombre = await _nombre_material(db, id_material)
            raise conflict(
                f"No hay suficiente '{nombre}': quedan "
                f"{material.cantidad_disponible} y se quieren consumir "
                f"{cantidad}."
            )
    else:
        saldo = cantidad

    material.cantidad_disponible = saldo

    movimiento = MovimientoMaterial(
        id_material=id_material,
        tipo=tipo,
        cantidad=cantidad,
        saldo_resultante=saldo,
        motivo=motivo_limpio,
        id_tarea=id_tarea,
        id_empleado=id_empleado,
        fecha_hora=ahora(),
    )
    db.add(movimiento)
    await db.flush()
    return movimiento


async def registrar_consumo_de_tarea(
    db: AsyncSession,
    *,
    id_tarea: int,
    lineas: list[LineaConsumo],
    id_empleado: int | None,
) -> list[MovimientoMaterial]:
    """
    Descuenta del stock lo que una tarea consumió, al cerrarla.

    Las líneas se agrupan por material antes de aplicarlas: mandar el mismo
    material dos veces es fácil desde el formulario, y dos movimientos de 2
    dejan dos filas que parecen dos usos distintos del almacén en el mismo
    cierre. Se suman y queda una sola línea de 4, que es lo que pasó.

    El orden de aplicación es por `id_material`, siempre el mismo. Importa:
    dos cierres simultáneos que toquen los mismos dos materiales en orden
    contrario se bloquean mutuamente, y Postgres mata uno con un interbloqueo
    cuando no hacía falta.
    """
    if not lineas:
        return []

    agrupadas: dict[int, int] = {}
    for linea in lineas:
        _validar_cantidad(linea.cantidad)
        agrupadas[linea.id_material] = (
            agrupadas.get(linea.id_material, 0) + linea.cantidad
        )

    movimientos = []
    for id_material in sorted(agrupadas):
        movimientos.append(
            await registrar_movimiento(
                db,
                id_material=id_material,
                tipo=TIPO_CONSUMO,
                cantidad=agrupadas[id_material],
                id_empleado=id_empleado,
                id_tarea=id_tarea,
            )
        )
    return movimientos


async def registrar_ajuste(
    db: AsyncSession,
    *,
    id_material: int,
    nueva_cantidad: int,
    motivo: str,
    id_empleado: int | None,
) -> MovimientoMaterial:
    """
    Corrige el stock de un material a mano, con motivo obligatorio.

    Es lo que antes hacía `PATCH /activos/{id}` escribiendo
    `cantidad_disponible` directamente. Hace lo mismo de siempre —fija el
    número— con un campo más: por qué. Sin él, un ajuste y un dedazo son la
    misma fila.
    """
    if nueva_cantidad < 0:
        raise bad_request("El stock no puede quedar en negativo.")
    if nueva_cantidad > MAX_CANTIDAD_MOVIMIENTO:
        raise bad_request(
            "El stock indicado supera el máximo de "
            f"{MAX_CANTIDAD_MOVIMIENTO:,} unidades."
        )

    material = await _material_bloqueado(db, id_material)
    if material.cantidad_disponible == nueva_cantidad:
        raise bad_request(
            f"El material ya tiene {nueva_cantidad} unidades: no hay nada que "
            "ajustar."
        )

    # `cantidad` de un ajuste es el saldo al que se deja el material, no la
    # diferencia; el CHECK `cantidad > 0` por eso impide ajustar a 0 por esta
    # vía. Para vaciar un material se registra el consumo o la baja del activo,
    # que es lo que de verdad pasó con las unidades.
    if nueva_cantidad == 0:
        raise bad_request(
            "Para dejar un material en 0 registra el consumo o da de baja el "
            "activo: un ajuste a cero no dice a dónde fueron las unidades."
        )

    return await registrar_movimiento(
        db,
        id_material=id_material,
        tipo=TIPO_AJUSTE,
        cantidad=nueva_cantidad,
        motivo=motivo,
        id_empleado=id_empleado,
    )


async def listar_movimientos(
    db: AsyncSession,
    id_material: int,
    *,
    limite: int = 200,
) -> list[tuple]:
    """
    Historia de un material, lo más reciente primero, con el nombre de quien
    hizo cada movimiento y el título de la tarea cuando fue un consumo.

    Devuelve filas y no objetos para no obligar a cargar dos relaciones por
    movimiento (el `N+1` que convierte una pestaña en 200 consultas).
    """
    from app.models.empleado import Empleado
    from app.models.tarea import Tarea

    # Que el material exista se comprueba antes: si no, una pestaña de un id
    # inventado saldría vacía y parecería un material sin movimientos.
    existe = await db.execute(
        select(Material.id_activo).where(Material.id_activo == id_material)
    )
    if existe.scalar_one_or_none() is None:
        raise not_found(f"No existe ningún material con id={id_material}.")

    resultado = await db.execute(
        select(
            MovimientoMaterial,
            Empleado.nombre,
            Empleado.apellido,
            Tarea.titulo,
        )
        .outerjoin(Empleado, Empleado.id_empleado == MovimientoMaterial.id_empleado)
        .outerjoin(Tarea, Tarea.id_tarea == MovimientoMaterial.id_tarea)
        .where(MovimientoMaterial.id_material == id_material)
        .order_by(
            MovimientoMaterial.fecha_hora.desc(),
            MovimientoMaterial.id_movimiento.desc(),
        )
        .limit(limite)
    )
    return resultado.all()
