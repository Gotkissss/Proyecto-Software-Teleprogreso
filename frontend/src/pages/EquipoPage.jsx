/**
 * pages/EquipoPage.jsx
 *
 * SCRUM-125: Layout con secciones "Mi vehículo" y "Mis herramientas"
 * SCRUM-126: Card de vehículo con imagen, placa, marca, modelo, estado
 * SCRUM-127: List/grid de herramientas con imagen, tipo y estado
 * SCRUM-128: Estado vacío si el técnico no tiene vehículo asignado
 * SCRUM-129: Consume equipoService.js → GET /empleados/mi-equipo
 *

 */

import { useCallback, useState, useEffect } from 'react'
import Badge from '../components/ui/Badge'
import PageState from '../components/ui/PageState'
import styles from './EquipoPage.module.css'

const API_BASE = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : 'https://backend-production-6d60.up.railway.app')

const fotoUrl = (url) => {
  if (!url) return null
  return url.startsWith('http') ? url : API_BASE + url
}

import { getMiEquipo } from '../api/equipoService'

/* ─── ICONOS ─────────────────────────────────────────────────────────────── */
const IconCar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-1"/>
    <circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
  </svg>
)
const IconWrench = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)
const IconTag = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>
)

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
const ESTADO_ACTIVO = {
  disponible:    { label: 'Disponible',    variant: 'success' },
  en_uso:        { label: 'En uso',        variant: 'warning' },
  mantenimiento: { label: 'Mantenimiento', variant: 'danger'  },
}

const estadoDeActivo = (estado) => ESTADO_ACTIVO[estado] ?? ESTADO_ACTIVO.disponible

/* ─── SVG VEHÍCULO (inline, sin imagen externa) ──────────────────────────── */
function VehiculoIlustracion() {
  return (
    <svg viewBox="0 0 160 90" width="160" height="90" fill="none" aria-hidden="true">
      <rect x="8" y="48" width="144" height="34" rx="6" fill="var(--color-primary-deep)" opacity="0.9"/>
      <path d="M28 48 L42 18 L118 18 L136 48 Z" fill="var(--color-primary-deep)"/>
      <path d="M46 46 L54 24 L108 24 L118 46 Z" fill="var(--color-surface)" opacity="0.25"/>
      {/* ruedas */}
      <circle cx="40" cy="82" r="12" fill="#1a202c"/>
      <circle cx="40" cy="82" r="5" fill="#718096"/>
      <circle cx="120" cy="82" r="12" fill="#1a202c"/>
      <circle cx="120" cy="82" r="5" fill="#718096"/>
      {/* faros */}
      <rect x="130" y="52" width="10" height="6" rx="2" fill="#ffd54f" opacity="0.85"/>
      <rect x="20"  y="52" width="10" height="6" rx="2" fill="var(--color-danger)" opacity="0.7"/>
    </svg>
  )
}

/* ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────────── */
export default function EquipoPage() {
  const [vehiculo,     setVehiculo]     = useState(null)
  const [herramientas, setHerramientas] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  const fetchEquipo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { vehiculo: v, herramientas: h } = await getMiEquipo()
      setVehiculo(v)
      setHerramientas(h)
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'No se pudo cargar tu equipo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEquipo()
  }, [fetchEquipo])

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando tu equipo..."
        error={error}
        onRetry={fetchEquipo}
        errorTitle="No se pudo cargar tu equipo"
      />
    )
  }

  const estadoVeh = estadoDeActivo(vehiculo?.estado_vehiculo)

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>Mi equipo</h1>
        <p className={styles.subtitle}>Vehículo y herramientas asignadas a tu nombre</p>
      </header>

      {/* ════════════════════════════════════════
          SECCIÓN: MI VEHÍCULO  (SCRUM-126)
      ════════════════════════════════════════ */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIconWrap}>
            <IconCar />
          </span>
          <h2 className={styles.sectionTitle}>Mi vehículo</h2>
        </div>

        {/* SCRUM-128: Estado vacío */}
        {!vehiculo ? (
          <PageState
            empty
            emptyIcon={<IconCar />}
            emptyTitle="Sin vehículo asignado"
            emptyDescription="Aún no tienes un vehículo asignado. Contacta a tu supervisor."
          />
        ) : (
          /* SCRUM-126: Card de vehículo */
          <div className={styles.vehiculoCard}>
            {/* Imagen / ilustración grande */}
            <div className={styles.vehiculoImagen}>
              {fotoUrl(vehiculo.foto_url)
                ? <img
                    src={fotoUrl(vehiculo.foto_url)}
                    alt={vehiculo.nombre_activo}
                    className={styles.vehiculoFoto}
                  />
                : <VehiculoIlustracion />
              }
            </div>

            {/* Info principal */}
            <div className={styles.vehiculoInfo}>
              <div className={styles.vehiculoTitleRow}>
                <h3 className={styles.vehiculoNombre}>{vehiculo.nombre_activo}</h3>
                <Badge {...estadoVeh} />
              </div>

              <div className={styles.vehiculoGrid}>
                <div className={styles.vehiculoDataItem}>
                  <span className={styles.dataLabel}>Placa</span>
                  <span className={styles.vehiculoPlaca}>{vehiculo.placa}</span>
                </div>
                <div className={styles.vehiculoDataItem}>
                  <span className={styles.dataLabel}>Marca</span>
                  <span className={styles.dataValue}>{vehiculo.marca ?? '—'}</span>
                </div>
                <div className={styles.vehiculoDataItem}>
                  <span className={styles.dataLabel}>Modelo</span>
                  <span className={styles.dataValue}>{vehiculo.modelo ?? '—'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════
          SECCIÓN: MIS HERRAMIENTAS  (SCRUM-127)
      ════════════════════════════════════════ */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIconWrap}>
            <IconWrench />
          </span>
          <h2 className={styles.sectionTitle}>Mis herramientas</h2>
          {herramientas.length > 0 && (
            <span className={styles.herramientasCount}>{herramientas.length}</span>
          )}
        </div>

        {herramientas.length === 0 ? (
          <PageState
            empty
            emptyIcon={<IconWrench />}
            emptyTitle="Sin herramientas asignadas"
            emptyDescription="No tienes herramientas asignadas a tu vehículo todavía."
          />
        ) : (
          /* SCRUM-127: grid de herramientas */
          <ul className={styles.herramientasGrid}>
            {herramientas.map((herr) => {
              const estadoH = estadoDeActivo(herr.estado)
              return (
                <li key={herr.id_activo} className={styles.herramientaCard}>
                  {/* Icono */}
                  <div className={styles.herramientaIconWrap}>
                    <IconWrench />
                  </div>

                  {/* Nombre y tipo */}
                  <div className={styles.herramientaBody}>
                    <span className={styles.herramientaNombre}>{herr.nombre_activo}</span>
                    {herr.tipo_herramienta && (
                      <span className={styles.herramientaTipo}>
                        <IconTag />
                        {herr.tipo_herramienta}
                      </span>
                    )}
                    {(herr.marca || herr.modelo) && (
                      <span className={styles.herramientaMeta}>
                        {[herr.marca, herr.modelo].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>

                  {/* Estado */}
                  <Badge {...estadoH} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
