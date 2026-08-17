/**
 * components/mapa/SelectorUbicacionMapa.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-171 — Selector de ubicación para NuevaTareaPage: un clic en el mapa
 * (o arrastrar el marcador) fija el punto y rellena el campo de dirección;
 * escribir una dirección mueve el marcador. Las dos vías usan Nominatim, el
 * mismo proveedor sin costo que ya sirve los tiles de MapaBase.
 *
 * Es un componente controlado: el padre es dueño de `direccion`, `lat` y
 * `lng`, y decide qué hacer con `onCambiarUbicacion({ lat, lng, direccion })`.
 * Cuando la dirección todavía no se conoce (la geocodificación inversa sigue
 * en curso) se manda `direccion: undefined`, para que el padre no pise lo
 * que el supervisor ya tenía escrito.
 *
 * Para no entrar en bucle (mapa → dirección → mapa → ...) recuerda en una ref
 * la última dirección que él mismo generó y no la vuelve a geocodificar
 * cuando el padre se la devuelve por props.
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
import MapaBase from './MapaBase'
import CentrarMarcadorSeleccionado from './CentrarMarcadorSeleccionado'
// SCRUM-181: pin compartido, en tamaño `lg` porque es el elemento con el que
// se interactúa en esta pantalla.
import { iconoSeleccion } from './iconoMarcador'
import Spinner from '../ui/Spinner'
import {
  buscarCoordenadas,
  buscarDireccion,
  debounce,
} from '../../utils/geocodificacion'
import styles from './SelectorUbicacionMapa.module.css'

/** Centro por defecto: Ciudad de Guatemala (sede de Teleprogreso). */
const CENTRO_GUATEMALA = [14.6349, -90.5069]

// Nominatim devuelve basura con textos muy cortos ("z 1"), y cada pulsación
// cuenta contra su límite de uso. Por debajo de esto no se consulta.
const MIN_CARACTERES_DIRECCION = 5

const ICONO = iconoSeleccion()

/** Escucha los clics del mapa y coloca/mueve el marcador ahí. */
function CapaClicMapa({ onClic }) {
  useMapEvents({
    click(e) {
      onClic(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/** Redondeo solo para mostrar; el valor que viaja al backend va completo. */
const mostrarCoord = (n) => Number(n).toFixed(5)

export default function SelectorUbicacionMapa({
  direccion,
  lat,
  lng,
  onCambiarUbicacion,
  disabled = false,
  error = null,
}) {
  const [buscandoDireccion, setBuscandoDireccion] = useState(false)
  const [buscandoCoordenadas, setBuscandoCoordenadas] = useState(false)
  const [avisoGeo, setAvisoGeo] = useState(null)

  // El handler del padre se guarda en una ref para que los callbacks de abajo
  // (memorizados / creados una sola vez) no se queden con la versión del
  // primer render.
  const alCambiar = useRef(onCambiarUbicacion)
  useEffect(() => {
    alCambiar.current = onCambiarUbicacion
  }, [onCambiarUbicacion])

  // Última dirección generada por este mismo componente: evita volver a
  // geocodificar su propio resultado cuando el padre lo devuelve por props.
  const ultimaDireccionGenerada = useRef(null)

  // Se cancelan las consultas en vuelo al desmontar (o al lanzar una nueva),
  // para no escribir estado sobre un componente que ya no está montado.
  const abortInverso = useRef(null)
  const abortDirecto = useRef(null)
  const montado = useRef(true)

  /** Marcador movido por el usuario (clic o arrastre): dirección ← mapa. */
  const fijarPunto = useCallback((nuevoLat, nuevoLng) => {
    setAvisoGeo(null)
    setBuscandoDireccion(true)

    // La coordenada se avisa de inmediato: el marcador no tiene por qué
    // esperar a que Nominatim conteste con el texto de la dirección.
    alCambiar.current?.({ lat: nuevoLat, lng: nuevoLng, direccion: undefined })

    abortInverso.current?.abort()
    const control = new AbortController()
    abortInverso.current = control

    buscarDireccion(nuevoLat, nuevoLng, control.signal)
      .then((texto) => {
        if (control.signal.aborted || !montado.current) return
        if (!texto) {
          setAvisoGeo('No se encontró una dirección para este punto; puedes escribirla a mano.')
          return
        }
        ultimaDireccionGenerada.current = texto
        alCambiar.current?.({ lat: nuevoLat, lng: nuevoLng, direccion: texto })
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || !montado.current) return
        setAvisoGeo('No se pudo obtener la dirección de este punto.')
      })
      .finally(() => {
        if (!control.signal.aborted && montado.current) setBuscandoDireccion(false)
      })
  }, [])

  /** Dirección escrita a mano: mapa ← dirección (con debounce). */
  const buscarPorDireccion = useRef(
    debounce((texto) => {
      setBuscandoCoordenadas(true)
      setAvisoGeo(null)

      abortDirecto.current?.abort()
      const control = new AbortController()
      abortDirecto.current = control

      buscarCoordenadas(texto, control.signal)
        .then((resultado) => {
          if (control.signal.aborted || !montado.current) return
          if (!resultado) {
            setAvisoGeo('No se encontró esa dirección en el mapa. Puedes fijarla con un clic.')
            return
          }
          alCambiar.current?.({
            lat: resultado.lat,
            lng: resultado.lng,
            direccion: undefined,
          })
        })
        .catch((err) => {
          if (err?.name === 'AbortError' || !montado.current) return
          setAvisoGeo('No se pudo buscar esa dirección en el mapa.')
        })
        .finally(() => {
          if (!control.signal.aborted && montado.current) setBuscandoCoordenadas(false)
        })
    }, 800)
  ).current

  useEffect(() => {
    if (disabled) return

    const texto = (direccion ?? '').trim()
    if (!texto) return
    // Eco de lo que este mismo componente acaba de rellenar tras un clic.
    if (texto === ultimaDireccionGenerada.current) return
    if (texto.length < MIN_CARACTERES_DIRECCION) return

    buscarPorDireccion(texto)
    // Solo interesa reaccionar al texto de la dirección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direccion, disabled])

  // Limpieza al desmontar: se cancela el debounce pendiente y las consultas
  // que sigan en vuelo.
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      buscarPorDireccion.cancelar()
      abortInverso.current?.abort()
      abortDirecto.current?.abort()
    }
  }, [buscarPorDireccion])

  const quitarUbicacion = () => {
    setAvisoGeo(null)
    ultimaDireccionGenerada.current = null
    // La dirección escrita se respeta: quitar el pin no borra el texto.
    alCambiar.current?.({ lat: null, lng: null, direccion: undefined })
  }

  const marcador = lat != null && lng != null ? [lat, lng] : null
  const centro = marcador ?? CENTRO_GUATEMALA
  const ocupado = buscandoDireccion || buscandoCoordenadas

  return (
    <div className={styles.wrap}>
      <MapaBase
        center={centro}
        zoom={marcador ? 16 : 12}
        scrollWheelZoom
        className={styles.mapa}
      >
        {!disabled && <CapaClicMapa onClic={fijarPunto} />}
        {marcador && <CentrarMarcadorSeleccionado punto={marcador} zoom={16} />}
        {marcador && (
          <Marker
            position={marcador}
            icon={ICONO}
            draggable={!disabled}
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
        <div className={styles.mensaje}>
          {ocupado && (
            <span className={styles.estado}>
              <Spinner size="sm" />
              {buscandoDireccion
                ? 'Buscando la dirección de este punto...'
                : 'Ubicando la dirección en el mapa...'}
            </span>
          )}

          {!ocupado && error && <span className={styles.error}>⚠ {error}</span>}

          {!ocupado && !error && avisoGeo && (
            <span className={styles.aviso}>⚠ {avisoGeo}</span>
          )}

          {!ocupado && !error && !avisoGeo && (
            <span className={styles.ayuda}>
              {marcador
                ? 'Arrastra el marcador o haz clic en otro punto para ajustarlo.'
                : 'Haz clic en el mapa para fijar la ubicación exacta del servicio.'}
            </span>
          )}
        </div>

        {marcador && (
          <div className={styles.coordenadas}>
            <span className={styles.coordTexto}>
              {mostrarCoord(lat)}, {mostrarCoord(lng)}
            </span>
            <button
              type="button"
              className={styles.quitarBtn}
              onClick={quitarUbicacion}
              disabled={disabled}
            >
              Quitar ubicación
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
