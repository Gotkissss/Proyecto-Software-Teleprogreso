"""
Un caso por cada endpoint que modifica datos (HU-S9-03, tarea 4).

Cada caso prepara lo que el endpoint necesita (empleados, jornada, tarea,
activos…) y devuelve la respuesta de UNA llamada a ese endpoint. Las pruebas
comprueban que esa llamada dejó al menos una fila en la bitácora con su
`request_id`, el actor real y la IP:

- tests/test_cobertura_auditoria.py (sin base): la lista de endpoints que
  mutan y la de este catálogo tienen que coincidir. Un endpoint nuevo sin caso
  rompe la suite unitaria, que corre en todo PR.
- tests/integracion/test_cobertura_auditoria.py (PostGIS): ejecuta cada caso.

Para añadir un endpoint: escribe aquí su caso con `@caso("MÉTODO", "/ruta")`,
con la ruta tal cual la declara FastAPI (p. ej. "/tareas/{id}/iniciar").
"""
import struct
import uuid
import zlib
from datetime import date, datetime, timezone

from app.db.session import AsyncSessionLocal
from app.models.alerta import Alerta
from tests.soporte_bd import CONTRASENA_PRUEBA, LAT_PRUEBA, LNG_PRUEBA, encabezado, token_de

CASOS = {}


def caso(metodo: str, ruta: str):
    def registrar(funcion):
        CASOS[(metodo, ruta)] = funcion
        return funcion

    return registrar


def _png_minimo() -> bytes:
    """PNG real de 1x1: la subida valida la firma del archivo, no solo su nombre."""
    def bloque(tipo, datos):
        crc = zlib.crc32(tipo + datos) & 0xFFFFFFFF
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", crc)

    cabecera = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixeles = zlib.compress(b"\x00\xff\xff\xff")
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloque(b"IHDR", cabecera)
        + bloque(b"IDAT", pixeles)
        + bloque(b"IEND", b"")
    )


PNG = _png_minimo()
UBICACION = {"lat": LAT_PRUEBA, "lng": LNG_PRUEBA}


def _unico(prefijo: str) -> str:
    return f"{prefijo}-{uuid.uuid4().hex[:8]}"


class Escenario:
    """Atajos para preparar datos a través de la propia API o de la siembra."""

    def __init__(self, cliente, siembra):
        self.cliente = cliente
        self.siembra = siembra
        self.actor = None  # quien hace la llamada que se audita

    @staticmethod
    def h(empleado):
        return encabezado(token_de(empleado))

    async def empleado(self, rol):
        return await self.siembra.empleado(rol)

    async def tecnico_en_jornada(self):
        tecnico = await self.empleado("tecnico")
        await self.siembra.jornada_abierta(tecnico)
        return tecnico

    async def tarea(self, tecnico, estado="pendiente"):
        return await self.siembra.tarea(tecnico, _unico("Tarea auditoría"), estado=estado)

    async def preparar(self, metodo, ruta, empleado, **kwargs):
        """Llamada de preparación: tiene que salir bien, pero no es la que se audita."""
        respuesta = await self.cliente.request(metodo, ruta, headers=self.h(empleado), **kwargs)
        assert respuesta.status_code < 400, f"preparación {metodo} {ruta}: {respuesta.text}"
        return respuesta.json()

    async def llamar(self, metodo, ruta, empleado, **kwargs):
        """La llamada auditada."""
        self.actor = empleado
        return await self.cliente.request(metodo, ruta, headers=self.h(empleado), **kwargs)

    async def activo(self, supervisor, tipo, **campos):
        cuerpo = {"tipo": tipo, "nombre_activo": _unico(tipo), **campos}
        return (await self.preparar("POST", "/activos", supervisor, json=cuerpo))["id_activo"]

    async def carro(self, supervisor):
        return await self.activo(supervisor, "carro", placa=_unico("P"))

    async def evidencia(self, tecnico, id_tarea):
        incidencia = await self.preparar(
            "POST", f"/tareas/{id_tarea}/incidencias", tecnico, json={"descripcion": "Evidencia"}
        )
        return incidencia["id_incidencia"]


# --- Autenticación -----------------------------------------------------------

@caso("POST", "/auth/login")
async def _login(e):
    empleado = await e.empleado("tecnico")
    e.actor = empleado
    return await e.cliente.post(
        "/auth/login", json={"correo": empleado.correo, "contrasena": CONTRASENA_PRUEBA}
    )


@caso("POST", "/auth/logout")
async def _logout(e):
    return await e.llamar("POST", "/auth/logout", await e.empleado("supervisor"))


@caso("POST", "/auth/cambiar-contrasena")
async def _cambiar_contrasena(e):
    return await e.llamar(
        "POST",
        "/auth/cambiar-contrasena",
        await e.empleado("gerente"),
        json={
            "contrasena_actual": CONTRASENA_PRUEBA,
            "nueva_contrasena": "Otra-Clave-Segura-2026",
            "confirmacion_contrasena": "Otra-Clave-Segura-2026",
        },
    )


# --- Tareas ------------------------------------------------------------------

@caso("POST", "/tareas")
async def _crear_tarea(e):
    supervisor = await e.empleado("supervisor")
    tecnico = await e.empleado("tecnico")
    respuesta = await e.llamar(
        "POST",
        "/tareas",
        supervisor,
        json={"nombre": _unico("Instalación"), "id_tecnico": tecnico.id_empleado, **UBICACION},
    )
    if respuesta.status_code < 400:
        e.siembra.ids_tareas.append(respuesta.json()["id_tarea"])
    return respuesta


@caso("PATCH", "/tareas/{id}")
async def _editar_tarea(e):
    tarea = await e.tarea(await e.empleado("tecnico"))
    return await e.llamar(
        "PATCH", f"/tareas/{tarea.id_tarea}", await e.empleado("supervisor"),
        json={"descripcion": "Revisar la acometida"},
    )


@caso("PATCH", "/tareas/{id}/estado")
async def _estado_tarea(e):
    tarea = await e.tarea(await e.empleado("tecnico"))
    return await e.llamar(
        "PATCH", f"/tareas/{tarea.id_tarea}/estado", await e.empleado("supervisor"),
        json={"estado": "cancelado"},
    )


@caso("PATCH", "/tareas/{id}/reasignar")
async def _reasignar_tarea(e):
    tarea = await e.tarea(await e.empleado("tecnico"))
    otro = await e.empleado("tecnico")
    return await e.llamar(
        "PATCH", f"/tareas/{tarea.id_tarea}/reasignar", await e.empleado("supervisor"),
        json={"id_tecnico": otro.id_empleado},
    )


@caso("PATCH", "/tareas/{id}/iniciar")
async def _iniciar_tarea(e):
    tecnico = await e.tecnico_en_jornada()
    tarea = await e.tarea(tecnico)
    return await e.llamar("PATCH", f"/tareas/{tarea.id_tarea}/iniciar", tecnico, json=UBICACION)


@caso("PATCH", "/tareas/{id}/finalizar")
async def _finalizar_tarea(e):
    tecnico = await e.tecnico_en_jornada()
    tarea = await e.tarea(tecnico, estado="en_progreso")
    id_incidencia = await e.evidencia(tecnico, tarea.id_tarea)
    await e.preparar(
        "POST", f"/tareas/{tarea.id_tarea}/incidencias/{id_incidencia}/foto", tecnico,
        files={"file": ("evidencia.png", PNG, "image/png")},
    )
    return await e.llamar("PATCH", f"/tareas/{tarea.id_tarea}/finalizar", tecnico, json=UBICACION)


# --- Evidencias ----------------------------------------------------------------

@caso("POST", "/tareas/{id}/incidencias")
async def _crear_incidencia(e):
    tecnico = await e.tecnico_en_jornada()
    tarea = await e.tarea(tecnico, estado="en_progreso")
    return await e.llamar(
        "POST", f"/tareas/{tarea.id_tarea}/incidencias", tecnico,
        json={"descripcion": "Cable dañado en el poste"},
    )


@caso("POST", "/tareas/{id}/incidencias/{id_incidencia}/foto")
async def _foto_incidencia(e):
    tecnico = await e.tecnico_en_jornada()
    tarea = await e.tarea(tecnico, estado="en_progreso")
    id_incidencia = await e.evidencia(tecnico, tarea.id_tarea)
    return await e.llamar(
        "POST", f"/tareas/{tarea.id_tarea}/incidencias/{id_incidencia}/foto", tecnico,
        files={"file": ("evidencia.png", PNG, "image/png")},
    )


@caso("DELETE", "/tareas/{id}/incidencias/{id_incidencia}")
async def _eliminar_incidencia(e):
    tecnico = await e.tecnico_en_jornada()
    tarea = await e.tarea(tecnico, estado="en_progreso")
    id_incidencia = await e.evidencia(tecnico, tarea.id_tarea)
    return await e.llamar(
        "DELETE", f"/tareas/{tarea.id_tarea}/incidencias/{id_incidencia}",
        await e.empleado("supervisor"),
    )


# --- Asistencia, descansos y ubicación ----------------------------------------

@caso("POST", "/asistencia/entrada")
async def _entrada(e):
    return await e.llamar("POST", "/asistencia/entrada", await e.empleado("tecnico"), json=UBICACION)


@caso("POST", "/asistencia/salida")
async def _salida(e):
    return await e.llamar("POST", "/asistencia/salida", await e.tecnico_en_jornada(), json=UBICACION)


@caso("POST", "/descanso/iniciar")
async def _iniciar_descanso(e):
    return await e.llamar(
        "POST", "/descanso/iniciar", await e.tecnico_en_jornada(), json={"tipo": "tecnica"}
    )


@caso("POST", "/descanso/finalizar")
async def _finalizar_descanso(e):
    tecnico = await e.tecnico_en_jornada()
    await e.preparar("POST", "/descanso/iniciar", tecnico, json={"tipo": "tecnica"})
    return await e.llamar("POST", "/descanso/finalizar", tecnico)


@caso("POST", "/ubicaciones")
async def _ubicacion(e):
    return await e.llamar("POST", "/ubicaciones", await e.tecnico_en_jornada(), json=UBICACION)


@caso("POST", "/ubicaciones/lote")
async def _ubicaciones_lote(e):
    ahora = datetime.now(timezone.utc).isoformat()
    return await e.llamar(
        "POST", "/ubicaciones/lote", await e.tecnico_en_jornada(),
        json={"puntos": [{**UBICACION, "fecha_hora": ahora}]},
    )


# --- Empleados -----------------------------------------------------------------

@caso("POST", "/empleados")
async def _crear_empleado(e):
    respuesta = await e.llamar(
        "POST", "/empleados", await e.empleado("admin"),
        json={
            "nombre": "Nuevo",
            "apellido": "Ingreso",
            "correo": f"{_unico('nuevo')}@pruebas.teleprogreso.com",
            "contrasena": "Clave-Inicial-2026",
            "rol": "tecnico",
            "fecha_contratacion": date(2026, 1, 5).isoformat(),
        },
    )
    if respuesta.status_code < 400:
        e.siembra.ids_empleados.append(respuesta.json()["id_empleado"])
    return respuesta


@caso("PATCH", "/empleados/{id}")
async def _editar_empleado(e):
    tecnico = await e.empleado("tecnico")
    return await e.llamar(
        "PATCH", f"/empleados/{tecnico.id_empleado}", await e.empleado("admin"),
        json={"telefono": "5555-0101"},
    )


@caso("PATCH", "/empleados/{id}/estado")
async def _estado_empleado(e):
    tecnico = await e.empleado("tecnico")
    return await e.llamar(
        "PATCH", f"/empleados/{tecnico.id_empleado}/estado", await e.empleado("admin"),
        json={"estado": "inactivo"},
    )


@caso("PATCH", "/empleados/{id}/contrasena")
async def _restablecer_contrasena(e):
    tecnico = await e.empleado("tecnico")
    return await e.llamar(
        "PATCH", f"/empleados/{tecnico.id_empleado}/contrasena", await e.empleado("supervisor"),
        json={"contrasena": "Restablecida-2026", "contrasena_confirmacion": "Restablecida-2026"},
    )


# --- Inventario ------------------------------------------------------------------

@caso("POST", "/activos")
async def _crear_activo(e):
    return await e.llamar(
        "POST", "/activos", await e.empleado("supervisor"),
        json={"tipo": "material", "nombre_activo": _unico("Conector"), "cantidad_disponible": 40,
              "stock_minimo": 10},
    )


@caso("PATCH", "/activos/{id:int}")
async def _editar_activo(e):
    supervisor = await e.empleado("supervisor")
    id_activo = await e.activo(supervisor, "material", cantidad_disponible=5)
    return await e.llamar(
        "PATCH", f"/activos/{id_activo}", supervisor, json={"cantidad_disponible": 3}
    )


@caso("DELETE", "/activos/{id:int}")
async def _eliminar_activo(e):
    supervisor = await e.empleado("supervisor")
    id_activo = await e.activo(supervisor, "herramienta")
    return await e.llamar("DELETE", f"/activos/{id_activo}", supervisor)


@caso("POST", "/activos/{id:int}/imagen")
async def _imagen_activo(e):
    supervisor = await e.empleado("supervisor")
    id_activo = await e.activo(supervisor, "herramienta")
    return await e.llamar(
        "POST", f"/activos/{id_activo}/imagen", supervisor,
        files={"file": ("herramienta.png", PNG, "image/png")},
    )


@caso("POST", "/activos/carros/{id}/asignar")
async def _asignar_tecnico(e):
    supervisor = await e.empleado("supervisor")
    id_carro = await e.carro(supervisor)
    tecnico = await e.empleado("tecnico")
    return await e.llamar(
        "POST", f"/activos/carros/{id_carro}/asignar", supervisor,
        json={"id_empleado": tecnico.id_empleado},
    )


@caso("DELETE", "/activos/carros/{id}/asignacion")
async def _liberar_tecnico(e):
    supervisor = await e.empleado("supervisor")
    id_carro = await e.carro(supervisor)
    tecnico = await e.empleado("tecnico")
    await e.preparar(
        "POST", f"/activos/carros/{id_carro}/asignar", supervisor,
        json={"id_empleado": tecnico.id_empleado},
    )
    return await e.llamar("DELETE", f"/activos/carros/{id_carro}/asignacion", supervisor)


@caso("POST", "/activos/carros/{id}/herramientas")
async def _asignar_herramienta(e):
    supervisor = await e.empleado("supervisor")
    id_carro = await e.carro(supervisor)
    id_herramienta = await e.activo(supervisor, "herramienta")
    return await e.llamar(
        "POST", f"/activos/carros/{id_carro}/herramientas", supervisor,
        json={"id_herramienta": id_herramienta},
    )


@caso("DELETE", "/activos/carros/{id}/herramientas/{id_h}")
async def _liberar_herramienta(e):
    supervisor = await e.empleado("supervisor")
    id_carro = await e.carro(supervisor)
    id_herramienta = await e.activo(supervisor, "herramienta")
    await e.preparar(
        "POST", f"/activos/carros/{id_carro}/herramientas", supervisor,
        json={"id_herramienta": id_herramienta},
    )
    return await e.llamar(
        "DELETE", f"/activos/carros/{id_carro}/herramientas/{id_herramienta}", supervisor
    )


# --- Alertas ---------------------------------------------------------------------

@caso("PATCH", "/alertas/{id}")
async def _atender_alerta(e):
    async with AsyncSessionLocal() as sesion:
        alerta = Alerta(
            tipo="tarea_vencida", severidad="alta", estado="pendiente",
            referencia=_unico("prueba-auditoria"),
        )
        sesion.add(alerta)
        await sesion.commit()
    return await e.llamar(
        "PATCH", f"/alertas/{alerta.id_alerta}", await e.empleado("supervisor"),
        json={"estado": "atendida"},
    )
