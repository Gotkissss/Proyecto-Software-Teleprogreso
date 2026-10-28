"""
Cadena de suministro: lo que la HU-S10-03 arregló no se puede desandar sin ruido.
-----------------------------------------------------------------------------
A03 del OWASP Top 10:2025. El control vive en `.github/workflows/`, que no
corre ninguna prueba de pytest: el CI se comprueba a sí mismo ejecutándose, y
eso deja un hueco. Lo que esta HU arregló se puede desandar en una línea y sin
que nada se queje:

  - volver a poner `continue-on-error` en el job de auditoría «mientras
    arreglamos esto», que es exactamente cómo estuvo dos sprints;
  - cambiar un `uses:` fijado por SHA a `@v4` porque es más legible;
  - quitar el digest de una imagen base al actualizarla a mano;
  - reintroducir `python-jose` al resolver un conflicto de ramas.

Las cuatro cosas son archivos del repositorio, así que se pueden comprobar sin
levantar nada. Es la prueba que la matriz de `SEGURIDAD.md` señala para A03.
-----------------------------------------------------------------------------
"""
import pathlib
import re

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[2]
WORKFLOWS = sorted((RAIZ / ".github" / "workflows").glob("*.yml"))
DOCKERFILES = [RAIZ / "backend" / "Dockerfile", RAIZ / "frontend" / "Dockerfile"]

# Un SHA de commit de Git: 40 hexadecimales. Es lo único que no se puede mover.
SHA_GIT = re.compile(r"^[0-9a-f]{40}$")

# Librerías que salieron a propósito y no deben volver. Cada una con el motivo,
# para que quien se tope con esta prueba sepa por qué está aquí.
RETIRADAS = {
    "python-jose": (
        "arrastraba ecdsa (aviso de canal lateral sin versión corregida y sin "
        "intención de tenerla, porque la propia librería declara que no se "
        "defiende de eso), más pyasn1 y rsa, para hacer solo HS256. Se migró a "
        "PyJWT en la HU-S10-03."
    ),
}


def _lineas_de_requisitos() -> list[str]:
    """Las líneas de requirements.txt que instalan algo, sin comentarios."""
    texto = (RAIZ / "backend" / "requirements.txt").read_text(encoding="utf-8")
    return [
        linea.strip()
        for linea in texto.splitlines()
        if linea.strip() and not linea.lstrip().startswith("#")
    ]


# ── Dependencias retiradas ──────────────────────────────────────────────────

@pytest.mark.parametrize("paquete,motivo", sorted(RETIRADAS.items()))
def test_una_dependencia_retirada_no_vuelve(paquete, motivo):
    instaladas = [l.lower() for l in _lineas_de_requisitos()]
    assert not any(paquete in l for l in instaladas), (
        f"«{paquete}» volvió a requirements.txt. {motivo}"
    )


def test_el_backend_no_importa_la_libreria_retirada():
    """
    Que no esté en requirements.txt no basta: un import suelto la haría
    obligatoria otra vez en cuanto alguien la instalara por su cuenta, y el
    despliegue fallaría con un ImportError en vez de con un aviso.
    """
    sospechosos = []
    for archivo in (RAIZ / "backend" / "app").rglob("*.py"):
        texto = archivo.read_text(encoding="utf-8")
        if re.search(r"^\s*(from|import)\s+jose\b", texto, re.M):
            sospechosos.append(str(archivo.relative_to(RAIZ)))
    assert not sospechosos, f"Todavía importan `jose`: {sospechosos}"


# ── La auditoría bloquea ────────────────────────────────────────────────────

def test_el_job_de_auditoria_no_lleva_continue_on_error():
    """
    Llevó `continue-on-error: true` desde el Sprint 9 «hasta que se arreglen
    los pendientes», y el resultado fue que los avisos siguieron abiertos dos
    sprints: un job rojo que no bloquea nada es un job que nadie lee.
    """
    ci = (RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    inicio = ci.index("  dependencias:")
    # Hasta el job siguiente, que empieza con dos espacios de indentación.
    siguientes = [
        m.start() for m in re.finditer(r"^  [a-z][a-z-]*:$", ci, re.M)
        if m.start() > inicio
    ]
    bloque = ci[inicio:siguientes[0]] if siguientes else ci[inicio:]

    assert "continue-on-error" not in bloque, (
        "El job de auditoría volvió a ser informativo: un PR con una "
        "dependencia vulnerable se mezclaría con el job en rojo."
    )
    # Y sigue auditando las dos mitades del proyecto.
    assert "pip-audit" in bloque
    assert "npm audit" in bloque


def test_la_auditoria_de_npm_mira_produccion():
    """
    `--omit=dev` es deliberado y está documentado: lo que llega al navegador es
    el bundle de producción, y bloquear PRs por un aviso en vitest acaba en que
    alguien quita el job. Si desaparece la bandera, el job pasa a fallar por
    cosas que no llegan a ningún usuario.
    """
    ci = (RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "npm audit --omit=dev" in ci


def test_no_hay_auditorias_silenciadas_con_un_or_true():
    """
    `|| true` no silencia solo el aviso de hoy: silencia también el que venga
    después. Las excepciones van con `--ignore-vuln <ID>`, su motivo y su
    fecha de revisión.
    """
    ci = (RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    for linea in ci.splitlines():
        if "audit" in linea and "|| true" in linea:
            pytest.fail(f"Auditoría silenciada con `|| true`: {linea.strip()}")


# ── Nada se referencia por una etiqueta que se mueve ────────────────────────

@pytest.mark.parametrize(
    "workflow", WORKFLOWS, ids=[w.name for w in WORKFLOWS]
)
def test_cada_action_va_fijada_por_sha(workflow):
    """
    Una etiqueta como `@v4` la mueve su dueño. Quien controle el repositorio de
    la Action —o a quien se lo comprometan— puede cambiar lo que corre en este
    CI sin tocar una línea de este repositorio, y ese CI tiene en sus manos el
    código y los secretos.
    """
    sueltas = []
    for linea in workflow.read_text(encoding="utf-8").splitlines():
        coincidencia = re.search(r"uses:\s*([^\s#]+)", linea)
        if not coincidencia:
            continue
        referencia = coincidencia.group(1)
        if "@" not in referencia:
            sueltas.append(linea.strip())
            continue
        version = referencia.rsplit("@", 1)[1]
        if not SHA_GIT.match(version):
            sueltas.append(linea.strip())

    assert not sueltas, (
        f"{workflow.name} referencia Actions por etiqueta mutable: {sueltas}. "
        "Fíjalas por SHA con la versión en un comentario al lado."
    )


@pytest.mark.parametrize(
    "workflow", WORKFLOWS, ids=[w.name for w in WORKFLOWS]
)
def test_cada_workflow_declara_sus_permisos(workflow):
    """
    Sin `permissions`, el GITHUB_TOKEN de cada job hereda los del repositorio,
    que pueden incluir escritura. Ninguno de estos jobs escribe nada.
    """
    texto = workflow.read_text(encoding="utf-8")
    assert re.search(r"^permissions:", texto, re.M), (
        f"{workflow.name} no declara `permissions`."
    )


@pytest.mark.parametrize(
    "dockerfile", DOCKERFILES, ids=[d.parent.name for d in DOCKERFILES]
)
def test_cada_imagen_base_va_fijada_por_digest(dockerfile):
    """
    `python:3.11-slim` es una etiqueta que su dueño mueve: el día que apunte a
    otra imagen, esto construye algo distinto de lo que se revisó sin que
    cambie una línea del archivo.
    """
    sueltas = []
    for linea in dockerfile.read_text(encoding="utf-8").splitlines():
        coincidencia = re.match(r"\s*FROM\s+(\S+)", linea, re.I)
        if not coincidencia:
            continue
        imagen = coincidencia.group(1)
        # Una etapa anterior del mismo Dockerfile no es una imagen de fuera.
        if "/" not in imagen and ":" not in imagen:
            continue
        if "@sha256:" not in imagen:
            sueltas.append(linea.strip())

    assert not sueltas, (
        f"{dockerfile.parent.name}/Dockerfile usa etiquetas mutables: "
        f"{sueltas}. Fíjalas por digest; Dependabot las mantiene."
    )


# ── Lo que avisa cuando algo queda viejo ────────────────────────────────────

def test_dependabot_cubre_los_cuatro_ecosistemas():
    """
    El precio de fijar todo por SHA y por digest es que nada se actualiza solo.
    Dependabot es lo que convierte eso en PRs en vez de en deuda silenciosa.
    """
    texto = (RAIZ / ".github" / "dependabot.yml").read_text(encoding="utf-8")
    for ecosistema in ("pip", "npm", "github-actions", "docker"):
        assert f"package-ecosystem: {ecosistema}" in texto, (
            f"Dependabot no vigila «{ecosistema}»."
        )


def test_el_ci_busca_secretos_en_el_diff():
    """
    Una contraseña pegada en un PR deja de ser secreta en el momento en que se
    empuja, aunque se quite después: queda en el historial. Antes de mezclar es
    la única ventana en la que se arregla sin reescribir historia.
    """
    ci = (RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "gitleaks" in ci.lower()
