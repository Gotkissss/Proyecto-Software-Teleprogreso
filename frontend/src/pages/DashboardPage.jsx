/**
 * pages/DashboardPage.jsx
 * ---------------------------------------------------------------------------
 * Dashboard principal del supervisor.
 * Muestra: el avance del día, las cifras de técnicos y tareas, quién está en
 * jornada y, al lado, dónde anda hoy cada técnico (<MapaEquipoHoy>).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../api/client'
import { getUbicacionesTecnicos } from '../api/ubicacionService'
import { Entra, NumeroAnimado } from '../anim/Entra'
import { useAuth } from '../context/AuthContext'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageState from '../components/ui/PageState'
import MapaEquipoHoy from '../components/mapa/MapaEquipoHoy'
import { contarTareas } from '../utils/plural'
import { fechaLarga, hace, proporcion, repartoDelDia, saludoPorHora } from '../utils/panel'
import styles from './DashboardPage.module.css'

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
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  // Dónde está hoy cada técnico (mapa del panel). El fallo se guarda aparte y
  // no corta la carga: el panel sirve igual sin el mapa, y antes un 500 de
  // esta llamada habría dejado la pantalla entera en el estado de error.
  const [ubicaciones,      setUbicaciones]      = useState([])
  const [errorUbicaciones, setErrorUbicaciones] = useState(false)
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
        const [metricas, tecnicos, mapa] = await Promise.all([
            fetchMetricasReal(),
            fetchTecnicosReal(),
            // El mapa es secundario: si falla, se queda el aviso dentro de su
            // tarjeta y el resto del panel entra igual.
            getUbicacionesTecnicos({ alcance: 'dia' }).then(
              (puntos) => ({ puntos }),
              () => ({ puntos: [], fallo: true }),
            ),
          ])
          setMetricas(metricas)
          setTecnicosList(tecnicos)
          setUbicaciones(mapa.puntos)
          setErrorUbicaciones(Boolean(mapa.fallo))
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
        skeleton="dashboard"
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

      {/* Los dos bloques van uno al lado del otro cuando la pantalla da de sí:
          la lista de quién está en jornada y el mapa de dónde está cada uno
          cuentan lo mismo, y leerlos juntos es lo que los hace útiles.
          Apilados dejaban media pantalla en blanco a la derecha. */}
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

      {/* ── Dónde está el equipo ──
          Ocupa el sitio que tenía "Tareas recientes", que repetía en cinco
          filas lo que ya dicen las tarjetas de arriba y la pantalla de
          Reasignación entera. El mapa, en cambio, responde algo que el panel
          no contestaba en ninguna parte: dónde anda la gente ahora mismo. */}
      <Entra as="section" turno={8} className={styles.section}>
        <MapaEquipoHoy puntos={ubicaciones} error={errorUbicaciones} />
      </Entra>

      </div>

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
