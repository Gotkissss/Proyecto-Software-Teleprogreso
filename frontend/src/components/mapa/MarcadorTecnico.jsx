import { Marker, Popup } from 'react-leaflet'
import Badge from '../ui/Badge'
import { ESTADO_TECNICO_LABEL, variantePorEstadoTecnico } from './estadoColor'
import { iconoTecnico } from './iconoMarcador'
import styles from './MarcadorTecnico.module.css'

function horaDe(fechaHora) {
  const hora = String(fechaHora ?? '').slice(11, 16)
  return hora || 'Sin registro'
}

export default function MarcadorTecnico({ tecnico }) {
  if (tecnico?.lat == null || tecnico?.lng == null) return null

  return (
    <Marker
      position={[tecnico.lat, tecnico.lng]}
      icon={iconoTecnico(tecnico.estado)}
      zIndexOffset={500}
    >
      <Popup>
        <div className={styles.popup}>
          <p className={styles.nombre}>{tecnico.nombre}</p>
          <div className={styles.badges}>
            <Badge
              label={ESTADO_TECNICO_LABEL[tecnico.estado] ?? tecnico.estado}
              variant={variantePorEstadoTecnico(tecnico.estado)}
            />
          </div>
          <p className={styles.fila}>
            <strong>Último reporte:</strong> {horaDe(tecnico.fecha_hora_registro)}
          </p>
        </div>
      </Popup>
    </Marker>
  )
}