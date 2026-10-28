/**
 * pages/AlertasPage.jsx
 * ---------------------------------------------------------------------------
 * Gestión de alertas operativas del supervisor.
 * Muestra:
 *   1. Alertas persistentes generadas por el backend (GET/PATCH /alertas):
 *      tareas vencidas, técnicos sin marcar entrada, stock crítico.
 *   2. Sección "Stock crítico" con materiales bajo el mínimo definido
 *      (GET /activos/materiales/bajo-stock, vía api/inventarioService)
 *   3. Solo para el admin, "Seguridad": las alertas que el backend levanta
 *      leyendo la bitácora (HU-S10-05), con un enlace a la bitácora filtrada
 *      para investigarlas. A los demás roles el backend ni se las envía.
 *
 * Ambas secciones consumen endpoints reales del backend. No hay datos mock
 * ni flags de features pendientes: las alertas se generan y persisten en el
 * servidor (app/services/alertas.py), el frontend solo las lista y permite
 * atenderlas/descartarlas.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import PageState from '../components/ui/PageState'
import StockBadge from '../components/ui/StockBadge'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../context/AuthContext'
import {
  ESTADO_ALERTA,
  TIPO_ALERTA,
  actualizarEstadoAlerta,
  describirErrorAlertas,
  esAlertaSeguridad,
  getAlertas,
} from '../api/alertaService'
import { getMaterialesBajoStock } from '../api/inventarioService'
import {
  TIPO_ALERTA_SEGURIDAD_INFO,
  describirAlertaSeguridad,
  enlaceBitacora,
} from '../utils/alertasSeguridad'
import { ROLES, puedeOperar } from '../utils/permisos'
import { calcularPorcentajeStock, clasificarStock } from '../utils/stock'
import styles from './AlertasPage.module.css'

/*  Helpers */
const formatHora = (isoString) => {
  const fecha = new Date(isoString)
  const ahora = new Date()
  const diffMin = Math.floor((ahora - fecha) / (1000 * 60))
  if (diffMin < 1)  return 'Hace un momento'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `Hace ${diffH} h`
  return fecha.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })
}

/**
 * Metadatos para traducir el `tipo` persistido por el backend en un mensaje
 * legible. El backend solo entrega { tipo, severidad, estado, referencia,
 * fecha } — la referencia tiene forma "entidad:id" (ver services/alertas.py).
 */
const TIPO_ALERTA_INFO = {
  tarea_vencida: {
    label: 'Tarea vencida',
    describir: (nombre) => `«${nombre}» venció su fecha de finalización y sigue activa.`,
    sinNombre: (id) => `La tarea #${id} venció su fecha de finalización y sigue activa.`,
  },
  tecnico_sin_entrada: {
    label: 'Técnico sin entrada',
    describir: (nombre) => `${nombre} no ha marcado su entrada el día de hoy.`,
    sinNombre: (id) => `El empleado #${id} no ha marcado su entrada el día de hoy.`,
  },
  stock_critico: {
    label: 'Stock crítico',
    describir: (nombre) => `«${nombre}» está por debajo del stock mínimo.`,
    sinNombre: (id) => `El material #${id} está por debajo del stock mínimo.`,
  },
}

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

const IconStock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
)

/** Filtros de estado disponibles en la pestaña de alertas operativas. */
const FILTROS_ESTADO = [
  { value: ESTADO_ALERTA.PENDIENTE,  label: 'Pendientes' },
  { value: ESTADO_ALERTA.ATENDIDA,   label: 'Atendidas' },
  { value: ESTADO_ALERTA.RESUELTA,   label: 'Resueltas solas' },
  { value: ESTADO_ALERTA.DESCARTADA, label: 'Descartadas' },
  { value: 'todas',                  label: 'Todas' },
]

function parseReferencia(referencia) {
  if (!referencia) return { entidad: null, id: null }
  const [entidad, id] = referencia.split(':')
  return { entidad, id }
}

/**
 * Mensaje de la alerta.
 *
 * El backend ya resuelve `referencia_label` al nombre real (título de la
 * tarea, nombre del técnico o del material). Si por alguna razón no viniera
 * —la entidad se borró, por ejemplo— se cae al id crudo en vez de dejar la
 * tarjeta sin texto.
 */
function describirAlerta(alerta) {
  const deSeguridad = describirAlertaSeguridad(alerta)
  if (deSeguridad) return deSeguridad

  const info = TIPO_ALERTA_INFO[alerta.tipo]
  if (!info) return `Alerta: ${alerta.tipo}`

  if (alerta.referencia_label) return info.describir(alerta.referencia_label)

  const { id } = parseReferencia(alerta.referencia)
  return id ? info.sinNombre(id) : info.label
}

/*
   SUB-COMPONENTE: Tarjeta de Material con Stock Bajo
    */
function MaterialStockCard({ material }) {
  const { cantidad_disponible: disponible, stock_minimo: minimo } = material
  const nivel      = clasificarStock(disponible, minimo)
  const porcentaje = calcularPorcentajeStock(disponible, minimo)

  const barColor =
    nivel === 'critico' ? 'var(--color-danger)'
    : nivel === 'bajo'  ? 'var(--color-warning)'
    :                     'var(--color-success)'

  const deficit = minimo - disponible

  return (
    <div className={`${styles.stockCard} ${styles[`stockCard_${nivel}`]}`}>
      {/* Cabecera */}
      <div className={styles.stockCardHeader}>
        <div className={styles.stockCardInfo}>
          <span className={styles.stockCardNombre}>{material.nombre_activo}</span>
          {material.tipo_material && (
            <span className={styles.stockCardTipo}>{material.tipo_material}</span>
          )}
        </div>
        <StockBadge disponible={disponible} minimo={minimo} />
      </div>

      {/* Descripción breve */}
      {material.descripcion && (
        <p className={styles.stockCardDesc}>{material.descripcion}</p>
      )}

      {/* Barra de stock */}
      <div className={styles.stockBarWrap}>
        <div className={styles.stockBarTrack}>
          <div
            className={styles.stockBarFill}
            style={{
              width: `${porcentaje}%`,
              background: barColor,
            }}
          />
          {/* Línea del mínimo al 50% de la barra (minimo = 50% de referencia 2×minimo) */}
          <div className={styles.stockBarMinLine} title={`Mínimo: ${minimo}`} />
        </div>
        <div className={styles.stockBarLabels}>
          <span className={styles.stockBarDisponible}>
            <strong>{disponible}</strong> {material.unidad_medida ?? 'u.'}
          </span>
          <span className={styles.stockBarMinimo}>
            Mín: {minimo} {material.unidad_medida ?? 'u.'}
          </span>
        </div>
      </div>

      {/* Mensaje de déficit */}
      <div className={`${styles.stockDeficit} ${styles[`stockDeficit_${nivel}`]}`}>
        {nivel === 'critico' ? (
          <>⊗ Sin existencias — reponer <strong>{minimo} {material.unidad_medida ?? 'u.'}</strong> como mínimo</>
        ) : (
          <>▼ Faltan <strong>{deficit} {material.unidad_medida ?? 'u.'}</strong> para alcanzar el stock mínimo</>
        )}
      </div>
    </div>
  )
}

/* 
   COMPONENTE PRINCIPAL
  */
export default function AlertasPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  // Solo decide si se dibuja la pestaña: quien no es admin no las recibe.
  const esAdmin = user?.rol === ROLES.ADMIN
  // HU-S10-08: PATCH /alertas/{id} es `require_supervisor`. El gerente ve esta
  // pantalla —revisar la operación es su trabajo— pero no atiende ni descarta
  // avisos, y los dos botones acababan en un 403 por cada clic.
  const puedeAtender = puedeOperar(user?.rol, 'alertas.atender')

  /* Alertas operativas (persistentes, backend real) */
  const [alertas,      setAlertas]      = useState([])
  const [loadingAl,    setLoadingAl]    = useState(true)
  const [errorAl,      setErrorAl]      = useState(null)
  const [actualizando, setActualizando] = useState(null)

  /*  Stock crítico */
  const [materiales,   setMateriales]   = useState([])
  const [loadingSt,    setLoadingSt]    = useState(true)
  const [errorSt,      setErrorSt]      = useState(null)

  /*  Tab activa  */
  const [tabActiva, setTabActiva] = useState('operativas') // 'operativas' | 'seguridad' | 'stock'

  /*  Filtro de estado (pendiente | atendida | descartada | todas) */
  const [filtroEstado, setFiltroEstado] = useState(ESTADO_ALERTA.PENDIENTE)

  /*  Fetch alertas operativas desde GET /alertas  */
  const fetchAlertas = useCallback(async () => {
    setLoadingAl(true)
    try {
      setErrorAl(null)
      const params = filtroEstado === 'todas' ? {} : { estado: filtroEstado }
      const data = await getAlertas(params)
      setAlertas(data)
    } catch (err) {
      setErrorAl(describirErrorAlertas(err))
      console.error('Error al cargar las alertas:', err)
    } finally {
      setLoadingAl(false)
    }
  }, [filtroEstado])

  useEffect(() => {
    fetchAlertas()
  }, [fetchAlertas])

  /*  Fetch materiales bajo stock */
  const fetchStock = useCallback(async () => {
    setLoadingSt(true)
    try {
      setErrorSt(null)
      setMateriales(await getMaterialesBajoStock())
    } catch (err) {
      setErrorSt(
        err?.response?.data?.detail ||
        err?.message ||
        'No se pudo cargar el inventario de stock crítico.'
      )
      console.error(err)
    } finally {
      setLoadingSt(false)
    }
  }, [])

  useEffect(() => {
    fetchStock()
  }, [fetchStock])

  /* Atender o descartar una alerta persistida */
  const handleActualizarEstado = async (id, estado) => {
    setActualizando(id)
    try {
      const actualizada = await actualizarEstadoAlerta(id, estado)
      setAlertas((prev) =>
        filtroEstado === 'todas'
          // En "Todas" la alerta sigue visible, solo cambia su estado.
          ? prev.map((a) => (a.id_alerta === id ? { ...a, ...actualizada } : a))
          : prev.filter((a) => a.id_alerta !== id)
      )
      toast.success(
        estado === ESTADO_ALERTA.ATENDIDA
          ? 'Alerta marcada como atendida.'
          : 'Alerta descartada.'
      )
    } catch (err) {
      toast.error(describirErrorAlertas(err))
      console.error('Error al actualizar la alerta:', err)
    } finally {
      setActualizando(null)
    }
  }

  /*  Contadores para los tabs  */
  // Las dos listas salen de la misma consulta (filtrada en el backend por el
  // estado elegido): las de seguridad van a su propia pestaña.
  const alertasOperativas = alertas.filter((a) => !esAlertaSeguridad(a))
  const alertasSeguridad  = alertas.filter(esAlertaSeguridad)
  const criticos       = materiales.filter((m) => m.cantidad_disponible === 0).length
  const stockBadge     = materiales.length  // total materiales bajo mínimo

  /* El badge del tab cuenta SIEMPRE las pendientes, no lo que devuelve el
     filtro activo. Antes mostraba el total del filtro, así que al pararse en
     "Atendidas" el badge decía "1" como si quedara una alerta por atender. */
  const cuentaPendientes = (lista) =>
    filtroEstado === ESTADO_ALERTA.PENDIENTE || filtroEstado === 'todas'
      ? lista.filter((a) => a.estado === ESTADO_ALERTA.PENDIENTE).length
      : null
  const badgeOperativas = cuentaPendientes(alertasOperativas)
  const badgeSeguridad  = cuentaPendientes(alertasSeguridad)

  /* Filtros, estados de carga/vacío y tarjetas: iguales en las dos pestañas
     de alertas, cambia la lista y el texto cuando no hay ninguna. */
  const renderListado = (lista, { vacioPendientes }) => (
    <>
      {/* Filtro por estado: permite revisar también las ya atendidas
          o descartadas, en vez de ver siempre una lista vacía. */}
      <div className={styles.filtros}>
        {FILTROS_ESTADO.map(({ value, label }) => (
          <button
            key={value}
            className={`${styles.filtroBtn} ${filtroEstado === value ? styles.filtroActivo : ''}`}
            onClick={() => setFiltroEstado(value)}
          >
            {label}
          </button>
        ))}
        <button
          className={styles.filtroBtn}
          onClick={fetchAlertas}
          disabled={loadingAl}
          title="Volver a consultar las alertas"
        >
          ↻ Actualizar
        </button>
      </div>

      {loadingAl || errorAl || lista.length === 0 ? (
        <PageState
          loading={loadingAl}
          loadingLabel="Buscando alertas..."
          error={errorAl}
          onRetry={fetchAlertas}
          errorTitle="No se pudieron cargar las alertas"
          empty
          emptyIcon={<IconCheck />}
          emptyTitle={
            filtroEstado === ESTADO_ALERTA.PENDIENTE
              ? 'Todo en orden'
              : 'No hay alertas con este estado'
          }
          emptyDescription={
            filtroEstado === ESTADO_ALERTA.PENDIENTE
              ? vacioPendientes
              : 'Prueba con otro filtro para ver el historial de alertas.'
          }
        />
      ) : (
        <ul className={styles.alertasList}>
          {lista.map((alerta) => {
            const esCritica = alerta.severidad === 'critica'
            const nivelClase = esCritica ? 'critico' : 'advertencia'
            const info = TIPO_ALERTA_INFO[alerta.tipo] ?? TIPO_ALERTA_SEGURIDAD_INFO[alerta.tipo]
            const enProceso = actualizando === alerta.id_alerta

            return (
              <li
                key={alerta.id_alerta}
                className={`${styles.alertaItem} ${styles[nivelClase] ?? ''}`}
              >
                <div className={styles.alertaHeader}>
                  <Badge
                    label={esCritica ? 'Crítico' : 'Advertencia'}
                    variant={esCritica ? 'danger' : 'warning'}
                  />
                  {info && (
                    <span className={styles.alertaTarea}>{info.label}</span>
                  )}
                  <span className={styles.alertaHora}>
                    {formatHora(alerta.fecha)}
                  </span>
                </div>

                <p className={styles.alertaMensaje}>{describirAlerta(alerta)}</p>

                {/* Atender o descartar solo cambia el estado de ESTE aviso;
                    la tarea no se entera. Sin una salida hacia ella, el
                    supervisor descartaba el aviso creyendo que resolvia el
                    problema y la tarea seguia igual, asignada y vencida. */}
                {alerta.tipo === TIPO_ALERTA.TAREA_VENCIDA && (
                  <button
                    type="button"
                    className={`btn btn-secondary btn-sm ${styles.irATareaBtn}`}
                    onClick={() => navigate('/supervisor/reasignacion')}
                  >
                    Ir a la tarea para resolverla &rarr;
                  </button>
                )}

                {/* Lo mismo con las de seguridad: el aviso se investiga en
                    la bitácora, ya filtrada por lo que la levantó. */}
                {esAlertaSeguridad(alerta) && (
                  <button
                    type="button"
                    className={`btn btn-secondary btn-sm ${styles.irATareaBtn}`}
                    onClick={() => navigate(enlaceBitacora(alerta))}
                  >
                    Ver en la bitácora &rarr;
                  </button>
                )}

                {alerta.estado === ESTADO_ALERTA.PENDIENTE && puedeAtender ? (
                  <div className={styles.alertaAcciones}>
                    <button
                      className={`btn btn-secondary btn-sm ${styles.resolverBtn}`}
                      onClick={() => handleActualizarEstado(alerta.id_alerta, ESTADO_ALERTA.ATENDIDA)}
                      disabled={enProceso}
                    >
                      {enProceso ? 'Guardando...' : 'Marcar aviso como atendido'}
                    </button>
                    <button
                      className={`btn btn-ghost btn-sm ${styles.descartarBtn}`}
                      onClick={() => handleActualizarEstado(alerta.id_alerta, ESTADO_ALERTA.DESCARTADA)}
                      disabled={enProceso}
                    >
                      Descartar aviso
                    </button>
                  </div>
                ) : (
                  <span className={styles.alertaEstado}>
                    {/* Sin esta línea, el gerente veía el aviso sin botones y
                        sin estado: parecía que la tarjeta estaba incompleta. */}
                    {alerta.estado === ESTADO_ALERTA.PENDIENTE && '• Pendiente'}
                    {alerta.estado === ESTADO_ALERTA.ATENDIDA && '✓ Atendida'}
                    {alerta.estado === ESTADO_ALERTA.DESCARTADA && '✕ Descartada'}
                    {alerta.estado === ESTADO_ALERTA.RESUELTA &&
                      '✓ Resuelta sola — la causa ya no existe'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Alertas del sistema</h1>

      {/*  Tabs  */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tabActiva === 'operativas' ? styles.tabActive : ''}`}
          onClick={() => setTabActiva('operativas')}
        >
          Alertas operativas
          {badgeOperativas > 0 && (
            <span
              className={`${styles.tabBadge} ${styles.tabBadgeDanger}`}
              title={`${badgeOperativas} alerta(s) pendiente(s)`}
            >
              {badgeOperativas}
            </span>
          )}
        </button>

        {esAdmin && (
          <button
            className={`${styles.tab} ${tabActiva === 'seguridad' ? styles.tabActive : ''}`}
            onClick={() => setTabActiva('seguridad')}
          >
            Seguridad
            {badgeSeguridad > 0 && (
              <span
                className={`${styles.tabBadge} ${styles.tabBadgeDanger}`}
                title={`${badgeSeguridad} alerta(s) de seguridad pendiente(s)`}
              >
                {badgeSeguridad}
              </span>
            )}
          </button>
        )}

        <button
          className={`${styles.tab} ${tabActiva === 'stock' ? styles.tabActive : ''}`}
          onClick={() => setTabActiva('stock')}
        >
          Stock crítico
          {stockBadge > 0 && (
            <span className={`${styles.tabBadge} ${criticos > 0 ? styles.tabBadgeDanger : styles.tabBadgeWarning}`}>
              {stockBadge}
            </span>
          )}
        </button>
      </div>

      {/* 
          TAB 1: Alertas operativas
          */}
      {tabActiva === 'operativas' && (
        <section className={styles.tabPanel}>
          {renderListado(alertasOperativas, {
            vacioPendientes: 'No hay alertas operativas pendientes en este momento.',
          })}
        </section>
      )}

      {/* 
          TAB: Seguridad (solo admin)
          */}
      {esAdmin && tabActiva === 'seguridad' && (
        <section className={styles.tabPanel}>
          {renderListado(alertasSeguridad, {
            vacioPendientes:
              'Nada sospechoso en la bitácora: ni intentos de acceso repetidos ni cambios en cuentas de administrador.',
          })}
        </section>
      )}

      {/* 
          TAB 2: Stock crítico
         */}
      {tabActiva === 'stock' && (
        <section className={styles.tabPanel}>
          {loadingSt || errorSt || materiales.length === 0 ? (
            <PageState
              loading={loadingSt}
              loadingLabel="Revisando el inventario..."
              error={errorSt}
              onRetry={fetchStock}
              errorTitle="No se pudo cargar el stock crítico"
              empty
              emptyIcon={<IconStock />}
              emptyTitle="Inventario en buen estado"
              emptyDescription="Todos los materiales están por encima de su stock mínimo."
            />
          ) : (
            <>
              {/* Resumen rápido */}
              <div className={styles.stockResumen}>
                <div className={`${styles.stockResumenCard} ${styles.stockResumenCritico}`}>
                  <span className={styles.stockResumenNum}>{criticos}</span>
                  <span className={styles.stockResumenLabel}>Sin existencias</span>
                </div>
                <div className={`${styles.stockResumenCard} ${styles.stockResumenBajo}`}>
                  <span className={styles.stockResumenNum}>{materiales.length - criticos}</span>
                  <span className={styles.stockResumenLabel}>Stock insuficiente</span>
                </div>
                <div className={`${styles.stockResumenCard} ${styles.stockResumenTotal}`}>
                  <span className={styles.stockResumenNum}>{materiales.length}</span>
                  <span className={styles.stockResumenLabel}>Total afectados</span>
                </div>
              </div>

              {/* Lista de materiales */}
              <ul className={styles.stockList}>
                {/* se ordena  primero los sin stock (crítico), luego los demás */}
                {[...materiales]
                  .sort((a, b) => a.cantidad_disponible - b.cantidad_disponible)
                  .map((material) => (
                    <li key={material.id_activo}>
                      <MaterialStockCard material={material} />
                    </li>
                  ))}
              </ul>

              <p className={styles.stockFootnote}>
                * Los datos se actualizan al recargar la página. Contacta al responsable
                de bodega para gestionar la reposición de materiales.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  )
}