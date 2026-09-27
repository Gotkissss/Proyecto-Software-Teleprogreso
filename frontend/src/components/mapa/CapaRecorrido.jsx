/**
 * components/mapa/CapaRecorrido.jsx
 * ---------------------------------------------------------------------------
 * HU-5 — Recorrido de un técnico en un día, dibujado sobre <MapaBase>.
 *
 *   - Línea continua entre puntos seguidos: el trayecto registrado.
 *   - Línea punteada gris donde hubo un hueco sin datos (`tras_hueco`): la
 *     app estuvo cerrada, el teléfono bloqueado o sin GPS. Solo marca el
 *     salto; no dice por dónde pasó el técnico.
 *   - Un punto pequeño por cada reporte periódico, con su hora al tocarlo.
 *   - Pines de color para los eventos: entrada, salida, inicio y fin de tarea.
 *
 * No renderiza nada visible fuera del mapa: la lista en orden y el estado
 * vacío los muestra <PanelRecorrido>.
 * ---------------------------------------------------------------------------
 */
import { CircleMarker, Marker, Polyline, Popup, Tooltip } from 'react-leaflet'
import { crearIconoPin } from './iconoMarcador'
import {
  COLOR_EVENTO,
  COLOR_HUECO,
  COLOR_TRAYECTO,
  etiquetaEvento,
  horaDe,
} from './recorrido'

/**
 * Parte el recorrido en tramos continuos y huecos.
 * @returns {{ tramos: Array<Array<[number,number]>>, huecos: Array<{desde, hasta}> }}
 */
function separarTramos(puntos) {
  const tramos = []
  const huecos = []
  let actual = []

  puntos.forEach((p, i) => {
    if (i > 0 && p.tras_hueco) {
      huecos.push({ desde: puntos[i - 1], hasta: p })
      if (actual.length > 1) tramos.push(actual)
      actual = []
    }
    actual.push([p.lat, p.lng])
  })
  if (actual.length > 1) tramos.push(actual)

  return { tramos, huecos }
}

export default function CapaRecorrido({ puntos = [] }) {
  if (puntos.length === 0) return null

  const { tramos, huecos } = separarTramos(puntos)

  return (
    <>
      {tramos.map((tramo, i) => (
        <Polyline
          key={`tramo-${i}`}
          positions={tramo}
          pathOptions={{ color: COLOR_TRAYECTO, weight: 4, opacity: 0.8 }}
        />
      ))}

      {huecos.map(({ desde, hasta }, i) => (
        <Polyline
          key={`hueco-${i}`}
          positions={[[desde.lat, desde.lng], [hasta.lat, hasta.lng]]}
          pathOptions={{ color: COLOR_HUECO, weight: 3, dashArray: '6 8', opacity: 0.9 }}
        >
          <Tooltip sticky>
            Sin datos entre {horaDe(desde.fecha_hora)} y {horaDe(hasta.fecha_hora)}
          </Tooltip>
        </Polyline>
      ))}

      {puntos.map((p, i) =>
        p.evento === 'periodico' ? (
          <CircleMarker
            key={`punto-${i}`}
            center={[p.lat, p.lng]}
            radius={4}
            pathOptions={{ color: COLOR_TRAYECTO, fillColor: '#fff', fillOpacity: 1, weight: 2 }}
          >
            <Popup>{horaDe(p.fecha_hora)}</Popup>
          </CircleMarker>
        ) : (
          <Marker
            key={`evento-${i}`}
            position={[p.lat, p.lng]}
            icon={crearIconoPin({ color: COLOR_EVENTO[p.evento], tamano: 'sm' })}
          >
            <Popup>
              <strong>{etiquetaEvento(p)}</strong> · {horaDe(p.fecha_hora)}
            </Popup>
          </Marker>
        )
      )}
    </>
  )
}
