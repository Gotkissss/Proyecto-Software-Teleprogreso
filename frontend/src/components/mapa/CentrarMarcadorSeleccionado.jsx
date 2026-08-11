/**
 * components/mapa/CentrarMarcadorSeleccionado.jsx
 * SCRUM-158 — Centra el mapa en el marcador de una tarea puntual en vez del
 * fitBounds general de AjustarVistaMarcadores. Se usa cuando el técnico llega
 * a MapaPage desde el botón "Ver en mapa" de RutaDiariaPage con una tarea
 * concreta en mente.
 *
 * No renderiza nada visible; se usa como hijo de <MapaBase>.
 *
 *   <MapaBase>
 *     <CentrarMarcadorSeleccionado punto={[servicio.lat, servicio.lng]} />
 *     {marcadores}
 *   </MapaBase>
 */
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export default function CentrarMarcadorSeleccionado({ punto, zoom = 17 }) {
  const map = useMap()

  useEffect(() => {
    if (!punto) return
    map.setView(punto, zoom, { animate: true })
    // Solo interesa reaccionar a cambios del punto/zoom en sí, no a
    // reasignaciones de la instancia del mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punto?.[0], punto?.[1], zoom])

  return null
}