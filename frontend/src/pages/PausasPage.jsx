import { useCallback, useState, useEffect, useRef } from 'react'
import {
  getAsistenciaHoy,
  registrarEntrada,
  iniciarPausa,
  finalizarPausa,
  finalizarJornada,
  getTiposPausa,
} from '../api/asistenciaService'
import Modal from '../components/ui/Modal'
import Spinner from '../components/ui/Spinner'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import styles from './PausasPage.module.css'


const IconClock   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
const IconPause   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
const IconPlay    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const IconCheck   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
const IconBolt    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
const IconTimer   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13"/><line x1="12" y1="3" x2="12" y2="5"/></svg>
const IconHistory = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.01"/></svg>
const IconCoffee  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
const IconLogin   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>

const JORNADA_TOTAL_SEGUNDOS = 8 * 3600 // 8 horas

const secsToHHMM = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`
}

const formatCountdown = (seconds) => {
  if (seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

const formatDuracion = (seconds) => {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function ModalPausa({ open, tipos, pausasUsadas, onSelect, onClose, loading }) {
  // Antes era un overlay propio de esta página; ahora usa el Modal compartido.
  return (
    <Modal open={open} onClose={onClose} title="Seleccionar tipo de pausa">
      <p className={styles.modalSubtitle}>
        Registra tus pausas para cumplir con la normativa operativa.
      </p>
      <div className={styles.modalList}>
        {tipos.map((t) => {
          const usada = pausasUsadas.includes(t.id)
          return (
            <button
              key={t.id}
              className={`${styles.tipoPausaBtn} ${usada ? styles.tipoPausaUsada : ''}`}
              onClick={() => !usada && onSelect(t.id)}
              disabled={loading || usada}
            >
              <span className={styles.tipoPausaIcon}><IconCoffee /></span>
              <div className={styles.tipoPausaInfo}>
                <span className={styles.tipoPausaLabel}>
                  {t.label} {usada ? '(ya usada)' : ''}
                </span>
                <span className={styles.tipoPausaMax}>Máx. {t.duracion_max_min} min</span>
              </div>
              {loading && <Spinner size="sm" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

function HistorialRow({ item }) {
  const isEntrada = item.tipo === 'entrada'
  return (
    <div className={styles.historialRow}>
      <span className={`${styles.historialIcon} ${isEntrada ? styles.iconEntrada : styles.iconPausa}`}>
        {isEntrada ? <IconBolt /> : <IconClock />}
      </span>
      <div className={styles.historialInfo}>
        <span className={styles.historialLabel}>{item.label}</span>
        {item.hora_fin
          ? <span className={styles.historialTime}>{item.hora_inicio} - {item.hora_fin}</span>
          : <span className={styles.historialTime}>{item.hora_inicio}</span>
        }
      </div>
      <span className={styles.historialDuracion}>
        {item.duracion_segundos != null
          ? formatDuracion(item.duracion_segundos)
          : item.tipo === 'entrada' ? 'Entrada' : ''}
      </span>
    </div>
  )
}

export default function PausasPage() {
  const toast = useToast()
  const [asistencia, setAsistencia] = useState(null)
  const [tiposPausa, setTiposPausa] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [showModal,  setShowModal]  = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  // segundos transcurridos desde que entró (para el countdown de jornada)
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState(0)
  // pausa activa: { id, label, duracionMaxSeg, segundosRestantes }
  const [pausaActiva, setPausaActiva] = useState(null)
  // IDs de pausas ya usadas esta jornada
  const [pausasUsadas, setPausasUsadas] = useState([])
  // historial local construido manualmente
  const [historial, setHistorial] = useState([])

  const enPausa = !!pausaActiva
  const jornadaIniciada = !!asistencia?.hora_entrada
  const jornadaFinalizada = !!asistencia?.hora_salida

  // Tick del tiempo transcurrido de jornada (cuenta hacia arriba internamente,
  // pero lo mostramos como JORNADA_TOTAL - transcurrido = tiempo restante)
  const tiempoTranscurridoRef = useRef(null)
  useEffect(() => {
    if (jornadaIniciada && !jornadaFinalizada && !enPausa) {
      tiempoTranscurridoRef.current = setInterval(() => {
        setTiempoTranscurrido((s) => s + 1)
      }, 1000)
    } else {
      clearInterval(tiempoTranscurridoRef.current)
    }
    return () => clearInterval(tiempoTranscurridoRef.current)
  }, [jornadaIniciada, jornadaFinalizada, enPausa])

  // Tick del countdown de pausa
  const pausaRef = useRef(null)
  useEffect(() => {
    if (enPausa) {
      pausaRef.current = setInterval(() => {
        setPausaActiva((prev) => {
          if (!prev) return prev
          const next = prev.segundosRestantes - 1
          return { ...prev, segundosRestantes: next < 0 ? 0 : next }
        })
      }, 1000)
    } else {
      clearInterval(pausaRef.current)
    }
    return () => clearInterval(pausaRef.current)
  }, [enPausa])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const [asist, tipos] = await Promise.all([
        getAsistenciaHoy(),
        getTiposPausa(),
      ])
      setAsistencia(asist)
      setTiposPausa(tipos)
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la asistencia.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleRegistrarEntrada = async () => {
    setActionLoading(true)
    try {
      const updated = await registrarEntrada()
      setAsistencia(updated)
      const horaLabel = new Date().toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })
      setHistorial([{ tipo: 'entrada', label: 'Inicio de Jornada', hora_inicio: horaLabel, hora_fin: null, duracion_segundos: null }])
      setTiempoTranscurrido(0)
      toast.success('¡Entrada registrada correctamente!')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo registrar la entrada.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleIniciarPausa = async (tipoPausaId) => {
    setActionLoading(true)
    try {
      const tipo = tiposPausa.find((t) => t.id === tipoPausaId)
      await iniciarPausa(tipoPausaId)
      const horaLabel = new Date().toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })
      setPausaActiva({
        id: tipoPausaId,
        label: tipo.label,
        duracionMaxSeg: tipo.duracion_max_min * 60,
        segundosRestantes: tipo.duracion_max_min * 60,
        horaInicio: horaLabel,
      })
      setPausasUsadas((prev) => [...prev, tipoPausaId])
      setShowModal(false)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo iniciar la pausa.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReanudar = async () => {
    setActionLoading(true)
    try {
      await finalizarPausa()
      const horaFin = new Date().toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })
      const duracionUsada = pausaActiva.duracionMaxSeg - pausaActiva.segundosRestantes
      setHistorial((prev) => [
        ...prev,
        {
          tipo: 'pausa',
          label: pausaActiva.label,
          hora_inicio: pausaActiva.horaInicio,
          hora_fin: horaFin,
          duracion_segundos: duracionUsada,
        },
      ])
      setPausaActiva(null)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo reanudar la jornada.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleFinalizarJornada = async () => {
    if (!window.confirm('¿Confirmas que deseas finalizar la jornada de hoy?')) return
    setActionLoading(true)
    try {
      await finalizarJornada()
      toast.success('¡Jornada finalizada! Tu estado se actualizó.')
      setAsistencia((prev) => ({ ...prev, hora_salida: new Date().toISOString() }))
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo finalizar la jornada.')
    } finally {
      setActionLoading(false)
    }
  }

  const getEstadoJornada = () => {
    if (!jornadaIniciada)    return { label: 'Inactivo',           color: '#94a3b8' }
    if (jornadaFinalizada)   return { label: 'Jornada finalizada', color: '#16a34a' }
    if (enPausa)             return { label: pausaActiva.label,    color: '#d97706' }
    return                          { label: 'Activo',             color: '#16a34a' }
  }

  const estadoPagina = (
    <PageState
      loading={loading}
      loadingLabel="Cargando asistencia..."
      error={!asistencia ? error : null}
      onRetry={fetchData}
      errorTitle="No se pudo cargar tu asistencia"
    />
  )
  if (estadoPagina) return estadoPagina

  const estadoJornada = getEstadoJornada()
  // Tiempo restante de jornada (8h - transcurrido)
  const segundosRestantesJornada = Math.max(0, JORNADA_TOTAL_SEGUNDOS - tiempoTranscurrido)
  const jornadaDisplay = formatCountdown(segundosRestantesJornada)

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.jornadaLabel}>
          Jornada de Hoy:{' '}
          {asistencia?.fecha
            ? new Date(asistencia.fecha + 'T12:00:00').toLocaleDateString('es-GT', {
                day: 'numeric', month: 'long', year: 'numeric'
              })
            : ''}
        </p>

        <span
          className={styles.estadoBadge}
          style={{
            background: estadoJornada.color + '20',
            color: estadoJornada.color,
            border: `1px solid ${estadoJornada.color}40`,
          }}
        >
          <span className={styles.estadoDot} style={{ background: estadoJornada.color }} />
          {estadoJornada.label}
        </span>

        {!jornadaIniciada ? (
          <div className={styles.entradaWrap}>
            <p className={styles.normativaText}>
              Registra tu entrada para iniciar la jornada laboral.
            </p>
            <button
              className={styles.entradaBtn}
              onClick={handleRegistrarEntrada}
              disabled={actionLoading}
            >
              {actionLoading ? <Spinner size="sm" color="white" /> : <IconLogin />}
              <span>Registrar Entrada</span>
            </button>
          </div>
        ) : (
          <>
            {/* Reloj principal: countdown jornada o countdown pausa */}
            <div className={`${styles.clockRing} ${enPausa ? styles.clockRingPaused : ''}`}>
              <span className={styles.clockIcon}><IconClock /></span>
              <span className={`${styles.clockTime} ${enPausa ? styles.clockTimePaused : ''}`}>
                {enPausa
                  ? formatCountdown(pausaActiva.segundosRestantes)
                  : jornadaDisplay}
              </span>
              <span className={styles.clockLabel}>
                {enPausa ? 'TIEMPO DE PAUSA' : 'TIEMPO RESTANTE'}
              </span>
            </div>

            <p className={styles.normativaText}>
              {enPausa
                ? `Pausa en curso: ${pausaActiva.label}`
                : 'Registra tus pausas obligatorias para cumplir con la normativa operativa.'}
            </p>

            {!jornadaFinalizada && (
              <button
                className={`${styles.pauseBtn} ${enPausa ? styles.pauseBtnActive : ''}`}
                onClick={enPausa ? handleReanudar : () => setShowModal(true)}
                disabled={actionLoading}
              >
                {actionLoading
                  ? <Spinner size="sm" color="white" />
                  : enPausa ? <IconPlay /> : <IconPause />}
                <span>{enPausa ? 'REANUDAR' : 'PAUSAR'}</span>
              </button>
            )}
          </>
        )}
      </section>

      <section className={styles.metrics}>
        <div className={styles.metricCard}>
          <span className={styles.metricIcon}><IconBolt /></span>
          <div>
            <p className={styles.metricLabel}>PRODUCTIVIDAD</p>
            <p className={styles.metricValue}>{asistencia?.productividad_pct ?? '-'}%</p>
          </div>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricIcon}><IconTimer /></span>
          <div>
            <p className={styles.metricLabel}>EN PAUSA</p>
            <p className={styles.metricValue}>
              {asistencia?.tiempo_en_pausa_segundos != null
                ? secsToHHMM(asistencia.tiempo_en_pausa_segundos)
                : '--:--:--'}
            </p>
          </div>
        </div>
      </section>

      <section className={styles.historial}>
        <div className={styles.historialHeader}>
          <span className={styles.historialTitle}>
            <IconHistory />
            Historial de hoy
          </span>
          <button className={styles.verTodoBtn}>Ver todo</button>
        </div>

        <div className={styles.historialList}>
          {historial.length > 0
            ? historial.map((item, i) => <HistorialRow key={i} item={item} />)
            : <p className={styles.historialVacio}>Sin registros por el momento.</p>
          }
        </div>
      </section>

      {/* El feedback de éxito/error ahora sale por el toast global
          (components/ui/Toast), igual que en el resto de la app. */}

      {jornadaIniciada && !jornadaFinalizada && (
        <div className={styles.finalizarWrap}>
          <button
            className={styles.finalizarBtn}
            onClick={handleFinalizarJornada}
            disabled={actionLoading || enPausa}
          >
            {actionLoading ? <Spinner size="sm" color="white" /> : <IconCheck />}
            <span>Guardar y Finalizar Jornada</span>
          </button>
          <p className={styles.finalizarNote}>
            Al finalizar, tu ubicación y estado se actualizarán en el panel de supervisión.
          </p>
        </div>
      )}

      {jornadaFinalizada && (
        <div className={styles.jornadaFinalizada}>
          <IconCheck />
          <span>Jornada finalizada</span>
        </div>
      )}

      <ModalPausa
        open={showModal}
        tipos={tiposPausa}
        pausasUsadas={pausasUsadas}
        onSelect={handleIniciarPausa}
        onClose={() => setShowModal(false)}
        loading={actionLoading}
      />
    </div>
  )
}