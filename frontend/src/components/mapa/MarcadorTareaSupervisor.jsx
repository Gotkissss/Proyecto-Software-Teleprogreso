/**
 * HU-165 — Marcador de una tarea sobre <MapaBase> para la vista "Mapa" del
 * supervisor.
 *
 * A diferencia de MarcadorTarea (vista del técnico, que colorea por
 * prioridad mientras la tarea sigue abierta), aquí el color es siempre por
 * ESTADO: el supervisor necesita ver de un vistazo qué tareas están
 * pendientes/en curso/completadas/canceladas en todo el equipo, no priorizar
 * una sola ruta. El color coincide con el de LeyendaMapaSupervisor (misma
 * fuente: estadoColor.js).
 *
 * Uso como hijo de <MapaBase>, normalmente agrupado dentro de un
 * <LayerGroup> por técnico (ver MapaSupervisorPage):
 *   <LayerGroup>
 *     {serviciosDelTecnico.map((s) => (
 *       <MarcadorTareaSupervisor key={s.id_servicio} servicio={s} />
 *     ))}
 *   </LayerGroup>
 *
 * `servicio` sigue la forma que arma MapaSupervisorPage a partir de
 * getTareas() (api/tareaService):
 *   { id_servicio, estado, prioridad, nombre, direccion, tipo, lat, lng,
 *     tecnico: { id_empleado, nombre } | null }
 */
import { Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import Badge from '../ui/Badge'
import {
  colorPorEstado,
  ESTADO_LABEL,
  PRIORIDAD_LABEL,
  variantePorEstado,
  variantePorPrioridad,
} from './estadoColor'
import styles from './MarcadorTareaSupervisor.module.css'

/** Ícono en forma de pin (SVG), coloreado según el estado de la tarea. */
function crearIcono(servicio) {
  const color = colorPorEstado(servicio.estado)
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

export default function MarcadorTareaSupervisor({ servicio }) {
  if (servicio?.lat == null || servicio?.lng == null) return null

  return (
    <Marker position={[servicio.lat, servicio.lng]} icon={crearIcono(servicio)}>
      <Popup>
        <div className={styles.popup}>
          <p className={styles.popupTitulo}>{servicio.nombre}</p>

          {/* HU-165: en la vista del supervisor, cada popup debe identificar
              a qué técnico pertenece la tarea (no aplica en MarcadorTarea,
              la vista del técnico, donde ya se sabe que es "su" tarea). */}
          <p className={styles.popupTecnico}>
            {servicio.tecnico?.nombre ?? 'Sin técnico asignado'}
          </p>

          <div className={styles.popupBadges}>
            <Badge
              label={ESTADO_LABEL[servicio.estado] ?? servicio.estado}
              variant={variantePorEstado(servicio.estado)}
            />
            <Badge
              label={PRIORIDAD_LABEL[servicio.prioridad] ?? servicio.prioridad}
              variant={variantePorPrioridad(servicio.prioridad)}
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