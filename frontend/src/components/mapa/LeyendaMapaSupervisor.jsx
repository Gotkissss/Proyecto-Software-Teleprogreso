/**
 * components/mapa/LeyendaMapaSupervisor.jsx
 * HU-166 — Leyenda de colores por estado + contador de tareas visibles,
 * superpuesta sobre el mapa del supervisor.
 *
 * A diferencia de la leyenda de MapaPage (vista del técnico), que va en una
 * franja debajo del mapa, aquí se superpone SOBRE el propio mapa: el
 * supervisor la necesita a la vista mientras sigue viendo el mapa completo,
 * sin tener que hacer scroll.
 *
 * "Visibles" = las tareas que ya pasaron los filtros de fecha/técnico de
 * MapaSupervisorPage y tienen coordenadas — exactamente las mismas que se
 * pintan como marcador en ese momento.
 *
 * Los colores salen de estadoColor.js, la misma fuente que usa
 * MarcadorTareaSupervisor, así el color de cada pin siempre coincide con
 * el de la leyenda.
 *
 * Uso como hijo de un contenedor con position:relative (el mismo
 * styles.mapWrap que envuelve a <MapaBase> en MapaSupervisorPage):
 *   <div className={styles.mapWrap}>
 *     <MapaBase>...</MapaBase>
 *     <LeyendaMapaSupervisor servicios={conUbicacion} />
 *   </div>
 */
import { ESTADO_COLOR, ESTADO_LABEL, ORDEN_ESTADOS } from './estadoColor'
import styles from './LeyendaMapaSupervisor.module.css'

export default function LeyendaMapaSupervisor({ servicios = [] }) {
  const conteoPorEstado = ORDEN_ESTADOS.map((estado) => ({
    estado,
    label: ESTADO_LABEL[estado],
    color: ESTADO_COLOR[estado],
    total: servicios.filter((s) => s.estado === estado).length,
  }))

  return (
    <div className={styles.panel}>
      <p className={styles.contador}>
        <strong>{servicios.length}</strong>{' '}
        {servicios.length === 1 ? 'tarea visible' : 'tareas visibles'}
      </p>

      <ul className={styles.leyenda}>
        {conteoPorEstado.map((item) => (
          <li key={item.estado} className={styles.item}>
            <span className={styles.dot} style={{ background: item.color }} />
            <span className={styles.itemLabel}>{item.label}</span>
            <span className={styles.itemTotal}>{item.total}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}