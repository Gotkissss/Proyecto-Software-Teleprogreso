"""
seed_neurolab.py — Estado de partida de la prueba de UX del NeuroLab (UVG)
-----------------------------------------------------------------------------
Deja la base en el escenario EXACTO que pide el guion del experimento
(«Script Instrucciones Teleprogreso», Ingeniería de Software 2, Grupo 2), y
vuelve a dejarla igual entre un participante y el siguiente:

    python seed_neurolab.py --reset

Es un seed aparte de `seed.py` a propósito. El de demostración no sirve para
el experimento, y no por gusto:

  - deja la tarea urgente del técnico de prueba ya en `en_progreso`, así que
    la tarea A2 («localizar la de mayor prioridad e iniciarla») no tendría
    nada que iniciar;
  - a quien no marca entrada hoy lo elige con `tecnicos[-1]`, que no es el
    técnico de prueba: la tarea A1 («registrar la entrada») tampoco tendría
    nada que registrar, porque Juan ya aparecería en jornada;
  - siembra 3 materiales bajo el mínimo y 2 tareas vencidas, que son 5
    alertas críticas; el guion pide exactamente dos alertas pendientes, una
    crítica y una de advertencia;
  - las horas de la jornada de hoy salen de `random` y del reloj, así que dos
    participantes no veían lo mismo.

ESCENARIO QUE DEJA (lo que el moderador debe ver antes de cada sesión)
---------------------------------------------------------------------
  Cuentas (las únicas dos que se usan en la prueba):
      tecnico@teleprogreso.com   → Bloque A (técnico de campo)
      admin@teleprogreso.com     → Bloque B (supervisor)
  Contraseña: la de CONTRASENA_DEMO, igual que en seed.py (HU-S10-01). Las de
  EMPLEADOS de abajo son solo para desarrollo local.

  - 4 técnicos en plantilla; 3 en jornada y el de prueba SIN entrada marcada.
  - El técnico de prueba tiene 3 tareas para hoy, las tres `pendiente`, una
    marcada como urgente (es la que pide iniciar A2).
  - Los otros 3 técnicos llevan 4, 2 y 1 tareas activas: el selector de
    reasignación de B3 muestra cargas distintas y «el de menor carga» es una
    sola persona, sin empates.
  - 2 alertas operativas pendientes: 1 crítica + 1 advertencia.
  - Inventario completo pero TODO por encima del stock mínimo, para que no
    aparezcan alertas de stock que nadie pidió.

POR QUÉ LA ALERTA DE ADVERTENCIA VA FECHADA AYER
------------------------------------------------
Las alertas no son datos sueltos: `services/alertas.py` las genera y las
cierra solo, a partir de lo que pasa en la operación. La única condición que
produce severidad 'advertencia' es `tecnico_sin_entrada`, y el único técnico
sin entrada en este escenario es el de prueba — que marca entrada en la tarea
A1. En cuanto lo hace, `_resolver_alertas_obsoletas` le pone 'resuelta' y la
alerta desaparece de la pantalla ANTES de que el participante llegue al
Bloque B, que es justo donde tiene que encontrarla (tarea B2).

Esa función salta a propósito los avisos de «no marcó entrada» de días
anteriores: que hoy sí haya marcado no borra que ayer no lo hizo. Así que la
advertencia se siembra fechada ayer por la tarde, como el aviso que quedó sin
atender del día anterior. Con eso sobrevive a la tarea A1 y los dos bloques
ven las mismas dos alertas, que es lo que hace comparables a los 8
participantes.

La crítica (`tarea_vencida`) no necesita el truco: su causa sigue viva
durante toda la sesión, así que el detector la mantiene pendiente sola.

CÓMO SE CORRE EN EL DESPLIEGUE
-----------------------------
La base de Railway no es alcanzable desde fuera de su red (el servicio de
Postgres no expone proxy público), así que esto NO se puede correr desde la
laptop del moderador contra producción. Se corre DENTRO del contenedor:

    railway ssh --service Backend "cd /app && python seed_neurolab.py --reset"

o con el envoltorio de `scripts/reset-neurolab.ps1`, que es la misma línea.

⚠️  `--reset` BORRA todos los datos de operación (TRUNCATE de todas las
tablas menos la bitácora de auditoría, que es de solo inserción, y
`alembic_version`). Es lo que se quiere entre participantes, y es la razón de
que el flag sea obligatorio: sin él el script no toca nada. Con
SEMBRAR_DEMO=false el despliegue ya tiene datos reales y el script se niega a
correr.
-----------------------------------------------------------------------------
"""
import asyncio
import random
import sys
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.reglas import ESTADOS_TAREA_ACTIVOS, ROL_TECNICO
from app.core.security import hash_password
from app.core.tiempo import ahora as ahora_local, hoy as hoy_local

# Importa TODOS los modelos: el reset recorre Base.metadata para saber qué
# vaciar, y metadata solo conoce las clases importadas (ver seed.py).
import app.models  # noqa: F401

from app.db.base import Base
from app.models.alerta import Alerta
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Tarea
from app.models.ubicacion import UbicacionEmpleado

# Se reutiliza lo que ya está probado del seed de demostración: el borrado, el
# catálogo de pausas, el inventario y el histórico de tareas cerradas. Lo que
# cambia en el experimento es el estado de HOY, y eso es lo que se escribe
# aquí. Importar el módulo no conecta a la base: su engine es perezoso.
import seed as seed_demo
from seed import (
    ConfiguracionSeedInvalida,
    contrasena_demo,
    crear_historial_tareas,
    crear_inventario,
    crear_tipos_pausa,
    punto,
    resetear_base_de_datos,
    sembrar_demo,
    verificar_postgis,
)

engine = create_async_engine(settings.url_migraciones_async, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False
)

HOY = hoy_local()
AYER = HOY - timedelta(days=1)

# Semanas de trabajo ya cerrado que se siembran hacia atrás. Son menos que en
# el seed de demostración (8): el experimento no mira reportes, y menos filas
# hacen el reset de entre participantes más corto.
SEMANAS_HISTORIAL = 4
DIAS_HISTORIAL_ASISTENCIA = SEMANAS_HISTORIAL * 7

# Correos como clave: las tareas y las jornadas apuntan aquí por correo y no
# por índice de lista, para que reordenar la lista no cambie en silencio quién
# tiene qué carga de trabajo.
TECNICO_PRUEBA = "tecnico@teleprogreso.com"
ADMIN_PRUEBA = "admin@teleprogreso.com"


# ═══════════════════════════════════════════════════════════════════════════
# CUENTAS
#
# Solo las dos de la prueba más los 3 técnicos que hacen falta para completar
# la plantilla de 4 que pide el guion. No se siembran supervisor@ ni gerente@:
# el participante no los usa y aparecerían en la pantalla de empleados sin
# pintar nada.
# ═══════════════════════════════════════════════════════════════════════════

EMPLEADOS = [
    {
        "nombre": "Carlos", "apellido": "Administrador",
        "correo": ADMIN_PRUEBA, "contrasena": "Admin1234!",
        "rol": "admin", "telefono": "5550-0001",
        "fecha_contratacion": date(2020, 1, 15),
    },
    {
        "nombre": "Juan", "apellido": "Pérez García",
        "correo": TECNICO_PRUEBA, "contrasena": "Tecnico1234!",
        "rol": "tecnico", "telefono": "5550-0002",
        "fecha_contratacion": date(2022, 6, 1),
    },
    {
        "nombre": "María", "apellido": "López Cardona",
        "correo": "maria.lopez@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "telefono": "5550-0003",
        "fecha_contratacion": date(2022, 8, 15),
    },
    {
        "nombre": "Diego", "apellido": "Morales Ruiz",
        "correo": "diego.morales@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "telefono": "5550-0004",
        "fecha_contratacion": date(2023, 1, 10),
    },
    {
        "nombre": "Ana", "apellido": "Castillo Mejía",
        "correo": "ana.castillo@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "telefono": "5550-0005",
        "fecha_contratacion": date(2023, 5, 22),
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# JORNADA DE HOY
#
# Los 3 técnicos que no son el de prueba entraron y siguen trabajando
# (hora_salida en None): son los «3 en jornada» del panel del supervisor.
# El de prueba no aparece aquí — su entrada la marca el participante en A1.
# ═══════════════════════════════════════════════════════════════════════════

JORNADAS_HOY = [
    {"correo": "maria.lopez@teleprogreso.com", "entrada": time(7, 48)},
    {"correo": "diego.morales@teleprogreso.com", "entrada": time(8, 5)},
    {"correo": "ana.castillo@teleprogreso.com", "entrada": time(7, 52)},
]


# ═══════════════════════════════════════════════════════════════════════════
# TAREAS DEL DÍA
#
# Carga activa que queda (lo que cuenta el selector de reasignación de B3):
#     Juan  (prueba) → 3   ·  las tres pendientes, una urgente (A2)
#     María          → 4   ·  incluye la vencida que levanta la alerta crítica
#     Diego          → 2
#     Ana            → 1   ·  el de menor carga, sin empate posible
#
# «pendiente» en todas las de Juan es deliberado: A2 pide iniciar la urgente,
# y una tarea que ya estuviera en progreso no se puede iniciar.
# ═══════════════════════════════════════════════════════════════════════════

TAREAS = [
    # ── Técnico de prueba (Bloque A) ─────────────────────────────────────────
    {
        # LA DE LA TAREA A2: es la única urgente de su lista.
        "titulo": "Reparación de señal — Tienda El Ahorro",
        "descripcion": (
            "El cliente reporta pérdida total de señal desde anoche. Es un "
            "comercio y no puede cobrar con tarjeta. Revisar splitter y cable "
            "de bajada."
        ),
        "estado_tarea": "pendiente", "prioridad": "urgente",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY,
        "direccion_servicio": "Barrio El Centro, 3 Calle 4-22, Local 5, Fraijanes",
        "coordenada": punto(14.4751, -90.4437),
        "tecnico": TECNICO_PRUEBA,
        "urgente_a2": True,
    },
    {
        "titulo": "Instalación fibra óptica — Residencial Los Álamos",
        "descripcion": (
            "Instalar acometida y ONT en apartamento 3B. El cliente ya cuenta "
            "con canaleta instalada."
        ),
        "estado_tarea": "pendiente", "prioridad": "alta",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Calle 15, Ave. Circunvalación, Bloque B, Apto 3B, Fraijanes",
        "coordenada": punto(14.4728, -90.4408),
        "tecnico": TECNICO_PRUEBA,
    },
    {
        "titulo": "Mantenimiento preventivo — Carlos Mendoza",
        "descripcion": (
            "Limpieza de conectores y revisión de niveles de señal. Contrato "
            "anual de mantenimiento."
        ),
        "estado_tarea": "pendiente", "prioridad": "media",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Col. Universidad, Casa 4, Zona 10, Fraijanes",
        "coordenada": punto(14.4693, -90.4381),
        "tecnico": TECNICO_PRUEBA,
    },

    # ── María: 4 activas, la más cargada ─────────────────────────────────────
    {
        # VENCIDA a propósito: es la ÚNICA alerta crítica del escenario.
        # Sigue 'pendiente' y con fecha_finalizacion pasada, así que su causa
        # está viva toda la sesión y el detector la mantiene sin resolver.
        "titulo": "Cambio de poste dañado — Callejón San José",
        "descripcion": (
            "Poste con inclinación peligrosa tras las lluvias. Coordinar con "
            "la municipalidad antes de intervenir."
        ),
        "estado_tarea": "pendiente", "prioridad": "urgente",
        "fecha_inicio": HOY - timedelta(days=6),
        "fecha_finalizacion": HOY - timedelta(days=3),
        "direccion_servicio": "Callejón San José, frente al parque central, Fraijanes",
        "coordenada": punto(14.4744, -90.4425),
        "tecnico": "maria.lopez@teleprogreso.com",
        "fecha_asignacion": HOY - timedelta(days=6),
        "vencida_critica": True,
    },
    {
        # LA DE LA TAREA B3: la que el moderador indica para reasignar.
        # Es de María (la más cargada) y vence hoy, así que pasarla a otro es
        # una decisión con sentido y no un trámite.
        "titulo": "Instalación TV Cable — Restaurante Sabor Latino",
        "descripcion": (
            "Instalar 3 puntos de TV cable en el área del comedor. El cliente "
            "solicita canales de deportes y noticias."
        ),
        "estado_tarea": "pendiente", "prioridad": "media",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY,
        "direccion_servicio": "Bo. Guamilito, 5 Ave 4 Calle, Fraijanes",
        "coordenada": punto(14.4776, -90.4459),
        "tecnico": "maria.lopez@teleprogreso.com",
        "reasignar_b3": True,
    },
    {
        "titulo": "Revisión de equipo — María Josefa Rodríguez",
        "descripcion": (
            "Cliente reporta que el router no enciende después de una tormenta "
            "eléctrica. Posible daño por sobretensión."
        ),
        "estado_tarea": "en_progreso", "prioridad": "alta",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Res. El Portal, Senda 3, Casa 12, Fraijanes",
        "coordenada": punto(14.4712, -90.4502),
        "tecnico": "maria.lopez@teleprogreso.com",
    },
    {
        "titulo": "Ampliación de red — Supermercado La Antorcha",
        "descripcion": (
            "Agregar 5 puntos de red adicionales en bodega y oficinas "
            "administrativas. Ya se tiene el cable corrido."
        ),
        "estado_tarea": "pendiente", "prioridad": "media",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Salida a La Lima, KM 18.5, Fraijanes",
        "coordenada": punto(14.4805, -90.4344),
        "tecnico": "maria.lopez@teleprogreso.com",
    },

    # ── Diego: 2 activas ─────────────────────────────────────────────────────
    {
        "titulo": "Cambio de router — Farmacia La Salud",
        "descripcion": "Equipo con falla de fuente. Sustituir y recuperar la configuración.",
        "estado_tarea": "en_progreso", "prioridad": "media",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY,
        "direccion_servicio": "Zona 1, casco urbano, 2 Ave 3-15, Fraijanes",
        "coordenada": punto(14.4762, -90.4398),
        "tecnico": "diego.morales@teleprogreso.com",
    },
    {
        "titulo": "Instalación de cámara IP — Colegio Mixto Fraijanes",
        "descripcion": "Montar 4 cámaras en el patio y agregarlas al NVR del colegio.",
        "estado_tarea": "pendiente", "prioridad": "alta",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Col. Las Victorias, 6 Calle, Fraijanes",
        "coordenada": punto(14.4659, -90.4419),
        "tecnico": "diego.morales@teleprogreso.com",
    },

    # ── Ana: 1 activa, la de menor carga ─────────────────────────────────────
    {
        "titulo": "Retiro de equipo — Abarrotería Doña Tere",
        "descripcion": "El cliente canceló el servicio. Retirar ONT y decodificador.",
        "estado_tarea": "pendiente", "prioridad": "baja",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=2),
        "direccion_servicio": "Bo. La Esperanza, 4 Ave 2-30, Fraijanes",
        "coordenada": punto(14.4688, -90.4463),
        "tecnico": "ana.castillo@teleprogreso.com",
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# ÚLTIMA POSICIÓN GPS DE LOS TÉCNICOS EN JORNADA
#
# Alimenta la distancia que el selector de reasignación muestra al lado de la
# carga de trabajo (GET /empleados/tecnicos/disponibles?id_tarea=...). Ana,
# además de ser la de menor carga, queda la más cerca de la tarea de B3: así
# carga y cercanía apuntan al mismo técnico y la decisión no es ambigua.
#
# El técnico de prueba NO lleva posición: no ha abierto su jornada, y la API
# tampoco acepta puntos sin jornada abierta.
# ═══════════════════════════════════════════════════════════════════════════

UBICACIONES_HOY = [
    # Distancias aproximadas a la tarea de B3 (Bo. Guamilito, 14.4776/-90.4459):
    {"correo": "ana.castillo@teleprogreso.com",  "lat": 14.4782, "lon": -90.4404},  # ~600 m
    {"correo": "maria.lopez@teleprogreso.com",   "lat": 14.4712, "lon": -90.4502},  # ~800 m
    {"correo": "diego.morales@teleprogreso.com", "lat": 14.4659, "lon": -90.4419},  # ~1.4 km
]


def hora_pasada(objetivo: time, margen_minutos: int = 30) -> time:
    """
    `objetivo`, o la hora de hace `margen_minutos` si `objetivo` aún no llegó.

    Las jornadas sembradas tienen que estar ya empezadas cuando se siembran, o
    el panel del supervisor contaría como «en jornada» a alguien que entrará
    más tarde. En una sesión de laboratorio a media mañana esto devuelve
    siempre la hora fija; el recorte solo actúa si el reset se corre de
    madrugada.
    """
    ahora = ahora_local()
    momento = ahora.replace(
        hour=objetivo.hour, minute=objetivo.minute, second=0, microsecond=0
    )
    tope = ahora - timedelta(minutes=margen_minutos)
    if momento > tope:
        momento = tope
    # Reset de madrugada: `tope` se fue al día anterior y esa hora no sirve
    # como entrada de hoy.
    if momento.date() < ahora.date():
        momento = ahora.replace(hour=0, minute=5, second=0, microsecond=0)
    return momento.time()


# ═══════════════════════════════════════════════════════════════════════════
# SIEMBRA
# ═══════════════════════════════════════════════════════════════════════════

async def crear_empleados(
    db: AsyncSession, contrasena: str | None = None
) -> dict[str, Empleado]:
    """
    Crea las cuentas y las devuelve indexadas por correo. `contrasena` (la de
    CONTRASENA_DEMO) reemplaza a la de cada cuenta.
    """
    print("\n👤 Creando cuentas...")
    por_correo: dict[str, Empleado] = {}

    for datos in EMPLEADOS:
        empleado = Empleado(
            nombre=datos["nombre"],
            apellido=datos["apellido"],
            correo=datos["correo"],
            hash_contrasena=hash_password(contrasena or datos["contrasena"]),
            rol=datos["rol"],
            # Todas activas: una cuenta inactiva no suma a la plantilla de 4
            # técnicos que cuenta el panel, y aquí la plantilla es dato del
            # escenario.
            estado="activo",
            telefono=datos["telefono"],
            fecha_contratacion=datos["fecha_contratacion"],
        )
        db.add(empleado)
        por_correo[datos["correo"]] = empleado

    await db.flush()
    tecnicos = sum(1 for e in por_correo.values() if e.rol == ROL_TECNICO)
    print(f"   ✅ {len(por_correo)} cuentas ({tecnicos} técnicos en plantilla)")
    return por_correo


async def crear_tareas_del_dia(
    db: AsyncSession,
    empleados: dict[str, Empleado],
) -> dict[str, Tarea]:
    """
    Crea las tareas de hoy y las asigna.

    Devuelve las que el resto del script necesita señalar por su nombre: la
    urgente de A2, la vencida que levanta la alerta crítica y la que se
    reasigna en B3.
    """
    print("\n📋 Creando las tareas del día...")
    creadas: list[Tarea] = []
    marcadas: dict[str, Tarea] = {}

    for datos in TAREAS:
        tarea = Tarea(
            titulo=datos["titulo"],
            descripcion=datos["descripcion"],
            estado_tarea=datos["estado_tarea"],
            prioridad=datos["prioridad"],
            fecha_inicio=datos["fecha_inicio"],
            fecha_finalizacion=datos["fecha_finalizacion"],
            direccion_servicio=datos["direccion_servicio"],
            coordenada_servicio=datos["coordenada"],
            fecha_asignacion=datos.get("fecha_asignacion", HOY),
            # Ninguna está cerrada: `fecha_completado` es lo que distingue una
            # tarea cerrada de una abierta en los reportes y el historial.
            fecha_completado=None,
        )
        db.add(tarea)
        creadas.append(tarea)

    await db.flush()

    for tarea, datos in zip(creadas, TAREAS):
        db.add(
            EmpleadoTarea(
                id_empleado=empleados[datos["tecnico"]].id_empleado,
                id_tarea=tarea.id_tarea,
            )
        )
        for clave in ("urgente_a2", "vencida_critica", "reasignar_b3"):
            if datos.get(clave):
                marcadas[clave] = tarea

    await db.flush()
    print(f"   ✅ {len(creadas)} tareas asignadas")
    return marcadas


async def crear_jornada_de_hoy(
    db: AsyncSession,
    empleados: dict[str, Empleado],
) -> None:
    """
    Abre la jornada de los 3 técnicos que no son el de prueba.

    Sin `hora_salida`: es lo que hace que el panel los cuente como «en jornada
    ahora mismo». No se siembran pausas de hoy — a media mañana todavía no
    habría ninguna, y una pausa con hora futura deja la pantalla del técnico
    mostrando un almuerzo gastado antes de tomarlo.
    """
    print("\n🕗 Abriendo la jornada de hoy...")

    for datos in JORNADAS_HOY:
        db.add(
            Asistencia(
                id_empleado=empleados[datos["correo"]].id_empleado,
                fecha=HOY,
                hora_entrada=hora_pasada(datos["entrada"]),
                hora_salida=None,
                coordenada_entrada=punto(14.4744, -90.4425),
                coordenada_salida=None,
            )
        )

    await db.flush()
    nombre = f"{empleados[TECNICO_PRUEBA].nombre} {empleados[TECNICO_PRUEBA].apellido}"
    print(f"   ✅ {len(JORNADAS_HOY)} técnicos en jornada")
    print(f"   ℹ️  {nombre} queda SIN entrada marcada (es la tarea A1)")


async def crear_historial_asistencia(
    db: AsyncSession,
    empleados: dict[str, Empleado],
) -> None:
    """
    Jornadas ya cerradas de los días hábiles anteriores, con su almuerzo.

    No afecta a ninguna métrica de hoy: existe para que el historial y los
    reportes no se vean vacíos si el participante entra a curiosear, que el
    guion permite explícitamente («puede navegar libremente»).

    Usa su propio generador aleatorio y no el global: así estas horas no
    corren la secuencia que `crear_historial_tareas` consume después, y dos
    resets seguidos producen exactamente el mismo historial.
    """
    print("\n🗓️  Generando el historial de días anteriores...")
    azar = random.Random(11)
    tecnicos = [e for e in empleados.values() if e.rol == ROL_TECNICO]
    jornadas = 0

    for delta in range(DIAS_HISTORIAL_ASISTENCIA, 0, -1):
        dia = HOY - timedelta(days=delta)
        if dia.weekday() >= 5:          # sábado y domingo no se opera
            continue

        for tecnico in tecnicos:
            # Alguna ausencia suelta, para que el historial no salga perfecto.
            if azar.random() < 0.08:
                continue

            entrada = (
                datetime.combine(dia, time(8, 0))
                + timedelta(minutes=azar.randint(-20, 20))
            ).time()
            salida = (
                datetime.combine(dia, time(17, 0))
                + timedelta(minutes=azar.randint(-15, 40))
            ).time()

            asistencia = Asistencia(
                id_empleado=tecnico.id_empleado,
                fecha=dia,
                hora_entrada=entrada,
                hora_salida=salida,
                coordenada_entrada=punto(
                    14.4744 + azar.uniform(-0.004, 0.004),
                    -90.4425 + azar.uniform(-0.004, 0.004),
                ),
                coordenada_salida=punto(
                    14.4744 + azar.uniform(-0.010, 0.010),
                    -90.4425 + azar.uniform(-0.010, 0.010),
                ),
            )
            db.add(asistencia)
            await db.flush()
            jornadas += 1

            almuerzo = datetime.combine(dia, time(12, 0)) + timedelta(
                minutes=azar.randint(0, 40)
            )
            db.add(
                Descanso(
                    id_asistencia=asistencia.id_asistencia,
                    hora_inicio=almuerzo.time(),
                    hora_fin=(almuerzo + timedelta(minutes=azar.randint(40, 60))).time(),
                    # El tipo tiene que ir: sin él la pantalla de pausas la
                    # etiqueta como genérica y le aplica otro límite.
                    tipo="almuerzo",
                )
            )

    await db.flush()
    print(f"   ✅ {jornadas} jornadas cerradas en los últimos {DIAS_HISTORIAL_ASISTENCIA} días")


async def crear_ubicaciones_de_hoy(
    db: AsyncSession,
    empleados: dict[str, Empleado],
) -> None:
    """Última posición de los técnicos en jornada (la distancia que ve B3)."""
    print("\n📍 Registrando la posición de los técnicos en jornada...")
    # 20 minutos: muy dentro de HORAS_UBICACION_RECIENTE (8 h), así que el
    # selector de reasignación las trata como «donde está ahora».
    hace_un_rato = ahora_local() - timedelta(minutes=20)

    for datos in UBICACIONES_HOY:
        db.add(
            UbicacionEmpleado(
                id_empleado=empleados[datos["correo"]].id_empleado,
                fecha_hora_registro=hace_un_rato,
                coordenada=punto(datos["lat"], datos["lon"]),
                evento="periodico",
            )
        )

    await db.flush()
    print(f"   ✅ {len(UBICACIONES_HOY)} posiciones registradas")


async def subir_el_stock_al_minimo(db: AsyncSession) -> None:
    """
    Deja todo el inventario por encima de su mínimo.

    `crear_inventario` siembra 3 materiales bajo mínimo a propósito, porque en
    la demo alimentan el tab de stock crítico. Aquí estorban: cada uno es una
    alerta `stock_critico` de severidad crítica, y el guion pide exactamente
    una crítica. Se corrige con una sentencia en vez de duplicando la lista de
    materiales, para que el inventario siga teniendo un solo dueño.
    """
    resultado = await db.execute(
        text(
            "UPDATE material SET cantidad_disponible = stock_minimo * 2 "
            "WHERE cantidad_disponible < stock_minimo"
        )
    )
    print(
        f"\n📦 Inventario: {resultado.rowcount or 0} materiales repuestos por "
        "encima del mínimo (el experimento no lleva alertas de stock)"
    )


async def crear_alertas(
    db: AsyncSession,
    empleados: dict[str, Empleado],
    marcadas: dict[str, Tarea],
) -> None:
    """
    Siembra las dos alertas pendientes de la tarea B2: una crítica y una de
    advertencia.

    Se siembran y no se dejan a la detección automática por dos razones. La
    primera es que la detección solo corre cuando alguien abre la pantalla de
    alertas, así que hasta entonces el contador del menú marcaría cero. La
    segunda, la de la advertencia, está explicada arriba en la cabecera del
    archivo: fechada hoy no sobrevive a la tarea A1.

    El detector no las duplica: para decidir si crea una alerta mira las que
    ya están pendientes con el mismo `tipo + referencia`, sin importar su
    fecha, y estas dos lo están.
    """
    print("\n🔔 Sembrando las dos alertas de la tarea B2...")

    vencida = marcadas["vencida_critica"]
    tecnico = empleados[TECNICO_PRUEBA]

    db.add(
        Alerta(
            tipo="tarea_vencida",
            severidad="critica",
            estado="pendiente",
            referencia=f"tarea:{vencida.id_tarea}",
            # Esta mañana: la pantalla la muestra como «Hace N h» y el
            # detector la reconoce como la alerta de hoy de esa tarea.
            fecha=datetime.combine(HOY, time(7, 5)),
        )
    )
    db.add(
        Alerta(
            tipo="tecnico_sin_entrada",
            severidad="advertencia",
            estado="pendiente",
            referencia=f"empleado:{tecnico.id_empleado}",
            # Ayer por la tarde. Es lo que la hace sobrevivir a la tarea A1:
            # el cierre automático salta los avisos de «no marcó entrada» que
            # no son del día en curso.
            fecha=datetime.combine(AYER, time(17, 40)),
        )
    )

    await db.flush()
    print("   ✅ 1 crítica (tarea vencida) + 1 advertencia (técnico sin entrada)")


# ═══════════════════════════════════════════════════════════════════════════
# VERIFICACIÓN
#
# El moderador tiene ~2 minutos entre participantes y no le va a dar tiempo de
# revisar la app a mano. El script comprueba él mismo que el escenario quedó
# como lo pide el guion y lo dice en una línea por condición.
# ═══════════════════════════════════════════════════════════════════════════

async def verificar_escenario(db: AsyncSession) -> list[str]:
    """Comprueba las condiciones del guion. Devuelve la lista de fallos."""
    fallos: list[str] = []

    def comprobar(etiqueta: str, obtenido, esperado) -> None:
        if obtenido == esperado:
            print(f"   ✅ {etiqueta}: {obtenido}")
        else:
            print(f"   ❌ {etiqueta}: {obtenido} (se esperaba {esperado})")
            fallos.append(f"{etiqueta}: {obtenido} en vez de {esperado}")

    # Plantilla y jornada
    tecnicos_total = await db.scalar(
        select(func.count(Empleado.id_empleado)).where(
            Empleado.rol == ROL_TECNICO, Empleado.estado == "activo"
        )
    )
    comprobar("Técnicos en plantilla", tecnicos_total, 4)

    en_jornada = await db.scalar(
        select(func.count(func.distinct(Asistencia.id_empleado)))
        .join(Empleado, Empleado.id_empleado == Asistencia.id_empleado)
        .where(
            Asistencia.fecha == HOY,
            Asistencia.hora_entrada.is_not(None),
            Asistencia.hora_salida.is_(None),
            Empleado.rol == ROL_TECNICO,
            Empleado.estado == "activo",
        )
    )
    comprobar("Técnicos en jornada", en_jornada, 3)

    # El técnico de prueba, sin entrada y con sus 3 tareas
    id_prueba = await db.scalar(
        select(Empleado.id_empleado).where(Empleado.correo == TECNICO_PRUEBA)
    )
    entradas_prueba = await db.scalar(
        select(func.count(Asistencia.id_asistencia)).where(
            Asistencia.id_empleado == id_prueba, Asistencia.fecha == HOY
        )
    )
    comprobar("Jornadas de hoy del técnico de prueba", entradas_prueba, 0)

    tareas_prueba = await db.execute(
        select(Tarea.prioridad, Tarea.estado_tarea)
        .join(EmpleadoTarea, EmpleadoTarea.id_tarea == Tarea.id_tarea)
        .where(
            EmpleadoTarea.id_empleado == id_prueba,
            Tarea.estado_tarea.in_(ESTADOS_TAREA_ACTIVOS),
        )
    )
    filas = tareas_prueba.all()
    comprobar("Tareas activas del técnico de prueba", len(filas), 3)
    comprobar(
        "De ellas, urgentes y todavía pendientes",
        sum(1 for p, e in filas if p == "urgente" and e == "pendiente"),
        1,
    )

    # Cargas de los demás: tres números distintos y ningún empate en el mínimo
    cargas = await db.execute(
        select(Empleado.nombre, func.count(EmpleadoTarea.id_tarea))
        .join(EmpleadoTarea, EmpleadoTarea.id_empleado == Empleado.id_empleado)
        .join(Tarea, Tarea.id_tarea == EmpleadoTarea.id_tarea)
        .where(
            Empleado.rol == ROL_TECNICO,
            Empleado.id_empleado != id_prueba,
            Tarea.estado_tarea.in_(ESTADOS_TAREA_ACTIVOS),
        )
        .group_by(Empleado.nombre)
    )
    por_tecnico = dict(cargas.all())
    comprobar("Cargas distintas entre los otros técnicos", sorted(por_tecnico.values()), [1, 2, 4])

    # Alertas
    pendientes = await db.execute(
        select(Alerta.severidad, func.count(Alerta.id_alerta))
        .where(Alerta.estado == "pendiente")
        .group_by(Alerta.severidad)
    )
    por_severidad = dict(pendientes.all())
    comprobar("Alertas críticas pendientes", por_severidad.get("critica", 0), 1)
    comprobar("Alertas de advertencia pendientes", por_severidad.get("advertencia", 0), 1)

    # Stock: ni una alerta de inventario
    bajo_minimo = await db.scalar(
        text("SELECT COUNT(*) FROM material WHERE cantidad_disponible < stock_minimo")
    )
    comprobar("Materiales bajo el mínimo", bajo_minimo, 0)

    return fallos


async def imprimir_hoja_del_moderador(
    db: AsyncSession, marcadas: dict[str, Tarea], con_contrasena_demo: bool = False
) -> None:
    """
    Los datos que el moderador necesita a la vista durante la sesión. Sin
    contraseñas: este texto queda en el log del despliegue.
    """
    pendientes = await db.scalar(
        select(func.count(Tarea.id_tarea)).where(Tarea.estado_tarea == "pendiente")
    )

    print("\n" + "=" * 72)
    print("  HOJA DEL MODERADOR — estado de partida")
    print("=" * 72)
    print("\n  Cuentas (hoja impresa de credenciales):")
    print(f"    Bloque A · técnico     {TECNICO_PRUEBA}")
    print(f"    Bloque B · supervisor  {ADMIN_PRUEBA}")
    if con_contrasena_demo:
        print("    Contraseña: la de CONTRASENA_DEMO (la entrega el equipo).")
    else:
        print("    Contraseñas: las de EMPLEADOS en seed_neurolab.py (solo desarrollo).")

    print("\n  Tareas señaladas:")
    print(f"    A2 · la urgente a iniciar   «{marcadas['urgente_a2'].titulo}»")
    print(f"    B3 · la que se reasigna     «{marcadas['reasignar_b3'].titulo}»")
    print(f"         (es de María López; el de menor carga es Ana Castillo)")
    print(f"    B2 · la alerta crítica      «{marcadas['vencida_critica'].titulo}» (vencida)")

    print("\n  Números del panel del supervisor (tarea B1):")
    print(f"    Al sembrar:                 3 de 4 técnicos en jornada · {pendientes} tareas pendientes")
    print(f"    En B1, si A1 y A2 salieron: 4 de 4 técnicos en jornada · {pendientes - 1} tareas pendientes")
    print( "    Si el participante falló A1: 3 de 4 ·  si falló A2: una pendiente más")
    print( "    (B1 se acierta diciendo lo que la pantalla muestra en ese momento)")
    print("\n" + "=" * 72)


# ═══════════════════════════════════════════════════════════════════════════
# ENTRYPOINT
# ═══════════════════════════════════════════════════════════════════════════

AVISO_SIN_FLAG = """
seed_neurolab.py — estado de partida de la prueba del NeuroLab

Este script BORRA todos los datos de operación y vuelve a sembrar el
escenario del experimento. No hace nada sin el flag explícito:

    python seed_neurolab.py --reset

En el despliegue se corre dentro del contenedor, porque la base de Railway no
es alcanzable desde fuera de su red:

    railway ssh --service Backend "cd /app && python seed_neurolab.py --reset"
"""


async def sembrar() -> None:
    # Antes del reset, que borra todo: con la configuración mal puesta no se
    # toca la base.
    if not sembrar_demo():
        print(
            "\n⛔ SEMBRAR_DEMO=false: este despliegue ya no es de demostración. "
            "seed_neurolab.py borraría sus datos y no se ejecuta."
        )
        raise SystemExit(1)
    try:
        clave_demo = contrasena_demo([datos["correo"] for datos in EMPLEADOS])
    except ConfiguracionSeedInvalida as error:
        print(f"\n⛔ No se siembra nada: {error}")
        raise SystemExit(1)

    async with AsyncSessionLocal() as db:
        await verificar_postgis(db)

    async with AsyncSessionLocal() as db:
        await resetear_base_de_datos(db)

    print("\n🧪 Sembrando el escenario del NeuroLab...")
    async with AsyncSessionLocal() as db:
        await crear_tipos_pausa(db)
        empleados = await crear_empleados(db, clave_demo)
        tecnicos = [e for e in empleados.values() if e.rol == ROL_TECNICO]

        # El histórico va primero a propósito: GET /tareas corta por id
        # descendente, así que las tareas de hoy tienen que quedar con los ids
        # más altos para que el relleno no las desplace nunca.
        #
        # La semilla se fija aquí y no al importar: `crear_historial_tareas`
        # consume el `random` global, y fijarla justo antes garantiza que todos
        # los participantes vean el mismo historial.
        random.seed(2026)
        await crear_historial_tareas(db, tecnicos, semanas=SEMANAS_HISTORIAL)

        marcadas = await crear_tareas_del_dia(db, empleados)
        await crear_inventario(db, tecnicos)
        await subir_el_stock_al_minimo(db)
        await crear_historial_asistencia(db, empleados)
        await crear_jornada_de_hoy(db, empleados)
        await crear_ubicaciones_de_hoy(db, empleados)
        await crear_alertas(db, empleados, marcadas)

        await db.commit()

    async with AsyncSessionLocal() as db:
        print("\n🔍 Verificando el escenario...")
        fallos = await verificar_escenario(db)
        await imprimir_hoja_del_moderador(
            db, marcadas, con_contrasena_demo=clave_demo is not None
        )

    await engine.dispose()
    await seed_demo.engine.dispose()

    if fallos:
        print("\n⚠️  EL ESCENARIO NO QUEDÓ COMO LO PIDE EL GUION:")
        for fallo in fallos:
            print(f"     · {fallo}")
        print("\n   NO empieces la sesión sin revisar esto.")
        raise SystemExit(1)

    print("\n✅ Escenario listo. La app puede recibir al siguiente participante.")


def main(argumentos: list[str]) -> int:
    if "--reset" not in argumentos:
        print(AVISO_SIN_FLAG)
        return 2
    asyncio.run(sembrar())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
