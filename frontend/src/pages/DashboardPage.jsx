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
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import styles from './DashboardPage.module.css'

const IconFoto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
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
    estado:           tec.disponible ? 'activo' : 'en_limite',
    tareas_asignadas: tec.tareas_activas,
  }))
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const [metricas,      setMetricas]      = useState(null)
  const [tecnicosList,  setTecnicosList]  = useState([])
  const [tareasList,    setTareasList]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  // Tarea cuyas evidencias está revisando el supervisor (SCRUM-141/142)
  const [tareaEvidencias, setTareaEvidencias] = useState(null)


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
                ? { nombre_completo: t.tecnico.nombre }
                : null,
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
      <h1 className={styles.title}>Panel de control</h1>
      <p className={styles.subtitle}>
        Vista general de la operación en tiempo real
      </p>

      {/* ── Métricas ── */}
      <section className={styles.metricsGrid}>
        <MetricCard
          label="Técnicos activos"
          // Si el backend reporta 0 pero hay técnicos activos en la lista,
          // mostramos el conteo real (técnicos con estado 'activo' o 'en_limite')
          // visible en la sección "Técnicos hoy".
          value={
            metricas?.tecnicos_activos && metricas.tecnicos_activos > 0
              ? metricas.tecnicos_activos
              : tecnicosList.length
          }
          variant="info"
        />
        <MetricCard
          label="Tareas completadas"
          value={metricas?.tareas_completadas ?? 0}
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
                  </span>
                </div>
                <Badge
                  label={tec.estado === 'activo' ? 'activo' : 'en límite'}
                  variant={tec.estado === 'activo' ? 'success' : 'warning'}
                />
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
            {tareasList.slice(0, 5).map((tarea) => (
              <li key={tarea.id} className={styles.tareaItem}>
                <div
                  className={styles.tareaInfo}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/supervisor/reasignacion')}
                  onKeyDown={(e) => e.key === 'Enter' && navigate('/supervisor/reasignacion')}
                >
                  <span className={styles.tareaTitulo}>{tarea.titulo}</span>
                  <span className={styles.tareaTecnico}>
                    {tarea.tecnico?.nombre_completo ?? 'Sin asignar'}
                  </span>
                </div>

                <div className={styles.tareaAcciones}>
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
            ))}
          </ul>
        )}
      </section>

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

function MetricCard({ label, value, variant, onClick, clickable }) {
  return (
    <div
      className={`${styles.metricCard} ${styles[variant]} ${clickable ? styles.clickable : ''}`}
      onClick={onClick}
    >
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  )
}