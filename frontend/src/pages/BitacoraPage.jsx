/**
 * pages/BitacoraPage.jsx
 * ---------------------------------------------------------------------------
 * Bitácora de auditoría (HU-S9-03), solo admin.
 *
 * - Arriba, el estado de la cadena de hashes (GET /auditoria/verificacion):
 *   un aviso rojo si alguna fila se alteró o se borró por fuera, y uno ámbar
 *   si la conexión del backend podría alterarla (superusuario o propietario).
 * - Filtros por empleado, rol, acción, entidad, id, request_id y rango de
 *   días. El rango al revés se bloquea aquí, antes de llamar.
 * - Tabla paginada (más reciente primero) y, al elegir una fila, el panel de
 *   detalle con el antes/después campo por campo.
 * - "Exportar a Excel" descarga TODAS las filas del filtro que se está viendo.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import {
  descargarBitacoraExcel,
  detalleDeErrorBlob,
  getBitacora,
  getCatalogosBitacora,
  getVerificacionBitacora,
} from '../api/auditoriaService'
import { getEmpleadosParaFiltro } from '../api/asistenciaService'
import { descargarArchivo, nombreDesdeContentDisposition } from '../utils/exportarReportes'
import { aISO, hoyISO } from '../utils/fecha'
import {
  ACCIONES,
  filasDeCambios,
  formatearFechaHora,
  quien,
  textoAccion,
} from '../utils/bitacora'
import styles from './BitacoraPage.module.css'

const PAGE_SIZE = 20

function haceDias(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return aISO(d)
}

const FILTROS_INICIALES = {
  actor: '',
  rol: '',
  accion: '',
  entidad: '',
  id_entidad: '',
  request_id: '',
  fecha_inicio: haceDias(7),
  fecha_fin: hoyISO(),
}

/**
 * Filtros de partida: los de siempre, más los que traiga la URL. Así una
 * alerta de seguridad (HU-S10-05) abre la bitácora ya filtrada por lo que la
 * levantó (/supervisor/bitacora?accion=login_fallido). Solo se toman las
 * claves que la pantalla conoce.
 */
function filtrosIniciales(searchParams) {
  const filtros = { ...FILTROS_INICIALES }
  for (const clave of Object.keys(FILTROS_INICIALES)) {
    const valor = searchParams.get(clave)
    if (valor) filtros[clave] = valor
  }
  return filtros
}

/* ── Estado de la cadena ─────────────────────────────────────────────────── */
function EstadoCadena({ verificacion, cargando, error, onReintentar }) {
  if (cargando) {
    return <div className={styles.estadoNeutro}>Verificando la integridad de la bitácora…</div>
  }
  if (error) {
    return (
      <div className={styles.estadoNeutro}>
        No se pudo verificar la bitácora: {error}{' '}
        <button className={styles.enlace} onClick={onReintentar}>Reintentar</button>
      </div>
    )
  }
  if (!verificacion) return null

  const purga = verificacion.ultima_purga
  return (
    <>
      {verificacion.integra ? (
        <div className={styles.estadoOk}>
          <strong>Cadena íntegra.</strong> {verificacion.descripcion}
          {purga && (
            <> Última purga: {formatearFechaHora(purga.fecha_hora)} ({purga.filas_purgadas} filas de más de {purga.retencion_dias} días).</>
          )}
          <button className={styles.enlace} onClick={onReintentar}>Volver a verificar</button>
        </div>
      ) : (
        <div className={styles.estadoRoto} role="alert">
          <strong>La bitácora fue alterada.</strong> {verificacion.descripcion} Las filas
          posteriores pueden no ser confiables: revisa quién tiene acceso directo a la base.
          <button className={styles.enlace} onClick={onReintentar}>Volver a verificar</button>
        </div>
      )}
      {!verificacion.protegida && (
        <div className={styles.estadoAviso}>
          <strong>Protección incompleta.</strong> {verificacion.detalle_proteccion}
        </div>
      )}
    </>
  )
}

/* ── Panel de detalle ────────────────────────────────────────────────────── */
function DetalleFila({ fila, onCerrar }) {
  const { conDiff, filas } = filasDeCambios(fila.cambios)
  return (
    <aside className={styles.detalle} aria-label={`Detalle de la acción #${fila.id_bitacora}`}>
      <div className={styles.detalleCabecera}>
        <div>
          <span className={styles.detalleTitulo}>Acción #{fila.id_bitacora}</span>
          <span className={styles.detalleSub}>{formatearFechaHora(fila.fecha_hora)}</span>
        </div>
        <button className={styles.cerrar} onClick={onCerrar} aria-label="Cerrar detalle">×</button>
      </div>

      <dl className={styles.meta}>
        <dt>Quién</dt>
        <dd>{quien(fila)}{fila.rol_actor ? ` · ${fila.rol_actor}` : ''}</dd>
        <dt>Qué</dt>
        <dd>{textoAccion(fila.accion)} · {fila.entidad}{fila.id_entidad != null ? ` #${fila.id_entidad}` : ''}</dd>
        <dt>Desde</dt>
        <dd>{fila.ip ?? '—'}</dd>
        <dt>Request ID</dt>
        <dd className={styles.mono}>{fila.request_id ?? '—'}</dd>
        <dt>Hash</dt>
        <dd className={styles.mono} title={fila.hash}>{fila.hash.slice(0, 16)}…</dd>
      </dl>

      <span className={styles.detalleSeccion}>
        {conDiff ? 'Cambios campo por campo' : 'Detalle'}
      </span>
      {filas.length === 0 ? (
        <p className={styles.sinCambios}>Esta acción no guardó detalle.</p>
      ) : (
        <table className={styles.tablaCambios}>
          <thead>
            <tr>
              <th>Campo</th>
              {conDiff ? (
                <>
                  <th>Antes</th>
                  <th>Después</th>
                </>
              ) : (
                <th>Valor</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.campo}>
                <td className={styles.campo}>{f.campo}</td>
                {conDiff ? (
                  <>
                    <td className={styles.antes}>{f.antes}</td>
                    <td className={styles.despues}>{f.despues}</td>
                  </>
                ) : (
                  <td className={styles.valor}>{f.valor}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  )
}

/* ── Página ──────────────────────────────────────────────────────────────── */
export default function BitacoraPage() {
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const [filtros, setFiltros] = useState(() => filtrosIniciales(searchParams))
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [seleccionada, setSeleccionada] = useState(null)
  const [empleados, setEmpleados] = useState([])
  const [catalogos, setCatalogos] = useState({ acciones: [], entidades: [], roles: [] })
  const [verificacion, setVerificacion] = useState(null)
  const [verificando, setVerificando] = useState(true)
  const [errorVerificacion, setErrorVerificacion] = useState(null)
  const [exportando, setExportando] = useState(false)

  const rangoInvalido = Boolean(
    filtros.fecha_inicio && filtros.fecha_fin && filtros.fecha_inicio > filtros.fecha_fin
  )

  const verificar = useCallback(async () => {
    setVerificando(true)
    setErrorVerificacion(null)
    try {
      setVerificacion(await getVerificacionBitacora())
    } catch (err) {
      setErrorVerificacion(err?.response?.data?.detail || 'error de conexión')
    } finally {
      setVerificando(false)
    }
  }, [])

  useEffect(() => {
    verificar()
    getEmpleadosParaFiltro()
      .then(setEmpleados)
      .catch((err) => console.error('No se pudo cargar la lista de empleados:', err))
    getCatalogosBitacora()
      .then(setCatalogos)
      .catch((err) => console.error('No se pudieron cargar los filtros de la bitácora:', err))
  }, [verificar])

  const cargar = useCallback(async () => {
    // Un rango al revés no se pide: el backend respondería 400.
    if (rangoInvalido) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await getBitacora(filtros, page, PAGE_SIZE))
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la bitácora.')
    } finally {
      setLoading(false)
    }
  }, [filtros, page, rangoInvalido])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cambiarFiltro = (campo, valor) => {
    setFiltros((prev) => ({ ...prev, [campo]: valor }))
    setPage(1)
    setSeleccionada(null)
  }

  const restablecer = () => {
    setFiltros(FILTROS_INICIALES)
    setPage(1)
    setSeleccionada(null)
  }

  const exportar = async () => {
    setExportando(true)
    try {
      const respuesta = await descargarBitacoraExcel(filtros)
      const nombre =
        nombreDesdeContentDisposition(respuesta.headers?.['content-disposition']) ||
        `bitacora_${filtros.fecha_inicio || 'inicio'}_${filtros.fecha_fin || 'hoy'}.xlsx`
      descargarArchivo(respuesta.data, nombre)
      toast.success(`Bitácora exportada: ${nombre}`)
    } catch (err) {
      toast.error((await detalleDeErrorBlob(err)) || 'No se pudo exportar la bitácora.')
    } finally {
      setExportando(false)
    }
  }

  const items = useMemo(() => data?.items ?? [], [data])
  const totalPages = data?.total_pages ?? 0

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Bitácora de auditoría</h1>
      <p className={styles.subtitle}>
        Todo lo que se hizo sobre los datos: quién, cuándo, desde dónde y qué cambió.
        Nadie puede editarla ni borrarla.
      </p>

      <EstadoCadena
        verificacion={verificacion}
        cargando={verificando}
        error={errorVerificacion}
        onReintentar={verificar}
      />

      {/* ── Filtros ── */}
      <div className={styles.filtros}>
        <Campo id="b-actor" etiqueta="Empleado">
          <select
            id="b-actor"
            className={styles.input}
            value={filtros.actor}
            onChange={(e) => cambiarFiltro('actor', e.target.value)}
          >
            <option value="">Todos</option>
            {empleados.map((e) => (
              <option key={e.id_empleado} value={e.id_empleado}>
                {e.nombre_completo} ({e.rol})
              </option>
            ))}
          </select>
        </Campo>

        <Campo id="b-rol" etiqueta="Rol">
          <select id="b-rol" className={styles.input} value={filtros.rol} onChange={(e) => cambiarFiltro('rol', e.target.value)}>
            <option value="">Todos</option>
            {catalogos.roles.map((rol) => <option key={rol} value={rol}>{rol}</option>)}
          </select>
        </Campo>

        <Campo id="b-accion" etiqueta="Acción">
          <select id="b-accion" className={styles.input} value={filtros.accion} onChange={(e) => cambiarFiltro('accion', e.target.value)}>
            <option value="">Todas</option>
            {catalogos.acciones.map((accion) => (
              <option key={accion} value={accion}>{textoAccion(accion)}</option>
            ))}
          </select>
        </Campo>

        <Campo id="b-entidad" etiqueta="Entidad">
          <select id="b-entidad" className={styles.input} value={filtros.entidad} onChange={(e) => cambiarFiltro('entidad', e.target.value)}>
            <option value="">Todas</option>
            {catalogos.entidades.map((entidad) => <option key={entidad} value={entidad}>{entidad}</option>)}
          </select>
        </Campo>

        <Campo id="b-id" etiqueta="ID entidad">
          <input
            id="b-id"
            type="number"
            min="1"
            className={`${styles.input} ${styles.inputCorto}`}
            value={filtros.id_entidad}
            onChange={(e) => cambiarFiltro('id_entidad', e.target.value)}
          />
        </Campo>

        <Campo id="b-request" etiqueta="Request ID">
          <input
            id="b-request"
            type="text"
            maxLength={64}
            className={styles.input}
            value={filtros.request_id}
            onChange={(e) => cambiarFiltro('request_id', e.target.value.trim())}
          />
        </Campo>

        <Campo id="b-desde" etiqueta="Desde">
          <input id="b-desde" type="date" className={styles.input} value={filtros.fecha_inicio} onChange={(e) => cambiarFiltro('fecha_inicio', e.target.value)} />
        </Campo>

        <Campo id="b-hasta" etiqueta="Hasta">
          <input id="b-hasta" type="date" className={styles.input} value={filtros.fecha_fin} onChange={(e) => cambiarFiltro('fecha_fin', e.target.value)} />
        </Campo>

        <div className={styles.acciones}>
          <button className={styles.secundario} onClick={restablecer}>Restablecer</button>
          <button
            className="btn btn-primary"
            onClick={exportar}
            disabled={exportando || rangoInvalido || !data?.total}
          >
            {exportando ? 'Exportando…' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      {rangoInvalido && (
        <p className={styles.errorRango} role="alert">
          La fecha «Desde» no puede ser posterior a «Hasta».
        </p>
      )}

      {/* ── Tabla + detalle ── */}
      {rangoInvalido ? null : loading || error || items.length === 0 ? (
        <PageState
          loading={loading}
          loadingLabel="Cargando bitácora..."
          error={error}
          onRetry={cargar}
          errorTitle="No se pudo cargar la bitácora"
          empty
          emptyTitle="Sin acciones registradas"
          emptyDescription="Ajusta el rango de fechas o los filtros para ver más resultados."
        />
      ) : (
        <div className={`${styles.cuerpo} ${seleccionada ? styles.conDetalle : ''}`}>
          <div>
            <div className={styles.tablaWrap}>
              <table className={styles.tabla}>
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Quién</th>
                    <th>Acción</th>
                    <th>Sobre</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((fila) => (
                    <tr
                      key={fila.id_bitacora}
                      className={`${styles.fila} ${seleccionada?.id_bitacora === fila.id_bitacora ? styles.filaActiva : ''}`}
                      onClick={() => setSeleccionada(fila)}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSeleccionada(fila)}
                      aria-selected={seleccionada?.id_bitacora === fila.id_bitacora}
                    >
                      <td className={styles.nowrap}>{formatearFechaHora(fila.fecha_hora)}</td>
                      <td>
                        <span className={styles.actor}>{quien(fila)}</span>
                        {fila.rol_actor && <span className={styles.rol}>{fila.rol_actor}</span>}
                      </td>
                      <td>
                        <Badge label={textoAccion(fila.accion)} variant={ACCIONES[fila.accion]?.variante ?? 'muted'} />
                      </td>
                      <td>
                        {fila.entidad}
                        {fila.id_entidad != null && <span className={styles.idEntidad}> #{fila.id_entidad}</span>}
                      </td>
                      <td className={styles.mono}>{fila.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.paginacion}>
              <button className={styles.secundario} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                ← Anterior
              </button>
              <span className={styles.pagInfo}>
                Página {data.page} de {totalPages || 1} · {data.total} acciones
              </span>
              <button className={styles.secundario} onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                Siguiente →
              </button>
            </div>
          </div>

          {seleccionada && <DetalleFila fila={seleccionada} onCerrar={() => setSeleccionada(null)} />}
        </div>
      )}
    </div>
  )
}

function Campo({ id, etiqueta, children }) {
  return (
    <div className={styles.campoFiltro}>
      <label className={styles.etiqueta} htmlFor={id}>{etiqueta}</label>
      {children}
    </div>
  )
}
