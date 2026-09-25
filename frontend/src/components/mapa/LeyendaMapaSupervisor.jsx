/**
 * components/mapa/LeyendaMapaSupervisor.jsx
 * HU-166 — Leyenda de colores por estado + contador de tareas visibles,
 * superpuesta sobre el mapa del supervisor.
 *
 * Vive en la columna lateral de MapaSupervisorPage, junto al filtro de
 * técnicos: a la derecha del mapa en pantalla ancha y encima del mapa en
 * móvil. Antes se superponía al mapa como overlay, pero acababa tapando el
 * control de zoom y las casillas del selector de técnicos.
 *
 * "Visibles" = las tareas que ya pasaron los filtros de fecha/técnico de
 * MapaSupervisorPage y tienen coordenadas — exactamente las mismas que se
 * pintan como marcador en ese momento.
 *
 * Los colores salen de estadoColor.js, la misma fuente que usa
 * MarcadorTareaSupervisor, así el color de cada pin siempre coincide con
 * el de la leyenda.
 *
 * `estados` acota qué filas se listan. Por defecto van los cuatro estados,
 * pero el mapa no pinta todos siempre: las canceladas nunca entran, y en un
 * día pasado solo se ve lo que se cerró ese día. Listar filas que ese mapa no
 * puede pintar deja un "Cancelado 0" fijo que solo hace ruido.
 *
 * SCRUM-225 — Desde que el mapa también pinta la posición en vivo de cada
 * técnico (<MarcadorTecnico>), la leyenda suma una segunda lista para sus
 * tres estados (disponible/en_pausa/en_tarea). Sin ella, un punto verde en
 * el mapa se podía leer como "tarea completada" en vez de "técnico
 * disponible": ambos comparten el mismo verde de éxito, solo que uno es un
 * pin de tarea y el otro un círculo de técnico. Los colores salen de
 * ESTADO_TECNICO_COLOR/ESTADO_TECNICO_LABEL, la misma fuente que usa
 * MarcadorTecnico/iconoTecnico. `tecnicos` son los técnicos que el mapa
 * está pintando en ese momento (ya filtrados); la lista solo se muestra si
 * hay alguno.
 *
 * Uso:
 *   <LeyendaMapaSupervisor
 *     servicios={visibles}
 *     estados={ESTADOS_HOY}
 *     tecnicos={tecnicosVisibles}
 *   />
 */
import {
  ESTADO_COLOR,
  ESTADO_LABEL,
  ORDEN_ESTADOS,
  ESTADO_TECNICO_COLOR,
  ESTADO_TECNICO_LABEL,
} from './estadoColor'
import styles from './LeyendaMapaSupervisor.module.css'

/** Orden fijo de la lista de técnicos, igual de motivo que ORDEN_ESTADOS. */
const ORDEN_ESTADOS_TECNICO = ['disponible', 'en_tarea', 'en_pausa']

export default function LeyendaMapaSupervisor({
  servicios = [],
  estados = ORDEN_ESTADOS,
  tecnicos = [],
}) {
  const conteoPorEstado = estados.map((estado) => ({
    estado,
    label: ESTADO_LABEL[estado],
    color: ESTADO_COLOR[estado],
    total: servicios.filter((s) => s.estado === estado).length,
  }))

  const conteoPorEstadoTecnico = ORDEN_ESTADOS_TECNICO.map((estado) => ({
    estado,
    label: ESTADO_TECNICO_LABEL[estado],
    color: ESTADO_TECNICO_COLOR[estado],
    total: tecnicos.filter((t) => t.estado === estado).length,
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

      {tecnicos.length > 0 && (
        <>
          <p className={styles.seccionTitulo}>Técnicos en el mapa</p>
          <ul className={styles.leyenda}>
            {conteoPorEstadoTecnico.map((item) => (
              <li key={item.estado} className={styles.item}>
                <span className={styles.dot} style={{ background: item.color }} />
                <span className={styles.itemLabel}>{item.label}</span>
                <span className={styles.itemTotal}>{item.total}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}