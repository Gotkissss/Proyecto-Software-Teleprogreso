/**
 * components/mapa/MiniMapaAsistencia.jsx
 * ---------------------------------------------------------------------------
 * HU-4 — Mini-mapa con el lugar donde se marcó la entrada y la salida de una
 * jornada. Se muestra al expandir la fila del historial de asistencia para
 * que el supervisor verifique que la jornada se abrió donde correspondía.
 *
 * Pinta un pin por cada marca que tenga coordenada (verde = entrada,
 * azul = salida). Si una de las dos se registró sin ubicación lo dice debajo
 * del mapa; si ninguna la tiene, el componente no se usa (la fila ya muestra
 * el badge "Sin ubicación").
 *
 * Uso:
 *   <MiniMapaAsistencia jornada={jornada} />
 * ---------------------------------------------------------------------------
 */
import { Marker, Popup } from 'react-leaflet'
import MapaBase from './MapaBase'
import AjustarVistaMarcadores from './AjustarVistaMarcadores'
import { crearIconoPin } from './iconoMarcador'
import styles from './MiniMapaAsistencia.module.css'

const COLOR_ENTRADA = 'var(--color-success)'
const COLOR_SALIDA = 'var(--color-primary)'

/** "07:30:00" → "07:30" */
function hhmm(hora) {
  return hora ? hora.slice(0, 5) : '—'
}

/** Marcas de la jornada que tienen coordenada, en el orden en que ocurrieron. */
function marcasConUbicacion(jornada) {
  const marcas = []
  if (jornada?.lat_entrada != null && jornada?.lng_entrada != null) {
    marcas.push({
      clave: 'entrada',
      etiqueta: 'Entrada',
      hora: jornada.hora_entrada,
      punto: [jornada.lat_entrada, jornada.lng_entrada],
      color: COLOR_ENTRADA,
    })
  }
  if (jornada?.lat_salida != null && jornada?.lng_salida != null) {
    marcas.push({
      clave: 'salida',
      etiqueta: 'Salida',
      hora: jornada.hora_salida,
      punto: [jornada.lat_salida, jornada.lng_salida],
      color: COLOR_SALIDA,
    })
  }
  return marcas
}

export default function MiniMapaAsistencia({ jornada }) {
  const marcas = marcasConUbicacion(jornada)
  if (marcas.length === 0) return null

  const entradaSinUbicacion = !marcas.some((m) => m.clave === 'entrada')
  // Solo cuenta como faltante si la salida existe: una jornada en curso
  // todavía no tiene salida que ubicar.
  const salidaSinUbicacion =
    Boolean(jornada.hora_salida) && !marcas.some((m) => m.clave === 'salida')

  return (
    <div className={styles.wrap}>
      <MapaBase
        center={marcas[0].punto}
        zoom={15}
        scrollWheelZoom={false}
        className={styles.mapa}
      >
        <AjustarVistaMarcadores puntos={marcas.map((m) => m.punto)} padding={32} />
        {marcas.map((m) => (
          <Marker
            key={m.clave}
            position={m.punto}
            icon={crearIconoPin({ color: m.color, tamano: 'sm' })}
          >
            <Popup>
              <strong>{m.etiqueta}</strong> · {hhmm(m.hora)}
            </Popup>
          </Marker>
        ))}
      </MapaBase>

      <div className={styles.leyenda}>
        {marcas.map((m) => (
          <span key={m.clave} className={styles.leyendaItem}>
            <span className={styles.punto} style={{ background: m.color }} />
            {m.etiqueta} · {hhmm(m.hora)}
          </span>
        ))}
        {entradaSinUbicacion && (
          <span className={styles.faltante}>Entrada sin ubicación</span>
        )}
        {salidaSinUbicacion && (
          <span className={styles.faltante}>Salida sin ubicación</span>
        )}
      </div>
    </div>
  )
}
