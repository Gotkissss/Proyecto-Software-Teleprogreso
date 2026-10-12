"""
Bitácora de auditoría contra PostgreSQL real (HU-S9-03, tareas 5 y 6).

Las pruebas que alteran la bitácora a propósito (como propietario, con el
trigger apagado) corren dentro de una transacción que se deshace al final:
la tabla es de solo inserción y la base de pruebas tiene que quedar íntegra
para las demás.
"""
import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core.contexto import CABECERA_REQUEST_ID
from app.core.tiempo import ahora
from app.core.geo import punto_wkt
from app.db.session import AsyncSessionLocal, engine
from app.models.bitacora import BitacoraAuditoria
from app.models.ubicacion import UbicacionEmpleado
from tests.soporte_bd import CONTRASENA_PRUEBA, encabezado, token_de


async def _filas_de(request_id):
    async with AsyncSessionLocal() as sesion:
        return (
            await sesion.execute(
                select(BitacoraAuditoria)
                .where(BitacoraAuditoria.request_id == request_id)
                .order_by(BitacoraAuditoria.id_bitacora)
            )
        ).scalars().all()


async def _insertar(conexion, accion="leer", entidad="prueba"):
    await conexion.execute(
        text("INSERT INTO bitacora_auditoria (accion, entidad) VALUES (:a, :e)"),
        {"a": accion, "e": entidad},
    )


async def _verificar(conexion):
    return (await conexion.execute(text("SELECT * FROM bitacora_auditoria_verificar()"))).one()


# --- Captura ---------------------------------------------------------------------

@pytest.mark.integracion
@pytest.mark.asyncio
async def test_el_hook_guarda_el_antes_y_despues_real(cliente, siembra):
    admin = await siembra.empleado("admin")
    tecnico = await siembra.empleado("tecnico")

    respuesta = await cliente.patch(
        f"/empleados/{tecnico.id_empleado}",
        json={"telefono": "5555-0202"},
        headers=encabezado(token_de(admin)),
    )

    assert respuesta.status_code == 200, respuesta.text
    [fila] = [f for f in await _filas_de(respuesta.headers[CABECERA_REQUEST_ID]) if f.entidad == "empleado"]
    assert (fila.accion, fila.id_entidad, fila.id_actor) == ("actualizar", tecnico.id_empleado, admin.id_empleado)
    assert fila.cambios == {"telefono": {"antes": None, "despues": "5555-0202"}}


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_ninguna_fila_guarda_el_hash_de_contrasena(cliente, siembra):
    gerente = await siembra.empleado("gerente")

    respuesta = await cliente.post(
        "/auth/cambiar-contrasena",
        json={
            "contrasena_actual": CONTRASENA_PRUEBA,
            "nueva_contrasena": "Nueva-Clave-Gerencia-2026",
            "confirmacion_contrasena": "Nueva-Clave-Gerencia-2026",
        },
        headers=encabezado(token_de(gerente)),
    )

    assert respuesta.status_code == 200, respuesta.text
    [fila] = await _filas_de(respuesta.headers[CABECERA_REQUEST_ID])
    assert fila.cambios["hash_contrasena"] == {"antes": "***", "despues": "***"}
    assert fila.cambios["version_token"] == {"antes": "***", "despues": "***"}
    async with AsyncSessionLocal() as sesion:
        hash_real = (
            await sesion.execute(
                text("SELECT hash_contrasena FROM empleado WHERE id_empleado = :id"),
                {"id": gerente.id_empleado},
            )
        ).scalar_one()
        copias = (
            await sesion.execute(
                text("SELECT count(*) FROM bitacora_auditoria WHERE cambios::text LIKE :h"),
                {"h": f"%{hash_real}%"},
            )
        ).scalar_one()
    assert copias == 0


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_la_base_pone_la_cadena_y_la_hora_aunque_la_app_mande_otra_cosa():
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        fila = (
            await conexion.execute(
                text(
                    "INSERT INTO bitacora_auditoria (accion, entidad, fecha_hora, hash, hash_anterior) "
                    "VALUES ('leer', 'prueba', '1990-01-01', repeat('f', 64), repeat('e', 64)) "
                    "RETURNING fecha_hora, hash, hash_anterior"
                )
            )
        ).one()
        verificacion = await _verificar(conexion)
        await transaccion.rollback()

    assert fila.fecha_hora.year > 2000
    assert fila.hash != "f" * 64 and fila.hash_anterior != "e" * 64
    assert verificacion.o_motivo is None


# --- Inmutabilidad -----------------------------------------------------------------

@pytest.mark.integracion
@pytest.mark.asyncio
async def test_el_rol_de_la_app_no_puede_modificar_ni_borrar_la_bitacora():
    rol = f"app_prueba_{uuid.uuid4().hex[:8]}"
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        await _insertar(conexion)
        await conexion.execute(text(f'CREATE ROLE "{rol}" NOLOGIN NOSUPERUSER'))
        # El peor caso: alguien le dio todos los permisos sobre todas las tablas.
        await conexion.execute(text(f'GRANT ALL ON ALL TABLES IN SCHEMA public TO "{rol}"'))
        await conexion.execute(text(f'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "{rol}"'))

        intentos = await conexion.begin_nested()
        # Un ancla que intentar borrar: un DELETE sobre una tabla vacía no
        # dispara el trigger de fila y no probaría nada. Se deshace después.
        await conexion.execute(
            text("INSERT INTO bitacora_ancla (hasta_id_bitacora, filas_purgadas, retencion_dias, hash_ancla) "
                 "VALUES (0, 0, 90, repeat('0', 64))")
        )

        ataques = [
            "UPDATE bitacora_auditoria SET accion = 'alterada'",
            "DELETE FROM bitacora_auditoria",
            "TRUNCATE bitacora_auditoria",
            "ALTER TABLE bitacora_auditoria DISABLE TRIGGER ALL",
            "DELETE FROM bitacora_ancla",
            "SELECT * FROM bitacora_auditoria_purgar(1)",
        ]
        resultados = {}
        for ataque in ataques:
            try:
                async with conexion.begin_nested():
                    await conexion.execute(text(f'SET LOCAL ROLE "{rol}"'))
                    if ataque.startswith("DELETE FROM bitacora_auditoria"):
                        # Ni encendiendo la bandera de la purga.
                        await conexion.execute(text("SET LOCAL teleprogreso.purga_bitacora = 'on'"))
                    await conexion.execute(text(ataque))
                resultados[ataque] = "permitido"
            except DBAPIError:
                resultados[ataque] = "rechazado"
            await conexion.execute(text("RESET ROLE"))
        await intentos.rollback()

        # Tras proteger(), solo le queda leer e insertar, y la cadena sigue
        # funcionando con sus inserciones.
        await conexion.execute(text("SELECT bitacora_auditoria_proteger()"))
        permisos = (
            await conexion.execute(
                text(
                    "SELECT privilege_type FROM information_schema.role_table_grants "
                    "WHERE table_name = 'bitacora_auditoria' AND grantee = :rol ORDER BY 1"
                ),
                {"rol": rol},
            )
        ).scalars().all()
        async with conexion.begin_nested():
            await conexion.execute(text(f'SET LOCAL ROLE "{rol}"'))
            await _insertar(conexion, entidad="desde_la_app")
            verificacion = await _verificar(conexion)
        await conexion.execute(text("RESET ROLE"))
        await transaccion.rollback()

    assert resultados == {ataque: "rechazado" for ataque in ataques}
    assert permisos == ["INSERT", "SELECT"]
    assert verificacion.o_motivo is None


# --- Verificación ------------------------------------------------------------------

@pytest.mark.integracion
@pytest.mark.asyncio
async def test_la_cadena_detecta_una_fila_alterada_y_una_borrada():
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        for _ in range(3):
            await _insertar(conexion)
        ultimas = (
            await conexion.execute(
                text("SELECT id_bitacora FROM bitacora_auditoria ORDER BY id_bitacora DESC LIMIT 3")
            )
        ).scalars().all()
        assert (await _verificar(conexion)).o_motivo is None

        # Solo el propietario puede apagar el trigger: así se simula a alguien
        # con acceso de administrador a la base editando por fuera.
        await conexion.execute(
            text("ALTER TABLE bitacora_auditoria DISABLE TRIGGER trg_bitacora_auditoria_inmutable")
        )
        async with conexion.begin_nested() as alterada:
            await conexion.execute(
                text("UPDATE bitacora_auditoria SET accion = 'otra' WHERE id_bitacora = :id"),
                {"id": ultimas[1]},
            )
            tras_alterar = await _verificar(conexion)
            await alterada.rollback()
        await conexion.execute(
            text("DELETE FROM bitacora_auditoria WHERE id_bitacora = :id"), {"id": ultimas[1]}
        )
        tras_borrar = await _verificar(conexion)
        await transaccion.rollback()

    assert (tras_alterar.o_id_rota, tras_alterar.o_motivo) == (ultimas[1], "contenido_alterado")
    assert (tras_borrar.o_id_rota, tras_borrar.o_motivo) == (ultimas[0], "eslabon_roto")


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_la_purga_borra_un_prefijo_deja_ancla_y_la_cadena_sigue_integra():
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        for _ in range(4):
            await _insertar(conexion)
        # La penúltima fila: los ids no son consecutivos (el trigger reasigna
        # el id tras tomar el candado).
        corte = (
            await conexion.execute(
                text("SELECT id_bitacora FROM bitacora_auditoria ORDER BY id_bitacora DESC OFFSET 1 LIMIT 1")
            )
        ).scalar_one()
        # Se envejece todo hasta `corte` (el contenido cambia, pero esas filas
        # son justo las que la purga se lleva).
        await conexion.execute(
            text("ALTER TABLE bitacora_auditoria DISABLE TRIGGER trg_bitacora_auditoria_inmutable")
        )
        await conexion.execute(
            text(
                "UPDATE bitacora_auditoria SET fecha_hora = now() - interval '200 days' "
                "WHERE id_bitacora <= :corte"
            ),
            {"corte": corte},
        )
        await conexion.execute(
            text("ALTER TABLE bitacora_auditoria ENABLE TRIGGER trg_bitacora_auditoria_inmutable")
        )

        filas, hasta = (
            await conexion.execute(
                text("SELECT * FROM bitacora_auditoria_purgar(90, 'prueba-purga')")
            )
        ).one()
        restantes_viejas = (
            await conexion.execute(
                text("SELECT count(*) FROM bitacora_auditoria WHERE id_bitacora <= :c"), {"c": corte}
            )
        ).scalar_one()
        ancla = (
            await conexion.execute(
                text("SELECT hasta_id_bitacora, filas_purgadas, retencion_dias FROM bitacora_ancla "
                     "ORDER BY id_ancla DESC LIMIT 1")
            )
        ).one()
        registro = (
            await conexion.execute(
                text("SELECT rol_actor, cambios FROM bitacora_auditoria WHERE request_id = 'prueba-purga'")
            )
        ).one()
        verificacion = await _verificar(conexion)
        await transaccion.rollback()

    assert hasta == corte and filas >= 3 and restantes_viejas == 0
    assert tuple(ancla) == (corte, filas, 90)
    assert registro.rol_actor == "sistema" and registro.cambios["filas"] == filas
    assert verificacion.o_motivo is None


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_inserciones_concurrentes_no_rompen_la_cadena():
    async def una_peticion(i):
        async with AsyncSessionLocal() as sesion:
            await _insertar(await sesion.connection(), entidad=f"concurrente_{i}")
            await asyncio.sleep(0.01)  # la transacción sigue abierta con el candado
            await sesion.commit()

    await asyncio.gather(*(una_peticion(i) for i in range(12)))

    async with engine.connect() as conexion:
        verificacion = await _verificar(conexion)
    assert verificacion.o_motivo is None


# --- API de consulta ---------------------------------------------------------------

@pytest.mark.integracion
@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["gerente", "supervisor", "tecnico"])
async def test_solo_el_admin_consulta_la_bitacora(cliente, siembra, rol):
    empleado = await siembra.empleado(rol)
    for ruta in ("/auditoria", "/auditoria/verificacion", "/auditoria/catalogos", "/auditoria/exportar"):
        respuesta = await cliente.get(ruta, headers=encabezado(token_de(empleado)))
        assert respuesta.status_code == 403, f"{ruta}: {respuesta.text}"


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_el_admin_filtra_verifica_y_exporta(cliente, siembra):
    admin = await siembra.empleado("admin")
    tecnico = await siembra.empleado("tecnico")
    cabecera = encabezado(token_de(admin))
    edicion = await cliente.patch(
        f"/empleados/{tecnico.id_empleado}", json={"telefono": "5555-0303"}, headers=cabecera
    )
    request_id = edicion.headers[CABECERA_REQUEST_ID]

    pagina = await cliente.get(
        "/auditoria", params={"request_id": request_id, "entidad": "empleado"}, headers=cabecera
    )
    verificacion = await cliente.get("/auditoria/verificacion", headers=cabecera)
    catalogos = await cliente.get("/auditoria/catalogos", headers=cabecera)
    exportacion = await cliente.get(
        "/auditoria/exportar", params={"actor": admin.id_empleado}, headers=cabecera
    )
    fechas_al_reves = await cliente.get(
        "/auditoria", params={"fecha_inicio": "2026-10-10", "fecha_fin": "2026-10-01"}, headers=cabecera
    )

    assert pagina.status_code == 200, pagina.text
    datos = pagina.json()
    assert datos["total"] == 1
    [fila] = datos["items"]
    assert fila["id_entidad"] == tecnico.id_empleado
    assert fila["nombre_actor"] == f"{admin.nombre} {admin.apellido}"

    assert verificacion.status_code == 200
    estado = verificacion.json()
    assert estado["integra"] is True
    # En CI la app se conecta como superusuario: la pantalla tiene que decirlo.
    assert estado["protegida"] is False and "superusuario" in estado["detalle_proteccion"]

    assert "actualizar" in catalogos.json()["acciones"]
    assert exportacion.status_code == 200
    assert exportacion.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert fechas_al_reves.status_code == 400

    # Revisar la bitácora también queda en la bitácora.
    lecturas = [
        f for f in await _filas_de(pagina.headers[CABECERA_REQUEST_ID]) if f.accion == "leer"
    ]
    assert lecturas and lecturas[0].entidad == "bitacora"


# --- Mantenimiento -----------------------------------------------------------------

@pytest.mark.integracion
@pytest.mark.asyncio
async def test_mantenimiento_purga_ubicaciones_viejas_y_lo_registra(siembra, tecnico_a):
    import mantenimiento

    async with AsyncSessionLocal() as sesion:
        vieja = UbicacionEmpleado(
            id_empleado=tecnico_a.id_empleado,
            coordenada=punto_wkt(14.6, -90.5),
            fecha_hora_registro=ahora() - timedelta(days=200),
        )
        reciente = UbicacionEmpleado(
            id_empleado=tecnico_a.id_empleado,
            coordenada=punto_wkt(14.6, -90.5),
            fecha_hora_registro=ahora(),
        )
        sesion.add_all([vieja, reciente])
        await sesion.commit()

    codigo = await asyncio.to_thread(mantenimiento.main, ["purgar"])
    verificacion = await asyncio.to_thread(mantenimiento.main, ["verificar-bitacora"])

    async with AsyncSessionLocal() as sesion:
        quedan = (
            await sesion.execute(
                select(UbicacionEmpleado.id_ubicacion).where(
                    UbicacionEmpleado.id_empleado == tecnico_a.id_empleado
                )
            )
        ).scalars().all()
        registro = (
            await sesion.execute(
                select(BitacoraAuditoria)
                .where(BitacoraAuditoria.accion == "purgar",
                       BitacoraAuditoria.entidad == "ubicacion_empleado")
                .order_by(BitacoraAuditoria.id_bitacora.desc())
                .limit(1)
            )
        ).scalar_one()

    assert codigo == 0 and verificacion == 0
    assert quedan == [reciente.id_ubicacion]
    assert registro.rol_actor == "sistema" and registro.cambios["filas"] >= 1
    assert registro.request_id.startswith("mantenimiento-")
