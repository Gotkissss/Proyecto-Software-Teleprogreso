/**
 * HU-165 — Vista "Mapa" en SupervisorLayout: todas las tareas del equipo
 * sobre un mapa, agrupadas por técnico (con casillas para mostrar/ocultar
 * a cada uno) y con filtros de fecha y de técnico.
 *
 * Reutiliza <MapaBase> igual que MapaPage (vista del técnico), pero:
 *   - Colorea los pines por ESTADO (no por prioridad) — ver
 *     MarcadorTareaSupervisor + estadoColor.js.
 *   - Agrupa los marcadores por técnico dentro de <LayerGroup>, expuestos
 *     como capas independientes en un <LayersControl> nativo de Leaflet:
 *     el supervisor puede apagar/encender técnicos concretos sin perder
 *     de vista el resto del mapa.
 *   - Trae TODAS las tareas del equipo (GET /tareas sin id_tecnico: el
 *     backend ya permite eso a supervisor/admin/gerente, ver
 *     routers/tareas.py) y filtra en el cliente por fecha/técnico, para
 *     no perder los conteos de las otras capas al cambiar un filtro.
 *
 * HU-166 (leyenda + contador) se agrega como overlay sobre el propio mapa
 * vía <LeyendaMapaSupervisor>, dentro del mismo contenedor con position:relative
 * que envuelve a <MapaBase>.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayerGroup, LayersControl } from 'react-leaflet'
import { getTareas, getTecnicosDisponibles } from '../api/tareaService'
import MapaBase from '../components/mapa/MapaBase'
import MarcadorTareaSupervisor from '../components/mapa/MarcadorTareaSupervisor'
import AjustarVistaMarcadores from '../components/mapa/AjustarVistaMarcadores'
import LeyendaMapaSupervisor from '../components/mapa/LeyendaMapaSupervisor'
import PageState from '../components/ui/PageState'
import styles from './MapaSupervisorPage.module.css'

const IconMapa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)

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

/** Date → "YYYY-MM-DD" en hora local. */
function aISO(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

/** "2026-07-31T10:00:00" → "2026-07-31" (o null si no hay fecha). */
function soloFecha(fechaHora) {
  return fechaHora ? String(fechaHora).slice(0, 10) : null
}

/**
 * ¿Esta tarea está vigente en `fechaISO`?
 * Vigente = fechaISO cae dentro de [fecha_inicio, fecha_finalizacion]. Si
 * falta fecha_inicio se usa fecha_asignacion como respaldo, y si falta
 * fecha_finalizacion se asume que dura un solo día (el mismo del inicio).
 * Una tarea sin ninguna fecha registrada no se oculta: se asume vigente
 * en vez de desaparecer del mapa por datos incompletos.
 */
function tareaVigenteEnFecha(tarea, fechaISO) {
  const inicio = soloFecha(tarea.fecha_inicio) ?? soloFecha(tarea.fecha_asignacion)
  if (!inicio) return true
  const fin = soloFecha(tarea.fecha_finalizacion) ?? inicio
  return fechaISO >= inicio && fechaISO <= fin
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
    fecha_inicio:        t.fecha_inicio ?? null,
    fecha_finalizacion:  t.fecha_finalizacion ?? null,
    fecha_asignacion:    t.fecha_asignacion ?? null,
  }
}

export default function MapaSupervisorPage() {
  const [tareas, setTareas]     = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  // Filtros: fecha (por defecto hoy) y técnico (por defecto todos).
  const [fecha, setFecha]         = useState(aISO(new Date()))
  const [idTecnico, setIdTecnico] = useState('')

  const fetchDatos = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      // Sin id_tecnico: el backend devuelve todo el equipo a supervisor/
      // admin/gerente (ver routers/tareas.py). El filtro por técnico se
      // aplica en el cliente junto con el de fecha, para no perder de vista
      // los conteos por técnico al cambiar de filtro.
      const [listaTareas, listaTecnicos] = await Promise.all([
        getTareas(),
        getTecnicosDisponibles(),
      ])
      setTareas(Array.isArray(listaTareas) ? listaTareas.map(tareaAServicio) : [])
      setTecnicos(listaTecnicos)
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar el mapa del equipo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDatos()
  }, [fetchDatos])

  // Tareas que pasan los filtros de fecha/técnico, tengan o no coordenadas
  // (se usa para mensajes de "sin ubicación").
  const filtradas = useMemo(() => {
    return tareas
      .filter((s) => tareaVigenteEnFecha(s, fecha))
      .filter((s) => !idTecnico || String(s.tecnico?.id_empleado) === idTecnico)
  }, [tareas, fecha, idTecnico])

  const conUbicacion = useMemo(
    () => filtradas.filter((s) => s.lat != null && s.lng != null),
    [filtradas]
  )
  const sinUbicacion = filtradas.length - conUbicacion.length
  const puntos = useMemo(() => conUbicacion.map((s) => [s.lat, s.lng]), [conUbicacion])

  // Agrupado por técnico: una capa (LayerGroup) por técnico, más "Sin
  // asignar" para las tareas que no tienen técnico. Se agrupa sobre
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

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando el mapa del equipo..."
        error={error}
        onRetry={fetchDatos}
        errorTitle="No se pudo cargar el mapa"
      />
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mapa</h1>
        <p className={styles.subtitle}>
          Ubicación de las tareas del equipo, agrupadas por técnico.
        </p>
      </header>

      {/* ── Filtros ── */}
      <section className={styles.filtros}>
        <label className={styles.filtroCampo}>
          <span>Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>

        <label className={styles.filtroCampo}>
          <span>Técnico</span>
          <select
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
        <div className={styles.mapWrap}>
          <MapaBase>
            <AjustarVistaMarcadores puntos={puntos} />

            <LayersControl position="topright">
              {grupos.map((g) => (
                <LayersControl.Overlay
                  key={g.id}
                  name={`${g.nombre} (${g.servicios.length})`}
                  checked
                >
                  <LayerGroup>
                    {g.servicios.map((s) => (
                      <MarcadorTareaSupervisor key={s.id_servicio} servicio={s} />
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
              ))}
            </LayersControl>
          </MapaBase>

          {/* HU-166: leyenda de colores por estado + contador de tareas
              visibles, superpuesta sobre el propio mapa. */}
          <LeyendaMapaSupervisor servicios={conUbicacion} />
        </div>
      ) : (
        <PageState
          empty
          emptyIcon={<IconMapa />}
          emptyTitle="Sin tareas para mostrar"
          emptyDescription="No hay tareas con ubicación que coincidan con la fecha y el técnico seleccionados."
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