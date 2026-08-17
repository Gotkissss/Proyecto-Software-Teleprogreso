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
import { useCallback, useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getServiciosMapa } from '../api/rutaService'
import MapaBase from '../components/mapa/MapaBase'
import MarcadorTarea from '../components/mapa/MarcadorTarea'
import MarcadorMiUbicacion from '../components/mapa/MarcadorMiUbicacion'
import AjustarVistaMarcadores from '../components/mapa/AjustarVistaMarcadores'
import CentrarMarcadorSeleccionado from '../components/mapa/CentrarMarcadorSeleccionado'
import { ESTADO_COLOR, PRIORIDAD_COLOR } from '../components/mapa/estadoColor'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'
import styles from './MapaPage.module.css'

const IconMapa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)

/**
 * Leyenda de colores: mismo criterio que `colorPorTarea` (estadoColor.js).
 * SCRUM-181: los colores se leen de las constantes compartidas en vez de
 * repetirse aquí a mano, que era como la leyenda y los pines se
 * desincronizaban al tocar la paleta.
 */
const LEYENDA = [
  { color: PRIORIDAD_COLOR.urgente,  label: 'Urgente' },
  { color: PRIORIDAD_COLOR.alta,     label: 'Alta' },
  { color: PRIORIDAD_COLOR.media,    label: 'Media' },
  { color: PRIORIDAD_COLOR.baja,     label: 'Baja' },
  { color: ESTADO_COLOR.en_progreso, label: 'En curso' },
  { color: ESTADO_COLOR.completado,  label: 'Completado' },
]

/** Texto de aviso cuando la ubicación del técnico no está disponible. */
const AVISO_UBICACION = {
  denegado:     'No podemos mostrar tu ubicación: el permiso de ubicación está denegado. Actívalo en los ajustes del navegador para verte en el mapa.',
  no_soportado: 'Tu dispositivo o navegador no soporta geolocalización, así que no podemos mostrar tu ubicación en el mapa.',
  error:        'No se pudo obtener tu ubicación en este momento.',
}

export default function MapaPage() {
  const { user } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  const [servicios, setServicios] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  // SCRUM-158: id de la tarea que RutaDiariaPage pidió centrar/resaltar,
  // recibido por `state` de navegación (no por query string). Se lee una
  // sola vez al montar: si el técnico interactúa con el mapa después no
  // queremos que un re-render lo vuelva a recentrar.
  const servicioSeleccionadoIdRef = useRef(location.state?.servicioId ?? null)
  const servicioSeleccionadoId = servicioSeleccionadoIdRef.current
  const avisoSinUbicacionMostrado = useRef(false)

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

  // Limpia el `state` de navegación al consumirlo, para que recargar la
  // página o volver con el botón "atrás" no vuelva a forzar el centrado.
  useEffect(() => {
    if (location.state?.servicioId != null) {
      navigate(location.pathname, { replace: true, state: null })
    }
    // Solo debe correr una vez al montar la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SCRUM-158: si la tarea pedida desde "Ver en mapa" existe pero no tiene
  // coordenadas, se avisa una sola vez en vez de fallar en silencio — el
  // resto del mapa se sigue mostrando igual.
  useEffect(() => {
    if (loading || !servicioSeleccionadoId || avisoSinUbicacionMostrado.current) return
    const seleccionada = servicios.find((s) => s.id_servicio === servicioSeleccionadoId)
    if (seleccionada && (seleccionada.lat == null || seleccionada.lng == null)) {
      avisoSinUbicacionMostrado.current = true
      toast.info('Esa tarea no tiene ubicación registrada, así que no se puede centrar en el mapa.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, servicios, servicioSeleccionadoId])

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

  // SCRUM-158: tarea puntual a centrar/resaltar (si vino de "Ver en mapa").
  const servicioSeleccionado = servicioSeleccionadoId
    ? conUbicacion.find((s) => s.id_servicio === servicioSeleccionadoId)
    : null

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
            {/* SCRUM-158: si venimos de "Ver en mapa" con una tarea puntual,
                el mapa se centra en ella en vez de encuadrar todas las
                paradas del día. */}
            {servicioSeleccionado ? (
              <CentrarMarcadorSeleccionado punto={[servicioSeleccionado.lat, servicioSeleccionado.lng]} />
            ) : (
              <AjustarVistaMarcadores puntos={puntos} />
            )}
            {conUbicacion.map((s) => (
              <MarcadorTarea
                key={s.id_servicio}
                servicio={s}
                autoAbrir={s.id_servicio === servicioSeleccionado?.id_servicio}
              />
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