import React from 'react'
import Badge from '../ui/Badge'
import PageState from '../ui/PageState'
import { HerramientaMiniatura } from './MiniaturaActivo'
import styles from './TablaHerramientas.module.css'

const ESTADO_HERR_LABEL = {
  disponible:    'Disponible',
  en_uso:        'En uso',
  mantenimiento: 'Mantenimiento',
  dañada:        'Dañada',
}

const ESTADO_HERR_VARIANT = {
  disponible:    'success',
  en_uso:        'info',
  mantenimiento: 'warning',
  dañada:        'danger',
}

const IconTool = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
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

export default function TablaHerramientas({
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  onAsignarCarro,
  onEditar,
  onEliminar,
}) {
  if (loading || datos.length === 0) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando herramientas..."
        empty
        emptyIcon={<IconTool />}
        emptyTitle="Sin herramientas"
        emptyDescription="No se encontraron herramientas con esos criterios de búsqueda."
      />
    )
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableResponsive}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Herramienta</th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('tipo_herramienta')}>
                <div className={styles.thContent}>Tipo <SortIcon col="tipo_herramienta" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('marca')}>
                <div className={styles.thContent}>Marca / Modelo <SortIcon col="marca" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('estado')}>
                <div className={styles.thContent}>Estado <SortIcon col="estado" sortConfig={sortConfig} /></div>
              </th>
              <th className={`${styles.th} ${styles.thActions}`}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {datos.map(h => (
              <tr key={h.id_activo} className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.activoCell}>
                    <HerramientaMiniatura tipo={h.tipo_herramienta} foto={fotoUrl(h.foto_url)} />
                    <span className={styles.activoNombre}>{h.nombre_activo}</span>
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={styles.tipoTag}>{h.tipo_herramienta || '—'}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.textoSecundario}>
                    {[h.marca, h.modelo].filter(Boolean).join(' · ') || '—'}
                  </span>
                </td>
                <td className={styles.td}>
                  <Badge
                    label={ESTADO_HERR_LABEL[h.estado] ?? h.estado}
                    variant={ESTADO_HERR_VARIANT[h.estado] ?? 'muted'}
                  />
                </td>
                <td className={`${styles.td} ${styles.tdActions}`}>
                  <div className={styles.actionBtns}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onAsignarCarro(h)}
                    >
                      Asignar a vehículo
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onEditar(h)}
                      title="Editar herramienta"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onEliminar(h)}
                      title="Eliminar herramienta"
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
          Mostrando {datos.length} herramienta{datos.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
