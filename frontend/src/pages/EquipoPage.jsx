/**
 * pages/EquipoPage.jsx
 *
 * SCRUM-125: Layout con secciones "Mi vehículo" y "Mis herramientas"
 * SCRUM-126: Card de vehículo con imagen, placa, marca, modelo, estado
 * SCRUM-127: List/grid de herramientas con imagen, tipo y estado
 * SCRUM-128: Estado vacío si el técnico no tiene vehículo asignado
 * SCRUM-129: Consume equipoService.js → GET /empleados/mi-equipo
 *
 * FLAG: USE_MOCK = true mientras el endpoint no esté listo.
 * Para activar el backend: cambiar USE_MOCK = false.
 */

import { useState, useEffect } from 'react'
import Spinner from '../components/ui/Spinner'
import styles from './EquipoPage.module.css'

// TODO (backend): descomentar cuando SCRUM-129 esté listo
// import { getMiEquipo } from '../api/equipoService'

/* ─── FLAG DE MOCK ───────────────────────────────────────────────────────── */
const USE_MOCK = true

/* ─── MOCK DATA ──────────────────────────────────────────────────────────── */
const MOCK_VEHICULO = {
  id_activo: 1,
  nombre_activo: 'Pickup Toyota Hilux',
  placa: 'P-123ABC',
  marca: 'Toyota',
  modelo: 'Hilux 2022',
  estado_vehiculo: 'en_uso',
  descripcion: 'Pickup doble cabina asignada a ruta norte.',
}

const MOCK_HERRAMIENTAS = [
  {
    id_activo: 2,
    nombre_activo: 'Escalera telescópica 6m',
    tipo_herramienta: 'Escalera',
    marca: 'Werner',
    modelo: 'MT-13',
    estado: 'disponible',
  },
  {
    id_activo: 3,
    nombre_activo: 'Multímetro digital',
    tipo_herramienta: 'Medidor',
    marca: 'Fluke',
    modelo: '117',
    estado: 'disponible',
  },
  {
    id_activo: 7,
    nombre_activo: 'Fusionadora de fibra',
    tipo_herramienta: 'Empalme',
    marca: 'Fujikura',
    modelo: 'FSM-80S',
    estado: 'en_uso',
  },
]

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
const ESTADO_VEHICULO = {
  disponible:    { label: 'Disponible',    cls: 'estadoDisponible' },
  en_uso:        { label: 'En uso',        cls: 'estadoEnUso' },
  mantenimiento: { label: 'Mantenimiento', cls: 'estadoMantenimiento' },
}

const ESTADO_HERR = {
  disponible:    { label: 'Disponible',    cls: 'herrDisponible' },
  en_uso:        { label: 'En uso',        cls: 'herrEnUso' },
  mantenimiento: { label: 'Mantenimiento', cls: 'herrMantenimiento' },
}

/* ─── SVG VEHÍCULO (inline, sin imagen externa) ──────────────────────────── */
function VehiculoIlustracion({ color = '#1e3a5f' }) {
  return (
    <svg viewBox="0 0 160 90" width="160" height="90" fill="none" aria-hidden="true">
      <rect x="8" y="48" width="144" height="34" rx="6" fill={color} opacity="0.9"/>
      <path d="M28 48 L42 18 L118 18 L136 48 Z" fill={color}/>
      <path d="M46 46 L54 24 L108 24 L118 46 Z" fill="white" opacity="0.25"/>
      {/* ruedas */}
      <circle cx="40" cy="82" r="12" fill="#1a202c"/>
      <circle cx="40" cy="82" r="5" fill="#718096"/>
      <circle cx="120" cy="82" r="12" fill="#1a202c"/>
      <circle cx="120" cy="82" r="5" fill="#718096"/>
      {/* faros */}
      <rect x="130" y="52" width="10" height="6" rx="2" fill="#ffd54f" opacity="0.85"/>
      <rect x="20"  y="52" width="10" height="6" rx="2" fill="#ef5350" opacity="0.7"/>
    </svg>
  )
}

/* ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────────── */
export default function EquipoPage() {
  const [vehiculo,     setVehiculo]     = useState(null)
  const [herramientas, setHerramientas] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  useEffect(() => {
    const fetchEquipo = async () => {
      setLoading(true)
      setError(null)
      try {
        if (USE_MOCK) {
          await new Promise((r) => setTimeout(r, 600))
          setVehiculo(MOCK_VEHICULO)
          setHerramientas(MOCK_HERRAMIENTAS)
        } else {
          // TODO (backend — SCRUM-129): descomentar cuando esté listo
          // const { vehiculo, herramientas } = await getMiEquipo()
          // setVehiculo(vehiculo)
          // setHerramientas(herramientas)
          throw new Error('SCRUM-129: endpoint no implementado aún. Activa USE_MOCK = true.')
        }
      } catch (err) {
        setError(err?.response?.data?.detail || err?.message || 'No se pudo cargar tu equipo.')
      } finally {
        setLoading(false)
      }
    }
    fetchEquipo()
  }, [])

  /* ── Loading ── */
  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner size="lg" />
        <p className={styles.loadingText}>Cargando tu equipo...</p>
      </div>
    )
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className={styles.center}>
        <p className={styles.errorText}>{error}</p>
      </div>
    )
  }

  const estadoVeh = ESTADO_VEHICULO[vehiculo?.estado_vehiculo] ?? ESTADO_VEHICULO.disponible

  return (
    <div className={styles.page}>

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
          <div className={styles.emptyCard}>
            <div className={styles.emptyIlustration}>
              <IconCar />
            </div>
            <p className={styles.emptyTitle}>Sin vehículo asignado</p>
            <p className={styles.emptyDesc}>
              Aún no tienes un vehículo asignado. Contacta a tu supervisor.
            </p>
          </div>
        ) : (
          /* SCRUM-126: Card de vehículo */
          <div className={styles.vehiculoCard}>
            {/* Imagen / ilustración grande */}
            <div className={styles.vehiculoImagen}>
              <VehiculoIlustracion color="#1e3a5f" />
            </div>

            {/* Info principal */}
            <div className={styles.vehiculoInfo}>
              <div className={styles.vehiculoTitleRow}>
                <h3 className={styles.vehiculoNombre}>{vehiculo.nombre_activo}</h3>
                <span className={`${styles.estadoBadge} ${styles[estadoVeh.cls]}`}>
                  <span className={styles.estadoDot} />
                  {estadoVeh.label}
                </span>
              </div>

              <span className={styles.vehiculoPlaca}>{vehiculo.placa}</span>

              <div className={styles.vehiculoGrid}>
                <div className={styles.vehiculoDataItem}>
                  <span className={styles.dataLabel}>Marca</span>
                  <span className={styles.dataValue}>{vehiculo.marca ?? '—'}</span>
                </div>
                <div className={styles.vehiculoDataItem}>
                  <span className={styles.dataLabel}>Modelo</span>
                  <span className={styles.dataValue}>{vehiculo.modelo ?? '—'}</span>
                </div>
              </div>

              {vehiculo.descripcion && (
                <p className={styles.vehiculoDesc}>{vehiculo.descripcion}</p>
              )}
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
          <div className={styles.emptyCard}>
            <div className={styles.emptyIlustration}>
              <IconWrench />
            </div>
            <p className={styles.emptyTitle}>Sin herramientas asignadas</p>
            <p className={styles.emptyDesc}>
              No tienes herramientas asignadas a tu vehículo todavía.
            </p>
          </div>
        ) : (
          /* SCRUM-127: grid de herramientas */
          <ul className={styles.herramientasGrid}>
            {herramientas.map((herr) => {
              const estadoH = ESTADO_HERR[herr.estado] ?? ESTADO_HERR.disponible
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
                  <span className={`${styles.herramientaEstado} ${styles[estadoH.cls]}`}>
                    {estadoH.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}