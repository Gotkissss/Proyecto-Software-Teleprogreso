/**
 * HU-165 — Vista "Mapa" en SupervisorLayout: las tareas del equipo sobre un
 * mapa, agrupadas por técnico (con casillas para mostrar/ocultar a cada uno)
 * y con filtros de fecha y de técnico.
 *
 * Reutiliza <MapaBase> igual que MapaPage (vista del técnico), pero:
 *   - Colorea los pines por ESTADO (no por prioridad) — ver
 *     MarcadorTareaSupervisor + estadoColor.js.
 *   - Agrupa los marcadores por técnico y deja apagar/encender a cada uno
 *     desde <FiltroTecnicosMapa>. Antes esto era un <LayersControl> nativo
 *     de Leaflet, que solo puede dibujarse dentro del mapa y terminaba
 *     tapándolo; ahora el panel vive fuera y el estado de qué técnicos se
 *     ven lo lleva esta página.
 *
 * Qué entra en el mapa lo decide el backend (GET /tareas/mapa-supervisor):
 * en el día de HOY, todo el trabajo abierto del equipo más lo que se cerró
 * hoy; en un día pasado, solo lo que se cerró ese día. Antes el recorte se
 * hacía aquí, contra el rango [fecha_inicio, fecha_finalizacion] de cada
 * tarea, y por eso el mapa mostraba dos pendientes en vez de todas: las
 * vencidas y las programadas para otro día se caían, y con ellas los técnicos
 * que solo tenían ese tipo de trabajo desaparecían del control de capas.
 *
 * HU-166 (leyenda + contador) va en <LeyendaMapaSupervisor>, en la misma
 * columna lateral que el filtro de técnicos: a la derecha del mapa en
 * pantalla ancha y encima del mapa en móvil.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMapaSupervisor, getTecnicosDisponibles } from '../api/tareaService'
import MapaBase from '../components/mapa/MapaBase'
import MarcadorTareaSupervisor from '../components/mapa/MarcadorTareaSupervisor'
import AjustarVistaMarcadores from '../components/mapa/AjustarVistaMarcadores'
import FiltroTecnicosMapa from '../components/mapa/FiltroTecnicosMapa'
import LeyendaMapaSupervisor from '../components/mapa/LeyendaMapaSupervisor'
import PageState from '../components/ui/PageState'
import { hoyISO } from '../utils/fecha'
import styles from './MapaSupervisorPage.module.css'

const IconMapa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)

/** Estados que puede pintar el mapa en la vista de HOY. */
const ESTADOS_HOY = ['pendiente', 'en_progreso', 'completado']

/** En un día pasado el mapa es el histórico de lo que se cerró ese día. */
const ESTADOS_DIA_PASADO = ['completado']

/** Intenta inferir el tipo de servicio a partir del título o descripción
 * (mismo criterio que rutaService.js, para que el popup muestre lo mismo
 * que ve el técnico). */
function inferirTipo(titulo = '', descripcion = '') {
  const text = `${titulo} ${descripcion}`.toLowerCase()
  if (text.includes('instalac'))   return 'Instalación'
  if (text.includes('repar'))      return 'Reparación'
  if (text.includes('manten'))     return 'Mantenimiento'
  if (text.includes('inspecc'))    return 'Inspección'
  if (text.includes('configur'))   return 'Configuración'
  return 'Servicio'
}

/** tarea (backend) → servicio (forma que consumen los componentes de mapa). */
function tareaAServicio(t) {
  return {
    id_servicio: t.id_tarea,
    estado:      t.estado_tarea,
    prioridad:   t.prioridad ?? 'media',
    nombre:      t.titulo,
    direccion:   t.direccion_servicio ?? 'Dirección no especificada',
    tipo:        inferirTipo(t.titulo, t.descripcion),
    lat:         t.lat ?? null,
    lng:         t.lng ?? null,
    tecnico:     t.tecnico ?? null,
    fecha_completado: t.fecha_completado ?? null,
  }
}

export default function MapaSupervisorPage() {
  const [tareas, setTareas]     = useState([])
  const [tecnicos, setTecnicos] = useState([])
  // `loading` solo cubre la primera carga: al cambiar de fecha se recarga sin
  // desmontar el mapa, para no parpadear ni perder el zoom en cada clic.
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  // Filtros: fecha (por defecto hoy) y técnico (por defecto todos).
  const [fecha, setFecha]         = useState(hoyISO())
  const [idTecnico, setIdTecnico] = useState('')

  // Técnicos apagados desde el panel lateral. Se guardan los ocultos y no los
  // visibles para que un técnico nuevo aparezca marcado sin tocar nada.
  const [ocultos, setOcultos] = useState(() => new Set())

  const alternarTecnico = (id) => {
    setOcultos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  const esHoy = fecha === hoyISO()

  // El selector de técnico se llena con TODOS los técnicos activos, no solo
  // con los que hoy tienen trabajo: el supervisor lo usa también para
  // comprobar que a alguien no le quedó nada asignado.
  useEffect(() => {
    let vigente = true
    getTecnicosDisponibles()
      .then((lista) => { if (vigente) setTecnicos(lista) })
      .catch(() => { if (vigente) setTecnicos([]) })
    return () => { vigente = false }
  }, [])

  const fetchTareas = useCallback(async () => {
    try {
      setError(null)
      const lista = await getMapaSupervisor(fecha)
      setTareas(lista.map(tareaAServicio))
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar el mapa del equipo.')
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    fetchTareas()
  }, [fetchTareas])

  // Tareas que pasan el filtro de técnico, tengan o no coordenadas (se usa
  // para el aviso de "sin ubicación"). La fecha ya la recortó el backend.
  //
  // El filtro por técnico se aplica aquí y no en la petición para no perder
  // de vista los conteos de las otras capas al cambiarlo.
  const filtradas = useMemo(() => {
    if (!idTecnico) return tareas
    return tareas.filter((s) => String(s.tecnico?.id_empleado) === idTecnico)
  }, [tareas, idTecnico])

  const conUbicacion = useMemo(
    () => filtradas.filter((s) => s.lat != null && s.lng != null),
    [filtradas]
  )
  const sinUbicacion = filtradas.length - conUbicacion.length
  const puntos = useMemo(() => conUbicacion.map((s) => [s.lat, s.lng]), [conUbicacion])

  // Agrupado por técnico para el panel lateral: una entrada por técnico, más
  // "Sin asignar" para las tareas que no tienen técnico. Se agrupa sobre
  // `conUbicacion` porque solo eso es lo que puede pintarse en el mapa.
  const grupos = useMemo(() => {
    const mapa = new Map()
    for (const s of conUbicacion) {
      const key = s.tecnico?.id_empleado ?? 'sin-asignar'
      if (!mapa.has(key)) {
        mapa.set(key, {
          id: key,
          nombre: s.tecnico?.nombre ?? 'Sin técnico asignado',
          servicios: [],
        })
      }
      mapa.get(key).servicios.push(s)
    }
    // Orden alfabético, con "Sin técnico asignado" siempre al final.
    return Array.from(mapa.values()).sort((a, b) => {
      if (a.id === 'sin-asignar') return 1
      if (b.id === 'sin-asignar') return -1
      return a.nombre.localeCompare(b.nombre)
    })
  }, [conUbicacion])

  // Lo que realmente se pinta: lo que tiene ubicación menos los técnicos que
  // el supervisor apagó en el panel.
  const visibles = useMemo(
    () => conUbicacion.filter(
      (s) => !ocultos.has(s.tecnico?.id_empleado ?? 'sin-asignar')
    ),
    [conUbicacion, ocultos]
  )

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando el mapa del equipo..."
        error={error}
        onRetry={fetchTareas}
        errorTitle="No se pudo cargar el mapa"
      />
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>Mapa</h1>
        <p className={styles.subtitle}>
          Dónde está el trabajo del día, por técnico
        </p>
      </header>

      {/* ── Filtros ── */}
      <section className={styles.filtros}>
        <label className={styles.filtroCampo}>
          <span className={styles.filtroLabel}>Fecha</span>
          <input
            type="date"
            className={styles.input}
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyISO())}
          />
        </label>

        <label className={styles.filtroCampo}>
          <span className={styles.filtroLabel}>Técnico</span>
          <select
            className={styles.select}
            value={idTecnico}
            onChange={(e) => setIdTecnico(e.target.value)}
          >
            <option value="">Todos</option>
            {tecnicos.map((t) => (
              <option key={t.id_empleado} value={t.id_empleado}>
                {t.nombre_completo}
              </option>
            ))}
          </select>
        </label>
      </section>

      {conUbicacion.length > 0 ? (
        <div className={styles.mapaLayout}>
          <div className={styles.mapWrap}>
            <MapaBase>
              <AjustarVistaMarcadores puntos={puntos} />

              {visibles.map((s) => (
                <MarcadorTareaSupervisor key={s.id_servicio} servicio={s} />
              ))}
            </MapaBase>
          </div>

          {/* Panel lateral: a la derecha del mapa en pantalla ancha, encima
              del mapa en móvil. */}
          <aside className={styles.panelLateral}>
            {/* HU-166: contador de tareas visibles + leyenda por estado. */}
            <LeyendaMapaSupervisor
              servicios={visibles}
              estados={esHoy ? ESTADOS_HOY : ESTADOS_DIA_PASADO}
            />

            <FiltroTecnicosMapa
              grupos={grupos}
              ocultos={ocultos}
              onAlternar={alternarTecnico}
            />
          </aside>
        </div>
      ) : (
        <PageState
          empty
          emptyIcon={<IconMapa />}
          emptyTitle="Sin tareas para mostrar"
          emptyDescription={
            esHoy
              ? 'No hay tareas con ubicación registrada que coincidan con el técnico seleccionado.'
              : 'Ese día no se cerró ninguna tarea con ubicación registrada.'
          }
        />
      )}

      {sinUbicacion > 0 && (
        <p className={styles.avisoSinUbicacion}>
          {sinUbicacion} {sinUbicacion === 1 ? 'tarea' : 'tareas'} sin ubicación registrada
          {sinUbicacion === 1 ? ' no aparece' : ' no aparecen'} en el mapa.
        </p>
      )}
    </div>
  )
}
