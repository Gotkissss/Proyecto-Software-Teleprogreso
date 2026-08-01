/**
 * pages/HistorialTareasPage.jsx
 * ---------------------------------------------------------------------------
 * "Lo que se hizo, por día."
 *
 * Faltaba una pantalla donde ver el trabajo cerrado: el panel del supervisor
 * solo muestra las últimas cinco tareas y la ruta del técnico solo el día en
 * curso, así que nadie podía revisar lo hecho ayer o la semana pasada.
 *
 * La misma pantalla sirve a los dos roles y se monta en dos rutas:
 *   /supervisor/historial-tareas → historial de todo el equipo, con filtro
 *                                  por técnico.
 *   /historial                   → el técnico ve solo lo suyo (el backend
 *                                  fuerza el filtro por el token, no por la UI).
 *
 * El agrupado por día lo hace el backend sobre `fecha_completado`, que es el
 * momento real del cierre.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { urlArchivo } from '../api/client'
import { getTareasCompletadas } from '../api/rutaService'
import { getTecnicosDisponibles } from '../api/tareaService'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageState from '../components/ui/PageState'
import styles from './HistorialTareasPage.module.css'

const ROLES_SUPERVISION = ['admin', 'supervisor', 'gerente']

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
)
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
)

/* ── Helpers de fecha ─────────────────────────────────────────────────────── */

/** Date → "YYYY-MM-DD" en hora local (toISOString desplazaría el día). */
function aISO(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

function hace(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return aISO(d)
}

/** "2026-07-31" → "Hoy", "Ayer" o "viernes, 31 de julio". */
function etiquetaDia(iso) {
  if (iso === aISO(new Date())) return 'Hoy'
  if (iso === hace(1)) return 'Ayer'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-GT', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function horaDe(isoDateTime) {
  if (!isoDateTime) return ''
  return new Date(isoDateTime).toLocaleTimeString('es-GT', {
    hour: '2-digit', minute: '2-digit',
  })
}

/* ── Tarjeta de una tarea cerrada ─────────────────────────────────────────── */

function TareaCompletadaCard({ tarea, mostrarTecnico }) {
  const [fotoAmpliada, setFotoAmpliada] = useState(null)

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.checkIcon}><IconCheck /></span>
        <div className={styles.cardTitulo}>
          <h4>{tarea.titulo}</h4>
          <span className={styles.cardHora}>
            Cerrada a las {horaDe(tarea.fecha_completado)}
          </span>
        </div>
        <Badge label={tarea.prioridad} />
      </div>

      <div className={styles.cardMeta}>
        {tarea.direccion_servicio && (
          <span className={styles.metaItem}>
            <IconPin /> {tarea.direccion_servicio}
          </span>
        )}
        {mostrarTecnico && tarea.tecnico && (
          <span className={styles.metaItem}>
            <IconUser /> {tarea.tecnico.nombre}
          </span>
        )}
      </div>

      {tarea.evidencias?.length > 0 ? (
        <div className={styles.evidencias}>
          {tarea.evidencias.map((ev) => (
            <div key={ev.id_incidencia} className={styles.evidencia}>
              {ev.foto_evidencia && (
                <button
                  type="button"
                  className={styles.fotoBtn}
                  onClick={() => setFotoAmpliada(urlArchivo(ev.foto_evidencia))}
                  title="Ver la foto en grande"
                >
                  <img
                    src={urlArchivo(ev.foto_evidencia)}
                    alt={`Evidencia de ${tarea.titulo}`}
                    loading="lazy"
                  />
                </button>
              )}
              <p className={styles.evidenciaTexto}>{ev.descripcion}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.sinEvidencia}>Sin evidencia registrada.</p>
      )}

      {/* Visor simple: click fuera para cerrar. */}
      {fotoAmpliada && (
        <div
          className={styles.lightbox}
          role="presentation"
          onClick={() => setFotoAmpliada(null)}
        >
          <img src={fotoAmpliada} alt="Evidencia ampliada" />
        </div>
      )}
    </article>
  )
}

/* ── Pantalla ─────────────────────────────────────────────────────────────── */

export default function HistorialTareasPage() {
  const { user } = useAuth()
  const esSupervision = ROLES_SUPERVISION.includes(user?.rol)

  const [desde, setDesde] = useState(hace(6))
  const [hasta, setHasta] = useState(aISO(new Date()))
  const [idTecnico, setIdTecnico] = useState('')
  const [tecnicos, setTecnicos] = useState([])

  const [historial, setHistorial] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchHistorial = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const data = await getTareasCompletadas({
        fecha_desde: desde,
        fecha_hasta: hasta,
        id_tecnico: esSupervision && idTecnico ? Number(idTecnico) : undefined,
      })
      setHistorial(data)
    } catch (err) {
      setError(
        err?.response?.data?.detail || 'No se pudo cargar el historial de tareas.'
      )
    } finally {
      setLoading(false)
    }
  }, [desde, hasta, idTecnico, esSupervision])

  useEffect(() => {
    fetchHistorial()
  }, [fetchHistorial])

  // El selector de técnicos solo tiene sentido —y solo está permitido— para
  // los roles de supervisión; si falla, la pantalla sigue funcionando sin él.
  useEffect(() => {
    if (!esSupervision) return
    getTecnicosDisponibles()
      .then(setTecnicos)
      .catch(() => setTecnicos([]))
  }, [esSupervision])

  const totalEvidencias = useMemo(
    () =>
      (historial?.dias ?? []).reduce(
        (acc, dia) =>
          acc + dia.tareas.reduce((n, t) => n + (t.evidencias?.length ?? 0), 0),
        0
      ),
    [historial]
  )

  const aplicarRango = (dias) => {
    setDesde(hace(dias - 1))
    setHasta(aISO(new Date()))
  }

  if (loading || (error && !historial)) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando el historial..."
        error={error}
        onRetry={fetchHistorial}
        errorTitle="No se pudo cargar el historial"
      />
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Tareas realizadas</h1>
        <p className={styles.subtitle}>
          {esSupervision
            ? 'Todo el trabajo cerrado por el equipo, día por día, con su evidencia.'
            : 'Todo lo que has completado, día por día.'}
        </p>
      </header>

      {/* ── Filtros ── */}
      <section className={styles.filtros}>
        <div className={styles.atajos}>
          <button type="button" onClick={() => aplicarRango(1)}>Hoy</button>
          <button type="button" onClick={() => aplicarRango(7)}>7 días</button>
          <button type="button" onClick={() => aplicarRango(30)}>30 días</button>
        </div>

        <label className={styles.filtroCampo}>
          <span>Desde</span>
          <input
            type="date"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>

        <label className={styles.filtroCampo}>
          <span>Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde}
            max={aISO(new Date())}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>

        {esSupervision && tecnicos.length > 0 && (
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
        )}
      </section>

      {/* ── Resumen del rango ── */}
      <section className={styles.resumen}>
        <div className={styles.resumenItem}>
          <span className={styles.resumenValor}>{historial?.total ?? 0}</span>
          <span className={styles.resumenLabel}>TAREAS COMPLETADAS</span>
        </div>
        <div className={styles.resumenDivider} />
        <div className={styles.resumenItem}>
          <span className={styles.resumenValor}>{historial?.dias?.length ?? 0}</span>
          <span className={styles.resumenLabel}>DÍAS CON ACTIVIDAD</span>
        </div>
        <div className={styles.resumenDivider} />
        <div className={styles.resumenItem}>
          <span className={styles.resumenValor}>{totalEvidencias}</span>
          <span className={styles.resumenLabel}>EVIDENCIAS</span>
        </div>
      </section>

      {/* ── Días ── */}
      {historial?.dias?.length > 0 ? (
        <div className={styles.dias}>
          {historial.dias.map((dia) => (
            <section key={dia.fecha} className={styles.dia}>
              <div className={styles.diaHeader}>
                <h2 className={styles.diaTitulo}>{etiquetaDia(dia.fecha)}</h2>
                <span className={styles.diaConteo}>
                  {dia.total} {dia.total === 1 ? 'tarea' : 'tareas'}
                </span>
              </div>
              <div className={styles.diaLista}>
                {dia.tareas.map((tarea) => (
                  <TareaCompletadaCard
                    key={tarea.id_tarea}
                    tarea={tarea}
                    mostrarTecnico={esSupervision}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Sin tareas completadas en este rango"
          description="Prueba a ampliar las fechas o a quitar el filtro de técnico."
        />
      )}
    </div>
  )
}
