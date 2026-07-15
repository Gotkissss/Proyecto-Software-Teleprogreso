/**
 * pages/ReasignacionPage.jsx
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Spinner from '../components/ui/Spinner'
import Badge from '../components/ui/Badge'
import apiClient from '../api/client'
import styles from './ReasignacionPage.module.css'


const LIMITE_TAREAS = 3

export default function ReasignacionPage() {

  const navigate = useNavigate()

  const [tareas, setTareas] = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [tareaSeleccionada, setTareaSeleccionada] = useState(null)
  const [tecnicoNuevo, setTecnicoNuevo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(null)
  const [errorReasignacion, setErrorReasignacion] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { getTareas } = await import('../api/tareaService')

          const [tareasData, tecnicosResp, todasTareasData] = await Promise.all([
            getTareas(),
            apiClient.get('/empleados?rol=tecnico'),
            getTareas(),
          ])

          const listaTareas = Array.isArray(tareasData) ? tareasData : []
          const listaTecnicos = tecnicosResp.data?.empleados ?? tecnicosResp.data ?? []
          const todasTareas = Array.isArray(todasTareasData) ? todasTareasData : []

          // Calcular cuántas tareas activas tiene cada técnico
          const tecnicosConConteo = listaTecnicos.map((tec) => {
            const activas = todasTareas.filter((t) =>
              t.tecnico?.id_empleado === tec.id_empleado &&
              ['pendiente', 'en_progreso'].includes(t.estado_tarea)
            ).length

            return {
              ...tec,
              id: tec.id_empleado,
              nombre_completo: `${tec.nombre} ${tec.apellido}`,
              tareas_activas: activas,
            }
          })

          setTareas(listaTareas)
          setTecnicos(tecnicosConConteo)
      } catch (err) {
        setError('No se pudieron cargar las tareas.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

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
      const { reasignarTarea } = await import('../api/tareaService')

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

          return id === selId
            ? { ...t, tecnico: tecnicoSeleccionado }
            : t
        })
      )

      setExito('Tarea reasignada correctamente.')
      setTareaSeleccionada(null)
      setTecnicoNuevo('')

      setTimeout(() => setExito(null), 3000)

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

  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return <p className={styles.errorMsg}>{error}</p>
  }

  return (
    <div className={styles.page}>

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

      {exito && (
        <div className={styles.exitoBanner}>
          {exito}
        </div>
      )}

      {tareas.length === 0 ? (
        <p className={styles.emptyMsg}>
          No hay tareas activas para reasignar.
        </p>
      ) : (
        <ul className={styles.tareasList}>
          {tareas.map((tarea) => {
            const id = tarea.id_tarea ?? tarea.id

            return (
              <li key={id} className={styles.tareaItem}>
                <div className={styles.tareaInfo}>
                  <span className={styles.tareaTitulo}>
                    {tarea.titulo}
                  </span>

                  <span className={styles.tareaTecnico}>
                    {tarea.tecnico?.nombre_completo
                      ?? (
                        tarea.empleados?.length > 0
                          ? tarea.empleados[0].id_empleado
                          : 'Sin asignar'
                      )}
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

      {tareaSeleccionada && (
        <div
          className={styles.overlay}
          onClick={() => setTareaSeleccionada(null)}
        >
          <div
            className={styles.panel}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.panelTitle}>
              Reasignar tarea
            </h2>

            <p className={styles.panelSubtitle}>
              {tareaSeleccionada.titulo}
            </p>

            {errorReasignacion && (
              <div className={styles.errorPanel}>
                <span className={styles.errorPanelIcon}>⚠</span>
                <span>{errorReasignacion}</span>
              </div>
            )}

            <label className={styles.label}>
              Asignar a:
            </label>

            <select
              className={styles.select}
              value={tecnicoNuevo}
              onChange={(e) => {
                setTecnicoNuevo(e.target.value)
                setErrorReasignacion(null)
              }}
            >
              <option value="">
                Selecciona un técnico
              </option>

              {tecnicos.map((tec) => {
                const alLimite =
                  (tec.tareas_activas ?? 0) >= LIMITE_TAREAS

                return (
                  <option
                    key={tec.id}
                    value={tec.id}
                    disabled={alLimite}
                  >
                    {tec.nombre_completo}
                    {' — '}
                    {tec.tareas_activas ?? 0} tarea
                    {tec.tareas_activas !== 1 ? 's' : ''}
                    {' '}activa
                    {tec.tareas_activas !== 1 ? 's' : ''}
                    {alLimite ? ' (límite alcanzado)' : ''}
                  </option>
                )
              })}
            </select>

            {tecnicoNuevo && (() => {
              const tec = tecnicos.find(
                (t) => t.id === Number(tecnicoNuevo)
              )

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

            <div className={styles.panelBtns}>
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
                  (
                    tecnicos.find(
                      (t) => t.id === Number(tecnicoNuevo)
                    )?.tareas_activas ?? 0
                  ) >= LIMITE_TAREAS
                }
              >
                {guardando ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}