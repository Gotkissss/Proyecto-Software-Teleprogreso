"""
Alertas de seguridad contra PostgreSQL real (HU-S10-05, tareas 1, 2 y 6).

Las reglas leen la bitácora con operadores de JSONB e INET y la cadena de
hashes de la base, así que se prueban contra PostGIS y no con mocks. Cada
prueba usa su propio correo, IP o id: la bitácora de la base de pruebas es
compartida y de solo inserción.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.core.reglas import (
    MINUTOS_VENTANA_SEGURIDAD,
    UMBRAL_ACCESO_DENEGADO,
    UMBRAL_LOGIN_FALLIDO,
)
from app.db.session import AsyncSessionLocal, engine
from app.models.alerta import Alerta
from app.services import alertas_seguridad as seguridad
from tests.soporte_bd import CONTRASENA_PRUEBA, encabezado, token_de

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]


def _unico(prefijo):
    return f"{prefijo}.{uuid.uuid4().hex[:10]}"


def _ip_unica():
    valor = uuid.uuid4().int
    return f"10.{valor % 250}.{(valor >> 8) % 250}.{(valor >> 16) % 250 + 1}"


async def _evento(accion, *, entidad="empleado", id_actor=None, id_entidad=None, ip=None, cambios=None, veces=1):
    async with engine.begin() as conexion:
        for _ in range(veces):
            await conexion.execute(
                text(
                    "INSERT INTO bitacora_auditoria (accion, entidad, id_actor, id_entidad, ip, cambios) "
                    "VALUES (:a, :e, :actor, :entidad, CAST(:ip AS inet), CAST(:c AS jsonb))"
                ),
                {
                    "a": accion,
                    "e": entidad,
                    "actor": id_actor,
                    "entidad": id_entidad,
                    "ip": ip,
                    "c": json.dumps(cambios) if cambios is not None else None,
                },
            )


async def _correr(**opciones):
    async with AsyncSessionLocal() as sesion:
        creadas = await seguridad.generar_alertas_seguridad(sesion, **opciones)
        await sesion.commit()
    return creadas


async def _alertas(tipo, referencia):
    async with AsyncSessionLocal() as sesion:
        return (
            await sesion.execute(
                select(Alerta).where(Alerta.tipo == tipo, Alerta.referencia == referencia)
            )
        ).scalars().all()


# --- a. Fuerza bruta -------------------------------------------------------------

async def test_diez_logins_fallidos_contra_un_correo_levantan_una_alerta_critica():
    correo = f"{_unico('victima')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO)

    await _correr()

    alertas = await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"correo:{correo}")
    assert [(a.severidad, a.estado) for a in alertas] == [("critica", "pendiente")]


async def test_un_intento_menos_del_umbral_no_avisa():
    correo = f"{_unico('olvido')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO - 1)

    await _correr()

    assert await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"correo:{correo}") == []


async def test_diez_logins_fallidos_desde_una_ip_avisan_aunque_cambie_el_correo():
    ip = _ip_unica()
    for _ in range(UMBRAL_LOGIN_FALLIDO):
        await _evento("login_fallido", ip=ip, cambios={"correo": f"{_unico('x')}@teleprogreso.com"})

    await _correr()

    assert len(await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"ip:{ip}")) == 1


async def test_fuera_de_la_ventana_los_intentos_no_cuentan():
    correo = f"{_unico('viejo')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO)
    despues = datetime.now(timezone.utc) + timedelta(minutes=MINUTOS_VENTANA_SEGURIDAD + 1)

    await _correr(ahora_utc=despues)

    assert await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"correo:{correo}") == []


async def test_correr_dos_veces_no_duplica_la_alerta():
    correo = f"{_unico('repetido')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO)

    await _correr()
    await _correr()

    assert len(await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"correo:{correo}")) == 1


async def test_un_ataque_real_desde_una_ip_termina_en_alerta_de_cuenta_bloqueada(cliente):
    # Lo que escribe POST /auth/login de verdad, no un formato inventado. Desde
    # una sola IP el límite de login corta antes de los diez fallidos: ese
    # ataque lo avisa la regla de cuenta bloqueada, y la de fuerza bruta queda
    # para el que se reparte entre muchas IPs.
    correo = f"{_unico('real')}@teleprogreso.com"
    for _ in range(UMBRAL_LOGIN_FALLIDO):
        await cliente.post("/auth/login", json={"correo": correo, "contrasena": "no-es-esta-2026"})

    await _correr()

    assert len(await _alertas(seguridad.TIPO_LOGIN_BLOQUEADO, f"correo:{correo}")) == 1


# --- b. Cuenta bloqueada -----------------------------------------------------------

async def test_una_cuenta_bloqueada_avisa_como_advertencia():
    correo = f"{_unico('bloqueada')}@teleprogreso.com"
    await _evento("login_bloqueado", ip=_ip_unica(), cambios={"correo": correo, "espera_s": 900})

    await _correr()

    alertas = await _alertas(seguridad.TIPO_LOGIN_BLOQUEADO, f"correo:{correo}")
    assert [a.severidad for a in alertas] == ["advertencia"]


# --- c. 403 repetidos ----------------------------------------------------------------

async def test_cinco_403_de_un_mismo_actor_avisan():
    actor = 900_000 + uuid.uuid4().int % 90_000
    await _evento(
        "acceso_denegado", entidad="ruta", id_actor=actor,
        cambios={"metodo": "GET", "ruta": "/auditoria"}, veces=UMBRAL_ACCESO_DENEGADO,
    )

    await _correr()

    assert len(await _alertas(seguridad.TIPO_ACCESO_DENEGADO, f"empleado:{actor}")) == 1


async def test_cuatro_403_no_avisan():
    actor = 900_000 + uuid.uuid4().int % 90_000
    await _evento("acceso_denegado", entidad="ruta", id_actor=actor, veces=UMBRAL_ACCESO_DENEGADO - 1)

    await _correr()

    assert await _alertas(seguridad.TIPO_ACCESO_DENEGADO, f"empleado:{actor}") == []


# --- d. Cuentas de admin -------------------------------------------------------------

async def test_restablecer_la_contrasena_de_otro_admin_avisa(cliente, siembra):
    actor = await siembra.empleado("admin")
    objetivo = await siembra.empleado("admin")

    respuesta = await cliente.patch(
        f"/empleados/{objetivo.id_empleado}/contrasena",
        json={"contrasena": "Restablecida-Por-Otro-2026", "contrasena_confirmacion": "Restablecida-Por-Otro-2026"},
        headers=encabezado(token_de(actor)),
    )
    assert respuesta.status_code == 200, respuesta.text
    await _correr()

    alertas = await _alertas(seguridad.TIPO_CUENTA_ADMIN, f"empleado:{objetivo.id_empleado}")
    assert [a.severidad for a in alertas] == ["critica"]


async def test_restablecer_la_de_un_tecnico_no_avisa(cliente, siembra):
    admin = await siembra.empleado("admin")
    tecnico = await siembra.empleado("tecnico")

    await cliente.patch(
        f"/empleados/{tecnico.id_empleado}/contrasena",
        json={"contrasena": "Restablecida-Tecnico-2026", "contrasena_confirmacion": "Restablecida-Tecnico-2026"},
        headers=encabezado(token_de(admin)),
    )
    await _correr()

    assert await _alertas(seguridad.TIPO_CUENTA_ADMIN, f"empleado:{tecnico.id_empleado}") == []


async def test_que_un_admin_cambie_la_suya_no_avisa(cliente, siembra):
    admin = await siembra.empleado("admin")

    respuesta = await cliente.post(
        "/auth/cambiar-contrasena",
        json={
            "contrasena_actual": CONTRASENA_PRUEBA,
            "nueva_contrasena": "Elegida-Por-El-Admin-2026",
            "confirmacion_contrasena": "Elegida-Por-El-Admin-2026",
        },
        headers=encabezado(token_de(admin)),
    )
    assert respuesta.status_code == 200, respuesta.text
    await _correr()

    assert await _alertas(seguridad.TIPO_CUENTA_ADMIN, f"empleado:{admin.id_empleado}") == []


async def test_subir_a_alguien_a_admin_avisa(cliente, siembra):
    admin = await siembra.empleado("admin")
    supervisor = await siembra.empleado("supervisor")

    respuesta = await cliente.patch(
        f"/empleados/{supervisor.id_empleado}",
        json={"rol": "admin"},
        headers=encabezado(token_de(admin)),
    )
    assert respuesta.status_code == 200, respuesta.text
    await _correr()

    assert len(await _alertas(seguridad.TIPO_CUENTA_ADMIN, f"empleado:{supervisor.id_empleado}")) == 1


# --- e. Cadena rota ------------------------------------------------------------------

async def test_una_fila_alterada_de_la_bitacora_levanta_alerta():
    # Como en test_auditoria: se altera dentro de una transacción que se
    # deshace al final, para dejar la base de pruebas íntegra.
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        await conexion.execute(text("INSERT INTO bitacora_auditoria (accion, entidad) VALUES ('leer', 'prueba')"))
        await conexion.execute(text("INSERT INTO bitacora_auditoria (accion, entidad) VALUES ('leer', 'prueba')"))
        penultima = (
            await conexion.execute(
                text("SELECT id_bitacora FROM bitacora_auditoria ORDER BY id_bitacora DESC OFFSET 1 LIMIT 1")
            )
        ).scalar_one()
        await conexion.execute(
            text("ALTER TABLE bitacora_auditoria DISABLE TRIGGER trg_bitacora_auditoria_inmutable")
        )
        await conexion.execute(
            text("UPDATE bitacora_auditoria SET accion = 'otra' WHERE id_bitacora = :id"), {"id": penultima}
        )
        sesion = AsyncSession(bind=conexion)
        consulta = select(Alerta.referencia).where(Alerta.tipo == seguridad.TIPO_BITACORA_ROTA)
        # Sin pedirla, la cadena no se recorre (es cara): eso lo hace el comando.
        await seguridad.generar_alertas_seguridad(sesion)
        sin_pedirla = (await sesion.execute(consulta)).scalars().all()
        await seguridad.generar_alertas_seguridad(sesion, verificar_cadena=True)
        pidiendola = (await sesion.execute(consulta)).scalars().all()
        await transaccion.rollback()

    assert sin_pedirla == []
    assert pidiendola == [f"bitacora:{penultima}"]


async def test_con_la_cadena_integra_no_hay_alerta_de_bitacora():
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        sesion = AsyncSession(bind=conexion)
        await seguridad.generar_alertas_seguridad(sesion, verificar_cadena=True)
        alertas = (
            await sesion.execute(select(Alerta).where(Alerta.tipo == seguridad.TIPO_BITACORA_ROTA))
        ).scalars().all()
        await transaccion.rollback()

    assert alertas == []


# --- f. Fallos al guardar la auditoría --------------------------------------------------

async def test_un_fallo_reciente_al_guardar_la_auditoria_avisa():
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        sesion = AsyncSession(bind=conexion)
        fallos = {"total": 2, "eventos_perdidos": 5, "ultimo": datetime.now(timezone.utc).timestamp()}
        creadas = await seguridad.generar_alertas_seguridad(sesion, fallos=fallos)
        alertas = (
            await sesion.execute(select(Alerta).where(Alerta.tipo == seguridad.TIPO_AUDITORIA_FALLIDA))
        ).scalars().all()
        await transaccion.rollback()

    assert creadas >= 1
    assert [a.referencia for a in alertas] == ["proceso:auditoria"]


@pytest.mark.parametrize(
    "fallos",
    [
        {"total": 0, "eventos_perdidos": 0, "ultimo": None},
        {"total": 1, "eventos_perdidos": 1, "ultimo": (datetime.now(timezone.utc) - timedelta(days=2)).timestamp()},
    ],
)
async def test_sin_fallos_recientes_no_avisa(fallos):
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        sesion = AsyncSession(bind=conexion)
        await seguridad.generar_alertas_seguridad(sesion, fallos=fallos)
        alertas = (
            await sesion.execute(select(Alerta).where(Alerta.tipo == seguridad.TIPO_AUDITORIA_FALLIDA))
        ).scalars().all()
        await transaccion.rollback()

    assert alertas == []


# --- g. Conexión privilegiada ---------------------------------------------------------

async def test_en_produccion_una_conexion_de_superusuario_avisa(monkeypatch):
    # La base de pruebas se conecta como el superusuario de la imagen.
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        sesion = AsyncSession(bind=conexion)
        await seguridad.generar_alertas_seguridad(sesion, revisar_conexion=True)
        alertas = (
            await sesion.execute(select(Alerta).where(Alerta.tipo == seguridad.TIPO_CONEXION_PRIVILEGIADA))
        ).scalars().all()
        await transaccion.rollback()

    assert len(alertas) == 1
    assert alertas[0].referencia.startswith("bd:")


async def test_fuera_de_produccion_no_se_revisa_la_conexion():
    async with engine.connect() as conexion:
        transaccion = await conexion.begin()
        sesion = AsyncSession(bind=conexion)
        await seguridad.generar_alertas_seguridad(sesion, revisar_conexion=True)
        alertas = (
            await sesion.execute(select(Alerta).where(Alerta.tipo == seguridad.TIPO_CONEXION_PRIVILEGIADA))
        ).scalars().all()
        await transaccion.rollback()

    assert alertas == []


# --- Visibilidad (tarea 2) --------------------------------------------------------------

async def _alerta_de_seguridad():
    correo = f"{_unico('visible')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO)
    await _correr()
    (alerta,) = await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"correo:{correo}")
    return alerta


async def test_solo_el_admin_ve_las_alertas_de_seguridad(cliente, siembra):
    alerta = await _alerta_de_seguridad()
    admin = await siembra.empleado("admin")

    for rol in ("supervisor", "gerente"):
        otro = await siembra.empleado(rol)
        respuesta = await cliente.get("/alertas?generar=false", headers=encabezado(token_de(otro)))
        assert respuesta.status_code == 200
        ids = {a["id_alerta"] for a in respuesta.json()}
        assert alerta.id_alerta not in ids, rol
        assert not any(a["tipo"].startswith("seguridad_") for a in respuesta.json()), rol

    respuesta = await cliente.get("/alertas?generar=false", headers=encabezado(token_de(admin)))
    vista = next(a for a in respuesta.json() if a["id_alerta"] == alerta.id_alerta)
    # La etiqueta es el propio correo: no hay una fila a la que nombrar.
    assert vista["referencia_label"] == alerta.referencia.removeprefix("correo:")


async def test_un_supervisor_no_puede_atender_una_alerta_de_seguridad(cliente, siembra):
    alerta = await _alerta_de_seguridad()
    supervisor = await siembra.empleado("supervisor")
    admin = await siembra.empleado("admin")

    respuesta = await cliente.patch(
        f"/alertas/{alerta.id_alerta}", json={"estado": "atendida"},
        headers=encabezado(token_de(supervisor)),
    )
    assert respuesta.status_code == 404

    respuesta = await cliente.patch(
        f"/alertas/{alerta.id_alerta}", json={"estado": "atendida"},
        headers=encabezado(token_de(admin)),
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["estado"] == "atendida"


async def test_abrir_la_pantalla_de_alertas_corre_las_reglas(cliente, siembra):
    correo = f"{_unico('pantalla')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO)
    admin = await siembra.empleado("admin")

    respuesta = await cliente.get("/alertas", headers=encabezado(token_de(admin)))

    assert respuesta.status_code == 200
    assert any(a["referencia"] == f"correo:{correo}" for a in respuesta.json())


# --- Comando programado (tarea 3) --------------------------------------------------------

async def test_el_comando_alertas_genera_operativas_y_de_seguridad_sin_que_nadie_abra_la_pantalla(siembra, tecnico_a):
    import asyncio

    import mantenimiento
    from app.core.tiempo import hoy

    tarea = await siembra.tarea(tecnico_a, "Vencida para el comando")
    async with engine.begin() as conexion:
        await conexion.execute(
            text("UPDATE tarea SET fecha_finalizacion = :ayer WHERE id_tarea = :id"),
            {"ayer": hoy() - timedelta(days=1), "id": tarea.id_tarea},
        )
    correo = f"{_unico('cron')}@teleprogreso.com"
    await _evento("login_fallido", ip=_ip_unica(), cambios={"correo": correo}, veces=UMBRAL_LOGIN_FALLIDO)

    codigo = await asyncio.to_thread(mantenimiento.main, ["alertas"])

    assert codigo == 0
    assert len(await _alertas("tarea_vencida", f"tarea:{tarea.id_tarea}")) == 1
    assert len(await _alertas(seguridad.TIPO_LOGIN_FALLIDO, f"correo:{correo}")) == 1
