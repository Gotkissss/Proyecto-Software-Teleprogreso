import os
import uuid
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.geo import punto_wkt
from app.core.rate_limit import limite_general, peticiones_login_por_ip
from app.core.security import create_access_token, hash_password
from app.core.tiempo import ahora
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.asistencia import Asistencia
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea

CONTRASENA_PRUEBA = "Clave-Pruebas-Integracion-2026"
LAT_PRUEBA = 14.6349
LNG_PRUEBA = -90.5069
IP_CLIENTE = "127.0.0.1"


def _nombre_bd(url):
    try:
        return make_url(url).database or ""
    except Exception:
        return ""


def verificar_bd_pruebas():
    nombres = (_nombre_bd(settings.DATABASE_URL), _nombre_bd(settings.DATABASE_URL_SYNC))
    if all(nombre.endswith("_test") for nombre in nombres):
        return
    mensaje = (
        "Las pruebas de integracion y regresion requieren una base cuyo nombre "
        f"termine en _test. DATABASE_URL apunta a '{nombres[0]}' y "
        f"DATABASE_URL_SYNC a '{nombres[1]}'. No se sembro ni borro ningun dato."
    )
    if os.environ.get("EXIGIR_BD_PRUEBAS") == "1":
        pytest.fail(mensaje, pytrace=False)
    pytest.skip(mensaje)


def encabezado(token):
    return {"Authorization": f"Bearer {token}"}


def token_de(empleado):
    return create_access_token(
        subject=empleado.id_empleado,
        rol=empleado.rol,
        version_token=empleado.version_token,
    )


class Siembra:
    def __init__(self, hash_contrasena):
        self.hash_contrasena = hash_contrasena
        self.ids_empleados = []
        self.ids_tareas = []

    async def _guardar(self, *objetos):
        async with AsyncSessionLocal() as sesion:
            sesion.add_all(objetos)
            await sesion.commit()

    async def empleado(self, rol):
        empleado = Empleado(
            rol=rol,
            estado="activo",
            hash_contrasena=self.hash_contrasena,
            version_token=0,
            correo=f"{rol}.{uuid.uuid4().hex[:12]}@pruebas.teleprogreso.com",
            fecha_contratacion=date(2024, 1, 15),
            nombre="Prueba",
            apellido=rol.capitalize(),
        )
        await self._guardar(empleado)
        self.ids_empleados.append(empleado.id_empleado)
        return empleado

    async def jornada_abierta(self, empleado):
        momento = ahora().replace(microsecond=0)
        jornada = Asistencia(
            id_empleado=empleado.id_empleado,
            fecha=momento.date(),
            hora_entrada=momento.time(),
        )
        await self._guardar(jornada)
        return jornada

    async def tarea(self, empleado, titulo, estado="pendiente", lat=None, lng=None,
                    fecha_asignacion=None, fecha_completado=None):
        tarea = Tarea(
            titulo=titulo,
            estado_tarea=estado,
            prioridad="media",
            coordenada_servicio=punto_wkt(lat, lng) if lat is not None else None,
            fecha_asignacion=fecha_asignacion,
            fecha_completado=fecha_completado,
        )
        await self._guardar(tarea)
        self.ids_tareas.append(tarea.id_tarea)
        if empleado is not None:
            await self._guardar(
                EmpleadoTarea(id_empleado=empleado.id_empleado, id_tarea=tarea.id_tarea)
            )
        return tarea

    async def limpiar(self):
        async with AsyncSessionLocal() as sesion:
            if self.ids_tareas:
                await sesion.execute(delete(Tarea).where(Tarea.id_tarea.in_(self.ids_tareas)))
            if self.ids_empleados:
                await sesion.execute(
                    delete(Empleado).where(Empleado.id_empleado.in_(self.ids_empleados))
                )
            await sesion.commit()


@pytest.fixture(scope="session")
def hash_contrasena_prueba():
    return hash_password(CONTRASENA_PRUEBA)


@pytest_asyncio.fixture(autouse=True)
async def proteccion_bd():
    verificar_bd_pruebas()
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def cliente():
    limite_general.limpiar(f"ip:{IP_CLIENTE}")
    peticiones_login_por_ip.limpiar(f"login-ip:{IP_CLIENTE}")
    transporte = ASGITransport(app=app, client=(IP_CLIENTE, 123))
    async with AsyncClient(transport=transporte, base_url="http://test") as cliente_http:
        yield cliente_http


@pytest_asyncio.fixture
async def siembra(hash_contrasena_prueba):
    sembrador = Siembra(hash_contrasena_prueba)
    yield sembrador
    await sembrador.limpiar()


@pytest_asyncio.fixture
async def tecnico_a(siembra):
    return await siembra.empleado("tecnico")


@pytest_asyncio.fixture
async def tecnico_b(siembra):
    return await siembra.empleado("tecnico")


@pytest_asyncio.fixture
async def supervisor(siembra):
    return await siembra.empleado("supervisor")


@pytest_asyncio.fixture
async def gerente(siembra):
    return await siembra.empleado("gerente")


@pytest_asyncio.fixture
async def jornada_abierta_a(siembra, tecnico_a):
    return await siembra.jornada_abierta(tecnico_a)
