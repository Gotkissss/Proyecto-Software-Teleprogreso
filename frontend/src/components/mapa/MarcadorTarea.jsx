/**
 * components/mapa/MarcadorTarea.jsx
 * SCRUM-162 — Marcador de una tarea sobre <MapaBase>: pin coloreado según
 * prioridad/estado, con popup mostrando dirección, tipo y prioridad.
 *
 * Uso como hijo de <MapaBase>:
 *   <MapaBase center={...}>
 *     {servicios.map((s) => (
 *       <MarcadorTarea key={s.id_servicio} servicio={s} />
 *     ))}
 *   </MapaBase>
 *
 * `servicio` sigue la misma forma que ya usa RutaDiariaPage (rutaService):
 * { id_servicio, estado, prioridad, nombre, direccion, tipo, lat, lng }
 *
 * SCRUM-158: `autoAbrir` abre el popup de este marcador automáticamente al
 * montarse — se usa cuando el técnico llega desde el botón "Ver en mapa" de
 * RutaDiariaPage con una tarea puntual seleccionada.
 */
import { useEffect, useRef } from 'react'
import { Marker, Popup } from 'react-leaflet'
import Badge from '../ui/Badge'
import {
  ESTADO_LABEL,
  PRIORIDAD_LABEL,
  variantePorEstado,
  variantePorPrioridad,
} from './estadoColor'
// SCRUM-181: el pin (forma, color y cache) vive en iconoMarcador.js, que lo
// comparten las cuatro pantallas de mapa.
import { iconoPorTarea } from './iconoMarcador'
import styles from './MarcadorTarea.module.css'

export default function MarcadorTarea({ servicio, autoAbrir = false }) {
  const markerRef = useRef(null)

  useEffect(() => {
    if (autoAbrir) markerRef.current?.openPopup()
  }, [autoAbrir])

  if (servicio?.lat == null || servicio?.lng == null) return null

  return (
    <Marker ref={markerRef} position={[servicio.lat, servicio.lng]} icon={iconoPorTarea(servicio)}>
      <Popup>
        <div className={styles.popup}>
          <p className={styles.popupTitulo}>{servicio.nombre}</p>

          <div className={styles.popupBadges}>
            <Badge
              label={ESTADO_LABEL[servicio.estado] ?? servicio.estado}
              variant={variantePorEstado(servicio.estado)}
            />
            <Badge
              label={PRIORIDAD_LABEL[servicio.prioridad] ?? servicio.prioridad}
              variant={variantePorPrioridad(servicio.prioridad)}
            />
          </div>

          <p className={styles.popupRow}>
            <strong>Dirección:</strong> {servicio.direccion}
          </p>
          <p className={styles.popupRow}>
            <strong>Tipo:</strong> {servicio.tipo}
          </p>
        </div>
      </Popup>
    </Marker>
  )
}
