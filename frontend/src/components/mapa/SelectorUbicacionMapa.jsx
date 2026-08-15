/**
 * components/mapa/SelectorUbicacionMapa.jsx
 * ---------------------------------------------------------------------------
 * Selector de ubicación para NuevaTareaPage: clic en el mapa (o arrastrar el
 * marcador) fija el punto y rellena el campo de dirección automáticamente;
 * escribir en el campo de dirección mueve el marcador. Ambas vías usan
 * Nominatim, el mismo proveedor sin costo que ya usa MapaBase para los tiles.
 *
 * Es un componente controlado: el padre es dueño de `direccion`, `lat`, `lng`
 * y decide qué hacer con `onCambiarUbicacion`. Para no entrar en loop
 * (mapa → dirección → mapa → ...), recuerda en una ref la última dirección y
 * la última coordenada que ÉL MISMO generó, y evita re-geocodificar su
 * propio resultado cuando el padre se lo devuelve por props.
 *
 * Uso:
 *   <SelectorUbicacionMapa
 *     direccion={form.direccion}
 *     lat={form.lat}
 *     lng={form.lng}
 *     onCambiarUbicacion={({ lat, lng, direccion }) => ...}
 *   />
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import MapaBase from './MapaBase'
import CentrarMarcadorSeleccionado from './CentrarMarcadorSeleccionado'
import Spinner from '../ui/Spinner'
import { buscarCoordenadas, buscarDireccion, debounce } from '../../utils/geocodificacion'
import styles from './SelectorUbicacionMapa.module.css'

const CENTRO_GUATEMALA = [14.6349, -90.5069]

function crearIconoSeleccion() {
  const html = `
    <div class="${styles.pinWrap}">
      <svg viewBox="0 0 24 32" width="36" height="46" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 20 12 20s12-11.5 12-20C24 5.4 18.6 0 12 0z" fill="currentColor"/>
        <circle cx="12" cy="12" r="4.5" fill="#fff"/>
      </svg>
    </div>
  `
  return L.divIcon({
    html,
    className: styles.icon,
    iconSize: [36, 46],
    iconAnchor: [18, 46],
    popupAnchor: [0, -42],
  })
}

const ICONO = crearIconoSeleccion()

/** Escucha clics del mapa y coloca/mueve el marcador ahí. */
function CapaClicMapa({ onClic }) {
  useMapEvents({
    click(e) { onClic(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

export default function SelectorUbicacionMapa({ direccion, lat, lng, onCambiarUbicacion }) {
  const [buscandoDireccion, setBuscandoDireccion] = useState(false)
  const [buscandoCoordenadas, setBuscandoCoordenadas] = useState(false)
  const [avisoGeo, setAvisoGeo] = useState(null)

  // Última dirección/coordenada generada por este mismo componente: evita
  // re-geocodificar su propio resultado cuando el padre lo devuelve por props.
  const ultimaDireccionGenerada = useRef(null)

  /** Marcador movido por el usuario (clic o arrastre): dirección ← mapa. */
  const fijarPunto = useCallback((nuevoLat, nuevoLng) => {
    setAvisoGeo(null)
    setBuscandoDireccion(true)

    // Se avisa la coordenada de inmediato; la dirección llega después, sin
    // bloquear el marcador a que termine la consulta.
    onCambiarUbicacion({ lat: nuevoLat, lng: nuevoLng, direccion: undefined })

    buscarDireccion(nuevoLat, nuevoLng)
      .then((texto) => {
        if (!texto) {
          setAvisoGeo('No se encontró una dirección para este punto; puedes escribirla a mano.')
          return
        }
        ultimaDireccionGenerada.current = texto
        onCambiarUbicacion({ lat: nuevoLat, lng: nuevoLng, direccion: texto })
      })
      .catch(() => setAvisoGeo('No se pudo obtener la dirección de este punto.'))
      .finally(() => setBuscandoDireccion(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dirección escrita a mano: mapa ← dirección (con debounce).
  const buscarPorDireccion = useRef(
    debounce((texto) => {
      setBuscandoCoordenadas(true)
      setAvisoGeo(null)
      buscarCoordenadas(texto)
        .then((resultado) => {
          if (!resultado) {
            setAvisoGeo('No se encontró esa dirección en el mapa. Puedes fijarla con un clic.')
            return
          }
          onCambiarUbicacion({ lat: resultado.lat, lng: resultado.lng, direccion: undefined })
        })
        .catch(() => setAvisoGeo('No se pudo buscar esa dirección en el mapa.'))
        .finally(() => setBuscandoCoordenadas(false))
    }, 800)
  ).current

  useEffect(() => {
    const texto = (direccion ?? '').trim()
    if (!texto) return
    // Eco de lo que este mismo componente acaba de rellenar tras un clic.
    if (texto === ultimaDireccionGenerada.current) return
    if (texto.length < 5) return

    buscarPorDireccion(texto)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direccion])

  const marcador = lat != null && lng != null ? [lat, lng] : null
  const centro = marcador ?? CENTRO_GUATEMALA

  return (
    <div className={styles.wrap}>
      <MapaBase center={centro} zoom={marcador ? 16 : 12} scrollWheelZoom className={styles.mapa}>
        <CapaClicMapa onClic={fijarPunto} />
        {marcador && <CentrarMarcadorSeleccionado punto={marcador} zoom={16} />}
        {marcador && (
          <Marker
            position={marcador}
            icon={ICONO}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const { lat: la, lng: ln } = e.target.getLatLng()
                fijarPunto(la, ln)
              },
            }}
          />
        )}
      </MapaBase>

      <div className={styles.pie}>
        {(buscandoDireccion || buscandoCoordenadas) && (
          <span className={styles.estado}>
            <Spinner size="sm" />
            {buscandoDireccion ? 'Buscando la dirección de este punto...' : 'Ubicando la dirección en el mapa...'}
          </span>
        )}
        {!buscandoDireccion && !buscandoCoordenadas && avisoGeo && (
          <span className={styles.aviso}>⚠ {avisoGeo}</span>
        )}
        {!buscandoDireccion && !buscandoCoordenadas && !avisoGeo && (
          <span className={styles.ayuda}>
            {marcador
              ? 'Arrastra el marcador o haz clic en otro punto para ajustarlo.'
              : 'Haz clic en el mapa para fijar la ubicación del servicio.'}
          </span>
        )}
      </div>
    </div>
  )
}