/**
 * pages/ReportesPage.jsx
 * ---------------------------------------------------------------------------
 * Reportes de gerencia en pantalla (HU-S9-04), para admin y gerente. Es la
 * pantalla inicial del gerente.
 *
 * Antes los cuatro reportes solo se podían descargar en Excel. Aquí se ven:
 *   - Un rango con atajos (hoy, esta semana, este mes, mes pasado) que filtra
 *     todo lo de abajo. Un rango al revés se bloquea antes de llamar.
 *   - Indicadores del resumen con su variación contra el periodo anterior
 *     equivalente.
 *   - La tendencia de horas, tareas o pausas por día o semana.
 *   - La productividad de cada técnico.
 *   - La tabla del resumen por empleado; elegir una fila (o una barra) abre
 *     el detalle de esa persona.
 *   - "Exportar a Excel" descarga con estos mismos filtros.
 *
 * Al cambiar de filtro los datos anteriores quedan a la vista, atenuados,
 * hasta que llegan los nuevos: no hay saltos de diseño.
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import ModalExportarReporte from '../components/reportes/ModalExportarReporte'
import GraficoTendencia from '../components/reportes/GraficoTendencia'
import GraficoProductividad from '../components/reportes/GraficoProductividad'
import TablaResumen from '../components/reportes/TablaResumen'
import DetalleEmpleado from '../components/reportes/DetalleEmpleado'
import {
  getReporteProductividad,
  getResumenConComparacion,
  getSerieReporte,
} from '../api/reporteService'
import { RANGOS_RAPIDOS, rangoRapido } from '../utils/exportarReportes'
import {
  KPIS,
  METRICAS_SERIE,
  diasDelRango,
  formatoNumero,
  metricaSerie,
  textoRango,
  tonoVariacion,
} from '../utils/reportes'
import styles from './ReportesPage.module.css'

const ATAJO_INICIAL = 'mes'
// Topes del backend (core/reglas.py, MAX_DIAS_SERIE).
const MAX_DIAS_POR_DIA = 366
const MAX_DIAS_POR_SEMANA = 731

const IconDescarga = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

function detalleDe(err, porDefecto) {
  return err?.response?.data?.detail || porDefecto
}

/* ── Indicador con su variación ─────────────────────────────────────────── */
function Kpi({ definicion, actual, variacion, rangoAnterior }) {
  const tono = tonoVariacion(variacion, definicion.sentido)
  return (
    <article className={styles.kpi}>
      <span className={styles.kpiEtiqueta}>{definicion.etiqueta}</span>
      <span className={styles.kpiValor}>{definicion.formato(actual?.[definicion.clave] ?? 0)}</span>
      <span className={`${styles.kpiVariacion} ${styles[`tono_${tono}`]}`}>
        {variacion === null || variacion === undefined ? (
          <>Sin base para comparar con {textoRango(rangoAnterior)}</>
        ) : (
          <>
            <span aria-hidden="true">{variacion > 0 ? '▲' : variacion < 0 ? '▼' : '='}</span>{' '}
            {variacion > 0 ? '+' : ''}
            {formatoNumero(variacion, 1)} % vs {textoRango(rangoAnterior)}
          </>
        )}
      </span>
    </article>
  )
}

/* ── Selector segmentado (métrica y agrupación de la tendencia) ─────────── */
function Segmentado({ etiqueta, opciones, valor, onCambio }) {
  return (
    <div className={styles.segmentado} role="radiogroup" aria-label={etiqueta}>
      {opciones.map((opcion) => (
        <button
          key={opcion.valor}
          type="button"
          role="radio"
          aria-checked={valor === opcion.valor}
          disabled={opcion.deshabilitado}
          title={opcion.titulo}
          className={`${styles.segmento} ${valor === opcion.valor ? styles.segmentoActivo : ''}`}
          onClick={() => onCambio(opcion.valor)}
        >
          {opcion.etiqueta}
        </button>
      ))}
    </div>
  )
}

/* ── Página ─────────────────────────────────────────────────────────────── */
export default function ReportesPage() {
  const toast = useToast()
  const [atajo, setAtajo] = useState(ATAJO_INICIAL)
  const [rango, setRango] = useState(() => rangoRapido(ATAJO_INICIAL))
  const [metrica, setMetrica] = useState('horas')
  const [agruparElegido, setAgruparElegido] = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [exportarAbierto, setExportarAbierto] = useState(false)

  const [comparacion, setComparacion] = useState(null)
  const [productividad, setProductividad] = useState(null)
  const [serie, setSerie] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [cargandoSerie, setCargandoSerie] = useState(true)
  const [error, setError] = useState(null)
  const [errorSerie, setErrorSerie] = useState(null)
  // Número de la última petición de cada bloque: si el rango cambia rápido,
  // una respuesta vieja que llegue tarde no pisa a la nueva.
  const ultimoResumen = useRef(0)
  const ultimaSerie = useRef(0)

  const rangoInvalido = Boolean(
    !rango.fecha_inicio || !rango.fecha_fin || rango.fecha_inicio > rango.fecha_fin
  )
  const dias = rangoInvalido ? 0 : diasDelRango(rango)
  const demasiadoLargo = dias > MAX_DIAS_POR_SEMANA
  // Por defecto, por día hasta un mes y por semana de ahí en adelante; la
  // elección manual se respeta mientras el backend la admita.
  const agrupar =
    dias > MAX_DIAS_POR_DIA ? 'semana' : agruparElegido ?? (dias > 31 ? 'semana' : 'dia')
  const bloqueado = rangoInvalido || demasiadoLargo

  const cargarResumen = useCallback(async () => {
    if (bloqueado) {
      setCargando(false)
      return
    }
    const pedido = ++ultimoResumen.current
    setCargando(true)
    setError(null)
    try {
      const [conComparacion, porTecnico] = await Promise.all([
        getResumenConComparacion(rango),
        getReporteProductividad(rango),
      ])
      if (pedido !== ultimoResumen.current) return
      setComparacion(conComparacion)
      setProductividad(porTecnico)
    } catch (err) {
      if (pedido !== ultimoResumen.current) return
      setError(detalleDe(err, 'No se pudieron cargar los reportes.'))
    } finally {
      if (pedido === ultimoResumen.current) setCargando(false)
    }
  }, [rango, bloqueado])

  const cargarSerie = useCallback(async () => {
    if (bloqueado) {
      setCargandoSerie(false)
      return
    }
    const pedido = ++ultimaSerie.current
    setCargandoSerie(true)
    setErrorSerie(null)
    try {
      const respuesta = await getSerieReporte({ ...rango, metrica, agrupar })
      if (pedido === ultimaSerie.current) setSerie(respuesta)
    } catch (err) {
      if (pedido === ultimaSerie.current) setErrorSerie(detalleDe(err, 'No se pudo cargar la tendencia.'))
    } finally {
      if (pedido === ultimaSerie.current) setCargandoSerie(false)
    }
  }, [rango, metrica, agrupar, bloqueado])

  useEffect(() => {
    cargarResumen()
  }, [cargarResumen])

  useEffect(() => {
    cargarSerie()
  }, [cargarSerie])

  const aplicarAtajo = (clave) => {
    setAtajo(clave)
    setRango(rangoRapido(clave))
    setSeleccionado(null)
  }

  const cambiarFecha = (campo, valor) => {
    setAtajo('personalizado')
    setRango((previo) => ({ ...previo, [campo]: valor }))
    setSeleccionado(null)
  }

  const elegir = (fila) => {
    setSeleccionado((previo) =>
      previo?.id === fila.id_empleado ? null : { id: fila.id_empleado, nombre: fila.nombre_empleado }
    )
  }

  const resumen = comparacion?.actual
  const sinActividad = resumen && resumen.total_empleados === 0
  const opcionesAgrupar = useMemo(
    () => [
      {
        valor: 'dia',
        etiqueta: 'Por día',
        deshabilitado: dias > MAX_DIAS_POR_DIA,
        titulo: dias > MAX_DIAS_POR_DIA ? 'Más de un año: solo por semana' : undefined,
      },
      { valor: 'semana', etiqueta: 'Por semana' },
    ],
    [dias]
  )

  return (
    <div className={styles.page}>
      <div className={`${styles.cabecera} entra`} style={{ '--orden': 0 }}>
        <div>
          <h1 className={styles.title}>Reportes</h1>
          <p className={styles.subtitle}>
            Asistencia, tareas y productividad del personal, con su evolución y la
            comparación con el periodo anterior.
          </p>
        </div>
        <button
          type="button"
          className={`btn btn-primary ${styles.exportarBtn}`}
          onClick={() => setExportarAbierto(true)}
          disabled={bloqueado || !resumen}
          title="Descargar en Excel con el periodo y la persona de esta pantalla"
        >
          <IconDescarga /> Exportar a Excel
        </button>
      </div>

      {/* ── Filtros: el rango manda sobre todo lo de abajo ── */}
      <div className={`${styles.filtros} entra`} style={{ '--orden': 1 }}>
        <div className={styles.atajos} role="group" aria-label="Periodo">
          {RANGOS_RAPIDOS.map((item) => (
            <button
              key={item.clave}
              type="button"
              aria-pressed={atajo === item.clave}
              className={`${styles.atajo} ${atajo === item.clave ? styles.atajoActivo : ''}`}
              onClick={() => aplicarAtajo(item.clave)}
            >
              {item.etiqueta}
            </button>
          ))}
        </div>
        <label className={styles.campo}>
          <span>Desde</span>
          <input
            type="date"
            value={rango.fecha_inicio ?? ''}
            onChange={(e) => cambiarFecha('fecha_inicio', e.target.value)}
          />
        </label>
        <label className={styles.campo}>
          <span>Hasta</span>
          <input
            type="date"
            value={rango.fecha_fin ?? ''}
            onChange={(e) => cambiarFecha('fecha_fin', e.target.value)}
          />
        </label>
      </div>

      {rangoInvalido && (
        <p className={styles.errorRango} role="alert">
          {rango.fecha_inicio && rango.fecha_fin
            ? 'La fecha «Desde» no puede ser posterior a «Hasta».'
            : 'Elige las dos fechas del periodo.'}
        </p>
      )}
      {!rangoInvalido && demasiadoLargo && (
        <p className={styles.errorRango} role="alert">
          El periodo no puede pasar de dos años. Acórtalo para ver los reportes.
        </p>
      )}

      {/* Sin datos todavía cuenta como carga: entre un rango bloqueado y uno
          válido hay un render antes de que arranque la petición. */}
      {bloqueado ? null : !comparacion ? (
        <PageState loading={!error} error={error} onRetry={cargarResumen} loadingLabel="Cargando reportes..." />
      ) : (
        <div className={`${styles.cuerpo} ${cargando ? styles.actualizando : ''}`} aria-busy={cargando}>
          {error && (
            <p className={styles.errorRango} role="alert">
              {error}{' '}
              <button type="button" className={styles.enlace} onClick={cargarResumen}>Reintentar</button>
            </p>
          )}

          {/* Los indicadores entran uno tras otro; el resto de la pantalla sigue
              detras, en su turno. */}
          <section className={`${styles.kpis} entraHijos`} aria-label="Indicadores del periodo">
            {KPIS.map((definicion) => (
              <Kpi
                key={definicion.clave}
                definicion={definicion}
                actual={resumen}
                variacion={comparacion.variaciones[definicion.clave]}
                rangoAnterior={comparacion.periodoAnterior}
              />
            ))}
          </section>

          <section className={`${styles.tarjeta} entra`} style={{ '--orden': 4 }} aria-labelledby="titulo-tendencia">
            <div className={styles.tarjetaCabecera}>
              <h2 id="titulo-tendencia" className={styles.tarjetaTitulo}>
                {metricaSerie(metrica).etiqueta} por {agrupar === 'semana' ? 'semana' : 'día'}
              </h2>
              <div className={styles.controles}>
                <Segmentado
                  etiqueta="Métrica"
                  valor={metrica}
                  onCambio={setMetrica}
                  opciones={METRICAS_SERIE.map((m) => ({ valor: m.clave, etiqueta: m.etiqueta }))}
                />
                <Segmentado
                  etiqueta="Agrupación"
                  valor={agrupar}
                  onCambio={setAgruparElegido}
                  opciones={opcionesAgrupar}
                />
              </div>
            </div>
            {!serie ? (
              <PageState loading={!errorSerie} error={errorSerie} onRetry={cargarSerie} loadingLabel="Cargando tendencia..." />
            ) : (
              <div className={cargandoSerie ? styles.actualizando : undefined}>
                {errorSerie && <p className={styles.errorRango} role="alert">{errorSerie}</p>}
                <GraficoTendencia
                  puntos={serie.puntos}
                  metrica={serie.metrica}
                  agrupar={serie.agrupar}
                  titulo={`${metricaSerie(serie.metrica).etiqueta} por ${serie.agrupar === 'semana' ? 'semana' : 'día'}, ${textoRango(rango)}`}
                />
              </div>
            )}
          </section>

          {sinActividad ? (
            <PageState
              empty
              emptyTitle="Sin actividad en este periodo"
              emptyDescription="Nadie marcó jornada ni cerró tareas entre esas fechas. Prueba con otro periodo."
            />
          ) : (
            <>
              <section className={`${styles.tarjeta} entra`} style={{ '--orden': 5 }} aria-labelledby="titulo-productividad">
                <div className={styles.tarjetaCabecera}>
                  <h2 id="titulo-productividad" className={styles.tarjetaTitulo}>
                    Tareas por hora trabajada, por técnico
                  </h2>
                </div>
                <GraficoProductividad
                  items={productividad?.items ?? []}
                  seleccionado={seleccionado?.id ?? null}
                  onSeleccionar={elegir}
                />
              </section>

              <section className={`${styles.tarjeta} entra`} style={{ '--orden': 6 }} aria-labelledby="titulo-resumen">
                <div className={styles.tarjetaCabecera}>
                  <h2 id="titulo-resumen" className={styles.tarjetaTitulo}>Resumen por empleado</h2>
                  <span className={styles.ayuda}>Elige una fila para ver el detalle de esa persona.</span>
                </div>
                <TablaResumen resumen={resumen} seleccionado={seleccionado?.id ?? null} onSeleccionar={elegir} />
              </section>

              {seleccionado && (
                <DetalleEmpleado
                  key={`${seleccionado.id}-${rango.fecha_inicio}-${rango.fecha_fin}`}
                  empleado={seleccionado}
                  rango={rango}
                  onCerrar={() => setSeleccionado(null)}
                />
              )}
            </>
          )}
        </div>
      )}

      <ModalExportarReporte
        open={exportarAbierto}
        onClose={() => setExportarAbierto(false)}
        filtros={rango}
        empleado={seleccionado}
        onExportado={(archivo) => toast.success(`Reporte descargado: ${archivo}.`)}
        onError={(mensaje) => toast.error(mensaje)}
      />
    </div>
  )
}
