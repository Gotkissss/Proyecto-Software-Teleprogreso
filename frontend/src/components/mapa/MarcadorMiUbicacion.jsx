/**
 * components/mapa/MarcadorMiUbicacion.jsx
 * SCRUM-163 — Marcador de la ubicación en vivo del técnico (posición del
 * dispositivo obtenida vía Geolocation API), visualmente distinto a los
 * pines de tareas de MarcadorTarea: un punto azul con halo de precisión,
 * al estilo "estás aquí" de Google Maps.
 *
 * Uso como hijo de <MapaBase>, junto a los marcadores de tareas:
 *   <MapaBase>
 *     <MarcadorMiUbicacion posicion={{ lat, lng, accuracy }} />
 *     {marcadoresDeTareas}
 *   </MapaBase>
 *
 * Si `posicion` todavía no existe (permiso pendiente, denegado, sin
 * soporte, etc.) no renderiza nada: la pantalla que lo usa es responsable
 * de avisarle al técnico por qué no aparece (ver MapaPage).
 */
import { Marker, Popup, Circle } from 'react-leaflet'
import L from 'leaflet'
import styles from './MarcadorMiUbicacion.module.css'

function crearIcono() {
  const html = `
    <div class="${styles.dot}">
      <span class="${styles.dotPulse}"></span>
    </div>
  `
  return L.divIcon({
    html,
    className: styles.icon,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  })
}

export default function MarcadorMiUbicacion({ posicion }) {
  if (posicion?.lat == null || posicion?.lng == null) return null

  const { lat, lng, accuracy } = posicion

  return (
    <>
      {/* Halo de precisión del GPS/red: le da al técnico una idea de qué
          tan exacto es el punto (varios metros en interiores/edificios). */}
      {accuracy != null && (
        <Circle
          center={[lat, lng]}
          radius={accuracy}
          pathOptions={{
            color: 'var(--color-primary)',
            fillColor: 'var(--color-primary)',
            fillOpacity: 0.12,
            weight: 1,
          }}
        />
      )}
      <Marker position={[lat, lng]} icon={crearIcono()} zIndexOffset={1000}>
        <Popup>Tu ubicación actual</Popup>
      </Marker>
    </>
  )
}