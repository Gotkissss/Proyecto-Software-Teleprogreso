# backend/app/routers/incidencias.py
"""
Router de Incidencias / evidencias de tarea — Teleprogreso S.A.
-----------------------------------------------------------------------------
Permite al técnico dejar constancia de lo realizado en una tarea (descripción
+ foto) y al supervisor consultar esas evidencias desde el dashboard.

Endpoints:
  POST   /tareas/{id}/incidencias                      = Registrar evidencia
  GET    /tareas/{id}/incidencias                      = Listar evidencias
  POST   /tareas/{id}/incidencias/{id_incidencia}/foto = Subir/reemplazar foto
  DELETE /tareas/{id}/incidencias/{id_incidencia}      = Eliminar evidencia

Control de acceso:
  - Un técnico solo puede ver y registrar evidencias de tareas asignadas a él.
  - admin y supervisor pueden hacerlo sobre cualquier tarea.
  - Eliminar una evidencia queda restringido a admin y supervisor.

Requiere token JWT válido en Authorization: Bearer <token>.
-----------------------------------------------------------------------------
"""

from typing import Annotated, List

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_empleado, require_supervisor
from app.db.session import get_db
from app.models.empleado import Empleado, EmpleadoTarea
from app.models.tarea import Incidencia, Tarea
from app.schemas.incidencia import (
    FotoEvidenciaResponse,
    IncidenciaCreate,
    IncidenciaResponse,
)
from app.services.tareas import marcar_completada, validar_cierre_permitido
from app.services.uploads import eliminar_imagen, guardar_imagen

# El prefijo cuelga de /tareas para respetar la jerarquía del recurso.
# No colisiona con las rutas de tareas.py porque el segmento "incidencias"
# es literal y aquellas usan /{id}/estado, /{id}/reasignar e /{id}/iniciar.
router = APIRouter(prefix="/tareas", tags=["Incidencias"])

ROLES_SUPERVISION = ("admin", "supervisor", "gerente")


# ─── Utilidades internas ─────────────────────────────────────────────────────

async def _obtener_tarea_autorizada(
    db: AsyncSession,
    id_tarea: int,
    current_user: Empleado,
) -> Tarea:
    """
    Devuelve la tarea si existe y el usuario tiene acceso a ella.

    Un técnico solo accede a las tareas que tiene asignadas; los roles de
    supervisión acceden a todas.
    """
    result = await db.execute(select(Tarea).where(Tarea.id_tarea == id_tarea))
    tarea = result.scalar_one_or_none()

    if tarea is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarea con id={id_tarea} no encontrada.",
        )

    if current_user.rol not in ROLES_SUPERVISION:
        result_asig = await db.execute(
            select(EmpleadoTarea).where(
                EmpleadoTarea.id_tarea == id_tarea,
                EmpleadoTarea.id_empleado == current_user.id_empleado,
            )
        )
        if result_asig.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "No tienes permiso sobre esta tarea. "
                    "Solo el técnico asignado puede registrar o consultar sus evidencias."
                ),
            )

    return tarea


def _finalizar_tarea(tarea: Tarea) -> None:
    """
    Marca la tarea como completada tras registrar su evidencia.

    Vive aparte porque lo usan dos endpoints: el registro de la evidencia
    (cuando no lleva foto) y el upload de la foto (el caso normal del modal
    "Finalizar tarea", donde la tarea solo debe cerrarse si la foto llegó bien).

    Delega en `marcar_completada` para que el cierre deje siempre puesta la
    `fecha_completado`; antes esta función solo cambiaba el estado y la tarea
    no llegaba nunca al historial diario.

    Las reglas de "¿se puede cerrar esta tarea?" viven en
    `app.services.tareas.validar_cierre_permitido`, compartidas con
    `PATCH /tareas/{id}/finalizar`. Son dos caminos de cierre distintos y
    ninguno debe poder saltarse lo que exige el otro.
    """
    validar_cierre_permitido(tarea)
    marcar_completada(tarea)


async def _obtener_incidencia(
    db: AsyncSession,
    id_tarea: int,
    id_incidencia: int,
) -> Incidencia:
    result = await db.execute(
        select(Incidencia).where(
            Incidencia.id_incidencia == id_incidencia,
            Incidencia.id_tarea == id_tarea,
        )
    )
    incidencia = result.scalar_one_or_none()

    if incidencia is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No existe la evidencia id={id_incidencia} "
                f"para la tarea id={id_tarea}."
            ),
        )

    return incidencia


# ─── POST /tareas/{id}/incidencias ───────────────────────────────────────────

@router.post(
    "/{id}/incidencias",
    response_model=IncidenciaResponse,
    summary="Registrar una evidencia de la tarea",
    status_code=status.HTTP_201_CREATED,
)
async def crear_incidencia(
    id: int,
    data: IncidenciaCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Registra la descripción de lo realizado en una tarea.

    La foto se sube después con
    `POST /tareas/{id}/incidencias/{id_incidencia}/foto`, porque requiere
    multipart/form-data.

    Si se envía `finalizar_tarea: true`, la tarea pasa a estado 'completado'
    (y se le registra `fecha_inicio` si no la tenía). Una tarea ya cancelada
    no puede completarse.

    Roles: el técnico asignado, admin o supervisor.
    """
    tarea = await _obtener_tarea_autorizada(db, id, current_user)

    incidencia = Incidencia(
        id_tarea=tarea.id_tarea,
        descripcion=data.descripcion,
    )
    db.add(incidencia)

    if data.finalizar_tarea:
        _finalizar_tarea(tarea)

    await db.flush()
    # fecha_reporte la pone la BD (server_default NOW()); hay que releerla
    # para que la respuesta no salga con el atributo sin cargar.
    await db.refresh(incidencia)

    return incidencia


# ─── GET /tareas/{id}/incidencias ────────────────────────────────────────────

@router.get(
    "/{id}/incidencias",
    response_model=List[IncidenciaResponse],
    summary="Listar las evidencias de una tarea",
    status_code=status.HTTP_200_OK,
)
async def get_incidencias(
    id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
):
    """
    Devuelve las evidencias de la tarea, de la más reciente a la más antigua.

    Es el endpoint que consume el dashboard del supervisor para ver qué dejó
    registrado el técnico al completar la tarea.

    Roles: el técnico asignado, admin, supervisor o gerente.
    """
    await _obtener_tarea_autorizada(db, id, current_user)

    result = await db.execute(
        select(Incidencia)
        .where(Incidencia.id_tarea == id)
        .order_by(Incidencia.fecha_reporte.desc(), Incidencia.id_incidencia.desc())
    )
    return result.scalars().all()


# ─── POST /tareas/{id}/incidencias/{id_incidencia}/foto ──────────────────────

@router.post(
    "/{id}/incidencias/{id_incidencia}/foto",
    response_model=FotoEvidenciaResponse,
    summary="Subir o reemplazar la foto de evidencia",
    status_code=status.HTTP_200_OK,
)
async def upload_foto_evidencia(
    id: int,
    id_incidencia: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Empleado, Depends(get_current_empleado)],
    file: Annotated[
        UploadFile, File(description="Imagen jpg, jpeg, png, webp o gif.")
    ],
    # Con Annotated el valor por defecto es un bool de verdad. Escrito como
    # `finalizar_tarea: bool = Form(False)`, el default sería el objeto Form,
    # que es truthy: al llamar la función fuera de FastAPI (tests) la tarea se
    # cerraría siempre.
    finalizar_tarea: Annotated[
        bool,
        Form(
            description=(
                "Si es true, marca la tarea como 'completado' una vez guardada "
                "la foto. Es lo que usa el modal 'Finalizar tarea': así la "
                "tarea solo se cierra si la evidencia se subió bien."
            )
        ),
    ] = False,
):
    """
    Adjunta la foto de evidencia a una incidencia ya creada.

    Mismas reglas que el upload de activos (mismo servicio compartido):
    - Extensiones permitidas: jpg, jpeg, png, webp, gif
    - Tamaño máximo: 5 MB
    - Si ya había una foto, se reemplaza y la anterior se borra del disco

    Con `finalizar_tarea=true` cierra además la tarea, dejando el flujo del
    técnico en dos peticiones (crear evidencia → subir foto y finalizar) sin
    tener que crear una incidencia extra solo para cambiar el estado.

    Roles: el técnico asignado, admin o supervisor.
    """
    tarea = await _obtener_tarea_autorizada(db, id, current_user)
    incidencia = await _obtener_incidencia(db, id, id_incidencia)

    incidencia.foto_evidencia = await guardar_imagen(
        file,
        subcarpeta="incidencias",
        prefijo=f"incidencia_{id_incidencia}",
        url_anterior=incidencia.foto_evidencia,
    )

    if finalizar_tarea:
        _finalizar_tarea(tarea)

    await db.flush()

    return FotoEvidenciaResponse(
        detail="Foto de evidencia subida correctamente.",
        id_incidencia=incidencia.id_incidencia,
        foto_evidencia=incidencia.foto_evidencia,
    )


# ─── DELETE /tareas/{id}/incidencias/{id_incidencia} ─────────────────────────

@router.delete(
    "/{id}/incidencias/{id_incidencia}",
    summary="Eliminar una evidencia",
    status_code=status.HTTP_200_OK,
)
async def eliminar_incidencia(
    id: int,
    id_incidencia: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _current_user: Annotated[Empleado, Depends(require_supervisor)],
):
    """
    Elimina una evidencia y su foto asociada.

    Restringido a admin y supervisor: una evidencia es el respaldo del trabajo
    hecho, el técnico no debería poder borrar la suya.
    """
    incidencia = await _obtener_incidencia(db, id, id_incidencia)

    eliminar_imagen(incidencia.foto_evidencia)
    await db.delete(incidencia)

    return {
        "detail": "Evidencia eliminada correctamente.",
        "id_incidencia": id_incidencia,
    }
