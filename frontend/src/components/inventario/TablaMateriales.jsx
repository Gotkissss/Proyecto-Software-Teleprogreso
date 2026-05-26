/**
 * components/inventario/TablaMateriales.jsx
 * ---------------------------------------------------------------------------
 * Tabla de materiales del inventario.
 * Sigue el mismo patrón visual que TablaVehiculos y TablaHerramientas
 * (definidos inline en pages/InventarioPage.jsx) pero consume datos reales
 * del backend a través de inventarioService.getActivos().
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react'
import Badge from '../ui/Badge'
import { getActivos } from '../../services/inventarioService'
import styles from './TablaMateriales.module.css'

/* ── Iconos de orden (mismo estilo que el resto del proyecto) ──── */
const IconChevronUp = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
)
const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)
const IconChevronsUpDown = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="7 15 12 20 17 15" /><polyline points="7 9 12 4 17 9" />
  </svg>
)

/* ── Mapeos de estado a variantes de Badge ─────────────────────── */
const ESTADO_VARIANT = {
  disponible:     'success',
  en_uso:         'info',
  agotado:        'danger',
  bajo_stock:     'warning',
  mantenimiento:  'warning',
  fuera_servicio: 'danger',
}
const ESTADO_LABEL = {
  disponible:     'Disponible',
  en_uso:         'En uso',
  agotado:        'Agotado',
  bajo_stock:     'Stock bajo',
  mantenimiento:  'Mantenimiento',
  fuera_servicio: 'Fuera de servicio',
}

/* Iniciales del nombre del material (máx. 2 letras) */
function obtenerIniciales(nombre = '') {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('') || 'M'
}

/* Miniatura: imagen si existe, si no las iniciales del nombre */
function Miniatura({ activo }) {
  const url = activo.imagen_url || activo.imagen
  if (url) {
    return (
      <div className={styles.miniatura}>
        <img src={url} alt={activo.nombre_activo ?? activo.nombre} className={styles.miniaturaImg} />
      </div>
    )
  }
  return (
    <div className={styles.miniaturaIniciales}>
      {obtenerIniciales(activo.nombre_activo ?? activo.nombre)}
    </div>
  )
}

export default function TablaMateriales({
  busqueda = '',
  filtroEstado = 'todos',
  sortConfig = { key: null, dir: 'asc' },
  onSort = () => {},
  onEditar = () => {},
  onEliminar = () => {},
  refreshKey = 0,
}) {
  const [activos,  setActivos]  = useState([])
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState(null)

  // Al montar: obtiene activos y filtra solo los de tipo material.
  // Se espera que el backend incluya un campo `tipo_activo` con valores
  // como 'material' / 'vehiculo' / 'herramienta'.
  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError(null)
    getActivos()
      .then(data => {
        if (cancelado) return
        const lista = Array.isArray(data) ? data : []
        const soloMateriales = lista.filter(a => {
          const tipo = (a.tipo_activo ?? a.tipo ?? '').toLowerCase()
          return tipo === 'material'
        })
        setActivos(soloMateriales)
      })
      .catch(err => {
        if (cancelado) return
        setError(err?.response?.data?.detail || err.message || 'Error al cargar materiales')
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => { cancelado = true }
  }, [refreshKey])

  const SortIcon = ({ col }) => {
    if (sortConfig.key !== col) return <span className={styles.sortNeutral}><IconChevronsUpDown /></span>
    return sortConfig.dir === 'asc'
      ? <span className={styles.sortActive}><IconChevronUp /></span>
      : <span className={styles.sortActive}><IconChevronDown /></span>
  }

  const datos = useMemo(() => {
    const q = busqueda.toLowerCase()
    let lista = activos.filter(m => {
      const nombre = (m.nombre_activo ?? m.nombre ?? '').toLowerCase()
      const coincide = !q || nombre.includes(q)
      const estado  = filtroEstado === 'todos' || (m.estado ?? '').toLowerCase() === filtroEstado
      return coincide && estado
    })
    if (sortConfig.key) {
      const numericas = ['cantidad_disponible', 'stock_minimo']
      lista = [...lista].sort((a, b) => {
        const va = numericas.includes(sortConfig.key)
          ? Number(a[sortConfig.key] ?? 0)
          : String(a[sortConfig.key] ?? '').toLowerCase()
        const vb = numericas.includes(sortConfig.key)
          ? Number(b[sortConfig.key] ?? 0)
          : String(b[sortConfig.key] ?? '').toLowerCase()
        if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1
        if (va > vb) return sortConfig.dir === 'asc' ?  1 : -1
        return 0
      })
    }
    return lista
  }, [activos, busqueda, filtroEstado, sortConfig])

  if (cargando) {
    return <div className={styles.stateBox}>Cargando materiales...</div>
  }
  if (error) {
    return <div className={`${styles.stateBox} ${styles.stateError}`}>Error al cargar materiales: {error}</div>
  }
  if (datos.length === 0) {
    return <div className={styles.stateBox}>No se encontraron materiales.</div>
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Material</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('nombre_activo')}>
              <span>Nombre</span><SortIcon col="nombre_activo" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('cantidad_disponible')}>
              <span>Cantidad</span><SortIcon col="cantidad_disponible" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('stock_minimo')}>
              <span>Stock mínimo</span><SortIcon col="stock_minimo" />
            </th>
            <th className={styles.th}>Unidad</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('estado')}>
              <span>Estado</span><SortIcon col="estado" />
            </th>
            <th className={styles.th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {datos.map(m => {
            const cantidad     = Number(m.cantidad_disponible ?? 0)
            const stockMin     = Number(m.stock_minimo ?? 0)
            const stockBajo    = cantidad <= stockMin
            const estado       = m.estado ?? (stockBajo ? 'bajo_stock' : 'disponible')
            return (
              <tr key={m.id_activo ?? m.id} className={`${styles.tr} ${stockBajo ? styles.trAlerta : ''}`}>
                <td className={styles.td}>
                  <div className={styles.materialCell}>
                    <Miniatura activo={m} />
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={styles.nombre}>{m.nombre_activo ?? m.nombre}</span>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.numero} ${stockBajo ? styles.numeroAlerta : ''}`}>
                    {cantidad.toLocaleString()}
                  </span>
                  {stockBajo && (
                    <>
                      {' '}
                      <Badge label="Reabastecer" variant="danger" />
                    </>
                  )}
                </td>
                <td className={styles.td}>
                  <span className={styles.numero}>{stockMin.toLocaleString()}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.unidad}>{m.unidad_medida ?? m.unidad ?? '—'}</span>
                </td>
                <td className={styles.td}>
                  <Badge
                    label={ESTADO_LABEL[estado] ?? estado}
                    variant={ESTADO_VARIANT[estado] ?? 'muted'}
                  />
                </td>
                <td className={styles.td}>
                  <div className={styles.acciones}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnEditar}`}
                      onClick={() => onEditar(m)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnEliminar}`}
                      onClick={() => onEliminar(m)}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={styles.resultCount}>
        Mostrando {datos.length} de {activos.length} materiales
      </p>
    </div>
  )
}
