import { useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getMiRuta, iniciarServicio } from '../api/rutaService'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import ModalFinalizarTarea from '../components/tareas/ModalFinalizarTarea'
import {
  ESTADO_LABEL,
  PRIORIDAD_LABEL,
  variantePorEstado,
  variantePorPrioridad,
} from '../components/mapa/estadoColor'
import { describirVencimiento } from '../utils/vencimiento'
import styles from './RutaDiariaPage.module.css'

const IconPin      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
const IconRoute    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
const IconNav      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
const IconChevron  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
const IconCalendar = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
const IconAlert    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
const IconPlay     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const IconCheck    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
// SCRUM-158: botón "Ver en mapa" en el panel de detalle
const IconMap      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" /></svg>

// Panel de detalle / modal de tarea
function DetallePanel({ servicio, onClose, onIniciar, onTerminar, onVerEnMapa }) {
  const isInProgress = servicio.estado === 'en_progreso'
  const isCompleted  = servicio.estado === 'completado'

  return (
    <Modal open={Boolean(servicio)} onClose={onClose} title={servicio.nombre}>
      <div className={styles.panelBody}>
        {/* Estado actual */}
        <div className={styles.panelEstadoRow}>
          <span className={styles.panelEstadoLabel}>Estado de la tarea</span>
          <Badge
            label={ESTADO_LABEL[servicio.estado] ?? servicio.estado}
            variant={variantePorEstado(servicio.estado)}
          />
        </div>

        {/* Detalles */}
        <div className={styles.panelDetails}>
          <div className={styles.panelDetailRow}>
            <span className={styles.panelDetailKey}>Dirección</span>
            <span className={styles.panelDetailVal}>{servicio.direccion}</span>
          </div>
          <div className={styles.panelDetailRow}>
            <span className={styles.panelDetailKey}>Tipo</span>
            <span className={styles.panelDetailVal}>{servicio.tipo}</span>
          </div>
          <div className={styles.panelDetailRow}>
            <span className={styles.panelDetailKey}>Prioridad</span>
            <Badge
              label={PRIORIDAD_LABEL[servicio.prioridad] ?? servicio.prioridad}
              variant={variantePorPrioridad(servicio.prioridad)}
            />
          </div>
        </div>

        {/* SCRUM-158: enlace directo al mapa, centrado en esta tarea */}
        <button
          className={`btn btn-secondary ${styles.panelBtn}`}
          onClick={() => onVerEnMapa(servicio.id_servicio)}
        >
          <IconMap />
          <span>Ver en mapa</span>
        </button>

        {/* Acciones */}
        {!isCompleted && (
          <div className={styles.panelActions}>
            {!isInProgress ? (
              <button
                className={`btn btn-primary btn-lg ${styles.panelBtn}`}
                onClick={() => onIniciar(servicio.id_servicio)}
              >
                <IconPlay />
                <span>Iniciar tarea</span>
              </button>
            ) : (
              <button
                className={`btn btn-success btn-lg ${styles.panelBtn}`}
                onClick={() => onTerminar(servicio.id_servicio)}
              >
                <IconCheck />
                <span>Terminar tarea</span>
              </button>
            )}
          </div>
        )}

        {isCompleted && (
          <div className={styles.panelCompletado}>
            <IconCheck />
            <span>Tarea completada</span>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ServicioCard({ servicio, onVerDetalle }) {
  const isActive    = servicio.estado === 'en_progreso'
  const isCompleted = servicio.estado === 'completado'

  return (
    <article
      className={`
        ${styles.card}
        ${isActive    ? styles.cardActive    : ''}
        ${isCompleted ? styles.cardCompleted : ''}
        ${servicio.prioridad === 'urgente' && !isCompleted ? styles.cardUrgente : ''}
      `}
    >
      <div className={styles.cardMain}>
        <div className={styles.timeline}>
          <div className={`${styles.dot} ${styles[`dot_${servicio.estado}`]} ${servicio.prioridad === 'urgente' && servicio.estado === 'pendiente' ? styles.dot_urgente : ''}`} />
          <div className={styles.line} />
        </div>

        <div className={styles.info}>
          <div className={styles.badges}>
            <Badge
              label={ESTADO_LABEL[servicio.estado] ?? servicio.estado}
              variant={variantePorEstado(servicio.estado)}
            />
            {servicio.prioridad === 'urgente' && (
              <Badge label="Urgente" variant={variantePorPrioridad('urgente')} />
            )}
            {servicio.prioridad === 'alta' && servicio.estado !== 'completado' && (
              <Badge label="Alta" variant={variantePorPrioridad('alta')} />
            )}
            {/* Cuánto queda para la fecha límite. El técnico veía la lista sin
                ninguna señal de qué vence hoy y qué ya se pasó. */}
            {(() => {
              const v = describirVencimiento(servicio)
              return v ? <Badge label={v.texto} variant={v.variant} /> : null
            })()}
          </div>
          <h3 className={styles.nombre}>{servicio.nombre}</h3>
          <p className={styles.direccion}>
            <span className={styles.pinIcon}><IconPin /></span>
            {servicio.direccion}
          </p>
          <p className={styles.tipo}>{servicio.tipo}</p>
        </div>

        <button
          className={styles.chevronBtn}
          onClick={() => onVerDetalle(servicio)}
          aria-label={`Ver detalles de ${servicio.nombre}`}
        >
          <IconChevron />
        </button>
      </div>

      {!isCompleted && (
        <button
          className={`btn ${isActive ? 'btn-primary' : 'btn-ghost'} ${styles.navBtn}`}
          onClick={() => onVerDetalle(servicio)}
        >
          <IconNav />
          <span>
            {isActive ? 'Tarea en curso — Ver detalles' : 'Ver detalles de la orden'}
          </span>
        </button>
      )}
    </article>
  )
}

export default function RutaDiariaPage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [ruta,           setRuta]           = useState(null)
  const [servicios,      setServicios]      = useState([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [detalleAbierto, setDetalleAbierto] = useState(null)
  // Tarea que el técnico está cerrando desde el modal de evidencia (SCRUM-139)
  const [tareaFinalizando, setTareaFinalizando] = useState(null)

  // Los contadores se derivan de los datos, no de estado local: antes
  // arrancaban en 0 en cada montaje, así que al recargar la pantalla decían
  // "0 paradas" aunque el técnico ya hubiera cerrado tareas ese día.

  const fetchRuta = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const data = await getMiRuta(user?.id_empleado)
      setRuta(data)
      // Ordena: urgentes primero, luego por prioridad, completadas al final
      setServicios(ordenarServicios(data.servicios))
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la ruta.')
    } finally {
      setLoading(false)
    }
  }, [user?.id_empleado])

  useEffect(() => {
    fetchRuta()
  }, [fetchRuta])

  const ordenarServicios = (lista) => {
    const prioridadOrden = { urgente: 0, alta: 1, media: 2, baja: 3 }
    const pendientes = lista
      .filter((s) => s.estado !== 'completado')
      .sort((a, b) => (prioridadOrden[a.prioridad] ?? 99) - (prioridadOrden[b.prioridad] ?? 99))
    const completadas = lista.filter((s) => s.estado === 'completado')
    return [...pendientes, ...completadas]
  }

  const handleIniciar = async (idServicio) => {
    // Se guarda el estado previo para poder revertir con exactitud si el
    // backend rechaza el inicio (antes se revertía siempre a 'pendiente',
    // aunque la tarea viniera de otro estado).
    const estadoPrevio =
      servicios.find((s) => s.id_servicio === idServicio)?.estado ?? 'pendiente'

    // Optimistic update
    setServicios((prev) =>
      prev.map((s) =>
        s.id_servicio === idServicio ? { ...s, estado: 'en_progreso' } : s
      )
    )
    setDetalleAbierto((prev) =>
      prev && prev.id_servicio === idServicio ? { ...prev, estado: 'en_progreso' } : prev
    )
    try {
      await iniciarServicio(idServicio)
      toast.success('Servicio iniciado.')
    } catch (err) {
      const detalle = err?.response?.data?.detail ?? err.message
      console.warn('No se pudo confirmar inicio en servidor:', detalle)
      // Se revierte el optimistic update: si el backend no lo aceptó, la
      // tarjeta no debe quedarse en "en progreso" engañando al técnico.
      setServicios((prev) =>
        prev.map((s) =>
          s.id_servicio === idServicio ? { ...s, estado: estadoPrevio } : s
        )
      )
      setDetalleAbierto((prev) =>
        prev && prev.id_servicio === idServicio
          ? { ...prev, estado: estadoPrevio }
          : prev
      )
      toast.error(detalle || 'No se pudo iniciar el servicio.')
    }
  }

  /**
   * Una tarea ya no se cierra directamente: primero se pide la evidencia.
   * El estado local solo cambia cuando el backend confirmó que la guardó,
   * así no se marca como completada una tarea cuya foto no llegó a subirse.
   */
  const handleTerminar = (idServicio) => {
    const servicio = servicios.find((s) => s.id_servicio === idServicio)
    if (!servicio) return
    setDetalleAbierto(null)
    setTareaFinalizando(servicio)
  }

  const handleFinalizada = (idServicio) => {
    setServicios((prev) =>
      ordenarServicios(
        prev.map((s) =>
          s.id_servicio === idServicio
            ? {
                ...s,
                estado: 'completado',
                fecha_completado: new Date().toISOString(),
                total_incidencias: (s.total_incidencias ?? 0) + 1,
              }
            : s
        )
      )
    )
    // Se recarga contra el servidor para que la lista refleje lo que quedó
    // realmente guardado. Antes solo se actualizaba el array local: al salir
    // y volver a entrar reaparecía la tarea como si nada hubiera pasado.
    fetchRuta()
  }

  const handleVerDetalle = (servicio) => {
    // Siempre toma el estado más reciente del array
    const actual = servicios.find((s) => s.id_servicio === servicio.id_servicio) ?? servicio
    setDetalleAbierto(actual)
  }

  /**
   * SCRUM-158: navega al Mapa de Ruta pasando el id de la tarea seleccionada
   * por `state` (no por query string) para que MapaPage centre y resalte su
   * marcador sin acoplar ambas pantallas a un formato de URL.
   */
  const handleVerEnMapa = (idServicio) => {
    setDetalleAbierto(null)
    navigate('/mapa', { state: { servicioId: idServicio } })
  }

  // Sincroniza el panel si el estado cambió externamente
  const servicioEnPanel = detalleAbierto
    ? servicios.find((s) => s.id_servicio === detalleAbierto.id_servicio) ?? detalleAbierto
    : null

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando tu ruta del día..."
        error={error}
        onRetry={fetchRuta}
        errorTitle="No se pudo cargar tu ruta"
      />
    )
  }

  const totalServicios = servicios.length
  const paradasCompletadas = servicios.filter((s) => s.estado === 'completado').length
  const paradasPendientes = servicios.filter(
    (s) => s.estado === 'pendiente' || s.estado === 'en_progreso'
  ).length

  const fechaRuta = ruta?.fecha
    ? new Date(ruta.fecha + 'T12:00:00').toLocaleDateString('es-GT', {
        day: 'numeric', month: 'long',
      })
    : ''

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>Ruta de hoy</h1>
        <p className={styles.subtitle}>
          <IconCalendar />
          {fechaRuta ? `${fechaRuta}` : 'Tus paradas del día'}
        </p>
      </header>

      {/* Contadores — derivados de las tareas reales del día */}
      <section className={styles.resumen}>
        <div className={styles.resumenItem}>
          <span className={styles.resumenIcon}><IconPin /></span>
          <span className={styles.resumenValue}>
            {paradasCompletadas}/{totalServicios}
          </span>
          <span className={styles.resumenLabel}>Completadas</span>
        </div>
        <div className={styles.resumenDivider} />
        <div className={styles.resumenItem}>
          <span className={styles.resumenIcon}><IconRoute /></span>
          <span className={styles.resumenValue}>{paradasPendientes}</span>
          <span className={styles.resumenLabel}>Pendientes</span>
        </div>
      </section>

      {ruta?.alerta && (
        <div className={styles.alertBanner}>
          <IconAlert />
          <span>{ruta.alerta.mensaje}</span>
        </div>
      )}

      <section className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Cronograma del día</h2>
          <span className={styles.listUpdated}>
            Actualizado: {new Date().toLocaleTimeString('es-GT', {
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>

        {servicios.length > 0 ? (
          <div className={styles.list}>
            {servicios.map((s) => (
              <ServicioCard
                key={s.id_servicio}
                servicio={s}
                onVerDetalle={handleVerDetalle}
              />
            ))}
          </div>
        ) : (
          <PageState
            empty
            emptyIcon={<IconPin />}
            emptyTitle="Sin paradas para hoy"
            emptyDescription="Cuando tu supervisor te asigne tareas aparecerán en esta lista."
          />
        )}

        {servicios.length > 0 && (
          <p className={styles.listEnd}>No hay más paradas programadas</p>
        )}
      </section>

      {/* Panel de detalle */}
      {servicioEnPanel && (
        <DetallePanel
          servicio={servicioEnPanel}
          onClose={() => setDetalleAbierto(null)}
          onIniciar={handleIniciar}
          onTerminar={handleTerminar}
          onVerEnMapa={handleVerEnMapa}
        />
      )}

      {/* SCRUM-139/140: evidencia obligatoria al cerrar la tarea */}
      <ModalFinalizarTarea
        open={Boolean(tareaFinalizando)}
        servicio={tareaFinalizando}
        onClose={() => setTareaFinalizando(null)}
        onFinalizada={handleFinalizada}
      />
    </div>
  )
}
