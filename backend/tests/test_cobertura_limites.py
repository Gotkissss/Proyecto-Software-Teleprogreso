"""HU-S10-04, tarea 1: ningún texto de entrada puede nacer sin tope."""
import types
import typing
from enum import Enum

from annotated_types import MaxLen
from fastapi.routing import APIRoute
from pydantic import BaseModel
from pydantic.networks import EmailStr
from sqlalchemy import String, Text

from app.core.reglas import LONGITUD_MAXIMA_CONTRASENA
from app.main import app
from app.models.activo import Activo, Carro, Herramienta, Material
from app.models.alerta import Alerta
from app.models.asistencia import Asistencia, Descanso
from app.models.bitacora import BitacoraAuditoria
from app.models.empleado import Empleado
from app.models.tarea import Incidencia, Tarea

TOPE_TEXT = 2000  # columnas TEXT

_ACTIVO_CARRO = (Activo, Carro)
_ACTIVO_HERRAMIENTA = (Activo, Herramienta)
_ACTIVO_MATERIAL = (Activo, Material)

# (clase del cuerpo o "MÉTODO /ruta", campo) -> (modelos donde buscar, columna)
COLUMNAS = {
    ("TareaCreate", "nombre"): ((Tarea,), "titulo"),
    ("TareaCreate", "descripcion"): ((Tarea,), "descripcion"),
    ("TareaCreate", "direccion"): ((Tarea,), "direccion_servicio"),
    ("TareaUpdate", "nombre"): ((Tarea,), "titulo"),
    ("TareaUpdate", "descripcion"): ((Tarea,), "descripcion"),
    ("TareaUpdate", "direccion"): ((Tarea,), "direccion_servicio"),
    **{
        (clase, campo): ((Empleado,), campo)
        for clase in ("EmpleadoCreate", "EmpleadoUpdate")
        for campo in ("nombre", "apellido", "correo", "telefono")
    },
    ("LoginRequest", "correo"): ((Empleado,), "correo"),
    ("IncidenciaCreate", "descripcion"): ((Incidencia,), "descripcion"),
    ("DescansoIniciar", "tipo"): ((Descanso,), "tipo"),
    **{
        ("CarroCreate", c): (_ACTIVO_CARRO, c)
        for c in ("nombre_activo", "descripcion", "placa", "marca", "modelo", "estado_vehiculo")
    },
    **{
        ("HerramientaCreate", c): (_ACTIVO_HERRAMIENTA, c)
        for c in ("nombre_activo", "descripcion", "tipo_herramienta", "marca", "modelo", "estado")
    },
    **{
        ("MaterialCreate", c): (_ACTIVO_MATERIAL, c)
        for c in ("nombre_activo", "descripcion", "unidad_medida", "tipo_material")
    },
    **{
        ("ActivoUpdateRequest", c): ((Activo, Carro, Herramienta, Material), c)
        for c in ("nombre_activo", "descripcion", "placa", "marca", "modelo",
                  "estado_vehiculo", "tipo_herramienta", "estado", "unidad_medida",
                  "tipo_material")
    },
    # RTF-01 / R3-4: el mismo campo del cuerpo va a una columna o a la otra
    # segun sea la entrada o la salida; las dos son String(200), asi que basta
    # con comprobar una.
    ("MarcaAsistencia", "motivo_sin_ubicacion"): (
        (Asistencia,), "motivo_sin_ubicacion_entrada"
    ),
    ("GET /tareas", "estado"): ((Tarea,), "estado_tarea"),
    ("GET /empleados", "rol"): ((Empleado,), "rol"),
    ("GET /empleados", "estado"): ((Empleado,), "estado"),
    ("GET /alertas", "tipo"): ((Alerta,), "tipo"),
    ("GET /alertas", "severidad"): ((Alerta,), "severidad"),
    ("GET /alertas", "estado"): ((Alerta,), "estado"),
    **{
        (ruta, p): ((BitacoraAuditoria,), col)
        for ruta in ("GET /auditoria", "GET /auditoria/exportar")
        for p, col in (("rol", "rol_actor"), ("accion", "accion"),
                       ("entidad", "entidad"), ("request_id", "request_id"))
    },
}

M = LONGITUD_MAXIMA_CONTRASENA
SIN_COLUMNA = {
    ("LoginRequest", "contrasena"): (M, "se compara"),
    ("CambiarContrasenaRequest", "contrasena_actual"): (M, "se compara"),
    ("CambiarContrasenaRequest", "nueva_contrasena"): (M, "se guarda su hash"),
    ("CambiarContrasenaRequest", "confirmacion_contrasena"): (M, "se compara"),
    ("EmpleadoCreate", "contrasena"): (M, "se guarda su hash"),
    ("EmpleadoPasswordUpdate", "contrasena"): (M, "se guarda su hash"),
    ("EmpleadoPasswordUpdate", "contrasena_confirmacion"): (M, "se compara"),
    ("GET /empleados", "buscar"): (100, "filtro; busca en nombre, apellido y correo"),
    ("MovimientoMaterialCreate", "motivo"): (
        300,
        "va a movimiento_material.motivo, que no es una columna de los modelos "
        "que recorre esta prueba",
    ),
}

EXENTOS = {
    ("GET /archivos/{carpeta}/{nombre}", "exp"): "lo valida una regex y responde siempre el mismo 403",
    ("GET /archivos/{carpeta}/{nombre}", "firma"): "lo valida una regex y responde siempre el mismo 403",
}


def _sin_opcional(anotacion):
    origen = typing.get_origin(anotacion)
    if origen is typing.Annotated:
        return _sin_opcional(typing.get_args(anotacion)[0])
    if origen in (typing.Union, types.UnionType):
        reales = []
        for arg in typing.get_args(anotacion):
            if arg is not type(None):
                reales.extend(_sin_opcional(arg))
        return reales
    return [anotacion]


def _es_texto(tipo) -> bool:
    if tipo is EmailStr:
        return True
    return isinstance(tipo, type) and issubclass(tipo, str) and not issubclass(tipo, Enum)


def _es_modelo(tipo) -> bool:
    return isinstance(tipo, type) and issubclass(tipo, BaseModel)


def _tope(info):
    return next((m.max_length for m in info.metadata if isinstance(m, MaxLen)), None)


def _dependencias(dep):
    yield dep
    for hija in dep.dependencies:
        yield from _dependencias(hija)


def _campos_de_texto():
    encontrados = {}
    for ruta in app.routes:
        if not isinstance(ruta, APIRoute):
            continue
        metodo = sorted(ruta.methods - {"HEAD", "OPTIONS"})[0]
        for dep in _dependencias(ruta.dependant):
            for p in dep.query_params:
                if any(_es_texto(t) for t in _sin_opcional(p.field_info.annotation)):
                    encontrados[(f"{metodo} {ruta.path}", p.name)] = _tope(p.field_info)
            for p in dep.body_params:
                for tipo in _sin_opcional(p.field_info.annotation):
                    if not _es_modelo(tipo):
                        continue
                    for nombre, info in tipo.model_fields.items():
                        if any(_es_texto(t) for t in _sin_opcional(info.annotation)):
                            encontrados[(tipo.__name__, nombre)] = _tope(info)
    return [(o, c, t) for (o, c), t in sorted(encontrados.items())]


def _limite_de_columna(modelos, columna):
    for modelo in modelos:
        tabla = getattr(modelo, "__table__", None)
        if tabla is not None and columna in tabla.columns:
            tipo = tabla.columns[columna].type
            if isinstance(tipo, Text):          # Text hereda de String: va primero
                return TOPE_TEXT
            if isinstance(tipo, String) and tipo.length:
                return tipo.length
            raise AssertionError(f"{modelo.__name__}.{columna} no es un texto acotado")
    raise AssertionError(f"La columna '{columna}' no existe en {[m.__name__ for m in modelos]}")


CAMPOS = _campos_de_texto()


def test_el_recorrido_encuentra_los_campos_de_texto():
    assert len(CAMPOS) >= 45, f"El recorrido solo encontró {len(CAMPOS)} campos"


def test_todo_texto_de_entrada_tiene_tope():
    sin_tope = [f"{o}.{c}" for o, c, t in CAMPOS if t is None and (o, c) not in EXENTOS]
    assert not sin_tope, f"Campos de texto sin max_length (darían 500): {sin_tope}"


def test_ningun_tope_supera_la_columna_donde_se_guarda():
    excedidos = []
    for o, c, t in CAMPOS:
        if t is None or (o, c) not in COLUMNAS:
            continue
        modelos, columna = COLUMNAS[(o, c)]
        limite = _limite_de_columna(modelos, columna)
        if t > limite:
            excedidos.append(f"{o}.{c}: tope {t} > columna {columna} ({limite})")
    assert not excedidos, f"Topes mayores que su columna: {excedidos}"


def test_los_campos_sin_columna_respetan_su_tope_declarado():
    pasados = [
        f"{o}.{c}: tope {t} > {SIN_COLUMNA[(o, c)][0]}"
        for o, c, t in CAMPOS
        if (o, c) in SIN_COLUMNA and t is not None and t > SIN_COLUMNA[(o, c)][0]
    ]
    assert not pasados, f"Topes mayores que el declarado: {pasados}"


def test_cada_campo_declara_su_columna_o_por_que_no_la_tiene():
    sin_decidir = [
        f"{o}.{c}" for o, c, _ in CAMPOS
        if (o, c) not in COLUMNAS and (o, c) not in SIN_COLUMNA and (o, c) not in EXENTOS
    ]
    assert not sin_decidir, f"Añádelos a COLUMNAS o SIN_COLUMNA: {sin_decidir}"


def test_las_tablas_no_tienen_entradas_de_campos_que_ya_no_existen():
    existentes = {(o, c) for o, c, _ in CAMPOS}
    sobrantes = sorted((set(COLUMNAS) | set(SIN_COLUMNA) | set(EXENTOS)) - existentes)
    assert not sobrantes, f"Entradas sin campo: {sobrantes}"    