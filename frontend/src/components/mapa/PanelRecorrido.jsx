/**
 * components/mapa/PanelRecorrido.jsx
 * ---------------------------------------------------------------------------
 * HU-5 — Resumen del recorrido de un técnico, junto al mapa del supervisor.
 *
 * Lista en orden cronológico, con su hora, los momentos que importan para
 * revisar el día: entrada, inicio y fin de cada tarea, salida y los tramos
 * sin datos. Los reportes periódicos no se listan uno por uno (serían cientos):
 * se cuentan en el resumen y se ven como puntos en el mapa, con su hora al
 * tocarlos.
 *
 * Si ese día no hay datos muestra un estado vacío claro, en lugar de dejar al
 * supervisor frente a un mapa sin nada.
 * ---------------------------------------------------------------------------
 */
import Spinner from '../ui/Spinner'
import { COLOR_EVENTO, COLOR_HUECO, COLOR_TRAYECTO, etiquetaEvento, horaDe } from './recorrido'
import styles from './PanelRecorrido.module.css'

/** Eventos y huecos del recorrido, en orden, listos para la lista. */
function momentosDelDia(puntos) {
  const momentos = []
  puntos.forEach((p, i) => {
    if (i > 0 && p.tras_hueco) {
      momentos.push({
        clave: `hueco-${i}`,
        hora: `${horaDe(puntos[i - 1].fecha_hora)}–${horaDe(p.fecha_hora)}`,
        texto: 'Sin datos (app cerrada, teléfono bloqueado o sin GPS)',
        hueco: true,
      })
    }
    if (p.evento !== 'periodico') {
      momentos.push({
        clave: `evento-${i}`,
        hora: horaDe(p.fecha_hora),
        texto: etiquetaEvento(p),
        color: COLOR_EVENTO[p.evento],
      })
    }
  })
  return momentos
}

export default function PanelRecorrido({
  nombre,
  fecha,
  puntos = [],
  cargando = false,
  error = null,
  onReintentar,
}) {
  if (cargando) {
    return (
      <section className={styles.panel} aria-live="polite">
        <div className={styles.cargando}>
          <Spinner size="sm" /> Cargando el recorrido…
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className={styles.panel}>
        <p className={styles.error}>{error}</p>
        {onReintentar && (
          <button className="btn btn-secondary btn-sm" onClick={onReintentar}>
            Reintentar
          </button>
        )}
      </section>
    )
  }

  if (puntos.length === 0) {
    return (
      <section className={styles.panel}>
        <p className={styles.vacioTitulo}>Sin recorrido registrado</p>
        <p className={styles.vacioTexto}>
          No hay ubicaciones de {nombre ?? 'este técnico'} el {fecha}. Solo se
          registran mientras tiene la jornada abierta y la app en pantalla.
        </p>
      </section>
    )
  }

  const periodicos = puntos.filter((p) => p.evento === 'periodico').length
  const huecos = puntos.filter((p, i) => i > 0 && p.tras_hueco).length
  const momentos = momentosDelDia(puntos)

  return (
    <section className={styles.panel}>
      <header className={styles.encabezado}>
        <h2 className={styles.titulo}>Recorrido de {nombre}</h2>
        <p className={styles.resumen}>
          De {horaDe(puntos[0].fecha_hora)} a {horaDe(puntos[puntos.length - 1].fecha_hora)}
          {' · '}{periodicos} {periodicos === 1 ? 'ubicación registrada' : 'ubicaciones registradas'}
          {huecos > 0 && ` · ${huecos} ${huecos === 1 ? 'tramo' : 'tramos'} sin datos`}
        </p>
      </header>

      <div className={styles.leyenda}>
        <span className={styles.leyendaItem}>
          <span className={styles.linea} style={{ borderColor: COLOR_TRAYECTO }} /> Trayecto
        </span>
        <span className={styles.leyendaItem}>
          <span className={`${styles.linea} ${styles.lineaHueco}`} style={{ borderColor: COLOR_HUECO }} />
          Sin datos
        </span>
      </div>

      {momentos.length > 0 && (
        <ol className={styles.lista}>
          {momentos.map((m) => (
            <li key={m.clave} className={`${styles.item} ${m.hueco ? styles.itemHueco : ''}`}>
              <span className={styles.hora}>{m.hora}</span>
              {!m.hueco && <span className={styles.punto} style={{ background: m.color }} />}
              <span>{m.texto}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
