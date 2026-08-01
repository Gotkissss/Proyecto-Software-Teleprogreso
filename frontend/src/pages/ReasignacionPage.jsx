/**
 * pages/ReasignacionPage.jsx
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import Modal, { ModalActions } from '../components/ui/Modal'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import ModalEditarTarea from '../components/tareas/ModalEditarTarea'
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import { getTareas, getTecnicosDisponibles, reasignarTarea } from '../api/tareaService'
import styles from './ReasignacionPage.module.css'


const LIMITE_TAREAS = 3

// Estados en los que la tarea ya está cerrada: no se reasigna algo que
// el técnico ya entregó (ni algo que se canceló).
const ESTADOS_CERRADOS = ['completado', 'cancelado']

const estadoDe = (tarea) => tarea.estado_tarea ?? tarea.estado
const estaCerrada = (tarea) => ESTADOS_CERRADOS.includes(estadoDe(tarea))

export default function ReasignacionPage() {

  const navigate = useNavigate()
  const toast = useToast()

  const [tareas, setTareas] = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [tareaSeleccionada, setTareaSeleccionada] = useState(null)
  const [tareaEditando, setTareaEditando] = useState(null)
  const [tareaEvidencias, setTareaEvidencias] = useState(null)
  const [tecnicoNuevo, setTecnicoNuevo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorReasignacion, setErrorReasignacion] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      setError(null)

      // Una sola llamada a /tareas (antes se pedía dos veces en el mismo
      // Promise.all) y el conteo de carga viene del endpoint dedicado, que
      // sí admite rol supervisor. /empleados?rol=tecnico es solo-admin y
      // devolvía 403 al supervisor, dejando el selector vacío.
      const [listaTareas, listaTecnicos] = await Promise.all([
        getTareas(),
        getTecnicosDisponibles(),
      ])

      setTareas(Array.isArray(listaTareas) ? listaTareas : [])
      setTecnicos(listaTecnicos)
    } catch (err) {
      setError(
        err?.response?.data?.detail || 'No se pudieron cargar las tareas.'
      )
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleReasignar = async () => {
    if (!tareaSeleccionada || !tecnicoNuevo) return

    setGuardando(true)
    setErrorReasignacion(null)

    const tecnicoSeleccionado = tecnicos.find(
      (t) => t.id === Number(tecnicoNuevo)
    )

    // Validación client-side antes de llamar al backend
    if (tecnicoSeleccionado?.tareas_activas >= LIMITE_TAREAS) {
      setErrorReasignacion(
        `${tecnicoSeleccionado.nombre_completo} ya tiene ${tecnicoSeleccionado.tareas_activas} tareas activas. El límite es ${LIMITE_TAREAS}.`
      )

      setGuardando(false)
      return
    }

    try {
      await reasignarTarea(
        tareaSeleccionada.id_tarea ?? tareaSeleccionada.id,
        Number(tecnicoNuevo)
      )

      // Actualizar conteo local del técnico
      setTecnicos((prev) =>
        prev.map((t) =>
          t.id === Number(tecnicoNuevo)
            ? { ...t, tareas_activas: (t.tareas_activas ?? 0) + 1 }
            : t
        )
      )

      setTareas((prev) =>
        prev.map((t) => {
          const id = t.id_tarea ?? t.id
          const selId = tareaSeleccionada.id_tarea ?? tareaSeleccionada.id

          // El backend devuelve el técnico como { id_empleado, nombre };
          // se guarda con esa misma forma para que la lista lo muestre bien.
          return id === selId
            ? {
                ...t,
                tecnico: {
                  id_empleado: tecnicoSeleccionado.id,
                  nombre: tecnicoSeleccionado.nombre_completo,
                },
              }
            : t
        })
      )

      toast.success(
        `Tarea reasignada a ${tecnicoSeleccionado.nombre_completo}.`
      )
      setTareaSeleccionada(null)
      setTecnicoNuevo('')

    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail

      if (
        status === 400 &&
        typeof detail === 'string' &&
        detail.toLowerCase().includes('límite')
      ) {
        setErrorReasignacion(detail)
      } else if (status === 400) {
        setErrorReasignacion(
          detail || 'No se pudo reasignar la tarea. Verifica los datos.'
        )
      } else if (status === 404) {
        setErrorReasignacion(
          'La tarea o el técnico no fueron encontrados.'
        )
      } else {
        setErrorReasignacion(
          'Error inesperado al reasignar. Intenta de nuevo.'
        )
      }

      console.error(err)
    } finally {
      setGuardando(false)
    }
  }

  const abrirPanel = (tarea) => {
    setTareaSeleccionada(tarea)
    setTecnicoNuevo('')
    setErrorReasignacion(null)
  }

  // Esta pantalla es para repartir trabajo pendiente. Las tareas ya cerradas
  // se sacan de la lista: dejarlas ahí con su botón "Reasignar" invitaba a
  // mover trabajo que el técnico ya entregó, y además ensuciaba la lista.
  // El detalle de lo cerrado vive en "Realizadas".
  const tareasActivas = useMemo(
    () => tareas.filter((t) => !estaCerrada(t)),
    [tareas]
  )
  const totalCerradas = tareas.length - tareasActivas.length

  /** Técnico que ya tiene la tarea abierta en el modal. */
  const idTecnicoActual =
    tareaSeleccionada?.tecnico?.id_empleado ?? null

  /** Refleja en la lista la tarea que devolvió PATCH /tareas/{id}. */
  const handleTareaEditada = (actualizada) => {
    setTareas((prev) =>
      prev.map((t) =>
        (t.id_tarea ?? t.id) === actualizada.id_tarea ? { ...t, ...actualizada } : t
      )
    )
    toast.success('Tarea actualizada correctamente.')
    // El conteo de carga de los técnicos pudo cambiar con la edición.
    getTecnicosDisponibles().then(setTecnicos).catch(() => {})
  }

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando tareas..."
        error={error}
        onRetry={fetchData}
        errorTitle="No se pudieron cargar las tareas"
      />
    )
  }

  return (
    <div className={styles.page}>

      {/* Modal de edición de una tarea existente */}
      <ModalEditarTarea
        open={Boolean(tareaEditando)}
        tarea={tareaEditando}
        tecnicos={tecnicos}
        onClose={() => setTareaEditando(null)}
        onGuardado={handleTareaEditada}
      />

      {/* SCRUM-141/142: evidencias que dejó el técnico al cerrar la tarea */}
      <ModalEvidencias
        open={Boolean(tareaEvidencias)}
        tarea={tareaEvidencias}
        onClose={() => setTareaEvidencias(null)}
        puedeEliminar
        onCambio={fetchData}
      />

      {/* HEADER NUEVO */}
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>
          Reasignación de servicios
        </h1>

        <button
          className={styles.nuevaTareaBtn}
          onClick={() => navigate('/supervisor/nueva-tarea')}
        >
          + Nueva tarea
        </button>
      </div>

      {/* Aviso de lo que se está ocultando, con salida hacia el historial:
          si no, parecería que las tareas cerradas se perdieron. */}
      {totalCerradas > 0 && (
        <p className={styles.cerradasNota}>
          {totalCerradas} tarea{totalCerradas === 1 ? '' : 's'} ya cerrada
          {totalCerradas === 1 ? '' : 's'} no aparece
          {totalCerradas === 1 ? '' : 'n'} aquí.{' '}
          <button
            type="button"
            className={styles.verRealizadasBtn}
            onClick={() => navigate('/supervisor/historial-tareas')}
          >
            Ver tareas realizadas
          </button>
        </p>
      )}

      {tareasActivas.length === 0 ? (
        <PageState
          empty
          emptyTitle={
            totalCerradas > 0
              ? 'No queda trabajo pendiente por repartir'
              : 'No hay tareas para reasignar'
          }
          emptyDescription={
            totalCerradas > 0
              ? 'Todas las tareas están cerradas. Consúltalas en "Realizadas" o crea una nueva.'
              : 'Crea una tarea nueva para asignarla a un técnico.'
          }
          emptyAction={
            <button
              className={styles.nuevaTareaBtn}
              onClick={() => navigate('/supervisor/nueva-tarea')}
            >
              + Nueva tarea
            </button>
          }
        />
      ) : (
        <ul className={styles.tareasList}>
          {tareasActivas.map((tarea) => {
            const id = tarea.id_tarea ?? tarea.id

            return (
              <li key={id} className={styles.tareaItem}>
                <div className={styles.tareaInfo}>
                  <span className={styles.tareaTitulo}>
                    {tarea.titulo}
                  </span>

                  <span className={styles.tareaTecnico}>
                    {/* El backend devuelve tecnico.nombre (nombre completo).
                        Antes se leía `nombre_completo`, que no existe, y todas
                        las tareas aparecían como "Sin asignar". */}
                    {tarea.tecnico?.nombre ?? 'Sin asignar'}
                  </span>
                </div>

                <div className={styles.tareaAcciones}>
                  <Badge
                    label={tarea.estado_tarea ?? tarea.estado}
                    variant={
                      (tarea.estado_tarea ?? tarea.estado) === 'en_progreso'
                        ? 'info'
                        : (tarea.estado_tarea ?? tarea.estado) === 'retrasado'
                          ? 'danger'
                          : 'warning'
                    }
                  />

                  {tarea.total_incidencias > 0 && (
                    <button
                      className={styles.evidenciasBtn}
                      onClick={() => setTareaEvidencias(tarea)}
                      title="Ver las evidencias que dejó el técnico"
                    >
                      Evidencias ({tarea.total_incidencias})
                    </button>
                  )}

                  <button
                    className={styles.editarBtn}
                    onClick={() => setTareaEditando(tarea)}
                  >
                    Editar
                  </button>

                  <button
                    className={styles.reasignarBtn}
                    onClick={() => abrirPanel(tarea)}
                  >
                    Reasignar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Antes era un overlay propio de esta página; ahora usa el Modal
          compartido, igual que la edición de tareas y el inventario. */}
      <Modal
        open={Boolean(tareaSeleccionada)}
        onClose={() => setTareaSeleccionada(null)}
        title="Reasignar tarea"
      >
        <p className={styles.panelSubtitle}>
          {tareaSeleccionada?.titulo}
        </p>

        {errorReasignacion && (
          <div className={styles.errorPanel}>
            <span className={styles.errorPanelIcon}>⚠</span>
            <span>{errorReasignacion}</span>
          </div>
        )}

        {/* Quién la tiene ahora. Sin esto el supervisor abría el modal, veía
            a Juan Pérez en la lista y no entendía si era el asignado actual
            o una opción nueva. */}
        <p className={styles.asignadoActual}>
          Asignada actualmente a:{' '}
          <strong>{tareaSeleccionada?.tecnico?.nombre ?? 'nadie'}</strong>
        </p>

        <label className={styles.label} htmlFor="reasignar-tecnico">
          Reasignar a:
        </label>

        <select
          id="reasignar-tecnico"
          className={styles.select}
          value={tecnicoNuevo}
          onChange={(e) => {
            setTecnicoNuevo(e.target.value)
            setErrorReasignacion(null)
          }}
        >
          <option value="">Selecciona un técnico</option>

          {tecnicos.map((tec) => {
            const alLimite = (tec.tareas_activas ?? 0) >= LIMITE_TAREAS
            // El técnico que ya la tiene se muestra marcado y bloqueado:
            // reasignar una tarea a quien ya la tiene no hace nada.
            const esElActual = tec.id === idTecnicoActual

            return (
              <option
                key={tec.id}
                value={tec.id}
                disabled={alLimite || esElActual}
              >
                {tec.nombre_completo}
                {' — '}
                {tec.tareas_activas ?? 0} tarea
                {tec.tareas_activas !== 1 ? 's' : ''}
                {' '}activa
                {tec.tareas_activas !== 1 ? 's' : ''}
                {esElActual ? ' (ya tiene esta tarea)' : ''}
                {!esElActual && alLimite ? ' (límite alcanzado)' : ''}
              </option>
            )
          })}
        </select>

        {/* Único técnico en la plantilla y ya tiene la tarea: no hay a quién
            pasársela, y conviene decirlo en lugar de dejar un select inerte. */}
        {tecnicos.length > 0 &&
          tecnicos.every(
            (t) => t.id === idTecnicoActual || (t.tareas_activas ?? 0) >= LIMITE_TAREAS
          ) && (
            <p className={styles.limiteMsg}>
              ⚠ No hay ningún otro técnico disponible para recibir esta tarea.
            </p>
          )}

        {tecnicoNuevo && (() => {
          const tec = tecnicos.find((t) => t.id === Number(tecnicoNuevo))
          if (!tec) return null

          const activas = tec.tareas_activas ?? 0

          if (activas >= LIMITE_TAREAS) {
            return (
              <p className={styles.limiteMsg}>
                ⚠ Este técnico ya alcanzó el límite de {LIMITE_TAREAS} tareas activas.
              </p>
            )
          }

          if (activas === LIMITE_TAREAS - 1) {
            return (
              <p className={styles.advertenciaMsg}>
                ℹ Este técnico tendrá {activas + 1} tareas activas tras la reasignación.
              </p>
            )
          }

          return null
        })()}

        <ModalActions>
          <button
            className={styles.cancelBtn}
            onClick={() => setTareaSeleccionada(null)}
          >
            Cancelar
          </button>

          <button
            className={styles.confirmBtn}
            onClick={handleReasignar}
            disabled={
              !tecnicoNuevo ||
              guardando ||
              (tecnicos.find((t) => t.id === Number(tecnicoNuevo))?.tareas_activas ?? 0)
                >= LIMITE_TAREAS
            }
          >
            {guardando ? 'Guardando...' : 'Confirmar'}
          </button>
        </ModalActions>
      </Modal>
    </div>
  )
}