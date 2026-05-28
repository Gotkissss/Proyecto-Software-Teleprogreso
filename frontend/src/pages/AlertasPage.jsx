/**
 * pages/AlertasPage.jsx
 * ---------------------------------------------------------------------------
 * Gestión de alertas operativas del supervisor.
 * Muestra:
 *   1. Alertas operativas (retrasos, técnicos sin asignar, incidencias, etc.)
 *   2. Sección "Stock crítico" con materiales bajo el mínimo definido
 *
 * Para las alertas operativas se  usa datos mock mientras no exista /alertas.
 *
 * Para el stock crítico:
 *   - Consume GET /activos/materiales/bajo-stock (implementado por Gualim en backend)
 *     el frontend a partir de datos de muestra.
 *
 * Cuando gualim termine el backend:
 *   2. Descomentar la llamada real a getMaterialesBajoStock()
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react'
import Spinner from '../components/ui/Spinner'
import Badge from '../components/ui/Badge'
import StockBadge from '../components/ui/StockBadge'
import { getMaterialesBajoStock } from '../api/materialService'
import { calcularPorcentajeStock, clasificarStock } from '../api/materialService'
import styles from './AlertasPage.module.css'

/* 
   FLAGS DE MOCK
 */
const USE_MOCK_ALERTAS = false

const USE_MOCK_STOCK = false

/*  MOCK: Alertas operativas */
/*  MOCK: Materiales para stock crítico  */
// Simula lo que devolvería GET /activos/materiales/bajo-stock
// Solo incluye materiales donde cantidad_disponible < stock_minimo
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
  /* Alertas operativas */
  const [alertas,      setAlertas]      = useState([])
  const [loadingAl,    setLoadingAl]    = useState(true)
  const [errorAl,      setErrorAl]      = useState(null)
  const [resolviendo,  setResolviendo]  = useState(null)

  /*  Stock crítico */
  const [materiales,   setMateriales]   = useState([])
  const [loadingSt,    setLoadingSt]    = useState(true)
  const [errorSt,      setErrorSt]      = useState(null)

  /*  Tab activa  */
  const [tabActiva, setTabActiva] = useState('operativas') // 'operativas' | 'stock'

  /*  Fetch alertas operativas  */
  useEffect(() => {
    const fetchAlertas = async () => {
      try {
        if (USE_MOCK_ALERTAS) {
          await new Promise((r) => setTimeout(r, 400))
          setAlertas(MOCK_ALERTAS)
        } else {
          const { getAlertas } = await import('../api/alertaService')
          const data = await getAlertas()
          setAlertas(data)
        }
      } catch (err) {
        setErrorAl('No se pudieron cargar las alertas operativas.')
        console.error(err)
      } finally {
        setLoadingAl(false)
      }
    }
    fetchAlertas()
  }, [])

  /*  Fetch materiales bajo stock */
  useEffect(() => {
    const fetchStock = async () => {
      try {
        const data = await getMaterialesBajoStock()
          setMateriales(data)
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
    }
    fetchStock()
  }, [])

  /* Resolver alerta */
  const handleResolver = async (id) => {
    setResolviendo(id)
    try {
      if (!USE_MOCK_ALERTAS) {
        const { resolverAlerta } = await import('../api/alertaService')
        await resolverAlerta(id)
      } else {
        await new Promise((r) => setTimeout(r, 400))
      }
      setAlertas((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      console.error('Error al resolver alerta:', err)
    } finally {
      setResolviendo(null)
    }
  }

  /*  Contadores para los tabs  */
  const alertasActivas = alertas.filter((a) => !a.resuelta)
  const criticos       = materiales.filter((m) => m.cantidad_disponible === 0).length
  const stockBadge     = materiales.length  // total materiales bajo mínimo

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
          {alertasActivas.length > 0 && (
            <span className={`${styles.tabBadge} ${styles.tabBadgeDanger}`}>
              {alertasActivas.length}
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
          {loadingAl ? (
            <div className={styles.center}><Spinner size="lg" /></div>
          ) : errorAl ? (
            <p className={styles.errorMsg}>{errorAl}</p>
          ) : alertasActivas.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>✓</div>
              <p className={styles.emptyMsg}>No hay alertas operativas activas.</p>
            </div>
          ) : (
            <ul className={styles.alertasList}>
              {alertasActivas.map((alerta) => (
                <li
                  key={alerta.id}
                  className={`${styles.alertaItem} ${styles[alerta.nivel]}`}
                >
                  <div className={styles.alertaHeader}>
                    <Badge
                      label={alerta.nivel === 'critico' ? 'Crítico' : 'Advertencia'}
                      variant={alerta.nivel === 'critico' ? 'danger' : 'warning'}
                    />
                    <span className={styles.alertaHora}>
                      {formatHora(alerta.fecha_hora)}
                    </span>
                  </div>

                  <p className={styles.alertaMensaje}>{alerta.mensaje}</p>

                  {alerta.tecnico && (
                    <p className={styles.alertaTecnico}>
                      Técnico: <strong>{alerta.tecnico.nombre_completo}</strong>
                    </p>
                  )}

                  {alerta.tarea && (
                    <p className={styles.alertaTarea}>
                      Tarea: {alerta.tarea.titulo}
                    </p>
                  )}

                  <button
                    className={styles.resolverBtn}
                    onClick={() => handleResolver(alerta.id)}
                    disabled={resolviendo === alerta.id}
                  >
                    {resolviendo === alerta.id ? 'Resolviendo...' : 'Marcar como resuelta'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 
          TAB 2: Stock crítico
         */}
      {tabActiva === 'stock' && (
        <section className={styles.tabPanel}>
          {loadingSt ? (
            <div className={styles.center}><Spinner size="lg" /></div>
          ) : errorSt ? (
            <div className={styles.stockErrorWrap}>
              <p className={styles.errorMsg}>{errorSt}</p>
              {/* Indicamos claramente que el backend falta */}
              <p className={styles.stockErrorHint}>
                ⚙ El endpoint <code>/activos/materiales/bajo-stock</code> aún no está
                implementado. Activa <code>USE_MOCK_STOCK = true</code> para previsualizar
                con datos de prueba, o espera a que el compañero de backend lo implemente.
              </p>
            </div>
          ) : materiales.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>✓</div>
              <p className={styles.emptyMsg}>
                Todos los materiales tienen stock suficiente.
              </p>
            </div>
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