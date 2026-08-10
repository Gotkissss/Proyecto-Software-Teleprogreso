/**
 * pages/MapaPage.jsx
 * SCRUM-162 — Mapa de la ruta diaria del técnico: un marcador por tarea,
 * coloreado según prioridad/estado, con popup mostrando dirección, tipo
 * y prioridad.
 *
 * Usa el mismo patrón de carga (fetch + loading/error) que RutaDiariaPage,
 * y getServiciosMapa (rutaService.js) para traer las tareas de hoy con
 * coordenadas.
 */
import { useCallback, useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getServiciosMapa } from '../api/rutaService'
import MapaBase from '../components/mapa/MapaBase'
import MarcadorTarea from '../components/mapa/MarcadorTarea'
import MarcadorMiUbicacion from '../components/mapa/MarcadorMiUbicacion'
import AjustarVistaMarcadores from '../components/mapa/AjustarVistaMarcadores'
import PageState from '../components/ui/PageState'
import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'
import styles from './MapaPage.module.css'

const IconMapa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)

/** Leyenda de colores: mismo criterio que MarcadorTarea.colorPorTarea. */
const LEYENDA = [
  { color: 'var(--color-danger)',  label: 'Urgente' },
  { color: 'var(--color-warning)', label: 'Alta' },
  { color: 'var(--color-info)',    label: 'Media' },
  { color: 'var(--color-text-muted)', label: 'Baja' },
  { color: 'var(--color-primary)', label: 'En curso' },
  { color: 'var(--color-success)', label: 'Completado' },
]

/** Texto de aviso cuando la ubicación del técnico no está disponible. */
const AVISO_UBICACION = {
  denegado:     'No podemos mostrar tu ubicación: el permiso de ubicación está denegado. Actívalo en los ajustes del navegador para verte en el mapa.',
  no_soportado: 'Tu dispositivo o navegador no soporta geolocalización, así que no podemos mostrar tu ubicación en el mapa.',
  error:        'No se pudo obtener tu ubicación en este momento.',
}

export default function MapaPage() {
  const { user } = useAuth()

  const [servicios, setServicios] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  // SCRUM-163: ubicación en vivo del técnico (Geolocation API), con manejo
  // propio de permiso denegado / sin soporte / sin lectura disponible.
  const { posicion: miUbicacion, estado: estadoUbicacion } = useGeolocalizacionTecnico()

  const fetchServicios = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const data = await getServiciosMapa(user?.id_empleado)
      setServicios(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar el mapa de la ruta.')
    } finally {
      setLoading(false)
    }
  }, [user?.id_empleado])

  useEffect(() => {
    fetchServicios()
  }, [fetchServicios])

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando el mapa de tu ruta..."
        error={error}
        onRetry={fetchServicios}
        errorTitle="No se pudo cargar el mapa"
      />
    )
  }

  const conUbicacion = servicios.filter((s) => s.lat != null && s.lng != null)
  const sinUbicacion = servicios.length - conUbicacion.length
  const puntos = conUbicacion.map((s) => [s.lat, s.lng])

  if (servicios.length === 0) {
    return (
      <PageState
        empty
        emptyIcon={<IconMapa />}
        emptyTitle="Sin paradas para hoy"
        emptyDescription="Cuando tu supervisor te asigne tareas, aparecerán aquí en el mapa."
      />
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Mapa de Ruta</h2>
        <p className={styles.subtitle}>
          {conUbicacion.length} {conUbicacion.length === 1 ? 'parada' : 'paradas'} de hoy en el mapa
        </p>
      </header>

      {conUbicacion.length > 0 ? (
        <div className={styles.mapWrap}>
          <MapaBase>
            <AjustarVistaMarcadores puntos={puntos} />
            {conUbicacion.map((s) => (
              <MarcadorTarea key={s.id_servicio} servicio={s} />
            ))}
            {/* SCRUM-163: no participa del fitBounds de las tareas (arriba)
                para no reacomodar el zoom del técnico en cada lectura del
                GPS; solo se superpone como referencia. */}
            <MarcadorMiUbicacion posicion={miUbicacion} />
          </MapaBase>
        </div>
      ) : (
        <PageState
          empty
          emptyIcon={<IconMapa />}
          emptyTitle="Ninguna tarea de hoy tiene ubicación registrada"
          emptyDescription="Pídele a tu supervisor que agregue la dirección con coordenadas en la tarea."
        />
      )}

      {sinUbicacion > 0 && (
        <p className={styles.avisoSinUbicacion}>
          {sinUbicacion} {sinUbicacion === 1 ? 'tarea' : 'tareas'} de hoy sin ubicación registrada
          {sinUbicacion === 1 ? ' no aparece' : ' no aparecen'} en el mapa.
        </p>
      )}

      {/* SCRUM-163: aviso cuando no se puede mostrar el punto del técnico
          (permiso denegado, sin soporte, o sin lectura por ahora). No
          bloquea el resto del mapa: las tareas se siguen viendo igual. */}
      {AVISO_UBICACION[estadoUbicacion] && (
        <p className={styles.avisoUbicacion}>{AVISO_UBICACION[estadoUbicacion]}</p>
      )}

      <section className={styles.legend}>
        {LEYENDA.map((item) => (
          <span key={item.label} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </section>
    </div>
  )
}