/**
 * components/reportes/GraficoTendencia.jsx
 * ---------------------------------------------------------------------------
 * Línea de tendencia de una métrica (GET /reportes/serie), en SVG propio: el
 * proyecto no tiene librería de gráficos y no se añade una por esto.
 *
 * - Una sola serie: el título dice qué se dibuja, no hace falta leyenda.
 * - Línea de 2px con un lavado del 10% debajo; el valor del último periodo
 *   va escrito al final de la línea.
 * - Al pasar el puntero (o con las flechas del teclado) una línea vertical
 *   se ajusta al periodo más cercano y el recuadro muestra su valor.
 * - "Ver tabla" enseña los mismos números sin depender del gráfico.
 * ---------------------------------------------------------------------------
 */
import { useMemo, useState } from 'react'
import { useAnchoContenedor } from '../../hooks/useAnchoContenedor'
import { fechaCorta, marcasEje, metricaSerie } from '../../utils/reportes'
import styles from './Graficos.module.css'

const ALTO = 240
const MARGEN = { arriba: 16, derecha: 64, abajo: 28, izquierda: 52 }

function etiquetaPeriodo(punto, agrupar) {
  if (agrupar === 'semana' && punto.inicio !== punto.fin) {
    return `${fechaCorta(punto.inicio)} – ${fechaCorta(punto.fin)}`
  }
  return fechaCorta(punto.inicio)
}

export default function GraficoTendencia({ puntos = [], metrica, agrupar, titulo, compacto = false }) {
  const [ref, ancho] = useAnchoContenedor()
  const [activo, setActivo] = useState(null)
  const [verTabla, setVerTabla] = useState(false)
  const definicion = metricaSerie(metrica)
  const alto = compacto ? 160 : ALTO

  const geometria = useMemo(() => {
    const anchoUtil = Math.max(ancho - MARGEN.izquierda - MARGEN.derecha, 40)
    const altoUtil = alto - MARGEN.arriba - MARGEN.abajo
    const maximo = Math.max(0, ...puntos.map((p) => p.valor))
    const marcas = marcasEje(maximo)
    const tope = marcas[marcas.length - 1]
    const n = puntos.length
    const x = (i) => MARGEN.izquierda + (n <= 1 ? anchoUtil / 2 : (i * anchoUtil) / (n - 1))
    const y = (v) => MARGEN.arriba + altoUtil - (v / tope) * altoUtil
    const base = MARGEN.arriba + altoUtil
    const linea = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')
    const area = n ? `${linea} L${x(n - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z` : ''
    // Etiquetas del eje X sin chocar: una cada ~80px, siempre la última.
    const cada = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(anchoUtil / 80))))
    const etiquetasX = puntos
      .map((p, i) => i)
      .filter((i) => i % cada === 0 && (n - 1 - i >= cada / 2 || i === n - 1))
    if (n && !etiquetasX.includes(n - 1)) etiquetasX.push(n - 1)
    return { anchoUtil, base, marcas, tope, x, y, linea, area, etiquetasX }
  }, [ancho, alto, puntos])

  if (!puntos.length) {
    return <p className={styles.vacio}>No hay datos para dibujar en este periodo.</p>
  }

  const { base, marcas, x, y, linea, area, etiquetasX } = geometria
  const ultimo = puntos.length - 1
  const total = puntos.reduce((suma, p) => suma + p.valor, 0)

  const moverA = (clientX, caja) => {
    const relativo = clientX - caja.left
    let cercano = 0
    for (let i = 1; i < puntos.length; i += 1) {
      if (Math.abs(x(i) - relativo) < Math.abs(x(cercano) - relativo)) cercano = i
    }
    setActivo(cercano)
  }

  const alTeclear = (evento) => {
    if (evento.key === 'ArrowRight' || evento.key === 'ArrowLeft') {
      evento.preventDefault()
      const paso = evento.key === 'ArrowRight' ? 1 : -1
      setActivo((previo) => Math.min(ultimo, Math.max(0, (previo ?? ultimo) + paso)))
    } else if (evento.key === 'Escape') {
      setActivo(null)
    }
  }

  const descripcion = `${titulo}: ${puntos.length} ${agrupar === 'semana' ? 'semanas' : 'días'}, total ${definicion.formato(total)}.`

  return (
    <div className={styles.grafico}>
      <div className={styles.herramientas}>
        <button type="button" className={styles.enlace} onClick={() => setVerTabla((v) => !v)}>
          {verTabla ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      </div>

      {verTabla ? (
        <div className={styles.tablaWrap}>
          <table className={styles.tablaDatos}>
            <caption className={styles.oculto}>{descripcion}</caption>
            <thead>
              <tr>
                <th scope="col">{agrupar === 'semana' ? 'Semana' : 'Día'}</th>
                <th scope="col" className={styles.numero}>{definicion.etiqueta}</th>
              </tr>
            </thead>
            <tbody>
              {puntos.map((p) => (
                <tr key={p.inicio}>
                  <td>{etiquetaPeriodo(p, agrupar)}</td>
                  <td className={styles.numero}>{definicion.formato(p.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className={styles.lienzo}>
          <svg
            width={ancho}
            height={alto}
            role="img"
            aria-label={descripcion}
            tabIndex={0}
            className={styles.svg}
            onPointerMove={(e) => moverA(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setActivo(null)}
            onFocus={() => setActivo(ultimo)}
            onBlur={() => setActivo(null)}
            onKeyDown={alTeclear}
          >
            {marcas.map((marca) => (
              <g key={marca}>
                <line className={styles.rejilla} x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(marca)} y2={y(marca)} />
                <text className={styles.ejeTexto} x={MARGEN.izquierda - 8} y={y(marca)} dy="0.32em" textAnchor="end">
                  {definicion.formato(marca)}
                </text>
              </g>
            ))}
            {etiquetasX.map((i) => (
              <text key={i} className={styles.ejeTexto} x={x(i)} y={base + 18} textAnchor="middle">
                {fechaCorta(puntos[i].inicio)}
              </text>
            ))}

            <path className={styles.area} d={area} />
            <path className={styles.linea} d={linea} />

            {/* Valor del último periodo al final de la línea. */}
            <circle className={styles.punto} cx={x(ultimo)} cy={y(puntos[ultimo].valor)} r={4} />
            <text className={styles.valorFinal} x={x(ultimo) + 10} y={y(puntos[ultimo].valor)} dy="0.32em">
              {definicion.formato(puntos[ultimo].valor)}
            </text>

            {activo !== null && (
              <g>
                <line className={styles.cursor} x1={x(activo)} x2={x(activo)} y1={MARGEN.arriba} y2={base} />
                <circle className={styles.punto} cx={x(activo)} cy={y(puntos[activo].valor)} r={5} />
              </g>
            )}
          </svg>

          {activo !== null && (
            <div
              className={styles.tooltip}
              role="status"
              style={{
                left: Math.min(Math.max(x(activo), 70), ancho - 70),
                top: Math.max(y(puntos[activo].valor) - 12, 0),
              }}
            >
              <strong className={styles.tooltipValor}>{definicion.formato(puntos[activo].valor)}</strong>
              <span className={styles.tooltipEtiqueta}>{etiquetaPeriodo(puntos[activo], agrupar)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
