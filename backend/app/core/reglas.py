# backend/app/core/reglas.py
"""
Reglas de negocio compartidas — Teleprogreso S.A.
-----------------------------------------------------------------------------
Constantes que definen las políticas operativas del sistema. Viven aquí, en un
solo sitio, porque estaban repetidas en varios archivos y se desincronizaron:
`tareas.py` decía que el límite de carga era 3, `metricas.py` tenía su propio
`LIMITE = 3` y el frontend otro `LIMITE_TAREAS = 3` en dos pantallas distintas.
Cambiar la política obligaba a acordarse de los cinco sitios; olvidar uno hacía
que el selector marcara un técnico como disponible y el backend rechazara la
asignación, o al revés.

Ahora el backend lee de aquí y además publica el límite en la respuesta de
`GET /empleados/tecnicos/disponibles`, para que el frontend tampoco tenga que
adivinarlo.
-----------------------------------------------------------------------------
"""

# ── Carga de trabajo ─────────────────────────────────────────────────────────

# Máximo de tareas simultáneas (pendiente o en_progreso) por técnico.
LIMITE_TAREAS_ACTIVAS = 5

# Estados de tarea que consumen cupo del límite de arriba.
ESTADOS_TAREA_ACTIVOS = ("pendiente", "en_progreso")

# Estados en los que una tarea se considera cerrada.
ESTADOS_TAREA_CERRADOS = ("completado", "cancelado")


# ── Inventario ───────────────────────────────────────────────────────────────
#
# Estos conjuntos son la lista blanca de valores admitidos. Antes las columnas
# de estado eran texto libre en la API: se podía mandar cualquier cadena, y con
# `{"estado": "disponible"}` sobre una herramienta ya cargada en un vehículo se
# conseguía asignarla a un segundo vehículo (quedaba en dos a la vez).

ESTADOS_HERRAMIENTA = ("disponible", "en_uso", "mantenimiento", "baja")
ESTADOS_VEHICULO = ("disponible", "en_uso", "mantenimiento", "baja")

# Estado que indica que el activo está libre para asignarse.
ESTADO_DISPONIBLE = "disponible"

# Estado que se pone al asignarlo.
ESTADO_EN_USO = "en_uso"


# ── Personal ─────────────────────────────────────────────────────────────────

ROLES_VALIDOS = ("admin", "supervisor", "tecnico", "gerente")

# Roles que ven el trabajo de toda la operación y no solo el propio.
ROLES_SUPERVISION = ("admin", "supervisor", "gerente")

ROL_ADMIN = "admin"
ROL_TECNICO = "tecnico"

ESTADO_EMPLEADO_ACTIVO = "activo"
