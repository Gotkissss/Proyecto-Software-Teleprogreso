/**
 * components/inventario/TablaFiltrable.jsx
 * ---------------------------------------------------------------------------
 * Tabla genérica reutilizable para las tres pestañas de InventarioPage
 * (vehículos, herramientas, materiales). Resuelve en un solo lugar lo que
 * las tres tablas repetían: el shell (tarjeta, scroll horizontal, footer),
 * el manejo de loading/vacío vía PageState y el encabezado ordenable con
 * su ícono de flecha.
 *
 * Cada tabla concreta (TablaVehiculos, TablaHerramientas, TablaMateriales)
 * solo define sus columnas y cómo se renderiza cada celda; el resto de la
 * mecánica (sort, estados vacío/cargando, layout) vive acá.
 *
 * Uso:
 *   <TablaFiltrable
 *     columns={[
 *       { key: 'nombre_activo', label: 'Vehículo', render: v => <>...</> },
 *       { key: 'placa', label: 'Placa', sortable: true, render: v => <>...</> },
 *       { key: 'acciones', label: 'Acciones', align: 'right', render: v => <>...</> },
 *     ]}
 *     datos={datosFiltrados}
 *     loading={loading}
 *     sortConfig={sortConfig}
 *     onSort={handleSort}
 *     rowKey={v => v.id_activo}
 *     loadingLabel="Cargando vehículos..."
 *     emptyIcon={<IconCar />}
 *     emptyTitle="Sin vehículos"
 *     emptyDescription="No se encontraron vehículos con esos criterios de búsqueda."
 *     footerLabel={n => `Mostrando ${n} vehículo${n !== 1 ? 's' : ''}`}
 *   />
 * ---------------------------------------------------------------------------
 */

import PageState from '../ui/PageState'
import styles from './TablaFiltrable.module.css'

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

/**
 * @param {Array<{key: string, label: string, sortable?: boolean, align?: 'left'|'right', render: (item) => React.ReactNode}>} columns
 */
export default function TablaFiltrable({
  columns,
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  rowKey = (item) => item.id_activo,
  loadingLabel,
  emptyIcon,
  emptyTitle = 'Sin resultados',
  emptyDescription = 'No se encontraron resultados con esos criterios de búsqueda.',
  footerLabel,
}) {
  if (loading || datos.length === 0) {
    return (
      <PageState
        loading={loading}
        loadingLabel={loadingLabel}
        empty
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    )
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableResponsive}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={[
                    styles.th,
                    col.sortable ? styles.thSortable : '',
                    col.align === 'right' ? styles.thActions : '',
                  ].filter(Boolean).join(' ')}
                  onClick={col.sortable ? () => onSort(col.key) : undefined}
                >
                  {col.sortable ? (
                    <div className={styles.thContent}>
                      {col.label} <SortIcon col={col.key} sortConfig={sortConfig} />
                    </div>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {datos.map(item => (
              <tr key={rowKey(item)} className={styles.tr}>
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={[styles.td, col.align === 'right' ? styles.tdActions : ''].filter(Boolean).join(' ')}
                  >
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFooter}>
        <span className={styles.resultCount}>{footerLabel?.(datos.length)}</span>
      </div>
    </div>
  )
}
