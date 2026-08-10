/**
 * components/mapa/MarcadorTarea.jsx
 * SCRUM-162 — Marcador de una tarea sobre <MapaBase>: pin coloreado según
 * prioridad/estado, con popup mostrando dirección, tipo y prioridad.
 *
 * Uso como hijo de <MapaBase>:
 *   <MapaBase center={...}>
 *     {servicios.map((s) => (
 *       <MarcadorTarea key={s.id_servicio} servicio={s} />
 *     ))}
 *   </MapaBase>
 *
 * `servicio` sigue la misma forma que ya usa RutaDiariaPage (rutaService):
 * { id_servicio, estado, prioridad, nombre, direccion, tipo, lat, lng }
 */
import { Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import Badge from '../ui/Badge'
import styles from './MarcadorTarea.module.css'

const ESTADO_LABEL = {
  completado:  'Completado',
  en_progreso: 'En Curso',
  pendiente:   'Pendiente',
  cancelado:   'Cancelado',
}

const PRIORIDAD_LABEL = {
  urgente: 'Urgente',
  alta:    'Alta',
  media:   'Media',
  baja:    'Baja',
}

/**
 * Color del pin. El estado manda cuando la tarea ya no está abierta
 * (completada/cancelada); si sigue abierta (pendiente/en_progreso), el
 * color viene de la prioridad — así el técnico ve de un vistazo qué
 * parada urge más, no solo si ya empezó o no.
 * Usa las mismas variables de color que Badge.jsx en el resto de la app.
 */
function colorPorTarea(servicio) {
  if (servicio.estado === 'completado')  return 'var(--color-success)'
  if (servicio.estado === 'cancelado')   return 'var(--color-text-muted)'
  if (servicio.estado === 'en_progreso') return 'var(--color-primary)'

  switch (servicio.prioridad) {
    case 'urgente': return 'var(--color-danger)'
    case 'alta':    return 'var(--color-warning)'
    case 'baja':    return 'var(--color-text-muted)'
    default:        return 'var(--color-info)' // media
  }
}

/** Ícono en forma de pin (SVG) coloreado dinámicamente vía CSS var. */
function crearIcono(servicio) {
  const color = colorPorTarea(servicio)
  const enCurso = servicio.estado === 'en_progreso'

  const html = `
    <div class="${styles.pinWrap} ${enCurso ? styles.pinPulse : ''}" style="color:${color}">
      <svg viewBox="0 0 24 32" width="34" height="44" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 20 12 20s12-11.5 12-20C24 5.4 18.6 0 12 0z" fill="currentColor"/>
        <circle cx="12" cy="12" r="4.5" fill="#fff"/>
      </svg>
    </div>
  `

  return L.divIcon({
    html,
    className: styles.icon,
    iconSize: [34, 44],
    iconAnchor: [17, 44],
    popupAnchor: [0, -38],
  })
}

export default function MarcadorTarea({ servicio }) {
  if (servicio?.lat == null || servicio?.lng == null) return null

  return (
    <Marker position={[servicio.lat, servicio.lng]} icon={crearIcono(servicio)}>
      <Popup>
        <div className={styles.popup}>
          <p className={styles.popupTitulo}>{servicio.nombre}</p>

          <div className={styles.popupBadges}>
            <Badge
              label={ESTADO_LABEL[servicio.estado] ?? servicio.estado}
              variant={servicio.estado}
            />
            <Badge
              label={PRIORIDAD_LABEL[servicio.prioridad] ?? servicio.prioridad}
              variant={servicio.prioridad}
            />
          </div>

          <p className={styles.popupRow}>
            <strong>Dirección:</strong> {servicio.direccion}
          </p>
          <p className={styles.popupRow}>
            <strong>Tipo:</strong> {servicio.tipo}
          </p>
        </div>
      </Popup>
    </Marker>
  )
}
