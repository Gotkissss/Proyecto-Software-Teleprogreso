/**
 * pages/AlertasPage.jsx
 * ---------------------------------------------------------------------------
 * Gestión de alertas operativas del supervisor.
 * Muestra:
 *   1. Alertas persistentes generadas por el backend (GET/PATCH /alertas):
 *      tareas vencidas, técnicos sin marcar entrada, stock crítico.
 *   2. Sección "Stock crítico" con materiales bajo el mínimo definido
 *      (GET /activos/materiales/bajo-stock)
 *
 * Ambas secciones consumen endpoints reales del backend. No hay datos mock
 * ni flags de features pendientes: las alertas se generan y persisten en el
 * servidor (app/services/alertas.py), el frontend solo las lista y permite
 * atenderlas/descartarlas.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import Badge from '../components/ui/Badge'
import PageState from '../components/ui/PageState'
import StockBadge from '../components/ui/StockBadge'
import { useToast } from '../components/ui/Toast'
import {
  ESTADO_ALERTA,
  actualizarEstadoAlerta,
  describirErrorAlertas,
  getAlertas,
} from '../api/alertaService'
import {
  getMaterialesBajoStock,
  calcularPorcentajeStock,
  clasificarStock,
} from '../api/materialService'
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
  const [tabActiva, setTabActiva] = useState('operativas') // 'operativas' | 'stock'

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
  const alertasActivas = alertas // filtradas en el backend por el estado elegido
  const criticos       = materiales.filter((m) => m.cantidad_disponible === 0).length
  const stockBadge     = materiales.length  // total materiales bajo mínimo

  /* El badge del tab cuenta SIEMPRE las pendientes, no lo que devuelve el
     filtro activo. Antes mostraba el total del filtro, así que al pararse en
     "Atendidas" el badge decía "1" como si quedara una alerta por atender. */
  const pendientes = alertas.filter((a) => a.estado === ESTADO_ALERTA.PENDIENTE).length
  const badgeOperativas =
    filtroEstado === ESTADO_ALERTA.PENDIENTE || filtroEstado === 'todas'
      ? pendientes
      : null

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

          {loadingAl || errorAl || alertasActivas.length === 0 ? (
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
                  ? 'No hay alertas operativas pendientes en este momento.'
                  : 'Prueba con otro filtro para ver el historial de alertas.'
              }
            />
          ) : (
            <ul className={styles.alertasList}>
              {alertasActivas.map((alerta) => {
                const esCritica = alerta.severidad === 'critica'
                const nivelClase = esCritica ? 'critico' : 'advertencia'
                const info = TIPO_ALERTA_INFO[alerta.tipo]
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

                    {alerta.estado === ESTADO_ALERTA.PENDIENTE ? (
                      <div className={styles.alertaHeader}>
                        <button
                          className={styles.resolverBtn}
                          onClick={() => handleActualizarEstado(alerta.id_alerta, ESTADO_ALERTA.ATENDIDA)}
                          disabled={enProceso}
                        >
                          {enProceso ? 'Guardando...' : 'Marcar como atendida'}
                        </button>
                        <button
                          className={styles.resolverBtn}
                          onClick={() => handleActualizarEstado(alerta.id_alerta, ESTADO_ALERTA.DESCARTADA)}
                          disabled={enProceso}
                        >
                          Descartar
                        </button>
                      </div>
                    ) : (
                      <span className={styles.alertaEstado}>
                        {alerta.estado === ESTADO_ALERTA.ATENDIDA ? '✓ Atendida' : '✕ Descartada'}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
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