/**
 * components/asistencia/HistorialAsistenciaTable.jsx
 * ---------------------------------------------------------------------------
 * Historial de asistencia: tabla filtrable por empleado y rango de fechas.
 *
 * Consume GET /asistencia/historial, que devuelve las jornadas ya calculadas
 * (horas trabajadas, tiempo en pausas y detalle de cada pausa) con filtros por
 * empleado y rango de fechas, más paginación.
 *
 * Los totales del encabezado corresponden a todo el rango filtrado, no solo a
 * la página visible: los envía el backend en el bloque `totales`.
 *
 * Componente reutilizable: se usa tanto en la ruta standalone
 * (/supervisor/asistencia) como en el tab "Historial" de EmpleadosPage.
 * `showHeader` permite ocultar el título cuando ya lo da el contenedor (tab).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import Spinner from '../ui/Spinner'
import Badge from '../ui/Badge'
import {
  getEmpleadosParaFiltro,
  getHistorialAsistencia,
} from '../../api/asistenciaService'
import styles from './HistorialAsistenciaTable.module.css'

const PAGE_SIZE = 15

/** Fecha de hace N días en formato YYYY-MM-DD (el que espera <input type="date">). */
function haceDias(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().split('T')[0]
}

const FILTROS_INICIALES = {
  empleado: '',
  fecha_inicio: haceDias(30),
  fecha_fin: new Date().toISOString().split('T')[0],
}

/** "2026-07-25" → "25 jul 2026" */
function formatearFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-GT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** "07:30:00" → "07:30" */
function formatearHora(hora) {
  if (!hora) return '—'
  return hora.slice(0, 5)
}

/* ─────────────────────────────────────────────────────────────
   Indicadores visuales (SCRUM-138)
   Se calculan en el cliente a partir de campos que el backend ya
   entrega (hora_entrada, hora_salida, jornada_activa, fecha,
   minutos_trabajados) — no se inventa información nueva.
   ───────────────────────────────────────────────────────────── */

/**
 * Hora oficial de inicio de jornada. Debe coincidir con
 * `ALERTA_HORA_LIMITE` en backend/app/core/config.py (usada allá para
 * generar la alerta de "técnico sin entrada"). Se usa aquí únicamente
 * como referencia visual, no para lógica de negocio.
 */
const HORA_ENTRADA_LIMITE = '08:00'

/** Jornada completa de referencia para el indicador de horas trabajadas. */
const MINUTOS_JORNADA_COMPLETA = 8 * 60 // 8 horas

const HOY_ISO = new Date().toISOString().split('T')[0]

/** true si la hora de entrada es posterior a HORA_ENTRADA_LIMITE. */
function esLlegadaTarde(jornada) {
  if (!jornada.hora_entrada) return false
  return jornada.hora_entrada.slice(0, 5) > HORA_ENTRADA_LIMITE
}

/**
 * true si la jornada sigue "activa" (sin hora_salida) pero es de un día
 * anterior a hoy: el empleado olvidó marcar su salida. No se marca así
 * la jornada de hoy, que naturalmente puede seguir en curso.
 */
function esSinSalida(jornada) {
  return jornada.jornada_activa && jornada.fecha < HOY_ISO
}

/** Variante de color para el total de horas trabajadas de la jornada. */
function varianteHoras(minutosTrabajados) {
  if (minutosTrabajados >= MINUTOS_JORNADA_COMPLETA) return 'success'
  if (minutosTrabajados >= MINUTOS_JORNADA_COMPLETA / 2) return 'warning'
  return 'danger'
}

/* ─────────────────────────────────────────────────────────────
   Fila de una jornada (expandible para ver el detalle de pausas)
   ───────────────────────────────────────────────────────────── */
function FilaJornada({ jornada }) {
  const [abierta, setAbierta] = useState(false)
  const tienePausas = jornada.descansos?.length > 0
  const llegadaTarde = esLlegadaTarde(jornada)
  const sinSalida = esSinSalida(jornada)

  return (
    <>
      <tr
        className={`${styles.fila} ${tienePausas ? styles.filaClickable : ''}`}
        onClick={() => tienePausas && setAbierta((v) => !v)}
      >
        <td className={styles.celda}>
          <span className={styles.fecha}>{formatearFecha(jornada.fecha)}</span>
        </td>
        <td className={styles.celda}>
          <span className={styles.empleado}>{jornada.nombre_empleado}</span>
          <span className={styles.rol}>{jornada.rol}</span>
        </td>
        <td className={styles.celda}>
          <span className={llegadaTarde ? styles.horaTarde : undefined}>
            {formatearHora(jornada.hora_entrada)}
          </span>
          {llegadaTarde && (
            <span className={styles.indicadorWrap}>
              <Badge label="Llegada tarde" variant="warning" />
            </span>
          )}
        </td>
        <td className={styles.celda}>
          {sinSalida ? (
            <span className={styles.indicadorWrap}>
              <Badge label="Sin salida" variant="danger" />
            </span>
          ) : jornada.jornada_activa ? (
            <Badge label="En curso" variant="info" />
          ) : (
            formatearHora(jornada.hora_salida)
          )}
        </td>
        <td className={`${styles.celda} ${styles.numero}`}>
          <span className={`${styles.horasChip} ${styles[`horas_${varianteHoras(jornada.minutos_trabajados)}`]}`}>
            {jornada.horas_trabajadas}
          </span>
        </td>
        <td className={`${styles.celda} ${styles.numero}`}>
          {jornada.horas_pausa}
          {tienePausas && (
            <span className={styles.pausasCount}>
              {' '}({jornada.total_pausas})
            </span>
          )}
        </td>
        <td className={`${styles.celda} ${styles.numero}`}>
          {tienePausas && (
            <span className={styles.chevron}>{abierta ? '▾' : '▸'}</span>
          )}
        </td>
      </tr>

      {abierta && tienePausas && (
        <tr className={styles.filaDetalle}>
          <td className={styles.detalleCelda} colSpan={7}>
            <span className={styles.detalleTitulo}>Pausas de la jornada</span>
            <ul className={styles.pausasList}>
              {jornada.descansos.map((p) => (
                <li key={p.id_descanso} className={styles.pausaItem}>
                  <span>
                    {formatearHora(p.hora_inicio)} — {p.en_curso ? 'en curso' : formatearHora(p.hora_fin)}
                  </span>
                  <span className={styles.pausaMin}>{p.minutos} min</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   Página
   ───────────────────────────────────────────────────────────── */
export default function HistorialAsistenciaTable({ showHeader = true }) {
  const [filtros, setFiltros]     = useState(FILTROS_INICIALES)
  const [page, setPage]           = useState(1)
  const [data, setData]           = useState(null)
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  // Lista de empleados para el selector (vacía si el rol no puede consultarla)
  useEffect(() => {
    getEmpleadosParaFiltro()
      .then(setEmpleados)
      .catch((err) => console.error('No se pudo cargar la lista de empleados:', err))
  }, [])

  const fetchHistorial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const respuesta = await getHistorialAsistencia({
        ...filtros,
        page,
        page_size: PAGE_SIZE,
      })
      setData(respuesta)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(detail || 'No se pudo cargar el historial de asistencia.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [filtros, page])

  useEffect(() => {
    fetchHistorial()
  }, [fetchHistorial])

  const handleFiltro = (campo, valor) => {
    setFiltros((prev) => ({ ...prev, [campo]: valor }))
    setPage(1) // cualquier cambio de filtro vuelve a la primera página
  }

  const limpiarFiltros = () => {
    setFiltros(FILTROS_INICIALES)
    setPage(1)
  }

  const totales    = data?.totales
  const items      = data?.items ?? []
  const totalPages = data?.total_pages ?? 0

  return (
    <div className={styles.page}>
      {showHeader && (
        <>
          <h1 className={styles.title}>Historial de asistencia</h1>
          <p className={styles.subtitle}>
            Jornadas registradas con horas trabajadas y tiempo en pausas.
          </p>
        </>
      )}

      {/* ── Filtros ── */}
      <div className={styles.filtros}>
        <div className={styles.filtroCampo}>
          <label className={styles.filtroLabel} htmlFor="f-empleado">Empleado</label>
          <select
            id="f-empleado"
            className={styles.filtroInput}
            value={filtros.empleado}
            onChange={(e) => handleFiltro('empleado', e.target.value)}
            disabled={empleados.length === 0}
          >
            <option value="">
              {empleados.length === 0 ? 'Todos' : 'Todos los empleados'}
            </option>
            {empleados.map((e) => (
              <option key={e.id_empleado} value={e.id_empleado}>
                {e.nombre_completo} ({e.rol})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filtroCampo}>
          <label className={styles.filtroLabel} htmlFor="f-desde">Desde</label>
          <input
            id="f-desde"
            type="date"
            className={styles.filtroInput}
            value={filtros.fecha_inicio}
            onChange={(e) => handleFiltro('fecha_inicio', e.target.value)}
          />
        </div>

        <div className={styles.filtroCampo}>
          <label className={styles.filtroLabel} htmlFor="f-hasta">Hasta</label>
          <input
            id="f-hasta"
            type="date"
            className={styles.filtroInput}
            value={filtros.fecha_fin}
            onChange={(e) => handleFiltro('fecha_fin', e.target.value)}
          />
        </div>

        <button className={styles.limpiarBtn} onClick={limpiarFiltros}>
          Restablecer
        </button>
      </div>

      {/* ── Totales del rango ── */}
      {totales && !error && (
        <div className={styles.resumen}>
          <ResumenCard valor={totales.jornadas} label="Jornadas" />
          <ResumenCard valor={totales.horas_trabajadas} label="Horas trabajadas" destacado />
          <ResumenCard valor={totales.horas_pausa} label="Tiempo en pausas" />
          <ResumenCard
            valor={`${Math.floor(totales.promedio_minutos_trabajados / 60)}h ${totales.promedio_minutos_trabajados % 60}m`}
            label="Promedio por jornada"
          />
          {totales.jornadas_abiertas > 0 && (
            <ResumenCard
              valor={totales.jornadas_abiertas}
              label="Jornadas sin cerrar"
              alerta
            />
          )}
        </div>
      )}

      {/* ── Leyenda de indicadores ── */}
      <div className={styles.leyenda}>
        <span className={styles.leyendaItem}>
          <Badge label="Llegada tarde" variant="warning" /> Entrada después de las {HORA_ENTRADA_LIMITE}
        </span>
        <span className={styles.leyendaItem}>
          <Badge label="Sin salida" variant="danger" /> No se marcó salida en una jornada anterior
        </span>
        <span className={styles.leyendaItem}>
          <span className={`${styles.horasChip} ${styles.horas_success}`}>00:00</span> Jornada completa (≥ 8h)
        </span>
      </div>

      {/* ── Tabla ── */}
      {loading ? (
        <div className={styles.center}><Spinner size="lg" /></div>
      ) : error ? (
        <div className={styles.errorWrap}>
          <p className={styles.errorMsg}>{error}</p>
          <button className={styles.limpiarBtn} onClick={fetchHistorial}>
            Reintentar
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🗓</div>
          <p className={styles.emptyMsg}>
            No hay jornadas registradas con estos filtros.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th className={styles.th}>Fecha</th>
                  <th className={styles.th}>Empleado</th>
                  <th className={styles.th}>Entrada</th>
                  <th className={styles.th}>Salida</th>
                  <th className={`${styles.th} ${styles.numero}`}>Trabajado</th>
                  <th className={`${styles.th} ${styles.numero}`}>Pausas</th>
                  <th className={styles.th} aria-label="Detalle" />
                </tr>
              </thead>
              <tbody>
                {items.map((j) => (
                  <FilaJornada key={j.id_asistencia} jornada={j} />
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Paginación ── */}
          <div className={styles.paginacion}>
            <button
              className={styles.pagBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              ← Anterior
            </button>
            <span className={styles.pagInfo}>
              Página {data.page} de {totalPages || 1} · {data.total} jornadas
            </span>
            <button
              className={styles.pagBtn}
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
            >
              Siguiente →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ResumenCard({ valor, label, destacado = false, alerta = false }) {
  return (
    <div className={`${styles.resumenCard} ${destacado ? styles.resumenDestacado : ''} ${alerta ? styles.resumenAlerta : ''}`}>
      <span className={styles.resumenValor}>{valor}</span>
      <span className={styles.resumenLabel}>{label}</span>
    </div>
  )
}