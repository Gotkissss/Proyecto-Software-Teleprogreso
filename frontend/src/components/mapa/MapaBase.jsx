cat > src/components/mapa/MapaBase.jsx << 'EOF'
/**
 * components/mapa/MapaBase.jsx
 * Componente base reutilizable para renderizar un mapa con Leaflet +
 * react-leaflet, usando tiles de OpenStreetMap (sin costo, sin API key).
 *
 * Es intencionalmente "tonto": solo monta el mapa (contenedor + capa de
 * tiles) y expone `children`, para que otras pantallas (ruta del técnico,
 * ubicación en vivo, geocercas, etc.) agreguen sus propios <Marker>,
 * <Polyline>, <Circle>, etc. de react-leaflet sin duplicar esta config.
 *
 * Uso básico:
 *   <MapaBase />
 *
 * Con centro/zoom personalizados:
 *   <MapaBase center={[14.6349, -90.5069]} zoom={14} />
 *
 * Con marcadores u otros elementos de Leaflet como hijos:
 *   <MapaBase center={[14.6349, -90.5069]} zoom={14}>
 *     <Marker position={[14.6349, -90.5069]}>
 *       <Popup>Oficina central</Popup>
 *     </Marker>
 *   </MapaBase>
 */
import { MapContainer, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import styles from './MapaBase.module.css'

// Fix conocido de Leaflet + bundlers (Vite/Webpack): el ícono por defecto
// de los <Marker> se resuelve con rutas relativas que el bundler rompe,
// dejando los marcadores sin ícono visible. Se reconfigura una sola vez,
// al importar este módulo, apuntando a los assets ya procesados por Vite.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

/** Centro por defecto: Ciudad de Guatemala (sede de Teleprogreso). */
const CENTRO_DEFAULT = [14.6349, -90.5069]
const ZOOM_DEFAULT = 13

/**
 * @param {Object} props
 * @param {[number, number]} [props.center] - Coordenadas [lat, lng] iniciales.
 * @param {number} [props.zoom] - Nivel de zoom inicial.
 * @param {number} [props.minZoom] - Zoom mínimo permitido.
 * @param {number} [props.maxZoom] - Zoom máximo permitido.
 * @param {boolean} [props.scrollWheelZoom] - Permitir zoom con la rueda del mouse.
 * @param {string} [props.className] - Clases adicionales para el contenedor externo.
 * @param {React.Ref} [props.mapRef] - Ref opcional hacia la instancia del mapa de Leaflet.
 * @param {React.ReactNode} [props.children] - Marcadores/capas de react-leaflet a superponer.
 */
export default function MapaBase({
  center = CENTRO_DEFAULT,
  zoom = ZOOM_DEFAULT,
  minZoom = 3,
  maxZoom = 19,
  scrollWheelZoom = true,
  className = '',
  mapRef,
  children,
  ...rest
}) {
  return (
    <div className={`${styles.wrap} ${className}`.trim()}>
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        scrollWheelZoom={scrollWheelZoom}
        className={styles.map}
        ref={mapRef}
        {...rest}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {children}
      </MapContainer>
    </div>
  )
}
EOF