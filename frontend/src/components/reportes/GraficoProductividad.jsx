/**
 * components/reportes/GraficoProductividad.jsx
 * ---------------------------------------------------------------------------
 * Tareas cerradas por hora trabajada de cada técnico (GET
 * /reportes/productividad), en barras horizontales de SVG propio.
 *
 * - Un solo color para todas las barras: es una sola medida; el largo ya dice
 *   quién rinde más, no hace falta repetirlo con el tono.
 * - El valor va en la punta de cada barra; tareas y horas, en el recuadro al
 *   pasar el puntero o al enfocar la barra con el teclado.
 * - Con un técnico elegido en la pantalla, su barra se resalta y el resto se
 *   atenúa. Pulsar una barra elige a ese técnico.
 * ---------------------------------------------------------------------------
 */
import { useState } from 'react'
import { useAnchoContenedor } from '../../hooks/useAnchoContenedor'
import { formatoNumero } from '../../utils/reportes'
import styles from './Graficos.module.css'

const ALTO_BARRA = 20
const SEPARACION = 12
const ANCHO_NOMBRES = 150
const ESPACIO_VALOR = 56
const RADIO = 4

/** Barra con el extremo de datos redondeado y la base recta. */
function trazoBarra(x0, y, largo, alto) {
  if (largo <= RADIO) return `M${x0},${y} h${Math.max(largo, 0)} v${alto} h${-Math.max(largo, 0)} Z`
  const x1 = x0 + largo
  return [
    `M${x0},${y}`,
    `H${x1 - RADIO}`,
    `Q${x1},${y} ${x1},${y + RADIO}`,
    `V${y + alto - RADIO}`,
    `Q${x1},${y + alto} ${x1 - RADIO},${y + alto}`,
    `H${x0}`,
    'Z',
  ].join(' ')
}

function recortar(nombre, maximo = 20) {
  return nombre.length > maximo ? `${nombre.slice(0, maximo - 1)}…` : nombre
}

export default function GraficoProductividad({ items = [], seleccionado = null, onSeleccionar }) {
  const [ref, ancho] = useAnchoContenedor()
  const [activo, setActivo] = useState(null)

  if (!items.length) {
    return <p className={styles.vacio}>Ningún técnico trabajó en este periodo.</p>
  }

  const filas = [...items].sort(
    (a, b) => b.tareas_por_hora - a.tareas_por_hora || a.nombre_empleado.localeCompare(b.nombre_empleado, 'es')
  )
  const maximo = Math.max(...filas.map((f) => f.tareas_por_hora), 0.01)
  const anchoBarras = Math.max(ancho - ANCHO_NOMBRES - ESPACIO_VALOR, 40)
  const alto = filas.length * (ALTO_BARRA + SEPARACION) + SEPARACION
  const filaActiva = filas.find((f) => f.id_empleado === activo)

  return (
    <div ref={ref} className={styles.lienzo}>
      <svg
        width={ancho}
        height={alto}
        className={styles.svg}
        role="group"
        aria-label="Tareas por hora trabajada de cada técnico"
      >
        <line
          className={styles.rejilla}
          x1={ANCHO_NOMBRES}
          x2={ANCHO_NOMBRES}
          y1={SEPARACION / 2}
          y2={alto - SEPARACION / 2}
        />
        {filas.map((fila, indice) => {
          const y = SEPARACION + indice * (ALTO_BARRA + SEPARACION)
          const largo = (fila.tareas_por_hora / maximo) * anchoBarras
          const atenuada = seleccionado !== null && seleccionado !== fila.id_empleado
          const etiqueta = `${fila.nombre_empleado}: ${formatoNumero(fila.tareas_por_hora, 2)} tareas por hora, ${fila.tareas_completadas} tareas en ${fila.horas_trabajadas} horas`
          return (
            <g
              key={fila.id_empleado}
              className={`${styles.barraGrupo} ${atenuada ? styles.atenuada : ''}`}
              tabIndex={0}
              role="button"
              aria-label={etiqueta}
              aria-pressed={seleccionado === fila.id_empleado}
              onPointerEnter={() => setActivo(fila.id_empleado)}
              onPointerLeave={() => setActivo(null)}
              onFocus={() => setActivo(fila.id_empleado)}
              onBlur={() => setActivo(null)}
              onClick={() => onSeleccionar?.(fila)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSeleccionar?.(fila)
                }
              }}
            >
              {/* Zona de toque de toda la fila, mayor que la barra. */}
              <rect x={0} y={y - SEPARACION / 2} width={ancho} height={ALTO_BARRA + SEPARACION} fill="transparent" />
              <text className={styles.ejeTexto} x={ANCHO_NOMBRES - 10} y={y + ALTO_BARRA / 2} dy="0.32em" textAnchor="end">
                {recortar(fila.nombre_empleado)}
              </text>
              <path className={styles.barra} d={trazoBarra(ANCHO_NOMBRES, y, largo, ALTO_BARRA)} />
              <text className={styles.valorBarra} x={ANCHO_NOMBRES + largo + 8} y={y + ALTO_BARRA / 2} dy="0.32em">
                {formatoNumero(fila.tareas_por_hora, 2)}
              </text>
            </g>
          )
        })}
      </svg>

      {filaActiva && (
        <div
          className={styles.tooltip}
          role="status"
          style={{
            left: Math.min(ANCHO_NOMBRES + 90, ancho - 90),
            top: SEPARACION + filas.indexOf(filaActiva) * (ALTO_BARRA + SEPARACION) - 8,
          }}
        >
          <strong className={styles.tooltipValor}>
            {formatoNumero(filaActiva.tareas_por_hora, 2)} tareas/hora
          </strong>
          <span className={styles.tooltipEtiqueta}>{filaActiva.nombre_empleado}</span>
          <span className={styles.tooltipEtiqueta}>
            {filaActiva.tareas_completadas} tareas · {filaActiva.horas_trabajadas} h trabajadas
          </span>
        </div>
      )}
    </div>
  )
}
