/**
 * pages/ReasignacionPage.jsx
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal, { ModalActions } from '../components/ui/Modal'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import ModalDetalleTarea from '../components/tareas/ModalDetalleTarea'
import ModalEditarTarea from '../components/tareas/ModalEditarTarea'
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import MiniMapaTarea from '../components/mapa/MiniMapaTarea'
import { ESTADO_LABEL } from '../components/mapa/estadoColor'
import {
  LIMITE_TAREAS_FALLBACK,
  getTareas,
  getTecnicosDisponibles,
  reasignarTarea,
} from '../api/tareaService'
import { diasRestantes, parsearFechaLocal } from '../utils/vencimiento'
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

/**
 * Color de la barra de acento de la tarjeta: sigue al progreso (pendiente vs.
 * en curso), no al vencimiento. Con las cards agrupadas en columnas, ver de
 * un vistazo en qué van todas las tareas de un técnico importa más que cuál
 * está más cerca de vencer, que ya se lee en su propio badge.
 */
const acentoDe = (estado) => (estado === 'en_progreso' ? 'en_progreso' : 'pendiente')

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
const IconCalendario = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)
const IconFlechaAbajo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="6 13 12 19 18 13" />
  </svg>
)
const IconExclamacion = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
    <line x1="12" y1="4" x2="12" y2="15" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
)
// Único icono con relleno sólido de los tres: la campana "suena" con más
// fuerza visual que un simple contorno, y como urgente es la prioridad más
// alta, conviene que sea la que más pese en la columna. Las ondas de sonido
// y el badajo se quedan en trazo porque un arco tan fino no se ve bien
// relleno.
const IconCampana = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="currentColor" stroke="none" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    <path d="M3.5 5a10 10 0 0 0-1.5 3" />
    <path d="M20.5 5a10 10 0 0 1 1.5 3" />
  </svg>
)

// Un icono por prioridad en vez de texto: media no lleva icono a propósito,
// para que solo urgente/alta/baja "griten" y media quede neutra.
const PRIORIDAD_ICONO = {
  baja:    IconFlechaAbajo,
  alta:    IconExclamacion,
  urgente: IconCampana,
}

/** Vacío = pendiente, mitad inferior rellena = en curso. Reemplaza al badge
    de estado solo en la card del tablero: ahí el progreso se lee de un
    vistazo por el relleno, sin gastar el espacio de un badge de texto. */
const IconProgreso = ({ enProgreso }) => (
  <svg viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.75" />
    {enProgreso && <path d="M2 8a6 6 0 0 0 12 0z" fill="currentColor" />}
  </svg>
)

// Opciones del selector "Agrupar por". El valor es la clave que consume
// `agruparTareas`; el label es lo que ve el supervisor en el <select>.
const AGRUPACIONES = [
  { value: 'asignado',     label: 'Asignado a' },
  { value: 'prioridad',    label: 'Prioridad' },
  { value: 'progreso',     label: 'Progreso' },
  { value: 'vencimiento',  label: 'Fecha de finalización' },
]

const ORDEN_PRIORIDAD = ['urgente', 'alta', 'media', 'baja']
const ORDEN_PROGRESO = ['pendiente', 'en_progreso']

/**
 * Agrupa las tareas en columnas tipo Planner según el criterio elegido.
 *
 * "Prioridad" y "Progreso" usan un orden fijo (siempre las mismas columnas,
 * aunque estén vacías) porque son catálogos cerrados. "Asignado a" es
 * dinámico: una columna por técnico que tenga tareas, más "Sin asignar" al
 * final si aplica.
 */
function agruparTareas(tareas, criterio) {
  if (criterio === 'asignado') {
    const porTecnico = new Map()

    tareas.forEach((t) => {
      const nombre = t.tecnico?.nombre ?? null
      const key = nombre ?? '__sin_asignar__'
      if (!porTecnico.has(key)) {
        porTecnico.set(key, { key, label: nombre ?? 'Sin asignar', tareas: [] })
      }
      porTecnico.get(key).tareas.push(t)
    })

    return [...porTecnico.values()].sort((a, b) => {
      if (a.key === '__sin_asignar__') return 1
      if (b.key === '__sin_asignar__') return -1
      return a.label.localeCompare(b.label, 'es')
    })
  }

  if (criterio === 'prioridad') {
    return ORDEN_PRIORIDAD.map((p) => ({
      key: p,
      label: PRIORIDAD_LABEL[p],
      tareas: tareas.filter((t) => (t.prioridad ?? 'media').toLowerCase() === p),
    }))
  }

  if (criterio === 'progreso') {
    const presentes = new Set(tareas.map(estadoDe))
    const otros = [...presentes].filter((e) => !ORDEN_PROGRESO.includes(e))

    return [...ORDEN_PROGRESO, ...otros].map((e) => ({
      key: e,
      label: ESTADO_LABEL[e] ?? e,
      tareas: tareas.filter((t) => estadoDe(t) === e),
    }))
  }

  // criterio === 'vencimiento'
  const conRetraso = []
  const futuras = []
  const sinFecha = []

  tareas.forEach((t) => {
    if (!t.fecha_finalizacion) {
      sinFecha.push(t)
      return
    }
    const dias = diasRestantes(t.fecha_finalizacion)
    if (dias !== null && dias < 0) conRetraso.push(t)
    else futuras.push(t)
  })

  return [
    { key: 'retraso',   label: 'Con retraso', tareas: conRetraso },
    { key: 'futuras',   label: 'Futuras',     tareas: futuras },
    { key: 'sin_fecha', label: 'Sin fecha',   tareas: sinFecha },
  ]
}

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
  // Criterio de agrupación del tablero (SCRUM: vista tipo Planner por buckets).
  const [agrupacion, setAgrupacion] = useState('asignado')

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

  const grupos = useMemo(
    () => agruparTareas(tareasActivas, agrupacion),
    [tareasActivas, agrupacion]
  )

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
        <div>
          <h1 className={styles.title}>
            Reasignación de servicios
          </h1>
          <p className={styles.subtitle}>
            Tareas pendientes y en curso, disponibles para reasignar.
          </p>
        </div>

        <button
          className={`btn btn-primary ${styles.nuevaTareaBtn}`}
          onClick={() => navigate('/supervisor/nueva-tarea')}
        >
          <IconMas />
          <span>Nueva tarea</span>
        </button>
      </div>

      {/* Selector de agrupación del tablero, arriba a la derecha, como en
          Planner: cambia el criterio de las columnas sin recargar nada. */}
      {tareasActivas.length > 0 && (
        <div className={styles.boardToolbar}>
          <label className={styles.agruparLabel} htmlFor="agrupar-por">
            Agrupar por
          </label>
          <select
            id="agrupar-por"
            className={styles.agruparSelect}
            value={agrupacion}
            onChange={(e) => setAgrupacion(e.target.value)}
          >
            {AGRUPACIONES.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </div>
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
        <div className={styles.board}>
          {grupos.map((grupo) => (
            <div key={grupo.key} className={styles.boardColumn}>
              <div className={styles.boardColumnHeader}>
                <span className={styles.boardColumnTitle}>{grupo.label}</span>
                <span className={styles.boardColumnCount}>{grupo.tareas.length}</span>
              </div>

              <div className={styles.boardColumnBody}>
                {grupo.tareas.length === 0 ? (
                  <p className={styles.boardColumnEmpty}>Sin tareas</p>
                ) : (
                  grupo.tareas.map((tarea) => {
                    const id = tarea.id_tarea ?? tarea.id
                    const estado = estadoDe(tarea)
                    const prioridad = (tarea.prioridad ?? 'media').toLowerCase()
                    const enProgreso = estado === 'en_progreso'
                    const PrioridadIcono = PRIORIDAD_ICONO[prioridad]

                    // Estado de la fecha límite: vencida (rojo), futura/hoy
                    // (azul) o sin fecha asignada (gris), con el icono de
                    // calendario haciendo de badge en los tres casos.
                    const fechaLimite = tarea.fecha_finalizacion
                    const dias = fechaLimite ? diasRestantes(fechaLimite) : null
                    const fechaEstado = !fechaLimite ? 'sinFecha' : dias < 0 ? 'vencida' : 'futura'
                    const fechaTexto = fechaLimite
                      ? (() => {
                          const f = parsearFechaLocal(fechaLimite)
                          return f
                            ? `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}`
                            : null
                        })()
                      : null

                    return (
                      <div
                        key={id}
                        className={`${styles.tareaCard} ${styles[`acento_${acentoDe(estado)}`]}`}
                      >
                        {/* Toda la zona de información abre la ficha. Los
                            botones de abajo detienen la propagación para que
                            "Editar" no dispare además el detalle. */}
                        <div
                          className={styles.tareaCardInfo}
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
                          <span className={styles.tareaCardTituloRow}>
                            <span
                              className={`${styles.progresoIcon} ${styles[`progresoIcon_${acentoDe(estado)}`]}`}
                              title={ESTADO_LABEL[estado] ?? estado}
                            >
                              <IconProgreso enProgreso={enProgreso} />
                            </span>
                            <span className={styles.tareaCardTitulo}>{tarea.titulo}</span>
                          </span>

                          <span className={styles.tareaCardChips}>
                            <span
                              className={`${styles.fechaChip} ${styles[`fechaChip_${fechaEstado}`]}`}
                              title={
                                fechaEstado === 'sinFecha'
                                  ? 'Sin fecha límite'
                                  : `Fecha límite: ${fechaTexto}`
                              }
                            >
                              <IconCalendario />
                              {fechaTexto && <span>{fechaTexto}</span>}
                            </span>

                            {PrioridadIcono && (
                              <span
                                className={`${styles.prioridadIcono} ${styles[`prioridadIcono_${prioridad}`]}`}
                                title={PRIORIDAD_LABEL[prioridad] ?? prioridad}
                              >
                                <PrioridadIcono />
                              </span>
                            )}
                          </span>

                          {/* El backend devuelve tecnico.nombre (nombre
                              completo). Antes se leía `nombre_completo`, que
                              no existe, y todas las tareas aparecían como
                              "Sin asignar". */}
                          {tarea.tecnico?.nombre ? (
                            <span className={styles.tecnicoChip}>
                              <span className={styles.tecnicoAvatar}>
                                {tarea.tecnico.nombre[0].toUpperCase()}
                              </span>
                              <span className={styles.metaTecnico}>{tarea.tecnico.nombre}</span>
                            </span>
                          ) : (
                            <span className={styles.metaSinAsignar}>Sin asignar</span>
                          )}

                          {tarea.direccion_servicio && (
                            <span className={styles.metaDireccion}>
                              <IconPin />
                              <span className={styles.metaDireccionTexto}>
                                {tarea.direccion_servicio}
                              </span>
                            </span>
                          )}
                        </div>

                        <div
                          className={styles.tareaCardAcciones}
                          onClick={(e) => e.stopPropagation()}
                        >
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
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
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