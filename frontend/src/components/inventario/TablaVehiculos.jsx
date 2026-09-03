import React from 'react'
import Badge from '../ui/Badge'
import PageState from '../ui/PageState'
import { VehiculoMiniatura } from './MiniaturaActivo'
import styles from './TablaVehiculos.module.css'

const ESTADO_VEHICULO_LABEL = {
  disponible:     'Disponible',
  en_uso:         'En uso',
  mantenimiento:  'Mantenimiento',
  fuera_servicio: 'Fuera de servicio',
}

const ESTADO_VEHICULO_VARIANT = {
  disponible:     'success',
  en_uso:         'info',
  mantenimiento:  'warning',
  fuera_servicio: 'danger',
}

const IconCar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5L8 4h8l1.5 3H19a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2M5 17a2 2 0 1 0 4 0m6 0a2 2 0 1 0 4 0"/>
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

export default function TablaVehiculos({
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  onAsignarTecnico,
  onEditar,
  onEliminar,
}) {
  if (loading || datos.length === 0) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando vehículos..."
        empty
        emptyIcon={<IconCar />}
        emptyTitle="Sin vehículos"
        emptyDescription="No se encontraron vehículos con esos criterios de búsqueda."
      />
    )
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableResponsive}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Vehículo</th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('placa')}>
                <div className={styles.thContent}>Placa <SortIcon col="placa" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('marca')}>
                <div className={styles.thContent}>Marca / Modelo <SortIcon col="marca" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('estado_vehiculo')}>
                <div className={styles.thContent}>Estado <SortIcon col="estado_vehiculo" sortConfig={sortConfig} /></div>
              </th>
              <th className={styles.th}>Técnico asignado</th>
              <th className={`${styles.th} ${styles.thActions}`}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {datos.map(v => (
              <tr key={v.id_activo} className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.activoCell}>
                    <VehiculoMiniatura marca={v.marca} fotoUrl={fotoUrl(v.foto_url)} color="#1e3a5f" />
                    <span className={styles.activoNombre}>{v.nombre_activo}</span>
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={styles.placaBadge}>{v.placa}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.textoSecundario}>
                    {[v.marca, v.modelo].filter(Boolean).join(' · ') || '—'}
                  </span>
                </td>
                <td className={styles.td}>
                  <Badge
                    label={ESTADO_VEHICULO_LABEL[v.estado_vehiculo] ?? v.estado_vehiculo}
                    variant={ESTADO_VEHICULO_VARIANT[v.estado_vehiculo] ?? 'muted'}
                  />
                </td>
                <td className={styles.td}>
                  <span className={styles.textoSecundario}>
                    {v.nombre_empleado_asignado || 'Sin asignar'}
                  </span>
                </td>
                <td className={`${styles.td} ${styles.tdActions}`}>
                  <div className={styles.actionBtns}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onAsignarTecnico(v)}
                    >
                      Asignar técnico
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onEditar(v)}
                      title="Editar vehículo"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onEliminar(v)}
                      title="Eliminar vehículo"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFooter}>
        <span className={styles.resultCount}>
          Mostrando {datos.length} vehículo{datos.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
