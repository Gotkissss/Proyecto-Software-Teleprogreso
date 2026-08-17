/**
 * components/mapa/MiniMapaTarea.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-172 — Mini-mapa de una tarea puntual, para pantallas donde hace falta
 * ubicar el servicio de un vistazo sin salir a MapaSupervisorPage (el caso de
 * uso es el panel de reasignación: ver la zona antes de elegir técnico).
 *
 * Prioridad de la ubicación que muestra:
 *   1. tarea.lat / tarea.lng, si el backend ya las tiene registradas.
 *   2. Si no hay coordenadas pero sí dirección, se geocodifica esa dirección
 *      con Nominatim y el punto se marca como "aproximado".
 *   3. Si no hay ni coordenadas ni dirección, se muestra un estado vacío.
 *
 * El caso 2 existe porque la ubicación exacta (SCRUM-169/171) es opcional y
 * las tareas creadas antes de esa historia no la tienen: sin el respaldo por
 * dirección, el panel saldría vacío para casi todo el histórico.
 *
 * Uso:
 *   <MiniMapaTarea tarea={tareaSeleccionada} />
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react'
import { Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import MapaBase from './MapaBase'
import CentrarMarcadorSeleccionado from './CentrarMarcadorSeleccionado'
import Badge from '../ui/Badge'
import Spinner from '../ui/Spinner'
import {
  colorPorEstado,
  ESTADO_LABEL,
  PRIORIDAD_LABEL,
  variantePorEstado,
  variantePorPrioridad,
} from './estadoColor'
import { buscarCoordenadas } from '../../utils/geocodificacion'
import styles from './MiniMapaTarea.module.css'

/** Ícono de pin coloreado según el estado (misma fuente que la leyenda). */
function crearIcono(estado) {
  const color = colorPorEstado(estado)
  const html = `
    <div class="${styles.pinWrap}" style="color:${color}">
      <svg viewBox="0 0 24 32" width="30" height="38" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 20 12 20s12-11.5 12-20C24 5.4 18.6 0 12 0z" fill="currentColor"/>
        <circle cx="12" cy="12" r="4.5" fill="#fff"/>
      </svg>
    </div>
  `
  return L.divIcon({
    html,
    className: styles.icon,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  })
}

export default function MiniMapaTarea({ tarea }) {
  const [punto, setPunto] = useState(null) // { lat, lng, aproximado }
  const [buscando, setBuscando] = useState(false)
  const [errorGeo, setErrorGeo] = useState(null)

  const idTarea = tarea?.id_tarea ?? tarea?.id
  const direccion = tarea?.direccion_servicio ?? tarea?.direccion ?? null
  const lat = tarea?.lat
  const lng = tarea?.lng
  const tieneCoordenadas = lat != null && lng != null

  useEffect(() => {
    // Caso 1: el backend ya trae la coordenada exacta.
    if (tieneCoordenadas) {
      setPunto({ lat, lng, aproximado: false })
      setErrorGeo(null)
      setBuscando(false)
      return
    }

    // Caso 3: no hay nada que ubicar.
    if (!direccion) {
      setPunto(null)
      setErrorGeo(null)
      setBuscando(false)
      return
    }

    // Caso 2: se deduce el punto desde la dirección escrita.
    const control = new AbortController()
    setBuscando(true)
    setErrorGeo(null)

    buscarCoordenadas(direccion, control.signal)
      .then((resultado) => {
        if (control.signal.aborted) return
        if (!resultado) {
          setPunto(null)
          setErrorGeo('No se encontró esa dirección en el mapa.')
          return
        }
        setPunto({ lat: resultado.lat, lng: resultado.lng, aproximado: true })
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setErrorGeo('No se pudo ubicar la dirección en el mapa.')
      })
      .finally(() => {
        if (!control.signal.aborted) setBuscando(false)
      })

    return () => control.abort()
  }, [idTarea, direccion, tieneCoordenadas, lat, lng])

  if (!direccion && !tieneCoordenadas) {
    return (
      <div className={styles.vacio}>
        Esta tarea no tiene dirección ni ubicación registrada.
      </div>
    )
  }

  if (buscando) {
    return (
      <div className={styles.cargando}>
        <Spinner size="sm" /> Ubicando la dirección en el mapa...
      </div>
    )
  }

  if (errorGeo || !punto) {
    return (
      <div className={styles.vacio}>
        {errorGeo ?? 'No se pudo mostrar la ubicación de esta tarea.'}
      </div>
    )
  }

  const estado = tarea?.estado_tarea ?? tarea?.estado
  const prioridad = tarea?.prioridad

  return (
    <div className={styles.wrap}>
      <MapaBase
        center={[punto.lat, punto.lng]}
        zoom={16}
        scrollWheelZoom={false}
        className={styles.mapa}
      >
        <CentrarMarcadorSeleccionado punto={[punto.lat, punto.lng]} zoom={16} />
        <Marker position={[punto.lat, punto.lng]} icon={crearIcono(estado)}>
          <Popup>
            <div className={styles.popup}>
              <p className={styles.popupTitulo}>{tarea.titulo}</p>
              <div className={styles.popupBadges}>
                {estado && (
                  <Badge
                    label={ESTADO_LABEL[estado] ?? estado}
                    variant={variantePorEstado(estado)}
                  />
                )}
                {prioridad && (
                  <Badge
                    label={PRIORIDAD_LABEL[prioridad] ?? prioridad}
                    variant={variantePorPrioridad(prioridad)}
                  />
                )}
              </div>
              {direccion && <p className={styles.popupDireccion}>{direccion}</p>}
            </div>
          </Popup>
        </Marker>
      </MapaBase>

      {punto.aproximado && (
        <p className={styles.nota}>
          Ubicación aproximada, calculada a partir de la dirección registrada.
          Esta tarea no tiene coordenadas exactas guardadas.
        </p>
      )}
    </div>
  )
}
