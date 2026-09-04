/**
 * components/mapa/FiltroTecnicosMapa.jsx
 * Lista de técnicos con casillas para mostrar u ocultar sus marcadores.
 *
 * Antes esto era el <LayersControl> nativo de Leaflet, que solo puede vivir
 * dentro del mapa: con la plantilla completa se desplegaba encima del propio
 * mapa y se solapaba con la leyenda. Ahora es un panel normal fuera del mapa,
 * y quien lleva el estado de qué técnicos se ven es MapaSupervisorPage.
 */
import styles from './FiltroTecnicosMapa.module.css'

export default function FiltroTecnicosMapa({ grupos = [], ocultos, onAlternar }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.titulo}>Técnicos en el mapa</h2>

      <ul className={styles.lista}>
        {grupos.map((g) => (
          <li key={g.id}>
            <label className={styles.item}>
              <input
                type="checkbox"
                className={styles.check}
                checked={!ocultos.has(g.id)}
                onChange={() => onAlternar(g.id)}
              />
              <span className={styles.nombre}>{g.nombre}</span>
              <span className={styles.total}>{g.servicios.length}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
