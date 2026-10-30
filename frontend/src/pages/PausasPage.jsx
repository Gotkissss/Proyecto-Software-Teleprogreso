/**
 * pages/PausasPage.jsx
 * ---------------------------------------------------------------------------
 * Pantalla de jornada y pausas del técnico.
 *
 * Regla de oro de esta pantalla: **no inventa tiempo**. Todo el estado
 * (jornada abierta, pausa en curso, segundos ya consumidos, historial, pausas
 * ya usadas) se reconstruye desde `GET /descanso/hoy` en cada montaje.
 *
 * Antes los cronómetros arrancaban en 0 en cada montaje y el historial vivía
 * en un useState, así que salir de la pantalla —o cerrar sesión— reiniciaba
 * todo aunque en la base de datos la pausa siguiera abierta. Ahora el contador
 * del navegador solo sirve para animar: el valor base y el ancla temporal
 * vienen del servidor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useState, useEffect, useRef } from 'react'
import {
  registrarEntrada,
  iniciarPausa,
  finalizarPausa,
  finalizarJornada,
  getTiposPausa,
  getEstadoPausas,
} from '../api/asistenciaService'
import Modal, { ModalActions } from '../components/ui/Modal'
import Spinner from '../components/ui/Spinner'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import { useUbicacion } from '../context/UbicacionContext'
import { obtenerPosicionActual } from '../utils/posicionActual'
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

const secsToHHMMSS = (total) => {
  const s = Math.max(0, Math.floor(total))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
}

const formatCountdown = (seconds) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return secsToHHMMSS(s)
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
}

const formatDuracion = (seconds) => {
  if (!seconds) return ''
  return formatCountdown(seconds)
}

/** "14:32:05" → "14:32" para las etiquetas del historial. */
const horaCorta = (hora) => (hora ? hora.slice(0, 5) : '')

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

/** HU-4: aviso cuando la marca se registró, pero sin el lugar. */
const AVISO_SIN_UBICACION =
  'No se pudo obtener tu ubicación: la marca quedó registrada sin ella. ' +
  'Activa el GPS y el permiso de ubicación para las próximas.'

/**
 * RTF-01 / R3-4 — motivos frecuentes de una marca sin GPS.
 *
 * Se ofrecen como botones porque el técnico está en la calle, con una mano
 * ocupada: pedirle que escriba una frase es pedirle que no la escriba. El
 * campo libre queda para lo que no esté en la lista.
 */
const MOTIVOS_SIN_UBICACION = [
  'El GPS está denegado en el teléfono',
  'No hay señal en este punto',
  'Estoy en un sótano o un sitio cerrado',
]

/** Lo que dice el botón de marcar según en qué paso va (RTF-01 / R3-5). */
const PASO_MARCA = {
  ubicacion: 'Obteniendo ubicación…',
  enviando: 'Registrando…',
}

export default function PausasPage() {
  const toast = useToast()
  // HU-4: última posición conocida, como respaldo si la lectura nueva del GPS
  // no llega a tiempo al marcar entrada o salida.
  const { posicion, refrescarJornada } = useUbicacion()

  // Estado tal como lo reporta el backend. Es la única fuente de verdad.
  const [estado,     setEstado]     = useState(null)
  const [tiposPausa, setTiposPausa] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [showModal,  setShowModal]  = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  // RTF-01 / R3-9: el cierre de jornada usaba `window.confirm()`, que no se
  // parece a ningún otro diálogo del sistema y además bloquea la
  // automatización de pruebas. Se confirma con el modal propio.
  const [confirmarCierre, setConfirmarCierre] = useState(false)

  // RTF-01 / R3-5: la lectura del GPS tarda hasta 8 segundos y el botón solo
  // mostraba un spinner, así que el técnico no sabía si se había colgado.
  // `paso` dice en voz alta qué se está haciendo.
  const [paso, setPaso] = useState(null)
  // RTF-01 / R3-4: cuando no hay ubicación se le pregunta por qué, en vez de
  // dejar la marca como un hueco que el supervisor no puede contrastar.
  const [motivoPendiente, setMotivoPendiente] = useState(null)
  const [motivoTexto, setMotivoTexto] = useState('')

  // Segundos añadidos por el tick local desde la última respuesta del servidor.
  // Solo anima el reloj: el valor de partida siempre viene del backend, así
  // que salir y volver a entrar no reinicia nada.
  const [tickLocal, setTickLocal] = useState(0)

  const jornadaIniciada   = Boolean(estado?.hora_entrada)
  const jornadaFinalizada = Boolean(estado?.hora_salida)
  const pausaActiva       = estado?.pausa_activa ?? null
  const enPausa           = Boolean(pausaActiva)

  const fetchData = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true)
    try {
      setError(null)
      const [estadoPausas, tipos] = await Promise.all([
        getEstadoPausas(),
        getTiposPausa(),
      ])
      setEstado(estadoPausas)
      setTiposPausa(tipos)
      setTickLocal(0)
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la asistencia.')
    } finally {
      if (!silencioso) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Tick de 1 s mientras la jornada esté abierta. Solo incrementa el offset
  // local; los totales reales siguen siendo los del servidor + este offset.
  const tickRef = useRef(null)
  useEffect(() => {
    if (jornadaIniciada && !jornadaFinalizada) {
      tickRef.current = setInterval(() => setTickLocal((s) => s + 1), 1000)
    } else {
      clearInterval(tickRef.current)
    }
    return () => clearInterval(tickRef.current)
  }, [jornadaIniciada, jornadaFinalizada])

  // Al volver a la pestaña, se resincroniza con el servidor: si el móvil
  // suspendió la app, el setInterval se congela y el reloj se queda corto.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchData({ silencioso: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [fetchData])

  /**
   * Manda la marca al backend y refresca la pantalla.
   *
   * Es el tramo común de la entrada y la salida: lo que cambia entre las dos
   * es el endpoint y los textos, no el procedimiento.
   */
  const enviarMarca = async (accion, lugar, motivo = null) => {
    const esEntrada = accion === 'entrada'
    setPaso('enviando')
    try {
      const respuesta = esEntrada
        ? await registrarEntrada(lugar, motivo)
        : await finalizarJornada(lugar, motivo)
      await fetchData({ silencioso: true })
      // HU-5: la ruta y el envío de ubicación dependen de la jornada; se les
      // avisa ya en vez de esperar el siguiente ciclo del contexto.
      refrescarJornada?.()
      toast.success(
        esEntrada
          ? '¡Entrada registrada correctamente!'
          : '¡Jornada finalizada! Tu estado se actualizó.'
      )
      if (!respuesta?.ubicacion_registrada) {
        // Con motivo ya no hace falta regañar: el técnico acaba de explicarlo
        // y el supervisor lo verá en el historial.
        toast.info(
          motivo
            ? 'La marca quedó sin ubicación, con tu explicación anotada.'
            : AVISO_SIN_UBICACION
        )
      }
      setConfirmarCierre(false)
      return true
    } catch (err) {
      // RTF-01 / R3-2: el backend responde 409 con los títulos de las tareas
      // que siguen en curso. Ese mensaje es el que hay que mostrar —dice qué
      // falta—, y el modal se queda abierto para que se lea.
      toast.error(
        err?.response?.data?.detail ||
          (esEntrada
            ? 'No se pudo registrar la entrada.'
            : 'No se pudo finalizar la jornada.')
      )
      return false
    }
  }

  /**
   * Pide el GPS y marca. Si no hay ubicación, abre el modal del motivo en vez
   * de marcar a ciegas (RTF-01 / R3-4).
   */
  const marcar = async (accion) => {
    setActionLoading(true)
    setPaso('ubicacion')
    try {
      // HU-4: la marca nunca se bloquea por el GPS. Si no hay lectura llega
      // null, y entonces se pregunta por qué.
      const lugar = await obtenerPosicionActual({ respaldo: posicion })
      if (!lugar) {
        setMotivoTexto('')
        setMotivoPendiente(accion)
        return
      }
      await enviarMarca(accion, lugar)
    } finally {
      setPaso(null)
      setActionLoading(false)
    }
  }

  /** Confirma el modal del motivo y manda la marca sin ubicación. */
  const confirmarSinUbicacion = async (motivo) => {
    const accion = motivoPendiente
    if (!accion) return
    setActionLoading(true)
    try {
      const listo = await enviarMarca(accion, null, motivo)
      if (listo) {
        setMotivoPendiente(null)
        setMotivoTexto('')
      }
    } finally {
      setPaso(null)
      setActionLoading(false)
    }
  }

  const handleRegistrarEntrada = () => marcar('entrada')

  const handleIniciarPausa = async (tipoPausaId) => {
    setActionLoading(true)
    try {
      await iniciarPausa(tipoPausaId)
      setShowModal(false)
      // Se recarga en vez de construir el estado a mano: la hora de inicio
      // que vale es la que quedó guardada en la base de datos.
      await fetchData({ silencioso: true })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo iniciar la pausa.')
      await fetchData({ silencioso: true })
    } finally {
      setActionLoading(false)
    }
  }

  const handleReanudar = async () => {
    setActionLoading(true)
    try {
      await finalizarPausa()
      await fetchData({ silencioso: true })
      toast.success('Jornada reanudada.')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo reanudar la jornada.')
      await fetchData({ silencioso: true })
    } finally {
      setActionLoading(false)
    }
  }

  const handleFinalizarJornada = () => marcar('salida')

  if (loading || (error && !estado)) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando asistencia..."
        error={!estado ? error : null}
        onRetry={fetchData}
        errorTitle="No se pudo cargar tu asistencia"
      />
    )
  }

  /* ── Valores derivados: base del servidor + tick local ────────────────── */

  // El tick solo avanza si la jornada sigue abierta.
  const offset = jornadaFinalizada ? 0 : tickLocal

  const segundosDesdeEntrada = (estado?.segundos_brutos ?? 0) + offset
  const segundosEnPausaTotal = (estado?.segundos_en_pausa ?? 0) + (enPausa ? offset : 0)
  const segundosTrabajados   = Math.max(0, segundosDesdeEntrada - segundosEnPausaTotal)
  const segundosRestantesJornada = Math.max(0, JORNADA_TOTAL_SEGUNDOS - segundosTrabajados)

  const pausaTranscurrida = enPausa ? (pausaActiva.duracion_segundos ?? 0) + offset : 0
  const pausaRestante = enPausa
    ? Math.max(0, (pausaActiva.duracion_max_seg ?? 0) - pausaTranscurrida)
    : 0
  const pausaExcedida = enPausa && pausaTranscurrida > (pausaActiva.duracion_max_seg ?? 0)

  const pausasUsadas = estado?.tipos_usados ?? []

  // Historial: la entrada del día más cada pausa registrada en la BD.
  const historial = []
  if (estado?.hora_entrada) {
    historial.push({
      tipo: 'entrada',
      label: 'Inicio de Jornada',
      hora_inicio: horaCorta(estado.hora_entrada),
      hora_fin: null,
      duracion_segundos: null,
    })
  }
  for (const d of estado?.descansos ?? []) {
    historial.push({
      tipo: 'pausa',
      label: d.en_curso ? `${d.label} (en curso)` : d.label,
      hora_inicio: horaCorta(d.hora_inicio),
      hora_fin: horaCorta(d.hora_fin),
      duracion_segundos: d.en_curso ? pausaTranscurrida : d.duracion_segundos,
    })
  }

  const estadoJornada = !jornadaIniciada
    ? { label: 'Inactivo',           color: '#94a3b8' }
    : jornadaFinalizada
    ? { label: 'Jornada finalizada', color: '#16a34a' }
    : enPausa
    ? { label: pausaActiva.label,    color: pausaExcedida ? '#dc2626' : '#d97706' }
    : { label: 'Activo',             color: '#16a34a' }

  // Productividad = tiempo efectivo sobre el tiempo total de presencia.
  const productividadPct = segundosDesdeEntrada > 0
    ? Math.round((segundosTrabajados / segundosDesdeEntrada) * 100)
    : 0

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.jornadaLabel}>
          Jornada de Hoy:{' '}
          {estado?.fecha
            ? new Date(estado.fecha + 'T12:00:00').toLocaleDateString('es-GT', {
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

        {/* Sin jornada abierta se ofrece el botón de entrada. Ojo con el caso
            de la jornada YA finalizada: antes esta rama solo miraba
            `jornadaIniciada`, así que al cerrar la jornada el botón
            desaparecía para siempre y la pantalla se quedaba con un reloj
            congelado y ninguna acción posible. */}
        {!jornadaIniciada || jornadaFinalizada ? (
          <div className={styles.entradaWrap}>
            <p className={styles.normativaText}>
              {jornadaFinalizada
                ? 'Tu jornada de hoy ya está cerrada. Si vuelves a trabajar, registra una nueva entrada.'
                : 'Registra tu entrada para iniciar la jornada laboral.'}
            </p>
            <button
              className={styles.entradaBtn}
              onClick={handleRegistrarEntrada}
              disabled={actionLoading}
            >
              {actionLoading ? <Spinner size="sm" color="white" /> : <IconLogin />}
              <span>
                {/* RTF-01 / R3-5: el GPS tarda hasta 8 segundos; con solo el
                    spinner el técnico no sabía si la app se había colgado. */}
                {PASO_MARCA[paso] ??
                  (jornadaFinalizada ? 'Registrar nueva entrada' : 'Registrar Entrada')}
              </span>
            </button>
          </div>
        ) : (
          <>
            {/* Reloj principal: countdown de jornada o de la pausa en curso */}
            <div className={`${styles.clockRing} ${enPausa ? styles.clockRingPaused : ''}`}>
              <span className={styles.clockIcon}><IconClock /></span>
              <span className={`${styles.clockTime} ${enPausa ? styles.clockTimePaused : ''}`}>
                {enPausa
                  ? formatCountdown(pausaRestante)
                  : formatCountdown(segundosRestantesJornada)}
              </span>
              <span className={styles.clockLabel}>
                {enPausa
                  ? (pausaExcedida ? 'PAUSA EXCEDIDA' : 'TIEMPO DE PAUSA')
                  : 'TIEMPO RESTANTE'}
              </span>
            </div>

            <p className={styles.normativaText}>
              {enPausa
                ? `Pausa en curso: ${pausaActiva.label} · desde las ${horaCorta(pausaActiva.hora_inicio)}`
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
            <p className={styles.metricValue}>
              {jornadaIniciada ? `${productividadPct}%` : '-'}
            </p>
          </div>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricIcon}><IconTimer /></span>
          <div>
            <p className={styles.metricLabel}>EN PAUSA</p>
            <p className={styles.metricValue}>
              {jornadaIniciada ? secsToHHMMSS(segundosEnPausaTotal) : '--:--:--'}
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
          <button className={styles.verTodoBtn} onClick={() => fetchData()}>
            Actualizar
          </button>
        </div>

        <div className={styles.historialList}>
          {historial.length > 0
            ? historial.map((item, i) => <HistorialRow key={i} item={item} />)
            : <p className={styles.historialVacio}>Sin registros por el momento.</p>
          }
        </div>
      </section>

      {jornadaIniciada && !jornadaFinalizada && (
        <div className={styles.finalizarWrap}>
          <button
            className={styles.finalizarBtn}
            onClick={() => setConfirmarCierre(true)}
            disabled={actionLoading || enPausa}
          >
            {actionLoading ? <Spinner size="sm" color="white" /> : <IconCheck />}
            <span>Guardar y Finalizar Jornada</span>
          </button>
          <p className={styles.finalizarNote}>
            {enPausa
              ? 'Reanuda tu jornada antes de finalizarla.'
              : 'Al finalizar, tu ubicación y estado se actualizarán en el panel de supervisión.'}
          </p>
        </div>
      )}

      {jornadaFinalizada && (
        <div className={styles.jornadaFinalizada}>
          <IconCheck />
          <span>Jornada finalizada · {secsToHHMMSS(segundosTrabajados)} trabajadas</span>
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

      {/* RTF-01 / R3-9: el confirm nativo del navegador, con el modal propio.
          RTF-01 / R3-2: el texto avisa de la regla ANTES de intentarlo. Si
          quedan tareas en curso el backend responde 409 y el toast dice
          cuáles; esto evita el viaje para quien ya lo sabe. */}
      <Modal
        open={confirmarCierre}
        onClose={actionLoading ? undefined : () => setConfirmarCierre(false)}
        title="Finalizar jornada"
      >
        <p className={styles.modalSubtitle}>
          Se registrará tu salida y tu ubicación. No podrás volver a trabajar
          en tus tareas hasta la próxima entrada.
        </p>
        <p className={styles.modalSubtitle}>
          Si te queda alguna tarea <strong>en curso</strong>, finalízala o
          pásala a pendiente antes de cerrar.
        </p>
        <ModalActions>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setConfirmarCierre(false)}
            disabled={actionLoading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleFinalizarJornada}
            disabled={actionLoading}
          >
            {actionLoading
              ? <><Spinner size="sm" color="white" /> {PASO_MARCA[paso] ?? 'Finalizando…'}</>
              : 'Finalizar jornada'}
          </button>
        </ModalActions>
      </Modal>

      {/* RTF-01 / R3-4: sin GPS la marca se registra igual —bloquearla deja al
          técnico sin poder trabajar—, pero antes quedaba como «Ubicación no
          disponible» y nada más, y el supervisor no podía distinguir «el GPS
          no enganchó» de «marqué desde mi casa». Ahora se le pregunta. */}
      <Modal
        open={Boolean(motivoPendiente)}
        onClose={actionLoading ? undefined : () => setMotivoPendiente(null)}
        title="No se pudo obtener tu ubicación"
      >
        <p className={styles.modalSubtitle}>
          Tu {motivoPendiente === 'salida' ? 'salida' : 'entrada'} se va a
          registrar sin el lugar. Dinos por qué para que tu supervisor lo vea
          junto a la marca.
        </p>
        <div className={styles.motivosLista}>
          {MOTIVOS_SIN_UBICACION.map((motivo) => (
            <button
              key={motivo}
              type="button"
              className={`${styles.motivoBtn} ${
                motivoTexto === motivo ? styles.motivoBtnActivo : ''
              }`}
              onClick={() => setMotivoTexto(motivo)}
              disabled={actionLoading}
            >
              {motivo}
            </button>
          ))}
        </div>
        <label className={styles.motivoLabel} htmlFor="motivo-sin-ubicacion">
          O escríbelo con tus palabras
        </label>
        <textarea
          id="motivo-sin-ubicacion"
          className={styles.motivoTexto}
          rows={2}
          maxLength={200}
          value={motivoTexto}
          onChange={(e) => setMotivoTexto(e.target.value)}
          disabled={actionLoading}
        />
        <ModalActions>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => confirmarSinUbicacion(null)}
            disabled={actionLoading}
          >
            {/* Se puede seguir sin explicar: obligar a escribir algo solo
                produce motivos inventados, y la marca no debe bloquearse. */}
            Marcar sin explicar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => confirmarSinUbicacion(motivoTexto)}
            disabled={actionLoading || !motivoTexto.trim()}
          >
            {actionLoading
              ? <><Spinner size="sm" color="white" /> Registrando…</>
              : 'Registrar con esta explicación'}
          </button>
        </ModalActions>
      </Modal>
    </div>
  )
}
