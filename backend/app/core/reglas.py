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


# ── Ruta diaria del técnico ──────────────────────────────────────────────────
#
# Orden de las paradas en GET /tareas/mi-ruta (HU-3):
#
#   1. El trabajo abierto va antes que lo completado hoy.
#   2. Si el técnico envía su posición, las URGENTES van primero y, dentro de
#      cada grupo (urgentes / resto), la parada más cercana primero. El resto
#      NO se separa por alta/media/baja: ahí manda la cercanía, porque es lo
#      que evita cruzar el municipio de ida y vuelta. Una urgente, en cambio,
#      no puede quedar detrás de una tarea menor solo por estar más lejos.
#   3. Las tareas sin coordenada no tienen distancia: van al final de su grupo.
#   4. Sin posición del técnico (GPS denegado, sin señal), se ordena solo por
#      prioridad, que es el comportamiento que tenía la pantalla antes.
#
# El orden de esta tupla es el rango de prioridad (índice 0 = la más alta).
PRIORIDADES_TAREA = ("urgente", "alta", "media", "baja")

# Prioridad que siempre va por delante de la cercanía.
PRIORIDAD_URGENTE = "urgente"


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

# Roles que VEN el trabajo de toda la operación y no solo el propio.
ROLES_SUPERVISION = ("admin", "supervisor", "gerente")

# Roles que además de ver, OPERAN: asignan, registran y modifican.
#
# La diferencia con ROLES_SUPERVISION es el gerente, que es un rol de consulta:
# revisa la operación y se comunica con el supervisor, pero no registra
# evidencias ni toca el inventario. Antes iba en el mismo saco que admin y
# supervisor, así que podía subir fotos de evidencia a cualquier tarea.
ROLES_GESTION = ("admin", "supervisor")

ROL_ADMIN = "admin"
ROL_SUPERVISOR = "supervisor"
ROL_GERENTE = "gerente"
ROL_TECNICO = "tecnico"

ESTADO_EMPLEADO_ACTIVO = "activo"

# Tope de horas para que una jornada de ayer siga contando como "turno en
# curso" (ver es_del_turno_en_curso). Sin este tope, un técnico diurno que
# olvida marcar salida y llega al día siguiente también calificaría como
# turno nocturno, mostrando una jornada de hasta casi 24 horas.
#
# El valor (14 h) es una estimación de "12 horas legales
# con horas extra + 2 de margen", sin que existiera una historia de usuario
# que definiera este límite. Si se ajusta este número, revisar también
# POST /asistencia/entrada, POST /asistencia/salida, GET /descanso/hoy y
# POST /ubicaciones, que comparten esta regla.
DURACION_MAXIMA_TURNO_HORAS = 14


# ── Recorrido del técnico (HU-5) ─────────────────────────────────────────────
#
# Por qué se guardó cada punto de `ubicacion_empleado`:
#   - periodico:    reporte automático mientras la app está abierta y hay
#                   jornada. El frontend manda uno cada 2 min si el técnico se
#                   mueve (≥ 30 m) y uno de control cada 5 min si está quieto;
#                   descarta lecturas con precisión peor que 100 m.
#   - inicio_tarea: al iniciar una tarea (PATCH /tareas/{id}/iniciar).
#   - fin_tarea:    al finalizar una tarea (PATCH /tareas/{id}/finalizar).
# 'entrada' y 'salida' no se guardan aquí: salen de `asistencia` (HU-4) y el
# recorrido los intercala al construir la respuesta.
EVENTO_PERIODICO = "periodico"
EVENTO_INICIO_TAREA = "inicio_tarea"
EVENTO_FIN_TAREA = "fin_tarea"
EVENTO_ENTRADA = "entrada"
EVENTO_SALIDA = "salida"
EVENTOS_UBICACION = (EVENTO_PERIODICO, EVENTO_INICIO_TAREA, EVENTO_FIN_TAREA)

# Si entre dos puntos seguidos pasan más de estos minutos, el tramo se marca
# como "sin datos" en vez de dibujarse como un trayecto real. Es el doble del
# punto de control de un técnico quieto (5 min), para que estar parado no se
# confunda con un hueco. Casi siempre significa que la app estuvo cerrada, el
# teléfono bloqueado o sin GPS: la web no puede leer ubicación en segundo plano.
MINUTOS_HUECO_RECORRIDO = 10

# Máximo de puntos por envío en lote (cola sin conexión del frontend).
MAX_PUNTOS_LOTE = 500

# Margen para puntos en lote con hora ligeramente "futura" por diferencias
# entre el reloj del teléfono y el del servidor.
TOLERANCIA_RELOJ_SEGUNDOS = 120
