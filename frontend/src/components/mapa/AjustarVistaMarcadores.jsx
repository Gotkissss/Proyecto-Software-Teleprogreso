/**
 * components/mapa/AjustarVistaMarcadores.jsx
 * Ajusta automáticamente el centro/zoom del mapa para que todos los puntos
 * dados queden visibles. No renderiza nada visible; se usa como hijo de
 * <MapaBase> junto con los marcadores.
 *
 *   <MapaBase>
 *     <AjustarVistaMarcadores puntos={servicios.map(s => [s.lat, s.lng])} />
 *     {marcadores}
 *   </MapaBase>
 */
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

export default function AjustarVistaMarcadores({ puntos = [], padding = 48 }) {
  const map = useMap()

  useEffect(() => {
    if (!puntos.length) return

    if (puntos.length === 1) {
      map.setView(puntos[0], Math.max(map.getZoom(), 14))
      return
    }

    const bounds = L.latLngBounds(puntos)
    map.fitBounds(bounds, { padding: [padding, padding] })
    // Los puntos se recalculan en cada render de la página; comparamos por
    // su contenido (no por referencia) para no reajustar la vista de más.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, JSON.stringify(puntos), padding])

  return null
}