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
import { Entra, NumeroAnimado } from '../anim/Entra'
import { useAuth } from '../context/AuthContext'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageState from '../components/ui/PageState'
import ModalDetalleTarea from '../components/tareas/ModalDetalleTarea'
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import { etiquetaEstado, variantePorEstado } from '../components/mapa/estadoColor'
import { contarTareas } from '../utils/plural'
import { fechaLarga, hace, proporcion, repartoDelDia, saludoPorHora } from '../utils/panel'
import { describirVencimiento } from '../utils/vencimiento'
import styles from './DashboardPage.module.css'

const IconFoto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

const IconRefrescar = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <polyline points="21 3 21 9 15 9" />
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
  const { user } = useAuth()

  const [metricas,      setMetricas]      = useState(null)
  const [tecnicosList,  setTecnicosList]  = useState([])
  const [tareasList,    setTareasList]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  // Tarea cuyas evidencias está revisando el supervisor (SCRUM-141/142)
  const [tareaEvidencias, setTareaEvidencias] = useState(null)
  // Tarea abierta en la ficha de detalle (clic en la tarjeta)
  const [tareaDetalle, setTareaDetalle] = useState(null)
  // Cuando se cargaron estos datos, y un reloj que avanza para poder decirlo.
  // El panel no se refresca solo: sin esto, alguien puede decidir con cifras
  // de hace dos horas creyendo que son de ahora.
  const [cargadoEn, setCargadoEn] = useState(null)
  const [ahora, setAhora] = useState(() => Date.now())


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
          setCargadoEn(Date.now())
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

  // Medio minuto es el paso más largo que deja pasar de "hace un momento" a
  // "hace 1 min" sin que se note el salto. No pide nada al servidor: solo
  // mueve el reloj con el que se escribe esa frase.
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 30000)
    return () => clearInterval(reloj)
  }, [])


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

  const primerNombre = (user?.nombre || 'supervisor').split(' ')[0]
  const desdeCuando  = hace(cargadoEn, ahora) ?? 'ahora mismo'
  const reparto      = repartoDelDia(metricas)

  return (
    <div className={styles.page}>
      <Entra turno={0} className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Panel de control</h1>
          {/* Antes aquí decía "en tiempo real", y no lo es: el panel carga al
              entrar y no vuelve a pedir nada. Ahora dice de cuándo son las
              cifras, que es lo que de verdad hace falta saber para fiarse de
              ellas. */}
          <p className={styles.subtitle}>
            {saludoPorHora()}, {primerNombre} · <span className={styles.fecha}>{fechaLarga()}</span>
          </p>
        </div>

        {/* La exportación de reportes se mudó a la pantalla de Reportes
            (HU-S9-04), que es de admin y gerente: el Excel exige el mismo
            rol que el reporte que contiene. */}
        <div className={styles.frescura}>
          <span className={styles.pulso} aria-hidden="true" />
          <span className={styles.frescuraTexto}>Actualizado {desdeCuando}</span>
          <button
            type="button"
            className={styles.refrescarBtn}
            onClick={fetchData}
            title="Volver a pedir los datos"
          >
            <IconRefrescar />
            <span className={styles.refrescarTexto}>Actualizar</span>
          </button>
        </div>
      </Entra>

      {/* ── Avance del día ──
          Las cuatro cifras de arriba, en una sola imagen. No añade ningún
          dato: reparte los que ya están, que es lo que deja ver de un vistazo
          si el día va bien o va justo. */}
      <AvanceDelDia reparto={reparto} turno={1} />

      {/* ── Métricas ── */}
      {/* Las tarjetas caen de plano y se enderezan una tras otra, y cada cifra
          cuenta desde cero hasta su valor: es lo primero que se mira al entrar
          y lo que hace que el panel se lea como algo vivo. El turno va a mano
          porque es el que encadena la tarjeta con el conteo de su cifra. */}
      <section className={styles.metricsGrid}>
        {/* Antes esta tarjeta decía "Técnicos activos" y, si el backend
            devolvía 0, mostraba el total de la plantilla. Resultado: el número
            no cuadraba con la lista de abajo. Ahora dice explícitamente
            cuántos están en jornada sobre el total. */}
        <MetricCard
          turno={2}
          label="Técnicos en jornada"
          value={metricas?.tecnicos_en_jornada ?? 0}
          parteDe={metricas?.tecnicos_total ?? null}
          suffix={metricas?.tecnicos_total ? `de ${metricas.tecnicos_total}` : null}
          variant="info"
        />
        <MetricCard
          turno={3}
          label="Completadas hoy"
          value={metricas?.tareas_completadas_hoy ?? 0}
          parteDe={reparto.total || null}
          suffix={
            metricas?.tareas_completadas_total
              ? `${metricas.tareas_completadas_total} en total`
              : null
          }
          variant="success"
          onClick={() => navigate('/supervisor/historial-tareas')}
          clickable
        />
        {/* RTF-01 / R2-1: faltaba la tarjeta de las tareas en curso, así que
            el panel decía «Tareas pendientes: 0» mientras había dos en marcha
            y vencidas. Una tarea empezada no estaba en «pendientes» (ya no lo
            está) ni en «completadas» (todavía no): no aparecía en ninguna
            parte, y los números no cuadraban entre sí. El sufijo con el total
            de abiertas es lo que deja comprobar la suma de un vistazo. */}
        <MetricCard
          turno={4}
          label="Pendientes"
          value={metricas?.tareas_pendientes ?? 0}
          suffix={
            metricas?.tareas_activas
              ? `${metricas.tareas_activas} abiertas`
              : null
          }
          variant="warning"
        />
        <MetricCard
          turno={5}
          label="En curso"
          value={metricas?.tareas_en_progreso ?? 0}
          variant="info"
        />
        <MetricCard
          turno={6}
          label="En retraso"
          value={metricas?.tareas_retrasadas ?? 0}
          parteDe={metricas?.tareas_activas ?? null}
          /* «De las abiertas»: es un subconjunto de pendientes + en curso, no
             una cuarta categoría. Sin decirlo, el que suma las cuatro
             tarjetas obtiene más tareas de las que hay. */
          suffix="de las abiertas"
          variant="danger"
          onClick={() => navigate('/supervisor/alertas')}
          clickable
        />
      </section>

      {/* Los dos bloques van uno al lado del otro cuando la pantalla da de sí.
          Apilados dejaban media pantalla en blanco a la derecha y obligaban a
          bajar para ver las tareas del día. */}
      <div className={styles.panelesGrid}>

      {/* ── Técnicos ── */}
      <Entra as="section" turno={7} className={styles.section}>
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
                    {/* RTF-01 / R2-9: decía «1 tareas activas». */}
                    {contarTareas(tec.tareas_asignadas ?? 0)}
                    {tec.alLimite && ' · al límite'}
                  </span>
                </div>
                <Badge {...estadoJornada(tec)} />
              </li>
            ))}
          </ul>
        )}
      </Entra>

      {/* ── Tareas recientes ── */}
      <Entra as="section" turno={8} className={styles.section}>
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
                      className={`btn btn-secondary btn-sm ${styles.evidenciasBtn}`}
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
                  {/* RTF-01 / R2-8: salía el valor crudo del backend
                      («en_progreso») porque se pasaba `tarea.estado` tal cual.
                      Las dos cosas —texto y color— vienen ahora del mismo sitio
                      que el resto de la aplicación. */}
                  <Badge
                    label={etiquetaEstado(tarea.estado)}
                    variant={variantePorEstado(tarea.estado)}
                  />
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </Entra>

      </div>

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

/**
 * El día en una barra: lo cerrado, lo que está en marcha y lo que espera.
 *
 * No pide nada nuevo al backend; reparte las cifras que ya tienen las
 * tarjetas de arriba. Las retrasadas se señalan aparte y no suman al total,
 * porque son un subconjunto de pendientes y en curso: contarlas como cuarto
 * tramo daría un porcentaje que no cuadra con las tarjetas.
 */
function AvanceDelDia({ reparto, turno = 0 }) {
  const { completadas, enCurso, pendientes, retrasadas, total, porcentaje } = reparto

  // Sin trabajo hoy no hay nada que repartir, y una barra vacía al 0 % se lee
  // como "vas muy mal" en vez de "no hay tareas".
  if (total === 0) return null

  const tramos = [
    { clave: 'completadas', n: completadas, etiqueta: 'completadas' },
    { clave: 'enCurso',     n: enCurso,     etiqueta: 'en curso' },
    { clave: 'pendientes',  n: pendientes,  etiqueta: 'pendientes' },
  ].filter((tramo) => tramo.n > 0)

  return (
    <Entra turno={turno} className={styles.avance}>
      <div className={styles.avanceCabecera}>
        <h2 className={styles.avanceTitulo}>Avance del día</h2>
        <span className={styles.avancePorcentaje}>
          <NumeroAnimado valor={porcentaje} turno={turno} formato={(n) => `${Math.round(n)} %`} />
        </span>
      </div>

      {/* La barra se dibuja de izquierda a derecha con `scaleX`, que el
          navegador resuelve en la GPU; animar el ancho de cada tramo
          obligaría a rehacer el layout en cada fotograma. */}
      <Entra
        desde="barra"
        turno={turno}
        className={styles.avanceBarra}
        role="img"
        aria-label={`${completadas} de ${total} tareas completadas hoy`}
      >
        {tramos.map((tramo) => (
          <span
            key={tramo.clave}
            className={`${styles.avanceTramo} ${styles[`tramo_${tramo.clave}`]}`}
            style={{ flexGrow: tramo.n }}
          />
        ))}
      </Entra>

      <div className={styles.avanceLeyenda}>
        {tramos.map((tramo) => (
          <span key={tramo.clave} className={styles.avanceItem}>
            <span className={`${styles.avancePunto} ${styles[`tramo_${tramo.clave}`]}`} />
            {tramo.n} {tramo.etiqueta}
          </span>
        ))}
        {retrasadas > 0 && (
          <span className={`${styles.avanceItem} ${styles.avanceRetraso}`}>
            {retrasadas} en retraso
          </span>
        )}
      </div>
    </Entra>
  )
}

/**
 * `parteDe` es el total con el que se compara la cifra, y solo se pasa cuando
 * existe de verdad: "3 técnicos en jornada" es parte de la plantilla, pero
 * "4 tareas en curso" no es parte de nada en concreto. Sin total no se pinta
 * barra, porque una barra obliga a elegir un denominador y uno inventado se
 * lee como un dato.
 */
function MetricCard({ label, value, variant, onClick, clickable, suffix, turno = 0, parteDe = null }) {
  const parte = proporcion(value, parteDe)

  return (
    <Entra
      desde="cae"
      turno={turno}
      className={`${styles.metricCard} ${styles[variant]} ${clickable ? styles.clickable : ''}`}
      onClick={onClick}
    >
      <span className={styles.metricValue}>
        <NumeroAnimado valor={value} turno={turno} />
      </span>
      <span className={styles.metricLabel}>{label}</span>
      {/* Contexto del número (p. ej. "de 5"), para que la cifra no se lea
          suelta y se pueda contrastar con las listas de abajo. */}
      {suffix && <span className={styles.metricSuffix}>{suffix}</span>}

      {parte !== null && (
        <span className={styles.metricPista} aria-hidden="true">
          <Entra
            desde="barra"
            turno={turno}
            className={styles.metricPistaRelleno}
            style={{ width: `${parte * 100}%` }}
          />
        </span>
      )}
    </Entra>
  )
}
