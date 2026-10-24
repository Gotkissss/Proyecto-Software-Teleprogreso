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
from pathlib import Path

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

# ── Política de contraseñas (HU-S9-02, HU-S10-01) ───────────────────────────
#
# Una sola política para todos los caminos que fijan una contraseña: crear un
# empleado, restablecerla (admin/supervisor) y cambiarla uno mismo. Antes cada
# schema tenía su propia versión: crear y cambiar pedían solo 8 caracteres y
# únicamente el restablecimiento rechazaba las comunes, así que la misma clave
# pasaba por una puerta y la frenaban en otra.

LONGITUD_MINIMA_CONTRASENA = 8

# Tope de entrada (HU-S10-04). No hay columna que lo limite (en la base va el
# hash, no la clave), pero sin tope se aceptaba un texto de megabytes en cada
# login. bcrypt solo usa los primeros 72 bytes; 128 deja margen.
LONGITUD_MAXIMA_CONTRASENA = 128

# Lista de contraseñas comunes en un archivo de datos (sin dependencia nueva).
# Se lee una sola vez al importar. Está dentro de `app/`, así que viaja con la
# imagen de Docker sin tocar el Dockerfile.
ARCHIVO_CONTRASENAS_COMUNES = (
    Path(__file__).resolve().parent / "datos" / "contrasenas_comunes.txt"
)


def _cargar_contrasenas_comunes() -> frozenset[str]:
    """Lee el archivo: una por línea, en minúscula; ignora vacías y # comentarios."""
    with ARCHIVO_CONTRASENAS_COMUNES.open(encoding="utf-8") as archivo:
        return frozenset(
            linea.strip().lower()
            for linea in archivo
            if linea.strip() and not linea.lstrip().startswith("#")
        )


# Se compara sin distinguir mayúsculas.
CONTRASENAS_COMUNES = _cargar_contrasenas_comunes()


def es_contrasena_comun(contrasena: str) -> bool:
    """True si la contraseña está en la lista de las más comunes."""
    return contrasena.lower() in CONTRASENAS_COMUNES


def validar_politica_contrasena(
    contrasena: str,
    *,
    correo: str | None = None,
    contrasena_actual: str | None = None,
) -> str:
    """
    Aplica la política única de contraseñas y devuelve la contraseña intacta.

    Reglas, en este orden:
      1. Mínimo 8 caracteres.
      2. Sin espacios al inicio ni al final.
      3. Fuera de la lista de contraseñas comunes.
      4. Distinta del correo y de su parte local (lo que va antes de la @).
      5. Distinta de la contraseña actual.

    `correo` y `contrasena_actual` son opcionales porque no todos los caminos
    los tienen a mano: el schema de restablecimiento no ve la cuenta de destino
    y quien restablece no conoce la clave actual. Cada llamador pasa lo que
    sabe, y la comprobación que no aplica simplemente se omite.

    Lanza ValueError con un mensaje listo para mostrar. Sirve tal cual dentro de
    un `field_validator` de Pydantic (lo convierte en 422) y los routers o
    servicios lo envuelven en un 400.
    """
    if len(contrasena) < LONGITUD_MINIMA_CONTRASENA:
        raise ValueError(
            f"La contraseña debe tener al menos {LONGITUD_MINIMA_CONTRASENA} caracteres."
        )
    if contrasena.strip() != contrasena:
        raise ValueError("La contraseña no puede empezar ni terminar con espacios.")
    if es_contrasena_comun(contrasena):
        raise ValueError("La contraseña es demasiado común. Elige otra.")
    if correo:
        correo_normalizado = correo.strip().lower()
        parte_local = correo_normalizado.split("@")[0]
        if contrasena.lower() in (correo_normalizado, parte_local):
            raise ValueError("La contraseña no puede ser igual al correo de la cuenta.")
    if contrasena_actual is not None and contrasena == contrasena_actual:
        raise ValueError(
            "La contraseña nueva debe ser diferente de la contraseña actual."
        )
    return contrasena


# Jerarquía de cuentas (HU-S9-02). Decide quién puede actuar sobre la cuenta de
# quién. Gerente y supervisor comparten nivel a propósito: ninguno manda sobre
# el otro. Un rol que no esté aquí vale 0, o sea que no manda sobre nadie.
NIVEL_ROL = {
    ROL_ADMIN: 3,
    ROL_GERENTE: 2,
    ROL_SUPERVISOR: 2,
    ROL_TECNICO: 1,
}


def puede_administrar(actor: str, objetivo: str) -> bool:
    """
    ¿Puede un empleado con rol `actor` administrar la cuenta de uno con rol
    `objetivo`?

    - `admin` puede sobre cualquiera, incluido otro admin.
    - Los demás solo mandan sobre objetivos de nivel ESTRICTAMENTE menor: un
      supervisor sobre un técnico sí; sobre otro supervisor, un gerente o un
      admin, no.

    Recibe los roles (str), no los empleados, para poder usarse sin tocar la BD.
    """
    if actor == ROL_ADMIN:
        return True
    return NIVEL_ROL.get(actor, 0) > NIVEL_ROL.get(objetivo, 0)


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

# Antigüedad máxima de una posición para seguir tratándola como "donde está
# ahora" el técnico al repartir trabajo (la distancia de
# GET /empleados/tecnicos/disponibles?id_tarea=...). Pasado ese rato el técnico
# pudo haberse movido de municipio, y decir "a 800 m" de una posición de ayer
# es peor que decir que no se sabe.
#
# Es una ventana de tiempo y no la jornada abierta, como en
# GET /ubicaciones/tecnicos: ahí se pinta un mapa en vivo, mientras que aquí se
# reparte trabajo entre técnicos que pueden no estar en turno todavía. En la
# práctica coinciden casi siempre, porque POST /ubicaciones solo acepta puntos
# con la jornada abierta.
HORAS_UBICACION_RECIENTE = 8


# ── Bitácora de auditoría (HU-S9-03) ─────────────────────────────────────────
#
# Una lectura sensible idéntica (mismo actor, misma ruta, mismos filtros) se
# registra una vez por ventana. El mapa del supervisor repite
# GET /ubicaciones/tecnicos cada 15 s: sin esto dejaría cuatro filas iguales
# por minuto y la consulta de "quién miró qué" quedaría enterrada en ruido.
SEGUNDOS_LECTURA_REPETIDA = 300

# Tope de filas de una exportación a Excel de la bitácora. Por encima de esto
# el archivo deja de ser manejable y se pide acotar el filtro (400), en vez de
# entregar un archivo recortado que parezca completo.
MAX_FILAS_EXPORTAR_BITACORA = 50_000


# ── Serie temporal de reportes (HU-S9-04) ────────────────────────────────────
#
# GET /reportes/serie devuelve un punto por día o por semana, incluidos los
# periodos sin datos (en 0), para que la línea de tendencia no salte huecos.
# Topes de rango para que una consulta no devuelva miles de puntos que ningún
# gráfico puede dibujar: un año por día, dos años por semana.
METRICAS_SERIE = ("horas", "tareas", "pausas")
AGRUPACIONES_SERIE = ("dia", "semana")
MAX_DIAS_SERIE = {"dia": 366, "semana": 731}


# ── Fotos subidas (HU-S10-02) ────────────────────────────────────────────────

# Vigencia de un enlace firmado a una foto (app/core/archivos_firmados.py).
# Corta a propósito: un enlace copiado o reenviado deja de abrir la foto en
# unos minutos, y la pantalla que la muestra pide uno nuevo al recargar.
MINUTOS_URL_FIRMADA = 10
