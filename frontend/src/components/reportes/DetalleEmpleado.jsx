/**
 * components/reportes/DetalleEmpleado.jsx
 * ---------------------------------------------------------------------------
 * Detalle de una persona elegida en la tabla del resumen: su asistencia,
 * sus tareas completadas y su productividad en el mismo periodo (los tres
 * reportes con el filtro de esa persona), más la evolución de sus horas.
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import PageState from '../ui/PageState'
import GraficoTendencia from './GraficoTendencia'
import {
  getReporteAsistencia,
  getReporteProductividad,
  getReporteTareasCompletadas,
  getSerieReporte,
} from '../../api/reporteService'
import { diasDelRango, formatoNumero, textoRango } from '../../utils/reportes'
import styles from './DetalleEmpleado.module.css'

export default function DetalleEmpleado({ empleado, rango, onCerrar }) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const agrupar = diasDelRango(rango) > 31 ? 'semana' : 'dia'
  const seccion = useRef(null)

  // El detalle aparece debajo de la tabla: se lleva a la vista para que
  // elegir una fila tenga un efecto visible sin tener que buscarlo.
  useEffect(() => {
    seccion.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const filtroPersona = { ...rango, empleado: empleado.id }
      const filtroTecnico = { ...rango, tecnico: empleado.id }
      const [asistencia, tareas, productividad, serie] = await Promise.all([
        getReporteAsistencia(filtroPersona),
        getReporteTareasCompletadas(filtroTecnico),
        getReporteProductividad(filtroTecnico),
        getSerieReporte({ ...filtroPersona, metrica: 'horas', agrupar }),
      ])
      setDatos({ asistencia, tareas, productividad, serie })
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar el detalle.')
    } finally {
      setCargando(false)
    }
  }, [empleado.id, rango, agrupar])

  useEffect(() => {
    cargar()
  }, [cargar])

  const asistencia = datos?.asistencia
  const productividad = datos?.productividad?.items?.[0]

  return (
    <section ref={seccion} className={styles.detalle} aria-label={`Detalle de ${empleado.nombre}`}>
      <header className={styles.cabecera}>
        <div>
          <h2 className={styles.titulo}>{empleado.nombre}</h2>
          <p className={styles.sub}>{textoRango(rango)}</p>
        </div>
        <button type="button" className={styles.cerrar} onClick={onCerrar} aria-label="Cerrar detalle">
          ×
        </button>
      </header>

      {cargando || error ? (
        <PageState loading={cargando} error={error} onRetry={cargar} loadingLabel="Cargando detalle..." />
      ) : (
        <>
          <div className={styles.bloques}>
            <article className={styles.bloque}>
              <h3 className={styles.bloqueTitulo}>Asistencia</h3>
              <dl className={styles.datos}>
                <dt>Jornadas</dt>
                <dd>{formatoNumero(asistencia.total_jornadas)}</dd>
                <dt>Sin cerrar</dt>
                <dd>{formatoNumero(asistencia.total_jornadas_abiertas)}</dd>
                <dt>Horas trabajadas</dt>
                <dd>{asistencia.total_horas_trabajadas}</dd>
                <dt>Descansos</dt>
                <dd>{formatoNumero(asistencia.total_descansos)} · {asistencia.total_horas_pausa}</dd>
              </dl>
            </article>

            <article className={styles.bloque}>
              <h3 className={styles.bloqueTitulo}>Tareas completadas</h3>
              <p className={styles.cifra}>{formatoNumero(datos.tareas.total_tareas_completadas)}</p>
            </article>

            <article className={styles.bloque}>
              <h3 className={styles.bloqueTitulo}>Productividad</h3>
              {productividad ? (
                <>
                  <p className={styles.cifra}>{formatoNumero(productividad.tareas_por_hora, 2)}</p>
                  <p className={styles.nota}>tareas por hora trabajada</p>
                </>
              ) : (
                <p className={styles.nota}>
                  Solo se calcula para técnicos con horas o tareas en el periodo.
                </p>
              )}
            </article>
          </div>

          <h3 className={styles.bloqueTitulo}>
            Horas trabajadas por {agrupar === 'semana' ? 'semana' : 'día'}
          </h3>
          <GraficoTendencia
            puntos={datos.serie.puntos}
            metrica="horas"
            agrupar={agrupar}
            titulo={`Horas trabajadas de ${empleado.nombre}`}
            compacto
          />
        </>
      )}
    </section>
  )
}
