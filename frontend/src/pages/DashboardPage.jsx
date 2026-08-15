/**
 * pages/DashboardPage.jsx
 * ---------------------------------------------------------------------------
 * Dashboard principal del supervisor.
 * Muestra: técnicos activos, tareas completadas, pendientes y en retraso.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../api/client'
import { getTareas } from '../api/tareaService'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageState from '../components/ui/PageState'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import ModalDetalleTarea from '../components/tareas/ModalDetalleTarea'
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import { describirVencimiento } from '../utils/vencimiento'
import { exportarReporteAsistenciaMes } from '../utils/exportarAsistenciaCSV'
import styles from './DashboardPage.module.css'

const IconFoto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

// Ícono del botón "Exportar reporte" (flecha hacia una bandeja de descarga).
const IconDescarga = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Obtiene métricas del supervisor desde el backend real.
 * Endpoint: GET /metricas/supervisor
 */
async function fetchMetricasReal() {
  const { data } = await apiClient.get('/metricas/supervisor')
  return data
}

/**
 * Obtiene técnicos disponibles con conteo de tareas.
 * Endpoint: GET /empleados/tecnicos/disponibles
 */
async function fetchTecnicosReal() {
  const { data } = await apiClient.get('/empleados/tecnicos/disponibles')
  // El endpoint devuelve un array; adaptamos al formato que usa la tabla.
  return (Array.isArray(data) ? data : []).map((tec) => ({
    id:               tec.id_empleado,
    nombre_completo:  tec.nombre_completo,
    tareas_asignadas: tec.tareas_activas,
    // Estado de la JORNADA, no de la cuenta. Antes aquí se ponía
    // `disponible ? 'activo' : 'en_limite'`, que habla de carga de trabajo:
    // por eso todos salían como "activo" aunque no hubieran marcado entrada.
    enJornada:        tec.en_jornada,
    marcoEntrada:     tec.marco_entrada,
    alLimite:         !tec.disponible,
  }))
}

/** Etiqueta y color del estado de jornada de un técnico. */
function estadoJornada(tec) {
  if (tec.enJornada)    return { label: 'En jornada',  variant: 'success' }
  if (tec.marcoEntrada) return { label: 'Jornada cerrada', variant: 'muted' }
  return { label: 'Sin entrada', variant: 'warning' }
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const toast = useToast()

  const [metricas,      setMetricas]      = useState(null)
  const [tecnicosList,  setTecnicosList]  = useState([])
  const [tareasList,    setTareasList]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  // Tarea cuyas evidencias está revisando el supervisor (SCRUM-141/142)
  const [tareaEvidencias, setTareaEvidencias] = useState(null)
  // Tarea abierta en la ficha de detalle (clic en la tarjeta)
  const [tareaDetalle, setTareaDetalle] = useState(null)
  // Descarga rápida de asistencia del mes (adelanto de la página de Reportes)
  const [exportando, setExportando] = useState(false)


  const fetchData = useCallback(async () => {
      setLoading(true)
      setError(null)
      try {
        // Llamadas paralelas para minimizar el tiempo de carga
        const [metricas, tecnicos, tareas] = await Promise.all([
            fetchMetricasReal(),
            fetchTecnicosReal(),
            getTareas(),
          ])
          setMetricas(metricas)
          setTecnicosList(tecnicos)
          // Adaptar tareas al formato que usa la tabla del dashboard
          setTareasList(
            (Array.isArray(tareas) ? tareas : []).map((t) => ({
              id:       t.id_tarea,
              id_tarea: t.id_tarea,
              titulo:   t.titulo,
              estado:   t.estado_tarea,
              // SCRUM-141: el backend ya dice cuántas evidencias tiene cada
              // tarea, así no hay que pedir el detalle de todas para saber
              // cuáles muestran el botón de "ver evidencias".
              total_incidencias: t.total_incidencias ?? 0,
              tecnico: t.tecnico
                ? { nombre: t.tecnico.nombre, nombre_completo: t.tecnico.nombre }
                : null,
              // Campos que necesita la ficha de detalle. Antes se descartaban
              // en este mapeo, así que el panel no tenía con qué mostrarlos.
              descripcion:        t.descripcion,
              prioridad:          t.prioridad,
              direccion_servicio: t.direccion_servicio,
              fecha_inicio:       t.fecha_inicio,
              fecha_finalizacion: t.fecha_finalizacion,
              fecha_asignacion:   t.fecha_asignacion,
              estado_tarea:       t.estado_tarea,
            }))
          )
      } catch (err) {
        console.error('Error al cargar el dashboard:', err)
        setError(
          err?.response?.data?.detail ||
          'No se pudieron cargar los datos del dashboard.'
        )
      } finally {
        setLoading(false)
      }
  }, [])

  // Se re-ejecuta en cada montaje (navegación entre páginas)
  useEffect(() => {
    fetchData()
  }, [fetchData])

  /**
   * Botón "Exportar reporte": descarga la asistencia de TODA la plantilla
   * del mes actual en un CSV, sin salir del dashboard. Es un adelanto de la
   * página completa de Reportes (con filtros de rango/empleado) prevista
   * para el próximo sprint.
   */
  const handleExportarReporte = async () => {
    setExportando(true)
    try {
      const { totalJornadas, archivo } = await exportarReporteAsistenciaMes()
      toast.success(`Reporte descargado: ${archivo} (${totalJornadas} jornadas).`)
    } catch (err) {
      if (err?.sinDatos) {
        toast.info(err.message)
      } else {
        console.error('Error al exportar reporte de asistencia:', err)
        toast.error('No se pudo generar el reporte. Intenta de nuevo.')
      }
    } finally {
      setExportando(false)
    }
  }

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando el panel..."
        error={error}
        onRetry={fetchData}
        errorTitle="No se pudo cargar el panel"
      />
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Panel de control</h1>
          <p className={styles.subtitle}>
            Vista general de la operación en tiempo real
          </p>
        </div>

        {/* Descarga rápida del mes actual. Es un adelanto de la página
            completa de Reportes (con filtros de rango/empleado) prevista
            para el próximo sprint; por ahora resuelve el caso más pedido:
            "el mes tal cual". */}
        <button
          className={styles.exportarBtn}
          onClick={handleExportarReporte}
          disabled={exportando}
          title="Descarga la asistencia de todos los técnicos de este mes en CSV"
        >
          {exportando
            ? <><Spinner size="sm" color="white" /> Generando...</>
            : <><IconDescarga /> Exportar reporte</>}
        </button>
      </div>

      {/* ── Métricas ── */}
      <section className={styles.metricsGrid}>
        {/* Antes esta tarjeta decía "Técnicos activos" y, si el backend
            devolvía 0, mostraba el total de la plantilla. Resultado: el número
            no cuadraba con la lista de abajo. Ahora dice explícitamente
            cuántos están en jornada sobre el total. */}
        <MetricCard
          label="Técnicos en jornada"
          value={metricas?.tecnicos_en_jornada ?? 0}
          suffix={metricas?.tecnicos_total ? `de ${metricas.tecnicos_total}` : null}
          variant="info"
        />
        <MetricCard
          label="Completadas hoy"
          value={metricas?.tareas_completadas_hoy ?? 0}
          suffix={
            metricas?.tareas_completadas_total
              ? `${metricas.tareas_completadas_total} en total`
              : null
          }
          variant="success"
          onClick={() => navigate('/supervisor/historial-tareas')}
          clickable
        />
        <MetricCard
          label="Tareas pendientes"
          value={metricas?.tareas_pendientes ?? 0}
          variant="warning"
        />
        <MetricCard
          label="En retraso"
          value={metricas?.tareas_retrasadas ?? 0}
          variant="danger"
          onClick={() => navigate('/supervisor/alertas')}
          clickable
        />
      </section>

      {/* ── Técnicos ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Técnicos hoy</h2>
        {tecnicosList.length === 0 ? (
          <EmptyState
            title="No hay técnicos registrados"
            description="Da de alta técnicos desde la pantalla de Empleados para verlos aquí."
          />
        ) : (
          <ul className={styles.tecnicosList}>
            {tecnicosList.map((tec) => (
              <li key={tec.id} className={styles.tecnicoItem}>
                <div className={styles.tecnicoAvatar}>
                  {tec.nombre_completo?.[0]?.toUpperCase() ?? 'T'}
                </div>
                <div className={styles.tecnicoInfo}>
                  <span className={styles.tecnicoNombre}>{tec.nombre_completo}</span>
                  <span className={styles.tecnicoTareas}>
                    {tec.tareas_asignadas ?? 0} tareas activas
                    {tec.alLimite && ' · al límite'}
                  </span>
                </div>
                <Badge {...estadoJornada(tec)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Tareas recientes ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tareas recientes</h2>
        {tareasList.length === 0 ? (
          <EmptyState
            title="No hay tareas registradas"
            description="Crea una tarea desde Reasignación para empezar a operar."
          />
        ) : (
          <ul className={styles.tareasList}>
            {tareasList.slice(0, 5).map((tarea) => {
              const vencimiento = describirVencimiento(tarea)
              return (
              <li key={tarea.id} className={styles.tareaItem}>
                {/* Antes este clic saltaba a Reasignación, que obliga a
                    buscar la tarea otra vez en otra lista. Ahora abre la ficha
                    con los datos completos, sin salir del panel. */}
                <div
                  className={styles.tareaInfo}
                  role="button"
                  tabIndex={0}
                  title="Ver detalle de la tarea"
                  onClick={() => setTareaDetalle(tarea)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setTareaDetalle(tarea)
                    }
                  }}
                >
                  <span className={styles.tareaTitulo}>{tarea.titulo}</span>
                  <span className={styles.tareaTecnico}>
                    {tarea.tecnico?.nombre_completo ?? 'Sin asignar'}
                  </span>
                </div>

                <div className={styles.tareaAcciones}>
                  {vencimiento && (
                    <Badge label={vencimiento.texto} variant={vencimiento.variant} />
                  )}
                  {tarea.total_incidencias > 0 && (
                    <button
                      className={styles.evidenciasBtn}
                      onClick={() => setTareaEvidencias(tarea)}
                      title="Ver las evidencias que dejó el técnico"
                    >
                      <IconFoto />
                      Evidencias
                      <span className={styles.evidenciasCount}>
                        {tarea.total_incidencias}
                      </span>
                    </button>
                  )}
                  <Badge
                    label={tarea.estado}
                    variant={
                      tarea.estado === 'completado'  ? 'success' :
                      tarea.estado === 'en_progreso' ? 'info'    :
                      tarea.estado === 'retrasado'   ? 'danger'  : 'warning'
                    }
                  />
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Ficha de solo lectura de la tarea. Desde el panel no se reasigna:
          para eso está su pantalla, a la que se salta desde aquí. */}
      <ModalDetalleTarea
        tarea={tareaDetalle}
        onClose={() => setTareaDetalle(null)}
        onReasignar={() => navigate('/supervisor/reasignacion')}
        onVerEvidencias={(t) => { setTareaDetalle(null); setTareaEvidencias(t) }}
      />

      {/* SCRUM-141/142: evidencias de la tarea seleccionada */}
      <ModalEvidencias
        open={Boolean(tareaEvidencias)}
        tarea={tareaEvidencias}
        onClose={() => setTareaEvidencias(null)}
        puedeEliminar
        onCambio={fetchData}
      />
    </div>
  )
}

function MetricCard({ label, value, variant, onClick, clickable, suffix }) {
  return (
    <div
      className={`${styles.metricCard} ${styles[variant]} ${clickable ? styles.clickable : ''}`}
      onClick={onClick}
    >
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
      {/* Contexto del número (p. ej. "de 5"), para que la cifra no se lea
          suelta y se pueda contrastar con las listas de abajo. */}
      {suffix && <span className={styles.metricSuffix}>{suffix}</span>}
    </div>
  )
}