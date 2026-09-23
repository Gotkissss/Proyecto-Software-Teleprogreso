
import { useUbicacion } from '../../../context/UbicacionContext'
import styles from './IndicadorUbicacion.module.css'

const IconUbicacion = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const IconAviso = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  </svg>
)

export default function IndicadorUbicacion() {
  const { jornadaActiva, estado, errorEnvio } = useUbicacion()

  // Fuera de jornada el hook ni siquiera reporta al backend (ver
  // useGeolocalizacionTecnico.js), así que no hay nada que anunciar aquí.
  if (!jornadaActiva) return null

  let variante = 'ok'
  let texto = 'Compartiendo ubicación'
  let titulo = 'Tu ubicación se está reportando mientras tienes la jornada abierta.'

  if (estado === 'cargando') {
    variante = 'pendiente'
    texto = 'Obteniendo ubicación…'
    titulo = 'Esperando la primera lectura de GPS para empezar a compartir tu ubicación.'
  } else if (estado === 'denegado' || estado === 'no_soportado' || estado === 'error') {
    variante = 'alerta'
    texto = 'Ubicación no disponible'
    titulo = 'Tu supervisor no puede verte en el mapa: no se está compartiendo tu ubicación.'
  } else if (errorEnvio) {
    // Hay lectura de GPS válida, pero el último envío al backend falló
    // (red o servidor). El hook reintenta solo en la siguiente lectura.
    variante = 'alerta'
    texto = 'Ubicación sin enviar'
    titulo = errorEnvio
  }

  return (
    <span
      className={`${styles.indicador} ${styles[variante]}`}
      role="status"
      title={titulo}
    >
      <span className={styles.icono}>
        {variante === 'alerta' ? <IconAviso /> : <IconUbicacion />}
      </span>
      {variante === 'ok' && <span className={styles.pulso} aria-hidden="true" />}
      <span className={styles.texto}>{texto}</span>
    </span>
  )
}