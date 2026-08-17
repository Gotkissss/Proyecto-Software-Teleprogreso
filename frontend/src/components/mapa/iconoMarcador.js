/**
 * components/mapa/iconoMarcador.js
 * ---------------------------------------------------------------------------
 * SCRUM-181 — Fábrica única de los pines (divIcon) del mapa.
 *
 * Antes cada componente de marcador traía su propio `crearIcono()` con el SVG
 * del pin copiado dentro y su propio bloque de CSS. Eran cuatro copias de la
 * misma forma con tamaños ligeramente distintos, y el color se calculaba en
 * cada archivo por su cuenta.
 *
 * Además, `crearIcono(servicio)` se llamaba en cada render de cada marcador,
 * así que un mapa con 200 tareas construía 200 objetos `L.divIcon` nuevos por
 * render y Leaflet rehacía el nodo DOM de todos los pines. Aquí los íconos se
 * memorizan por (color, tamaño, pulso): un mapa completo usa un puñado de
 * instancias y compartirlas entre marcadores es el patrón normal de Leaflet.
 *
 * Los colores salen todos de estadoColor.js, que es la fuente única que
 * comparten la leyenda y los badges:
 *   verde = completado · azul = en progreso · rojo = urgente · gris = cancelado
 * ---------------------------------------------------------------------------
 */
import L from 'leaflet'
import { colorPorEstado, colorPorTarea } from './estadoColor'
import styles from './iconoMarcador.module.css'

/**
 * Tamaños del pin. `sm` para mini-mapas embebidos, `md` para los mapas de
 * pantalla completa y `lg` para el marcador que el supervisor arrastra al
 * fijar una ubicación (necesita ser el elemento más visible del mapa).
 */
export const TAMANOS_PIN = {
  sm: { ancho: 30, alto: 38 },
  md: { ancho: 34, alto: 44 },
  lg: { ancho: 36, alto: 46 },
}

/** Cache de instancias: la clave es todo lo que afecta al ícono renderizado. */
const cacheIconos = new Map()

/** SVG del pin (gota con círculo blanco), coloreado vía `currentColor`. */
function svgPin(ancho, alto) {
  return `
    <svg viewBox="0 0 24 32" width="${ancho}" height="${alto}" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 20 12 20s12-11.5 12-20C24 5.4 18.6 0 12 0z" fill="currentColor"/>
      <circle cx="12" cy="12" r="4.5" fill="#fff"/>
    </svg>
  `
}

/**
 * Construye (o recupera del cache) el pin de un color y tamaño dados.
 *
 * @param {Object}  opciones
 * @param {string}  opciones.color   - Color CSS, normalmente una var() del tema.
 * @param {'sm'|'md'|'lg'} [opciones.tamano]
 * @param {boolean} [opciones.pulso] - Anillo pulsante (tareas en progreso).
 * @returns {L.DivIcon}
 */
export function crearIconoPin({ color, tamano = 'md', pulso = false }) {
  const clave = `${color}|${tamano}|${pulso}`
  const enCache = cacheIconos.get(clave)
  if (enCache) return enCache

  const { ancho, alto } = TAMANOS_PIN[tamano] ?? TAMANOS_PIN.md

  const icono = L.divIcon({
    html: `
      <div class="${styles.pinWrap} ${pulso ? styles.pinPulse : ''}" style="color:${color}">
        ${svgPin(ancho, alto)}
      </div>
    `,
    className: styles.icon,
    iconSize: [ancho, alto],
    // La punta de la gota es la que marca el lugar exacto, no el centro.
    iconAnchor: [ancho / 2, alto],
    popupAnchor: [0, -(alto - 6)],
  })

  cacheIconos.set(clave, icono)
  return icono
}

/**
 * Pin de la vista del TÉCNICO: color por prioridad mientras la tarea sigue
 * abierta, por estado cuando ya está cerrada. Pulsa si está en progreso.
 */
export function iconoPorTarea(servicio, tamano = 'md') {
  const estado = servicio?.estado ?? servicio?.estado_tarea

  return crearIconoPin({
    color: colorPorTarea(servicio),
    tamano,
    pulso: estado === 'en_progreso',
  })
}

/**
 * Pin de la vista del SUPERVISOR (y del mini-mapa): color por estado, que es
 * lo que coincide con la leyenda del mapa de equipo.
 */
export function iconoPorEstado(estado, tamano = 'md', { pulso } = {}) {
  return crearIconoPin({
    color: colorPorEstado(estado),
    tamano,
    pulso: pulso ?? estado === 'en_progreso',
  })
}

/** Pin del selector de ubicación: color de marca, sin depender de una tarea. */
export function iconoSeleccion(tamano = 'lg') {
  return crearIconoPin({ color: 'var(--color-primary)', tamano })
}
