/**
 * pages/ReasignacionPage.jsx
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import Modal, { ModalActions } from '../components/ui/Modal'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import ModalDetalleTarea from '../components/tareas/ModalDetalleTarea'
import ModalEditarTarea from '../components/tareas/ModalEditarTarea'
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import MiniMapaTarea from '../components/mapa/MiniMapaTarea'
import {
  LIMITE_TAREAS_FALLBACK,
  getTareas,
  getTecnicosDisponibles,
  reasignarTarea,
} from '../api/tareaService'
import { describirVencimiento } from '../utils/vencimiento'
import styles from './ReasignacionPage.module.css'


// Respaldo. El límite real lo manda el backend en `limite_tareas` de cada
// técnico (backend/app/core/reglas.py). Esta pantalla lo tenía escrito a mano
// como 3, así que tras subir la política a 5 marcaba técnicos como llenos
// cuando todavía podían recibir trabajo.
const LIMITE_TAREAS = LIMITE_TAREAS_FALLBACK

/** Límite vigente para un técnico concreto. */
const limiteDe = (tecnico) => tecnico?.limite_tareas ?? LIMITE_TAREAS

/** True si el técnico ya no puede recibir más trabajo. */
const alLimite = (tecnico) => (tecnico?.tareas_activas ?? 0) >= limiteDe(tecnico)

// Estados en los que la tarea ya está cerrada: no se reasigna algo que
// el técnico ya entregó (ni algo que se canceló).
const ESTADOS_CERRADOS = ['completado', 'cancelado']

const estadoDe = (tarea) => tarea.estado_tarea ?? tarea.estado
const estaCerrada = (tarea) => ESTADOS_CERRADOS.includes(estadoDe(tarea))

const PRIORIDAD_LABEL = {
  baja:    'Prioridad Baja',
  media:   'Prioridad Media',
  alta:    'Prioridad Alta',
  urgente: 'Prioridad Urgente',
}

// El label que se muestra no es el valor crudo ('Prioridad Alta' y no 'alta'),
// así que Badge no puede deducir la variante sola y se le pasa explícita.
const PRIORIDAD_VARIANT = {
  baja:    'muted',
  media:   'info',
  alta:    'warning',
  urgente: 'danger',
}

/**
 * Color de la barra lateral de la tarjeta.
 *
 * Sigue al vencimiento y no a la prioridad: lo que hace que una tarea salte a
 * la vista en esta pantalla es que se esté pasando de fecha. Una tarea urgente
 * con una semana por delante no necesita gritar; una media que venció ayer sí.
 */
const acentoDe = (vencimiento) => {
  if (!vencimiento) return 'neutro'
  if (vencimiento.variant === 'danger') return 'critico'
  if (vencimiento.variant === 'warning') return 'proximo'
  return 'neutro'
}

// ── Iconos ───────────────────────────────────────────────────────────────────
const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)
const IconMas = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

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
  // Ficha de solo lectura: se abre al hacer clic en la tarjeta, sin tener que
  // entrar al modal de edición solo para consultar los datos.
  const [tareaDetalle, setTareaDetalle] = useState(null)
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
    if (alLimite(tecnicoSeleccionado)) {
      setErrorReasignacion(
        `${tecnicoSeleccionado.nombre_completo} ya tiene ${tecnicoSeleccionado.tareas_activas} tareas activas. El límite es ${limiteDe(tecnicoSeleccionado)}.`
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

  // Se cuentan por separado y no como un total de "cerradas".
  //
  // El aviso decía "3 tareas ya cerradas... Ver tareas realizadas", pero
  // sumaba completadas y canceladas, mientras que la pantalla de Realizadas
  // solo muestra las completadas. Con los datos de ejemplo (2 completadas y 1
  // cancelada) el supervisor leía 3, entraba, y encontraba 2 sin explicación.
  const totalCompletadas = useMemo(
    () => tareas.filter((t) => estadoDe(t) === 'completado').length,
    [tareas]
  )
  const totalCanceladas = useMemo(
    () => tareas.filter((t) => estadoDe(t) === 'cancelado').length,
    [tareas]
  )
  const totalCerradas = totalCompletadas + totalCanceladas

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

      {/* Ficha de solo lectura. Desde aquí se puede saltar a editar, reasignar
          o ver evidencias sin volver a la lista. */}
      <ModalDetalleTarea
        tarea={tareaDetalle}
        onClose={() => setTareaDetalle(null)}
        onEditar={(t) => { setTareaDetalle(null); setTareaEditando(t) }}
        onReasignar={(t) => { setTareaDetalle(null); abrirPanel(t) }}
        onVerEvidencias={(t) => { setTareaDetalle(null); setTareaEvidencias(t) }}
      />

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
          className={`btn btn-primary ${styles.nuevaTareaBtn}`}
          onClick={() => navigate('/supervisor/nueva-tarea')}
        >
          <IconMas />
          <span>Nueva tarea</span>
        </button>
      </div>

      {/* Aviso de lo que se está ocultando, con salida hacia el historial:
          si no, parecería que las tareas cerradas se perdieron. */}
      {totalCerradas > 0 && (
        <p className={styles.cerradasNota}>
          {/* Cada cifra dice exactamente qué es y a dónde lleva. Las
              canceladas no tienen pantalla propia, así que se nombran pero no
              se enlazan: prometer un enlace que no existe es peor que no
              mencionarlas. */}
          {totalCompletadas > 0 && (
            <>
              {totalCompletadas} realizada{totalCompletadas === 1 ? '' : 's'}
              {totalCanceladas > 0 && ` y ${totalCanceladas} cancelada${totalCanceladas === 1 ? '' : 's'}`}
            </>
          )}
          {totalCompletadas === 0 && (
            <>{totalCanceladas} cancelada{totalCanceladas === 1 ? '' : 's'}</>
          )}
          {' '}en total no aparece{totalCerradas === 1 ? '' : 'n'} aquí.
          {totalCompletadas > 0 && (
            <>
              {' '}
              <button
                type="button"
                className={styles.verRealizadasBtn}
                onClick={() => navigate('/supervisor/historial-tareas')}
              >
                Ver tareas realizadas
              </button>
              {/* El histórico ya cubre semanas de trabajo (SCRUM-180), así que
                  este número es mucho mayor que lo que abre "Realizadas", que
                  arranca en los últimos 7 días. Sin este aviso el supervisor
                  compara las dos cifras y cree que se perdieron tareas. */}
              <span className={styles.cerradasAclaracion}>
                (el historial abre en los últimos 7 días; amplía el rango para ver más)
              </span>
            </>
          )}
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
              className={`btn btn-primary ${styles.nuevaTareaBtn}`}
              onClick={() => navigate('/supervisor/nueva-tarea')}
            >
              <IconMas />
              <span>Nueva tarea</span>
            </button>
          }
        />
      ) : (
        <ul className={styles.tareasList}>
          {tareasActivas.map((tarea) => {
            const id = tarea.id_tarea ?? tarea.id
            const vencimiento = describirVencimiento(tarea)
            const estado = estadoDe(tarea)
            const prioridad = (tarea.prioridad ?? 'media').toLowerCase()
            const enProgreso = estado === 'en_progreso'

            return (
              <li
                key={id}
                className={`${styles.tareaItem} ${styles[`acento_${acentoDe(vencimiento)}`]}`}
              >
                {/* Toda la zona de información abre la ficha. Los botones de
                    la derecha detienen la propagación para que "Editar" no
                    dispare además el detalle. */}
                <div
                  className={`${styles.tareaInfo} ${styles.tareaInfoClickable}`}
                  role="button"
                  tabIndex={0}
                  title="Ver detalle de la tarea"
                  onClick={() => setTareaDetalle(tarea)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setTareaDetalle(tarea)
                    }
                  }}
                >
                  <span className={styles.tareaTitulo}>
                    {tarea.titulo}
                  </span>

                  {/* Quién la lleva y dónde. El nombre va destacado porque es
                      el dato por el que se busca al repartir trabajo. */}
                  <span className={styles.tareaMeta}>
                    {/* El backend devuelve tecnico.nombre (nombre completo).
                        Antes se leía `nombre_completo`, que no existe, y todas
                        las tareas aparecían como "Sin asignar". */}
                    <span
                      className={
                        tarea.tecnico?.nombre ? styles.metaTecnico : styles.metaSinAsignar
                      }
                    >
                      {tarea.tecnico?.nombre ?? 'Sin asignar'}
                    </span>

                    {tarea.direccion_servicio && (
                      <>
                        <span className={styles.metaSep} aria-hidden="true">·</span>
                        <span className={styles.metaDireccion}>
                          <IconPin />
                          {tarea.direccion_servicio}
                        </span>
                      </>
                    )}
                  </span>

                  {/* Fila de contexto: cuánto queda, qué tan urgente es y de
                      qué va la tarea, todo a un golpe de vista. */}
                  <span className={styles.tareaChips}>
                    {/* Cuánto queda para la fecha límite, para no tener que
                        calcularlo mentalmente a partir de una fecha suelta. */}
                    {vencimiento && (
                      <Badge label={vencimiento.texto} variant={vencimiento.variant} />
                    )}

                    <Badge
                      label={PRIORIDAD_LABEL[prioridad] ?? `Prioridad ${prioridad}`}
                      variant={PRIORIDAD_VARIANT[prioridad] ?? 'muted'}
                    />

                    {tarea.descripcion && (
                      <span className={styles.tareaDescripcion}>{tarea.descripcion}</span>
                    )}
                  </span>
                </div>

                <div className={styles.tareaAcciones} onClick={(e) => e.stopPropagation()}>
                  <Badge label={estado} variant={enProgreso ? 'info' : 'warning'} />

                  {tarea.total_incidencias > 0 && (
                    <button
                      className={`btn btn-secondary btn-sm ${styles.evidenciasBtn}`}
                      onClick={() => setTareaEvidencias(tarea)}
                      title="Ver las evidencias que dejó el técnico"
                    >
                      Evidencias
                      <span className={styles.evidenciasCount}>
                        {tarea.total_incidencias}
                      </span>
                    </button>
                  )}

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setTareaEditando(tarea)}
                  >
                    Editar
                  </button>

                  <button
                    className="btn btn-primary btn-sm"
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
        width={520}
      >
        <p className={styles.panelSubtitle}>
          {tareaSeleccionada?.titulo}
        </p>

        {/* SCRUM-172: dónde queda el servicio. Reasignar a ciegas obligaba a
            abrir el mapa del equipo en otra pestaña para saber si la zona le
            quedaba de camino al técnico que se estaba eligiendo. */}
        {tareaSeleccionada && <MiniMapaTarea tarea={tareaSeleccionada} />}

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
            const tecAlLimite = alLimite(tec)
            // El técnico que ya la tiene se muestra marcado y bloqueado:
            // reasignar una tarea a quien ya la tiene no hace nada.
            const esElActual = tec.id === idTecnicoActual

            return (
              <option
                key={tec.id}
                value={tec.id}
                disabled={tecAlLimite || esElActual}
              >
                {tec.nombre_completo}
                {' — '}
                {tec.tareas_activas ?? 0} tarea
                {tec.tareas_activas !== 1 ? 's' : ''}
                {' '}activa
                {tec.tareas_activas !== 1 ? 's' : ''}
                {esElActual ? ' (ya tiene esta tarea)' : ''}
                {!esElActual && tecAlLimite ? ' (límite alcanzado)' : ''}
              </option>
            )
          })}
        </select>

        {/* Único técnico en la plantilla y ya tiene la tarea: no hay a quién
            pasársela, y conviene decirlo en lugar de dejar un select inerte. */}
        {tecnicos.length > 0 &&
          tecnicos.every(
            (t) => t.id === idTecnicoActual || alLimite(t)
          ) && (
            <p className={styles.limiteMsg}>
              ⚠ No hay ningún otro técnico disponible para recibir esta tarea.
            </p>
          )}

        {tecnicoNuevo && (() => {
          const tec = tecnicos.find((t) => t.id === Number(tecnicoNuevo))
          if (!tec) return null

          const activas = tec.tareas_activas ?? 0

          if (alLimite(tec)) {
            return (
              <p className={styles.limiteMsg}>
                ⚠ Este técnico ya alcanzó el límite de {limiteDe(tec)} tareas activas.
              </p>
            )
          }

          if (activas === limiteDe(tec) - 1) {
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
            className="btn btn-ghost"
            onClick={() => setTareaSeleccionada(null)}
          >
            Cancelar
          </button>

          <button
            className="btn btn-primary"
            onClick={handleReasignar}
            disabled={
              !tecnicoNuevo ||
              guardando ||
              alLimite(tecnicos.find((t) => t.id === Number(tecnicoNuevo)))
            }
          >
            {guardando ? 'Guardando...' : 'Confirmar'}
          </button>
        </ModalActions>
      </Modal>
    </div>
  )
}