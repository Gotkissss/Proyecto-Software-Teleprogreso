"""
seed.py — Datos de demostración para Teleprogreso S.A.
-----------------------------------------------------------------------------
Siembra la base de datos con un escenario realista y completo:

  - Catálogo de tipos de pausa (tabla tipo_pausa)
  - 8 empleados (admin, supervisor, gerente y 5 técnicos)
  - 12 tareas con coordenadas reales de Fraijanes, repartidas entre técnicos
  - Inventario: 3 vehículos, 8 herramientas y 8 materiales (algunos bajo stock)
  - Asignación de vehículos y herramientas a técnicos
  - Historial de asistencia de 14 días con pausas, llegadas tarde y una
    jornada sin salida marcada
  - Ubicaciones GPS de los técnicos (las dibuja el mapa de ruta)
  - Evidencias (incidencias) en las tareas completadas

Las alertas NO se siembran a mano: las genera el propio backend al abrir la
pantalla de alertas, a partir de estos datos (tareas vencidas, técnicos sin
entrada y materiales bajo el mínimo).

MODOS DE EJECUCIÓN
------------------
Por defecto es idempotente: si ya existen empleados no hace nada, para no
pisar datos de desarrollo.

Para BORRAR TODO y volver a sembrar desde cero:

    SEED_RESET=true python seed.py      (o el flag  --reset)

Es lo que permite repoblar un entorno ya desplegado, como Railway, donde no se
puede hacer `docker compose down -v`. El reset vacía todas las tablas de datos
pero NO toca `alembic_version`: el esquema se sigue gobernando con migraciones.

⚠️ SEED_RESET destruye datos. En Railway se activa, se despliega una vez y se
vuelve a poner en false, o el siguiente reinicio del contenedor borrará todo
otra vez.
-----------------------------------------------------------------------------
"""
import asyncio
import os
import random
import sys
from datetime import date, datetime, time, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.security import hash_password
# Reloj de la operación (America/Guatemala). El contenedor corre en UTC: con
# `datetime.now()` los datos sembrados quedaban 6 horas en el futuro, así que
# las ubicaciones del seed tapaban a las que el técnico reportaba de verdad y
# `date.today()` cambiaba de día a las 18:00 hora local.
from app.core.tiempo import ahora as ahora_local, hoy as hoy_local
from app.db.base import Base

# Importa TODOS los modelos, no solo los que este script instancia. El reset
# recorre Base.metadata para saber qué vaciar, y metadata solo conoce las
# clases que se hayan importado: sin esta línea el TRUNCATE se saltaría
# `alerta` y `token_revocado`, y las alertas viejas sobrevivirían al borrado.
import app.models  # noqa: F401

from app.models.activo import (
    Activo,
    Carro,
    CarroHerramienta,
    Herramienta,
    Material,
)
from app.models.asistencia import Asistencia, Descanso
from app.models.empleado import Empleado, EmpleadoCarro, EmpleadoTarea
from app.models.pausa import TipoPausa
from app.models.tarea import Incidencia, Tarea
from app.models.ubicacion import UbicacionEmpleado

# Semilla fija: dos ejecuciones sobre BD limpia producen el mismo escenario,
# lo que hace reproducibles las capturas y las pruebas manuales.
random.seed(2026)

# Motor de base de datos
engine = create_async_engine(settings.DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False
)

HOY = hoy_local()


def punto(lat: float, lon: float) -> str:
    """WKT de un punto para las columnas Geography (PostGIS espera lon lat)."""
    return f"SRID=4326;POINT({lon} {lat})"


# ═══════════════════════════════════════════════════════════════════════════
# CATÁLOGO DE TIPOS DE PAUSA
# Es dato de operación, no configuración de código: el router de descanso lo
# lee de esta tabla. La migración 0005 lo inserta al crear la tabla; aquí se
# vuelve a sembrar porque el reset vacía todas las tablas.
# ═══════════════════════════════════════════════════════════════════════════

TIPOS_PAUSA = [
    {"id": "almuerzo", "label": "Pausa de Almuerzo",       "duracion_max_min": 60, "orden": 1},
    {"id": "tecnica",  "label": "Pausa Técnica (Soporte)", "duracion_max_min": 15, "orden": 2},
    {"id": "personal", "label": "Pausa Personal",          "duracion_max_min": 10, "orden": 3},
]


# ═══════════════════════════════════════════════════════════════════════════
# EMPLEADOS
# ═══════════════════════════════════════════════════════════════════════════

EMPLEADOS = [
    {
        "nombre": "Carlos", "apellido": "Administrador",
        "correo": "admin@teleprogreso.com", "contrasena": "Admin1234!",
        "rol": "admin", "estado": "activo", "telefono": "5550-0001",
        "fecha_contratacion": date(2020, 1, 15),
    },
    {
        "nombre": "Lucía", "apellido": "Ramírez Soto",
        "correo": "supervisor@teleprogreso.com", "contrasena": "Super1234!",
        "rol": "supervisor", "estado": "activo", "telefono": "5550-0010",
        "fecha_contratacion": date(2021, 3, 8),
    },
    {
        "nombre": "Ricardo", "apellido": "Estrada Molina",
        "correo": "gerente@teleprogreso.com", "contrasena": "Gerente1234!",
        "rol": "gerente", "estado": "activo", "telefono": "5550-0011",
        "fecha_contratacion": date(2019, 9, 2),
    },
    {
        "nombre": "Juan", "apellido": "Pérez García",
        "correo": "tecnico@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "estado": "activo", "telefono": "5550-0002",
        "fecha_contratacion": date(2022, 6, 1),
    },
    {
        "nombre": "María", "apellido": "López Cardona",
        "correo": "maria.lopez@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "estado": "activo", "telefono": "5550-0003",
        "fecha_contratacion": date(2022, 8, 15),
    },
    {
        "nombre": "Diego", "apellido": "Morales Ruiz",
        "correo": "diego.morales@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "estado": "activo", "telefono": "5550-0004",
        "fecha_contratacion": date(2023, 1, 10),
    },
    {
        "nombre": "Ana", "apellido": "Castillo Mejía",
        "correo": "ana.castillo@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "estado": "activo", "telefono": "5550-0005",
        "fecha_contratacion": date(2023, 5, 22),
    },
    {
        # Inactivo a propósito: sirve para probar el filtro de estado y que
        # el login rechace cuentas desactivadas.
        "nombre": "Pedro", "apellido": "Hernández Cruz",
        "correo": "pedro.hernandez@teleprogreso.com", "contrasena": "Tecnico1234!",
        "rol": "tecnico", "estado": "inactivo", "telefono": "5550-0006",
        "fecha_contratacion": date(2021, 11, 3),
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# TAREAS — coordenadas del casco urbano de Fraijanes, Guatemala
# El índice de "tecnico" apunta a la lista de técnicos activos.
# ═══════════════════════════════════════════════════════════════════════════

TAREAS = [
    {
        "titulo": "Instalación fibra óptica — Residencial Los Álamos",
        "descripcion": "Instalar acometida y ONT en apartamento 3B. El cliente ya cuenta con canaleta instalada.",
        "estado_tarea": "pendiente", "prioridad": "alta",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Calle 15, Ave. Circunvalación, Bloque B, Apto 3B, Fraijanes",
        "coordenada": punto(14.4728, -90.4408), "tecnico": 0,
        "fecha_asignacion": HOY,
    },
    {
        "titulo": "Reparación de señal — Tienda El Ahorro",
        "descripcion": "El cliente reporta pérdida intermitente de señal desde hace 3 días. Revisar splitter y cable de bajada.",
        "estado_tarea": "en_progreso", "prioridad": "urgente",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY,
        "direccion_servicio": "Barrio El Centro, 3 Calle 4-22, Local 5, Fraijanes",
        "coordenada": punto(14.4751, -90.4437), "tecnico": 0,
        "fecha_asignacion": HOY,
    },
    {
        "titulo": "Mantenimiento preventivo — Carlos Mendoza",
        "descripcion": "Limpieza de conectores y revisión de niveles de señal. Contrato anual de mantenimiento.",
        "estado_tarea": "pendiente", "prioridad": "media",
        "fecha_inicio": HOY + timedelta(days=1), "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Col. Universidad, Casa 4, Zona 10, Fraijanes",
        "coordenada": punto(14.4693, -90.4381), "tecnico": 1,
        "fecha_asignacion": HOY,
    },
    {
        "titulo": "Instalación TV Cable — Restaurante Sabor Latino",
        "descripcion": "Instalar 3 puntos de TV cable en el área del comedor. El cliente solicita canales de deportes y noticias.",
        "estado_tarea": "pendiente", "prioridad": "media",
        "fecha_inicio": HOY + timedelta(days=2), "fecha_finalizacion": HOY + timedelta(days=2),
        "direccion_servicio": "Bo. Guamilito, 5 Ave 4 Calle, Fraijanes",
        "coordenada": punto(14.4776, -90.4459), "tecnico": 1,
        "fecha_asignacion": HOY,
    },
    {
        "titulo": "Revisión de equipo — María Josefa Rodríguez",
        "descripcion": "Cliente reporta que el router no enciende después de una tormenta eléctrica. Posible daño por sobretensión.",
        "estado_tarea": "en_progreso", "prioridad": "alta",
        "fecha_inicio": HOY, "fecha_finalizacion": HOY + timedelta(days=1),
        "direccion_servicio": "Res. El Portal, Senda 3, Casa 12, Fraijanes",
        "coordenada": punto(14.4712, -90.4502), "tecnico": 2,
        "fecha_asignacion": HOY,
    },
    {
        "titulo": "Ampliación de red — Supermercado La Antorcha",
        "descripcion": "Agregar 5 puntos de red adicionales en bodega y oficinas administrativas. Ya se tiene el cable corrido.",
        "estado_tarea": "completado", "prioridad": "media",
        "fecha_inicio": HOY - timedelta(days=2), "fecha_finalizacion": HOY - timedelta(days=1),
        "direccion_servicio": "Salida a La Lima, KM 18.5, Fraijanes",
        "coordenada": punto(14.4805, -90.4344), "tecnico": 0,
        "fecha_asignacion": HOY - timedelta(days=3),
        "evidencia": (
            "Se instalaron los 5 puntos de red solicitados y se certificaron con "
            "probador de categoría 6. Se etiquetó cada roseta en bodega y oficinas. "
            "Cliente conforme, firmó la boleta de servicio."
        ),
    },
    {
        # VENCIDA a propósito: dispara la alerta 'tarea_vencida'.
        "titulo": "Cambio de poste dañado — Callejón San José",
        "descripcion": "Poste con inclinación peligrosa tras las lluvias. Coordinar con la municipalidad antes de intervenir.",
        "estado_tarea": "pendiente", "prioridad": "urgente",
        "fecha_inicio": HOY - timedelta(days=6), "fecha_finalizacion": HOY - timedelta(days=3),
        "direccion_servicio": "Callejón San José, frente al parque central, Fraijanes",
        "coordenada": punto(14.4744, -90.4425), "tecnico": 2,
        "fecha_asignacion": HOY - timedelta(days=6),
    },
    {
        # Segunda vencida, con otro técnico, para ver varias alertas a la vez.
        "titulo": "Migración a fibra — Clínica Santa Lucía",
        "descripcion": "Migrar el enlace de cobre a fibra sin cortar el servicio en horario de atención.",
        "estado_tarea": "en_progreso", "prioridad": "alta",
        "fecha_inicio": HOY - timedelta(days=5), "fecha_finalizacion": HOY - timedelta(days=2),
        "direccion_servicio": "2 Ave. 6-40, Zona 1, Fraijanes",
        "coordenada": punto(14.4762, -90.4398), "tecnico": 3,
        "fecha_asignacion": HOY - timedelta(days=5),
    },
    {
        "titulo": "Instalación de cámara IP — Ferretería El Tornillo",
        "descripcion": "Montar 2 cámaras IP en fachada y configurarlas en el NVR del cliente.",
        "estado_tarea": "pendiente", "prioridad": "baja",
        "fecha_inicio": HOY + timedelta(days=3), "fecha_finalizacion": HOY + timedelta(days=4),
        "direccion_servicio": "Bo. La Esperanza, 7 Calle 2-15, Fraijanes",
        "coordenada": punto(14.4688, -90.4463), "tecnico": 3,
        "fecha_asignacion": HOY,
    },
    {
        "titulo": "Soporte a cliente corporativo — Beneficio de Café",
        "descripcion": "Latencia alta en el enlace dedicado. Medir throughput y revisar configuración del router de borde.",
        "estado_tarea": "completado", "prioridad": "alta",
        "fecha_inicio": HOY - timedelta(days=4), "fecha_finalizacion": HOY - timedelta(days=4),
        "direccion_servicio": "Aldea El Cerrito, KM 22 carretera a Fraijanes",
        "coordenada": punto(14.4831, -90.4287), "tecnico": 1,
        "fecha_asignacion": HOY - timedelta(days=5),
        "evidencia": (
            "Se detectó un cable UTP en mal estado entre el ODF y el router de borde. "
            "Se reemplazó el patch cord y la latencia bajó de 180 ms a 12 ms. "
            "Se dejó evidencia de las pruebas de velocidad."
        ),
    },
    {
        "titulo": "Retiro de equipo — Cliente dado de baja",
        "descripcion": "Recuperar ONT y decodificador del cliente que canceló el servicio el mes pasado.",
        "estado_tarea": "cancelado", "prioridad": "baja",
        "fecha_inicio": HOY - timedelta(days=8), "fecha_finalizacion": HOY - timedelta(days=7),
        "direccion_servicio": "Col. Las Victorias, Casa 22, Fraijanes",
        "coordenada": punto(14.4659, -90.4419), "tecnico": None,
        "fecha_asignacion": None,
    },
    {
        # Sin asignar: sirve para probar la pantalla de reasignación.
        "titulo": "Levantamiento de factibilidad — Nuevo condominio",
        "descripcion": "Verificar cobertura y distancia al nodo más cercano para 40 viviendas del proyecto.",
        "estado_tarea": "pendiente", "prioridad": "media",
        "fecha_inicio": None, "fecha_finalizacion": HOY + timedelta(days=7),
        "direccion_servicio": "Condominio Villas del Pinar, KM 24.5, Fraijanes",
        "coordenada": punto(14.4857, -90.4521), "tecnico": None,
        "fecha_asignacion": None,
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# INVENTARIO
# ═══════════════════════════════════════════════════════════════════════════

CARROS = [
    {"nombre": "Pick-up Toyota Hilux", "placa": "P-472BCR", "marca": "Toyota",
     "modelo": "Hilux 2021", "capacidad": 3, "estado_vehiculo": "disponible",
     "descripcion": "Vehículo de campo asignado a instalaciones de fibra."},
    {"nombre": "Panel Nissan NV350", "placa": "P-118KLM", "marca": "Nissan",
     "modelo": "NV350 2019", "capacidad": 5, "estado_vehiculo": "disponible",
     "descripcion": "Panel para traslado de cuadrilla y material voluminoso."},
    {"nombre": "Pick-up Mazda BT-50", "placa": "P-905TRQ", "marca": "Mazda",
     "modelo": "BT-50 2020", "capacidad": 3, "estado_vehiculo": "mantenimiento",
     "descripcion": "En taller por cambio de frenos. No asignable esta semana."},
]

HERRAMIENTAS = [
    {"nombre": "Fusionadora de fibra óptica", "tipo_herramienta": "fusionadora",
     "marca": "Sumitomo", "modelo": "T-72C", "estado": "disponible"},
    {"nombre": "OTDR de campo", "tipo_herramienta": "medición",
     "marca": "EXFO", "modelo": "MaxTester 715D", "estado": "disponible"},
    {"nombre": "Power meter óptico", "tipo_herramienta": "medición",
     "marca": "Fluke", "modelo": "SimpliFiber Pro", "estado": "disponible"},
    {"nombre": "Escalera telescópica 8m", "tipo_herramienta": "acceso",
     "marca": "Werner", "modelo": "MT-26", "estado": "disponible"},
    {"nombre": "Crimpadora RJ45 profesional", "tipo_herramienta": "manual",
     "marca": "Klein Tools", "modelo": "VDV226-110", "estado": "disponible"},
    {"nombre": "Probador de cable de red", "tipo_herramienta": "medición",
     "marca": "Klein Tools", "modelo": "VDV501-852", "estado": "disponible"},
    {"nombre": "Taladro percutor inalámbrico", "tipo_herramienta": "eléctrica",
     "marca": "DeWalt", "modelo": "DCD996", "estado": "disponible"},
    {"nombre": "Kit de arnés de seguridad", "tipo_herramienta": "seguridad",
     "marca": "3M", "modelo": "Protecta P200", "estado": "mantenimiento"},
]

MATERIALES = [
    # Con stock suficiente
    {"nombre": "Cable de fibra óptica drop 1 hilo", "tipo_material": "cable",
     "unidad_medida": "metros", "cantidad_disponible": 4200, "stock_minimo": 1000},
    {"nombre": "Cable UTP Cat 6", "tipo_material": "cable",
     "unidad_medida": "metros", "cantidad_disponible": 1800, "stock_minimo": 500},
    {"nombre": "ONT GPON dual band", "tipo_material": "equipo",
     "unidad_medida": "unidades", "cantidad_disponible": 65, "stock_minimo": 20},
    {"nombre": "Conector RJ45 blindado", "tipo_material": "conector",
     "unidad_medida": "unidades", "cantidad_disponible": 900, "stock_minimo": 250},
    {"nombre": "Roseta óptica de pared", "tipo_material": "accesorio",
     "unidad_medida": "unidades", "cantidad_disponible": 140, "stock_minimo": 50},
    # BAJO MÍNIMO a propósito → alimenta el tab "Stock crítico" y las alertas
    {"nombre": "Conector SC/APC", "tipo_material": "conector",
     "unidad_medida": "unidades", "cantidad_disponible": 45, "stock_minimo": 200},
    {"nombre": "Cinta bandit de acero", "tipo_material": "sujeción",
     "unidad_medida": "metros", "cantidad_disponible": 30, "stock_minimo": 120},
    # SIN EXISTENCIAS → alerta crítica
    {"nombre": "Splitter óptico 1x8", "tipo_material": "accesorio",
     "unidad_medida": "unidades", "cantidad_disponible": 0, "stock_minimo": 25},
]


# ═══════════════════════════════════════════════════════════════════════════
# HELPERS DE SIEMBRA
# ═══════════════════════════════════════════════════════════════════════════

async def verificar_postgis(db: AsyncSession) -> None:
    """Verifica que PostGIS esté habilitado; si no, lo habilita."""
    result = await db.execute(
        text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')")
    )
    if not result.scalar():
        print("🔧 Habilitando PostGIS...")
        await db.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await db.commit()
        print("   ✅ PostGIS habilitado")
    else:
        print("✅ PostGIS ya está habilitado")


def reset_solicitado() -> bool:
    """
    ¿Hay que borrar todo antes de sembrar?

    Se activa con la variable de entorno SEED_RESET (true/1/yes) o con el flag
    --reset. La variable de entorno existe para poder repoblar entornos
    desplegados como Railway, donde no hay forma de tirar el volumen de la BD.
    """
    if "--reset" in sys.argv:
        return True
    return os.getenv("SEED_RESET", "").strip().lower() in ("1", "true", "yes", "si", "sí")


async def resetear_base_de_datos(db: AsyncSession) -> None:
    """
    Vacía todas las tablas de datos de la aplicación.

    Usa TRUNCATE ... RESTART IDENTITY CASCADE y no DROP: el esquema lo gobierna
    Alembic, y borrar las tablas dejaría `alembic_version` apuntando a una
    migración cuyas tablas ya no existen. Con TRUNCATE la estructura queda
    intacta y los IDs vuelven a empezar en 1, así que el escenario sembrado es
    idéntico al de una base recién creada.

    `alembic_version` se excluye a propósito: es metadata de migraciones, no
    dato de la operación.
    """
    tablas = [
        tabla.name
        for tabla in Base.metadata.sorted_tables
        if tabla.name != "alembic_version"
    ]

    if not tablas:
        return

    print("\n🗑️  SEED_RESET activo: borrando todos los datos existentes...")
    print(f"   Tablas: {', '.join(sorted(tablas))}")

    # Una sola sentencia con todas las tablas: CASCADE resuelve las claves
    # foráneas entre ellas sin tener que calcular el orden de borrado.
    lista = ", ".join(f'"{nombre}"' for nombre in tablas)
    await db.execute(text(f"TRUNCATE TABLE {lista} RESTART IDENTITY CASCADE"))
    await db.commit()

    print("   ✅ Base de datos vacía")


async def crear_tipos_pausa(db: AsyncSession) -> None:
    """Siembra el catálogo de pausas que consume el router de descanso."""
    print("\n⏸️  Creando catálogo de tipos de pausa...")

    for datos in TIPOS_PAUSA:
        db.add(
            TipoPausa(
                id_tipo_pausa=datos["id"],
                label=datos["label"],
                duracion_max_min=datos["duracion_max_min"],
                orden=datos["orden"],
                activo=True,
            )
        )

    await db.flush()
    print(f"   ✅ {len(TIPOS_PAUSA)} tipos de pausa")


async def bd_ya_tiene_datos(db: AsyncSession) -> bool:
    """True si ya existen empleados; evita resembrar y perder datos de dev."""
    try:
        result = await db.execute(text("SELECT COUNT(*) FROM empleado"))
        return (result.scalar() or 0) > 0
    except Exception:
        # Si la tabla no existe aún, consideramos que no hay datos
        return False


async def crear_empleados(db: AsyncSession) -> list[Empleado]:
    print("\n👤 Creando empleados...")
    creados: list[Empleado] = []

    for datos in EMPLEADOS:
        emp = Empleado(
            nombre=datos["nombre"],
            apellido=datos["apellido"],
            correo=datos["correo"],
            hash_contrasena=hash_password(datos["contrasena"]),
            rol=datos["rol"],
            estado=datos["estado"],
            telefono=datos["telefono"],
            fecha_contratacion=datos["fecha_contratacion"],
        )
        db.add(emp)
        creados.append(emp)

    await db.flush()
    print(f"   ✅ {len(creados)} empleados creados")
    return creados


async def crear_tareas(db: AsyncSession, tecnicos: list[Empleado]) -> list[Tarea]:
    """Crea las tareas, las asigna a su técnico y deja evidencia en las completadas."""
    print("\n📋 Creando tareas...")
    creadas: list[Tarea] = []

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
            fecha_asignacion=datos["fecha_asignacion"],
        )
        db.add(tarea)
        creadas.append(tarea)

    await db.flush()

    asignadas = 0
    evidencias = 0
    for tarea, datos in zip(creadas, TAREAS):
        indice = datos["tecnico"]
        if indice is not None:
            db.add(
                EmpleadoTarea(
                    id_empleado=tecnicos[indice].id_empleado,
                    id_tarea=tarea.id_tarea,
                )
            )
            asignadas += 1

        if datos.get("evidencia"):
            db.add(
                Incidencia(
                    id_tarea=tarea.id_tarea,
                    descripcion=datos["evidencia"],
                    # Sin foto: los archivos no se versionan y el disco del
                    # contenedor es efímero. La foto se sube desde la app.
                    fecha_reporte=datetime.combine(
                        datos["fecha_finalizacion"], time(16, 30)
                    ),
                )
            )
            evidencias += 1

    await db.flush()
    print(f"   ✅ {len(creadas)} tareas ({asignadas} asignadas, {evidencias} con evidencia)")
    return creadas


async def crear_inventario(db: AsyncSession, tecnicos: list[Empleado]) -> None:
    """Crea vehículos, herramientas y materiales, y los asigna."""
    print("\n📦 Creando inventario...")

    # ── Vehículos ────────────────────────────────────────────────────────────
    carros: list[Carro] = []
    for datos in CARROS:
        activo = Activo(
            nombre_activo=datos["nombre"],
            descripcion=datos["descripcion"],
            tipo="carro",
            fecha_registro=HOY - timedelta(days=200),
        )
        db.add(activo)
        await db.flush()

        carro = Carro(
            id_activo=activo.id_activo,
            placa=datos["placa"],
            marca=datos["marca"],
            modelo=datos["modelo"],
            capacidad=datos["capacidad"],
            estado_vehiculo=datos["estado_vehiculo"],
        )
        db.add(carro)
        carros.append(carro)

    # ── Herramientas ─────────────────────────────────────────────────────────
    herramientas: list[Herramienta] = []
    for datos in HERRAMIENTAS:
        activo = Activo(
            nombre_activo=datos["nombre"],
            descripcion=f"{datos['marca']} {datos['modelo']}",
            tipo="herramienta",
            fecha_registro=HOY - timedelta(days=150),
        )
        db.add(activo)
        await db.flush()

        herramienta = Herramienta(
            id_activo=activo.id_activo,
            tipo_herramienta=datos["tipo_herramienta"],
            marca=datos["marca"],
            modelo=datos["modelo"],
            estado=datos["estado"],
        )
        db.add(herramienta)
        herramientas.append(herramienta)

    # ── Materiales ───────────────────────────────────────────────────────────
    for datos in MATERIALES:
        activo = Activo(
            nombre_activo=datos["nombre"],
            descripcion=f"Material de {datos['tipo_material']} para instalaciones.",
            tipo="material",
            fecha_registro=HOY - timedelta(days=90),
        )
        db.add(activo)
        await db.flush()

        db.add(
            Material(
                id_activo=activo.id_activo,
                cantidad_disponible=datos["cantidad_disponible"],
                stock_minimo=datos["stock_minimo"],
                unidad_medida=datos["unidad_medida"],
                tipo_material=datos["tipo_material"],
            )
        )

    await db.flush()

    # ── Asignaciones: 1 técnico = 1 vehículo ─────────────────────────────────
    # Solo se asignan los vehículos disponibles; el que está en mantenimiento
    # queda libre para poder probar la validación del endpoint de asignación.
    disponibles = [
        c for c, d in zip(carros, CARROS) if d["estado_vehiculo"] == "disponible"
    ]
    for carro, tecnico in zip(disponibles, tecnicos):
        db.add(EmpleadoCarro(id_empleado=tecnico.id_empleado, id_carro=carro.id_activo))
        # Igual que arriba: el endpoint de asignación usa "en_uso".
        carro.estado_vehiculo = "en_uso"

    # ── Herramientas cargadas en los vehículos ───────────────────────────────
    herramientas_libres = [
        h for h, d in zip(herramientas, HERRAMIENTAS) if d["estado"] == "disponible"
    ]
    for indice, herramienta in enumerate(herramientas_libres):
        if indice >= len(disponibles) * 2:
            break  # el resto se queda en bodega
        carro = disponibles[indice % len(disponibles)]
        db.add(
            CarroHerramienta(
                id_carro=carro.id_activo,
                id_herramienta=herramienta.id_activo,
                fecha_asignacion=datetime.combine(HOY - timedelta(days=10), time(7, 30)),
                estado_entrega="bueno",
                comentario="Entregada en la asignación semanal de equipo.",
            )
        )
        # "en_uso" es el estado que escribe POST /activos/carros/{id}/herramientas.
        # El seed ponía "asignada", un cuarto valor que el frontend no sabe
        # traducir: las herramientas sembradas salían con el badge en crudo y
        # parecía que asignar una desde la app "no actualizaba" nada.
        herramienta.estado = "en_uso"

    await db.flush()

    bajo_stock = sum(
        1 for m in MATERIALES if m["cantidad_disponible"] < m["stock_minimo"]
    )
    print(
        f"   ✅ {len(CARROS)} vehículos, {len(HERRAMIENTAS)} herramientas, "
        f"{len(MATERIALES)} materiales"
    )
    print(f"   ⚠️  {bajo_stock} materiales bajo el stock mínimo (alimentan las alertas)")


async def crear_historial_asistencia(
    db: AsyncSession,
    tecnicos: list[Empleado],
    dias: int = 14,
) -> None:
    """
    Genera jornadas de los últimos `dias` días hábiles con pausas realistas.

    El escenario incluye a propósito:
      - llegadas tarde (después de las 08:00) para el badge "Llegada tarde"
      - una jornada antigua sin hora_salida para el badge "Sin salida"
      - la jornada de hoy abierta para un técnico (aparece "En curso")
      - un técnico SIN entrada hoy → dispara la alerta 'tecnico_sin_entrada'
    """
    print("\n🕒 Generando historial de asistencia...")
    jornadas = 0
    pausas = 0

    # El último técnico de la lista nunca marca hoy: así siempre hay al menos
    # una alerta de "técnico sin entrada" que mostrar en la demo.
    sin_entrada_hoy = tecnicos[-1]

    for delta in range(dias, -1, -1):
        dia = HOY - timedelta(days=delta)
        if dia.weekday() >= 5:      # sábado y domingo no se trabaja
            continue

        for indice, tecnico in enumerate(tecnicos):
            if dia == HOY and tecnico.id_empleado == sin_entrada_hoy.id_empleado:
                continue

            # Ausencia esporádica (~8 % de los días) para que el historial
            # no se vea artificialmente perfecto.
            if dia != HOY and random.random() < 0.08:
                continue

            # Entrada entre 07:35 y 08:25 → algunas caen después de las 08:00
            hora_entrada = (
                datetime.combine(dia, time(8, 0))
                + timedelta(minutes=random.randint(-25, 25))
            ).time()

            # Una jornada antigua concreta queda sin cerrar (olvidó marcar salida)
            olvido_salida = delta == 6 and indice == 1
            jornada_de_hoy_abierta = dia == HOY and indice == 0

            if olvido_salida or jornada_de_hoy_abierta:
                hora_salida = None
            else:
                hora_salida = (
                    datetime.combine(dia, time(17, 0))
                    + timedelta(minutes=random.randint(-20, 45))
                ).time()

            asistencia = Asistencia(
                id_empleado=tecnico.id_empleado,
                fecha=dia,
                hora_entrada=hora_entrada,
                hora_salida=hora_salida,
                coordenada_entrada=punto(
                    14.4744 + random.uniform(-0.004, 0.004),
                    -90.4425 + random.uniform(-0.004, 0.004),
                ),
            )
            db.add(asistencia)
            await db.flush()
            jornadas += 1

            # Almuerzo (siempre) + pausa técnica ocasional
            almuerzo_inicio = (
                datetime.combine(dia, time(12, 0))
                + timedelta(minutes=random.randint(0, 40))
            )
            almuerzo_fin = almuerzo_inicio + timedelta(minutes=random.randint(40, 60))
            db.add(
                Descanso(
                    id_asistencia=asistencia.id_asistencia,
                    hora_inicio=almuerzo_inicio.time(),
                    hora_fin=almuerzo_fin.time(),
                    # El tipo tiene que ir: sin él la pantalla de Pausas
                    # etiqueta la pausa como genérica y le aplica el límite
                    # por defecto en vez del de almuerzo.
                    tipo="almuerzo",
                )
            )
            pausas += 1

            if random.random() < 0.45:
                tecnica_inicio = (
                    datetime.combine(dia, time(15, 0))
                    + timedelta(minutes=random.randint(0, 60))
                )
                db.add(
                    Descanso(
                        id_asistencia=asistencia.id_asistencia,
                        hora_inicio=tecnica_inicio.time(),
                        hora_fin=(
                            tecnica_inicio + timedelta(minutes=random.randint(8, 15))
                        ).time(),
                        tipo="tecnica",
                    )
                )
                pausas += 1

    await db.flush()
    print(f"   ✅ {jornadas} jornadas con {pausas} pausas registradas")
    print(
        f"   ℹ️  {sin_entrada_hoy.nombre} {sin_entrada_hoy.apellido} no marcó entrada hoy "
        f"(alimenta la alerta 'técnico sin entrada')"
    )


async def crear_ubicaciones(db: AsyncSession, tecnicos: list[Empleado]) -> None:
    """Últimas posiciones GPS de cada técnico, dispersas por Fraijanes."""
    print("\n📍 Registrando ubicaciones GPS...")
    total = 0
    # Hora local, no datetime.now(): en UTC estos puntos quedarían 6 horas en
    # el futuro y el mapa seguiría mostrándolos por encima de la posición que
    # el técnico acaba de reportar desde su teléfono.
    ahora = ahora_local()

    for tecnico in tecnicos:
        for horas in (4, 2, 0):
            db.add(
                UbicacionEmpleado(
                    id_empleado=tecnico.id_empleado,
                    fecha_hora_registro=ahora - timedelta(hours=horas),
                    coordenada=punto(
                        14.4744 + random.uniform(-0.012, 0.012),
                        -90.4425 + random.uniform(-0.012, 0.012),
                    ),
                )
            )
            total += 1

    await db.flush()
    print(f"   ✅ {total} registros de ubicación")


def imprimir_resumen() -> None:
    print("\n" + "=" * 68)
    print("  🎉  Seed completado exitosamente")
    print("=" * 68)
    print("\n  Credenciales de acceso:\n")
    print(f"  {'Rol':<11} {'Correo':<38} Contraseña")
    print(f"  {'-'*11} {'-'*38} {'-'*14}")
    for datos in EMPLEADOS:
        marca = "" if datos["estado"] == "activo" else "  (INACTIVO)"
        print(f"  {datos['rol']:<11} {datos['correo']:<38} {datos['contrasena']}{marca}")
    print("\n  Las alertas no se siembran: se generan solas al abrir")
    print("  la pantalla de Alertas del supervisor.\n")
    # El aviso solo aplica a la variable de entorno: el flag --reset es una
    # ejecución puntual y no se va a repetir sola en el próximo arranque.
    if os.getenv("SEED_RESET", "").strip().lower() in ("1", "true", "yes", "si", "sí"):
        print("  ⚠️  SEED_RESET está activo. Vuelve a ponerlo en false para que")
        print("     el próximo reinicio no borre estos datos.\n")


# ═══════════════════════════════════════════════════════════════════════════
# ENTRYPOINT
# ═══════════════════════════════════════════════════════════════════════════

async def seed() -> None:
    # 1. Verificar PostGIS
    async with AsyncSessionLocal() as db:
        await verificar_postgis(db)

    # 2. Reset opcional: borra todo antes de sembrar
    reset = reset_solicitado()
    if reset:
        async with AsyncSessionLocal() as db:
            await resetear_base_de_datos(db)

    # 3. Si ya hay datos (y no se pidió reset), salir sin tocar nada
    async with AsyncSessionLocal() as db:
        if await bd_ya_tiene_datos(db):
            result = await db.execute(text("SELECT COUNT(*) FROM empleado"))
            print(f"✅ La base de datos ya tiene {result.scalar()} empleados.")
            print("   Omitiendo seed para respetar datos existentes.")
            print("   (Para resembrar desde cero: SEED_RESET=true python seed.py)")
            await engine.dispose()
            return

    # 4. BD vacía → sembrar el escenario completo
    print("\n🌱 Base de datos vacía. Insertando datos de demostración...")
    async with AsyncSessionLocal() as db:
        await crear_tipos_pausa(db)

        empleados = await crear_empleados(db)
        tecnicos = [e for e in empleados if e.rol == "tecnico" and e.estado == "activo"]

        await crear_tareas(db, tecnicos)
        await crear_inventario(db, tecnicos)
        await crear_historial_asistencia(db, tecnicos)
        await crear_ubicaciones(db, tecnicos)

        await db.commit()
        imprimir_resumen()

    await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(seed())
    except Exception as e:
        print(f"\n⚠️  Error durante el seed (no crítico): {e}")
        print("   El servidor continuará arrancando.")
        # NO hacemos sys.exit(1) — queremos que el contenedor arranque igual
