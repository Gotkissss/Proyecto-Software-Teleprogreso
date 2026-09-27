import { useCallback, useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUbicacion } from '../context/UbicacionContext'
import { getMiRuta, iniciarServicio } from '../api/rutaService'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import ModalFinalizarTarea from '../components/tareas/ModalFinalizarTarea'
import {
  ESTADO_LABEL,
  variantePorEstado,
  variantePorPrioridad,
} from '../components/mapa/estadoColor'
import { describirVencimiento } from '../utils/vencimiento'
import { formatearDistancia, urlGoogleMaps, urlWaze } from '../utils/navegacion'
import { obtenerPosicionActual } from '../utils/posicionActual'
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
function DetallePanel({ servicio, onClose, onIniciar, onTerminar, onVerEnMapa, bloqueado = false }) {
  const isInProgress = servicio.estado === 'en_progreso'
  const isCompleted  = servicio.estado === 'completado'

  const estadoColor = isCompleted
    ? '#16a34a'
    : isInProgress
    ? '#1a56db'
    : servicio.prioridad === 'urgente'
    ? '#dc2626'
    : '#64748b'

  const estadoLabel = ESTADO_LABEL[servicio.estado] ?? servicio.estado

  // Usa el Modal compartido en lugar del panel propio de esta pantalla.
  return (
    <Modal open={Boolean(servicio)} onClose={onClose} title={servicio.nombre}>
        <div className={styles.panelBody}>
          {/* Estado actual */}
          <div className={styles.panelEstadoRow}>
            <span className={styles.panelEstadoLabel}>Estado de la tarea</span>
            <span
              className={styles.panelEstadoBadge}
              style={{
                background: estadoColor + '18',
                color: estadoColor,
                border: `1px solid ${estadoColor}40`,
              }}
            >
              <span
                className={styles.panelEstadoDot}
                style={{ background: estadoColor }}
              />
              {estadoLabel}
            </span>
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
              <span className={styles.panelDetailVal} style={{ textTransform: 'capitalize' }}>
                {servicio.prioridad}
              </span>
            </div>
          </div>

          {/* SCRUM-158: enlace directo al mapa, centrado en esta tarea */}
          <button
            className={styles.verMapaBtn}
            onClick={() => onVerEnMapa(servicio.id_servicio)}
          >
            <IconMap />
            <span>Ver en mapa</span>
          </button>

          {/* Acciones */}
          {/* HU-5: sin jornada abierta no se trabaja en tareas. */}
          {!isCompleted && bloqueado && (
            <p className={styles.avisoJornada}>
              Registra tu entrada en <Link to="/pausas">Pausas</Link> para{' '}
              {isInProgress ? 'finalizar' : 'iniciar'} esta tarea.
            </p>
          )}

          {!isCompleted && (
            <div className={styles.panelActions}>
              {!isInProgress ? (
                <button
                  className={styles.iniciarBtn}
                  onClick={() => onIniciar(servicio.id_servicio)}
                  disabled={bloqueado}
                >
                  <IconPlay />
                  <span>Iniciar Tarea</span>
                </button>
              ) : (
                <button
                  className={styles.terminarBtn}
                  onClick={() => onTerminar(servicio.id_servicio)}
                  disabled={bloqueado}
                >
                  <IconCheck />
                  <span>Terminar Tarea</span>
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
          {/* HU-3: distancia desde donde está el técnico. Sin GPS o sin
              coordenada no se muestra nada: nunca una distancia inventada. */}
          {!isCompleted && formatearDistancia(servicio.distancia_m) && (
            <p className={styles.distancia}>
              {formatearDistancia(servicio.distancia_m)}
            </p>
          )}
        </div>

        <button
          className={styles.chevronBtn}
          onClick={() => onVerDetalle(servicio)}
          aria-label={`Ver detalles de ${servicio.nombre}`}
        >
          <IconChevron />
        </button>
      </div>

      {/* HU-3: "Cómo llegar" abre la app de mapas del teléfono con la
          coordenada de la tarea. Solo si la tarea tiene coordenada. */}
      {!isCompleted && urlGoogleMaps(servicio.lat, servicio.lng) && (
        <div className={styles.comoLlegar}>
          <span className={styles.comoLlegarLabel}>Cómo llegar</span>
          <a
            className={styles.comoLlegarBtn}
            href={urlGoogleMaps(servicio.lat, servicio.lng)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps
          </a>
          <a
            className={styles.comoLlegarBtn}
            href={urlWaze(servicio.lat, servicio.lng)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Waze
          </a>
        </div>
      )}

      {!isCompleted && (
        <button
          className={`${styles.navBtn} ${isActive ? styles.navBtnActive : ''}`}
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
  // HU-3: la posición sale del mismo seguimiento GPS que usa el mapa
  // (UbicacionContext); no se abre un segundo watchPosition.
  // HU-5: jornadaActiva bloquea iniciar/finalizar tareas sin haber marcado
  // entrada; refrescarJornada evita esperar el ciclo de 30 s del contexto.
  const { posicion, jornadaActiva, jornadaCargada, refrescarJornada } = useUbicacion()
  const sinJornada = jornadaCargada && !jornadaActiva
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

  // La posición cambia cada pocos segundos mientras el técnico se mueve.
  // Se lee desde una referencia para que cada lectura del GPS no vuelva a
  // pedir la ruta: se pide al entrar, cuando llega la primera posición y
  // después de cerrar una tarea.
  const posicionRef = useRef(posicion)
  posicionRef.current = posicion
  const hayPosicion = Boolean(posicion)
  const yaCargoRef = useRef(false)
  // Número de la última petición. La primera carga (sin GPS) y la que se
  // dispara al llegar la posición pueden resolverse en desorden; solo se
  // aplica la respuesta de la más reciente.
  const ultimaPeticionRef = useRef(0)

  const fetchRuta = useCallback(async ({ silencioso = false } = {}) => {
    // Silencioso: recargas que no deben tapar la lista con el spinner (p.e.
    // reordenar cuando llega la primera lectura del GPS).
    const peticion = ++ultimaPeticionRef.current
    if (!silencioso) setLoading(true)
    try {
      setError(null)
      const pos = posicionRef.current
      const data = await getMiRuta(pos ? { lat: pos.lat, lng: pos.lng } : null)
      if (peticion !== ultimaPeticionRef.current) return
      setRuta(data)
      // HU-3: el orden viene del backend (urgentes primero y luego por
      // cercanía; sin GPS, por prioridad). No se reordena aquí.
      setServicios(data.servicios)
      yaCargoRef.current = true
    } catch (err) {
      if (!silencioso && peticion === ultimaPeticionRef.current) {
        setError(err?.response?.data?.detail || 'No se pudo cargar la ruta.')
      }
    } finally {
      // Solo la petición más reciente apaga el spinner: si lo apagara una
      // reemplazada, se vería un instante el estado vacío antes de que llegue
      // la respuesta buena.
      if (peticion === ultimaPeticionRef.current) setLoading(false)
    }
  }, [])

  // Al entrar, y otra vez cuando el GPS pasa de no tener a tener posición (o
  // la pierde), para ordenar por cercanía o volver al orden por prioridad.
  useEffect(() => {
    fetchRuta({ silencioso: yaCargoRef.current })
  }, [fetchRuta, hayPosicion])

  // HU-5: el técnico puede venir de marcar entrada en Pausas; se consulta la
  // jornada al entrar para no mostrarle un bloqueo que ya no aplica.
  useEffect(() => {
    refrescarJornada?.()
  }, [refrescarJornada])

  // Tras un cambio local, las completadas bajan al final sin alterar el orden
  // que decidió el backend para el resto.
  const completadasAlFinal = (lista) => [
    ...lista.filter((s) => s.estado !== 'completado'),
    ...lista.filter((s) => s.estado === 'completado'),
  ]

  const handleIniciar = async (idServicio) => {
    if (sinJornada) {
      toast.error('Registra tu entrada para iniciar la jornada antes de iniciar tareas.')
      return
    }
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
      // HU-5: lugar del inicio para el recorrido. Nunca bloquea: sin GPS
      // llega null y la tarea se inicia igual.
      const lugar = await obtenerPosicionActual({ respaldo: posicion })
      await iniciarServicio(idServicio, lugar)
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
    if (sinJornada) {
      toast.error('Registra tu entrada para iniciar la jornada antes de finalizar tareas.')
      return
    }
    const servicio = servicios.find((s) => s.id_servicio === idServicio)
    if (!servicio) return
    setDetalleAbierto(null)
    setTareaFinalizando(servicio)
  }

  const handleFinalizada = (idServicio) => {
    setServicios((prev) =>
      completadasAlFinal(
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
        onRetry={() => fetchRuta()}
        errorTitle="No se pudo cargar tu ruta"
      />
    )
  }

  const nombre      = ruta?.tecnico?.nombre_completo ?? user?.nombre ?? 'Técnico'
  const primerNombre = nombre.split(' ')[0]
  const totalServicios = servicios.length
  const paradasCompletadas = servicios.filter((s) => s.estado === 'completado').length
  const paradasPendientes = servicios.filter(
    (s) => s.estado === 'pendiente' || s.estado === 'en_progreso'
  ).length

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.dateRow}>
          <span className={styles.dateLabel}>
            <IconCalendar />
            HOY, {ruta?.fecha
              ? new Date(ruta.fecha + 'T12:00:00').toLocaleDateString('es-GT', {
                  day: 'numeric', month: 'long',
                }).toUpperCase()
              : ''}
          </span>
        </div>
        <h2 className={styles.greeting}>Hola, {primerNombre}</h2>
      </header>

      {/* Contadores — derivados de las tareas reales del día */}
      <section className={styles.resumen}>
        <div className={styles.resumenItem}>
          <span className={styles.resumenIcon}><IconPin /></span>
          <span className={styles.resumenValue}>
            {paradasCompletadas}/{totalServicios}
          </span>
          <span className={styles.resumenLabel}>COMPLETADAS</span>
        </div>
        <div className={styles.resumenDivider} />
        <div className={styles.resumenItem}>
          <span className={styles.resumenIcon}><IconRoute /></span>
          <span className={styles.resumenValue}>{paradasPendientes}</span>
          <span className={styles.resumenLabel}>PENDIENTES</span>
        </div>
      </section>

      {/* HU-5: aviso de que sin jornada abierta no se trabaja en tareas. */}
      {sinJornada && (
        <div className={styles.avisoJornadaBanner} role="status">
          <IconAlert />
          <span>
            Registra tu entrada en <Link to="/pausas">Pausas</Link> para poder
            iniciar y finalizar tus tareas.
          </span>
        </div>
      )}

      {ruta?.alerta && (
        <div className={styles.alertBanner}>
          <IconAlert />
          <span>{ruta.alerta.mensaje}</span>
        </div>
      )}

      <section className={styles.listSection}>
        <div className={styles.listHeader}>
          <h3 className={styles.listTitle}>Cronograma del Día</h3>
          <span className={styles.listUpdated}>
            Actualizado: {new Date().toLocaleTimeString('es-GT', {
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        {/* HU-3: el técnico sabe por qué la lista está en este orden. */}
        <p className={styles.listOrden}>
          {ruta?.ordenadoPorCercania
            ? 'Urgentes primero, luego por cercanía'
            : 'Por prioridad · activa tu ubicación para ordenar por cercanía'}
        </p>

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
          <EmptyState
            title="Sin paradas para hoy"
            description="Cuando tu supervisor te asigne tareas aparecerán en esta lista."
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
          bloqueado={sinJornada}
        />
      )}

      {/* SCRUM-139/140: evidencia obligatoria al cerrar la tarea */}
      <ModalFinalizarTarea
        open={Boolean(tareaFinalizando)}
        servicio={tareaFinalizando}
        onClose={() => setTareaFinalizando(null)}
        onFinalizada={handleFinalizada}
        posicionRespaldo={posicion}
      />
    </div>
  )
}