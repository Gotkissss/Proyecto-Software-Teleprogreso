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
import PageState from '../components/ui/PageState'
import { tipoDeVehiculo } from '../utils/vehiculo'
import styles from './EquipoPage.module.css'

// La resolución del enlace firmado vive en api/client (urlArchivo): tenerla
// duplicada aquí obligaba a acordarse de tocar dos sitios cada vez que cambia
// la URL del backend.
import { urlArchivo } from '../api/client'
import { getMiEquipo } from '../api/equipoService'
import { useFotoFirmada, useRenovarEnlaces } from '../hooks/useFotoFirmada'

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
/* Lo común a las tres siluetas: ruedas y faros se dibujan igual. */
function RuedasYFaros() {
  return (
    <>
      <circle cx="40" cy="82" r="12" fill="#1a202c"/>
      <circle cx="40" cy="82" r="5" fill="#718096"/>
      <circle cx="120" cy="82" r="12" fill="#1a202c"/>
      <circle cx="120" cy="82" r="5" fill="#718096"/>
      <rect x="130" y="52" width="10" height="6" rx="2" fill="#ffd54f" opacity="0.85"/>
      <rect x="20"  y="52" width="10" height="6" rx="2" fill="#ef5350" opacity="0.7"/>
    </>
  )
}

/**
 * Silueta del vehículo según su carrocería (RTF-01 / R3-11).
 *
 * Antes era siempre un sedán, así que la pick-up del técnico salía dibujada
 * como un carro particular. El tipo se deduce del modelo (`utils/vehiculo.js`)
 * y, si no se reconoce, se dibuja la silueta de siempre.
 */
export function VehiculoIlustracion({ color = '#1e3a5f', tipo = 'sedan' }) {
  if (tipo === 'pickup') {
    return (
      <svg viewBox="0 0 160 90" width="160" height="90" fill="none" aria-hidden="true">
        {/* Cabina corta delante y palangana abierta detrás. */}
        <rect x="8" y="48" width="144" height="34" rx="6" fill={color} opacity="0.9"/>
        <path d="M64 48 L74 20 L120 20 L136 48 Z" fill={color}/>
        <path d="M78 46 L84 26 L114 26 L124 46 Z" fill="white" opacity="0.25"/>
        {/* Cajón: el borde alto es lo que distingue a una pick-up de lejos. */}
        <rect x="10" y="38" width="54" height="12" rx="2" fill={color}/>
        <rect x="14" y="42" width="46" height="8" fill="white" opacity="0.12"/>
        <RuedasYFaros />
      </svg>
    )
  }

  if (tipo === 'panel') {
    return (
      <svg viewBox="0 0 160 90" width="160" height="90" fill="none" aria-hidden="true">
        {/* Caja alta y recta de principio a fin. */}
        <path d="M12 18 L112 18 L140 48 L152 48 L152 82 L12 82 Z" fill={color} opacity="0.95"/>
        <path d="M114 24 L132 46 L150 46 L150 24 Z" fill="white" opacity="0.22"/>
        <rect x="24" y="26" width="36" height="20" rx="2" fill="white" opacity="0.12"/>
        <RuedasYFaros />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 160 90" width="160" height="90" fill="none" aria-hidden="true">
      <rect x="8" y="48" width="144" height="34" rx="6" fill={color} opacity="0.9"/>
      <path d="M28 48 L42 18 L118 18 L136 48 Z" fill={color}/>
      <path d="M46 46 L54 24 L108 24 L118 46 Z" fill="white" opacity="0.25"/>
      <RuedasYFaros />
    </svg>
  )
}

/** Foto del vehículo; si no carga ni con un enlace nuevo, queda la ilustración. */
function FotoVehiculo({ src, alt, alExpirar, tipo }) {
  const { fallida, alFallar } = useFotoFirmada(src, alExpirar)
  if (!src || fallida) return <VehiculoIlustracion color="#1e3a5f" tipo={tipo} />
  return (
    <img
      src={src}
      alt={alt}
      onError={alFallar}
      style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'}}
    />
  )
}

/* ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────────── */
export default function EquipoPage() {
  const [vehiculo,     setVehiculo]     = useState(null)
  const [herramientas, setHerramientas] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  const cargarEquipo = useCallback(async () => {
    const { vehiculo: v, herramientas: h } = await getMiEquipo()
    setVehiculo(v)
    setHerramientas(h)
  }, [])

  const fetchEquipo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await cargarEquipo()
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'No se pudo cargar tu equipo.')
    } finally {
      setLoading(false)
    }
  }, [cargarEquipo])

  const renovarEnlaces = useRenovarEnlaces(cargarEquipo)

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
              <FotoVehiculo
                src={urlArchivo(vehiculo.foto_url)}
                alt={vehiculo.nombre_activo}
                alExpirar={renovarEnlaces}
                tipo={tipoDeVehiculo(vehiculo)}
              />
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