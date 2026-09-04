import React from 'react'
import Badge from '../ui/Badge'
import PageState from '../ui/PageState'
import { MaterialMiniatura } from './MiniaturaActivo'
import styles from './TablaMateriales.module.css'

const IconBox = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)

const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
)

const IconChevronUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)

const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IconChevronsUpDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="7 15 12 20 17 15"/>
    <polyline points="7 9 12 4 17 9"/>
  </svg>
)

function SortIcon({ col, sortConfig }) {
  if (sortConfig.key !== col) return <span className={styles.sortNeutral}><IconChevronsUpDown /></span>
  return sortConfig.dir === 'asc'
    ? <span className={styles.sortActive}><IconChevronUp /></span>
    : <span className={styles.sortActive}><IconChevronDown /></span>
}

function fotoUrl(path) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `http://localhost:8000${path}`
}

export default function TablaMateriales({
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  onEditar,
  onEliminar,
}) {
  if (loading || datos.length === 0) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando materiales..."
        empty
        emptyIcon={<IconBox />}
        emptyTitle="Sin materiales"
        emptyDescription="No se encontraron materiales con esos criterios de búsqueda."
      />
    )
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableResponsive}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Material</th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('tipo_material')}>
                <div className={styles.thContent}>Tipo <SortIcon col="tipo_material" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('unidad_medida')}>
                <div className={styles.thContent}>Unidad <SortIcon col="unidad_medida" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('cantidad_disponible')}>
                <div className={styles.thContent}>Disponible <SortIcon col="cantidad_disponible" sortConfig={sortConfig} /></div>
              </th>
              <th className={styles.th}>Stock mínimo</th>
              <th className={styles.th}>Nivel de stock</th>
              <th className={`${styles.th} ${styles.thActions}`}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {datos.map(m => {
              const stockBajo = m.cantidad_disponible <= m.stock_minimo
              const pct = Math.min(100, Math.round((m.cantidad_disponible / Math.max(m.stock_minimo * 3, 1)) * 100))

              return (
                <tr key={m.id_activo} className={styles.tr}>
                  <td className={styles.td}>
                    <div className={styles.activoCell}>
                      <MaterialMiniatura tipo={m.tipo_material} foto={fotoUrl(m.foto_url)} />
                      <span className={styles.activoNombre}>{m.nombre_activo}</span>
                    </div>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.tipoTag}>{m.tipo_material || '—'}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.textoSecundario}>{m.unidad_medida || '—'}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.cantidadNum} ${stockBajo ? styles.cantidadBaja : ''}`}>
                      {m.cantidad_disponible?.toLocaleString()}
                    </span>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.textoSecundario}>{m.stock_minimo?.toLocaleString()}</span>
                  </td>
                  <td className={styles.td}>
                    <div className={styles.stockBarWrap}>
                      <div className={styles.stockBar}>
                        <div
                          className={`${styles.stockBarFill} ${stockBajo ? styles.stockBarBajo : styles.stockBarOk}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <Badge
                        label={stockBajo ? 'Stock bajo' : 'Normal'}
                        variant={stockBajo ? 'danger' : 'success'}
                      />
                    </div>
                  </td>
                  <td className={`${styles.td} ${styles.tdActions}`}>
                    <div className={styles.actionBtns}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onEditar(m)}
                        title="Editar material"
                      >
                        <IconEdit />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onEliminar(m)}
                        title="Eliminar material"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFooter}>
        <span className={styles.resultCount}>
          Mostrando {datos.length} material{datos.length !== 1 ? 'es' : ''}
        </span>
      </div>
    </div>
  )
}
