"""
La matriz OWASP de SEGURIDAD.md no envejece en silencio — T4 del Sprint 10.
-----------------------------------------------------------------------------
`SEGURIDAD.md` lleva una tabla con una fila por categoría del OWASP Top
10:2025, el archivo donde está el control y la prueba que lo vigila. Esa tabla
se presenta como evidencia de que las diez categorías están cubiertas.

Una matriz así se rompe sola: alguien renombra `exportacion_reportes.py`,
mueve una prueba de carpeta o la borra al refactorizar, y la tabla sigue
diciendo que esa categoría está cubierta por un archivo que ya no existe.
Nadie lo nota porque un documento no falla. Esto sí falla.

Lo que se comprueba es que la tabla está completa y que **todo lo que nombra
existe**. No se comprueba que el control sea bueno: eso es el trabajo de las
pruebas que la propia tabla señala.
-----------------------------------------------------------------------------
"""
import pathlib
import re

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SEGURIDAD = RAIZ / "SEGURIDAD.md"

CATEGORIAS = [
    "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10",
]

# Los seis flujos del modelo de amenazas. Si se añade uno al sistema —un envío
# de correo, una integración saliente— esta lista es el recordatorio de que su
# fila también hace falta.
FLUJOS = [
    "Iniciar sesión",
    "Asignar y editar una tarea",
    "Cerrar una tarea con evidencia",
    "Reportar ubicación",
    "Reportes del gerente",
    "Bitácora de auditoría",
]

STRIDE = [
    "Suplantación",
    "Alteración",
    "Repudio",
    "Fuga",
    "Denegación",
    "Elevación",
]


def _texto() -> str:
    return SEGURIDAD.read_text(encoding="utf-8")


def _filas_de_la_matriz() -> dict[str, tuple[str, str]]:
    """
    {categoría: (archivo, prueba)} leído de la tabla de SEGURIDAD.md.

    Se parsea el documento en vez de mantener la lista aquí: si estuviera
    duplicada en los dos sitios, la prueba podría pasar con una tabla que ya no
    dice lo mismo, que es exactamente el fallo que viene a evitar.
    """
    texto = _texto()
    inicio = texto.index("## Matriz OWASP Top 10:2025")
    # La tabla termina en el párrafo sobre SSRF, que va justo después.
    fin = texto.index("Sobre **SSRF**", inicio)
    filas = {}
    for linea in texto[inicio:fin].split("\n"):
        if not linea.startswith("| A"):
            continue
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        if len(celdas) != 4:
            continue
        categoria = celdas[0].split()[0]
        rutas = [
            re.fullmatch(r"`(.+)`", celdas[i]).group(1)
            for i in (2, 3)
            if re.fullmatch(r"`(.+)`", celdas[i])
        ]
        if len(rutas) == 2:
            filas[categoria] = (rutas[0], rutas[1])
    return filas


# ── La tabla está completa ──────────────────────────────────────────────────

def test_la_matriz_tiene_las_diez_categorias():
    filas = _filas_de_la_matriz()
    faltan = [c for c in CATEGORIAS if c not in filas]
    assert not faltan, f"La matriz no cubre: {', '.join(faltan)}"
    assert len(filas) == 10, sorted(filas)


@pytest.mark.parametrize("categoria", CATEGORIAS)
def test_cada_categoria_nombra_un_archivo_que_existe(categoria):
    archivo, _prueba = _filas_de_la_matriz()[categoria]
    ruta = RAIZ / archivo
    assert ruta.is_file(), (
        f"{categoria}: la matriz señala «{archivo}» como el control y ese "
        "archivo no existe. Si se movió o se renombró, actualiza la fila; si "
        "el control desapareció, la categoría dejó de estar cubierta."
    )


@pytest.mark.parametrize("categoria", CATEGORIAS)
def test_cada_categoria_nombra_una_prueba_que_existe(categoria):
    _archivo, prueba = _filas_de_la_matriz()[categoria]
    ruta = RAIZ / prueba
    assert ruta.is_file(), (
        f"{categoria}: la matriz señala «{prueba}» como la prueba que lo "
        "vigila y ese archivo no existe. Una categoría sin prueba no está "
        "cubierta, está supuesta."
    )


@pytest.mark.parametrize("categoria", CATEGORIAS)
def test_la_prueba_de_cada_categoria_contiene_pruebas(categoria):
    """
    Un archivo que existe pero se quedó vacío —o con todo comentado— cumpliría
    la comprobación de arriba sin vigilar nada.
    """
    _archivo, prueba = _filas_de_la_matriz()[categoria]
    contenido = (RAIZ / prueba).read_text(encoding="utf-8")
    assert "def test_" in contenido, (
        f"{categoria}: «{prueba}» no contiene ninguna función de prueba."
    )


def test_ninguna_categoria_se_apoya_en_la_misma_prueba_que_otra():
    """
    Si dos categorías apuntaran a la misma prueba, una de las dos estaría
    cubierta solo de nombre.
    """
    filas = _filas_de_la_matriz()
    pruebas = [prueba for _archivo, prueba in filas.values()]
    repetidas = {p for p in pruebas if pruebas.count(p) > 1}
    assert not repetidas, f"Pruebas compartidas por varias categorías: {repetidas}"


# ── El modelo de amenazas ───────────────────────────────────────────────────

def test_el_modelo_de_amenazas_cubre_los_seis_flujos():
    texto = _texto()
    inicio = texto.index("## Modelo de amenazas (STRIDE)")
    fin = texto.index("## Matriz OWASP Top 10:2025")
    modelo = texto[inicio:fin]

    faltan = [f for f in FLUJOS if f not in modelo]
    assert not faltan, f"Flujos sin analizar: {faltan}"


def test_el_modelo_nombra_las_seis_categorias_de_stride():
    texto = _texto()
    inicio = texto.index("## Modelo de amenazas (STRIDE)")
    fin = texto.index("## Matriz OWASP Top 10:2025")
    modelo = texto[inicio:fin]

    faltan = [s for s in STRIDE if s not in modelo]
    assert not faltan, (
        f"STRIDE incompleto: {faltan}. Si alguna no aplica a ningún flujo, "
        "dilo en el documento en vez de omitirla."
    )


def test_el_ssrf_sigue_declarado_como_no_aplicable_por_construccion():
    """
    El Top 10:2025 metió SSRF dentro de A01. Hoy no aplica porque el backend no
    hace ninguna petición saliente, y eso es una propiedad del código que se
    puede perder el día que alguien añada una integración. La nota tiene que
    seguir ahí para que ese día se note.
    """
    texto = _texto()
    assert "Sobre **SSRF**" in texto
    assert "no hace\nninguna petición saliente" in texto or (
        "no hace ninguna petición saliente" in texto.replace("\n", " ")
    )
