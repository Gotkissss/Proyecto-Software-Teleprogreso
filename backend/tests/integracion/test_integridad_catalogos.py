"""
La base rechaza lo que no está en el catálogo — HU-S10-08, migración 0013.
-----------------------------------------------------------------------------
Las listas blancas de roles, estados y prioridades vivían solo en
`core/reglas.py` y en los schemas. Eso cubre lo que entra por la API, que es
casi todo — pero el seed, una migración de datos, un script de corrección y la
consola de la base escriben directo. Un `estado_tarea` mal escrito por ahí no
revienta nada en el momento: la tarea deja de aparecer en las pantallas que
filtran por estado y el reporte del gerente la cuenta en ninguna columna.

Estas pruebas insertan por fuera del ORM, con SQL, que es exactamente el camino
que las restricciones existen para cubrir. Pasar por la API probaría los
schemas de Pydantic, que ya tienen sus propias pruebas.
-----------------------------------------------------------------------------
"""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.session import AsyncSessionLocal

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]


async def _falla_con(sql: str, parametros: dict | None = None) -> str:
    """Ejecuta el SQL esperando que la base lo rechace; devuelve el error."""
    async with AsyncSessionLocal() as sesion:
        with pytest.raises(IntegrityError) as error:
            await sesion.execute(text(sql), parametros or {})
            await sesion.commit()
        await sesion.rollback()
    return str(error.value)


# ── Catálogos ───────────────────────────────────────────────────────────────

_EMPLEADO = (
    "INSERT INTO empleado (rol, estado, hash_contrasena, correo, "
    "fecha_contratacion, nombre, apellido) "
    "VALUES (:rol, :estado, 'hash', :correo, '2024-01-01', 'A', 'B')"
)


@pytest.mark.parametrize(
    "rol", ["jefazo", "ADMIN", "tecnico ", "", "root"]
)
async def test_un_rol_fuera_del_catalogo_se_rechaza(rol):
    # 'ADMIN' y 'tecnico ' importan tanto como 'jefazo': una mayúscula o un
    # espacio de sobra dejan al empleado con un rol que ninguna comprobación
    # de `require_roles` reconoce, así que no puede entrar a ninguna pantalla y
    # el síntoma es "la cuenta no sirve", sin más pistas.
    error = await _falla_con(
        _EMPLEADO,
        {
            "rol": rol,
            "estado": "activo",
            "correo": f"{uuid.uuid4().hex[:12]}@pruebas.teleprogreso.com",
        },
    )
    assert "ck_empleado_rol" in error


@pytest.mark.parametrize("estado", ["suspendido", "ACTIVO", "baja"])
async def test_un_estado_de_empleado_fuera_del_catalogo_se_rechaza(estado):
    error = await _falla_con(
        _EMPLEADO,
        {
            "rol": "tecnico",
            "estado": estado,
            "correo": f"{uuid.uuid4().hex[:12]}@pruebas.teleprogreso.com",
        },
    )
    assert "ck_empleado_estado" in error


async def test_un_empleado_valido_si_entra():
    """El contrapeso: sin esto, un CHECK mal escrito que rechace todo dejaría
    pasar todas las pruebas de arriba."""
    correo = f"{uuid.uuid4().hex[:12]}@pruebas.teleprogreso.com"
    async with AsyncSessionLocal() as sesion:
        await sesion.execute(
            text(_EMPLEADO),
            {"rol": "tecnico", "estado": "activo", "correo": correo},
        )
        await sesion.commit()
        await sesion.execute(
            text("DELETE FROM empleado WHERE correo = :correo"), {"correo": correo}
        )
        await sesion.commit()


_TAREA = (
    "INSERT INTO tarea (titulo, estado_tarea, prioridad) "
    "VALUES ('Tarea de prueba', :estado, :prioridad)"
)


@pytest.mark.parametrize(
    "estado", ["terminada", "COMPLETADO", "en progreso", "finalizado"]
)
async def test_un_estado_de_tarea_fuera_del_catalogo_se_rechaza(estado):
    # "en progreso" con espacio en vez de guion bajo es el error más fácil de
    # cometer a mano, y el más difícil de ver: la tarea desaparece de las dos
    # pantallas que filtran por estado sin que nada falle.
    error = await _falla_con(_TAREA, {"estado": estado, "prioridad": "media"})
    assert "ck_tarea_estado" in error


@pytest.mark.parametrize("prioridad", ["critica", "ALTA", "muy alta", "1"])
async def test_una_prioridad_fuera_del_catalogo_se_rechaza(prioridad):
    error = await _falla_con(
        _TAREA, {"estado": "pendiente", "prioridad": prioridad}
    )
    assert "ck_tarea_prioridad" in error


async def test_un_estado_de_vehiculo_fuera_del_catalogo_se_rechaza():
    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            text(
                "INSERT INTO activo (nombre_activo, tipo) "
                "VALUES ('Camioneta de prueba', 'carro') RETURNING id_activo"
            )
        )
        id_activo = resultado.scalar_one()
        await sesion.commit()

    try:
        error = await _falla_con(
            "INSERT INTO carro (id_activo, placa, estado_vehiculo) "
            "VALUES (:id, :placa, 'prestado')",
            {"id": id_activo, "placa": f"P-{uuid.uuid4().hex[:6]}"},
        )
        assert "ck_carro_estado" in error
    finally:
        async with AsyncSessionLocal() as sesion:
            await sesion.execute(
                text("DELETE FROM activo WHERE id_activo = :id"), {"id": id_activo}
            )
            await sesion.commit()


async def test_un_estado_de_herramienta_fuera_del_catalogo_se_rechaza():
    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            text(
                "INSERT INTO activo (nombre_activo, tipo) "
                "VALUES ('Taladro de prueba', 'herramienta') RETURNING id_activo"
            )
        )
        id_activo = resultado.scalar_one()
        await sesion.commit()

    try:
        error = await _falla_con(
            "INSERT INTO herramienta (id_activo, estado) VALUES (:id, 'perdida')",
            {"id": id_activo},
        )
        assert "ck_herramienta_estado" in error
    finally:
        async with AsyncSessionLocal() as sesion:
            await sesion.execute(
                text("DELETE FROM activo WHERE id_activo = :id"), {"id": id_activo}
            )
            await sesion.commit()


# ── Un vehículo por técnico, un técnico por vehículo ────────────────────────

async def _carro(placa: str | None = None) -> int:
    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            text(
                "INSERT INTO activo (nombre_activo, tipo) "
                "VALUES ('Vehículo de prueba', 'carro') RETURNING id_activo"
            )
        )
        id_activo = resultado.scalar_one()
        await sesion.execute(
            text(
                "INSERT INTO carro (id_activo, placa, estado_vehiculo) "
                "VALUES (:id, :placa, 'disponible')"
            ),
            {"id": id_activo, "placa": placa or f"P-{uuid.uuid4().hex[:6]}"},
        )
        await sesion.commit()
        return id_activo


async def _borrar_carro(*ids: int) -> None:
    async with AsyncSessionLocal() as sesion:
        for id_activo in ids:
            await sesion.execute(
                text("DELETE FROM activo WHERE id_activo = :id"), {"id": id_activo}
            )
        await sesion.commit()


async def _asignar(id_empleado: int, id_carro: int) -> None:
    async with AsyncSessionLocal() as sesion:
        await sesion.execute(
            text(
                "INSERT INTO empleado_carro (id_empleado, id_carro) "
                "VALUES (:emp, :carro)"
            ),
            {"emp": id_empleado, "carro": id_carro},
        )
        await sesion.commit()


async def test_un_tecnico_no_puede_quedar_con_dos_vehiculos(tecnico_a):
    """
    La clave primaria de `empleado_carro` es la PAREJA, así que esto entraba.
    Lo impedía solo el servicio, con dos consultas previas: dos peticiones
    simultáneas las pasan las dos y el técnico acaba con dos vehículos, el
    inventario con dos "en uso" y la liberación en cascada soltando uno solo.
    """
    primero = await _carro()
    segundo = await _carro()
    try:
        await _asignar(tecnico_a.id_empleado, primero)
        error = await _falla_con(
            "INSERT INTO empleado_carro (id_empleado, id_carro) "
            "VALUES (:emp, :carro)",
            {"emp": tecnico_a.id_empleado, "carro": segundo},
        )
        assert "uq_empleado_carro_empleado" in error
    finally:
        await _borrar_carro(primero, segundo)


async def test_un_vehiculo_no_puede_quedar_con_dos_tecnicos(tecnico_a, tecnico_b):
    id_carro = await _carro()
    try:
        await _asignar(tecnico_a.id_empleado, id_carro)
        error = await _falla_con(
            "INSERT INTO empleado_carro (id_empleado, id_carro) "
            "VALUES (:emp, :carro)",
            {"emp": tecnico_b.id_empleado, "carro": id_carro},
        )
        assert "uq_empleado_carro_carro" in error
    finally:
        await _borrar_carro(id_carro)


# ── descanso.tipo → tipo_pausa ──────────────────────────────────────────────

async def test_una_pausa_con_un_tipo_que_no_existe_se_rechaza(
    siembra, tecnico_a
):
    """
    El catálogo de pausas es una tabla desde la 0005, pero la columna que lo
    referenciaba era texto suelto: una pausa de tipo 'siesta' se guardaba sin
    protesta y salía del historial sin etiqueta y sin duración máxima que
    comparar.
    """
    jornada = await siembra.jornada_abierta(tecnico_a)

    error = await _falla_con(
        "INSERT INTO descanso (id_asistencia, hora_inicio, tipo) "
        "VALUES (:asistencia, '10:00', 'siesta')",
        {"asistencia": jornada.id_asistencia},
    )

    assert "fk_descanso_tipo_pausa" in error


async def test_una_pausa_sin_tipo_sigue_siendo_valida(siembra, tecnico_a):
    """
    La columna se queda NULL-able a propósito: un descanso antiguo sin tipo es
    un dato incompleto, no uno inválido, y ponerle uno inventado para poder
    crear la clave sería peor que dejarlo en NULL.
    """
    jornada = await siembra.jornada_abierta(tecnico_a)

    async with AsyncSessionLocal() as sesion:
        resultado = await sesion.execute(
            text(
                "INSERT INTO descanso (id_asistencia, hora_inicio, tipo) "
                "VALUES (:asistencia, '10:00', NULL) RETURNING id_descanso"
            ),
            {"asistencia": jornada.id_asistencia},
        )
        id_descanso = resultado.scalar_one()
        await sesion.commit()
        await sesion.execute(
            text("DELETE FROM descanso WHERE id_descanso = :id"),
            {"id": id_descanso},
        )
        await sesion.commit()


async def test_retirar_un_tipo_de_pausa_no_borra_el_historial(
    siembra, tecnico_a
):
    """
    La clave es RESTRICT y no CASCADE: dar de baja un tipo de pausa no puede
    llevarse las pausas que ya se tomaron con él. Para retirarlo sin tocar el
    historial está `tipo_pausa.activo`.
    """
    jornada = await siembra.jornada_abierta(tecnico_a)
    id_tipo = f"p{uuid.uuid4().hex[:8]}"

    async with AsyncSessionLocal() as sesion:
        await sesion.execute(
            text(
                "INSERT INTO tipo_pausa (id_tipo_pausa, label, "
                "duracion_max_min, orden) VALUES (:id, 'De prueba', 10, 99)"
            ),
            {"id": id_tipo},
        )
        resultado = await sesion.execute(
            text(
                "INSERT INTO descanso (id_asistencia, hora_inicio, tipo) "
                "VALUES (:asistencia, '10:00', :tipo) RETURNING id_descanso"
            ),
            {"asistencia": jornada.id_asistencia, "tipo": id_tipo},
        )
        id_descanso = resultado.scalar_one()
        await sesion.commit()

    try:
        error = await _falla_con(
            "DELETE FROM tipo_pausa WHERE id_tipo_pausa = :id", {"id": id_tipo}
        )
        assert "fk_descanso_tipo_pausa" in error
    finally:
        async with AsyncSessionLocal() as sesion:
            await sesion.execute(
                text("DELETE FROM descanso WHERE id_descanso = :id"),
                {"id": id_descanso},
            )
            await sesion.execute(
                text("DELETE FROM tipo_pausa WHERE id_tipo_pausa = :id"),
                {"id": id_tipo},
            )
            await sesion.commit()
