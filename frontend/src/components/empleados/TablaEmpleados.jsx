import React from 'react'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import styles from './TablaEmpleados.module.css'

const ROLES = ['admin', 'supervisor', 'tecnico', 'gerente']
const ROL_LABEL = {
  admin:      'Admin',
  supervisor: 'Supervisor',
  tecnico:    'Técnico',
  gerente:    'Gerente',
}

const ROL_VARIANT = {
  admin:      'danger',
  supervisor: 'info',
  tecnico:    'muted',
  gerente:    'warning',
}

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)

const IconToggleOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="22" height="14" rx="7" ry="7"/>
    <circle cx="8" cy="12" r="3" fill="currentColor" stroke="none"/>
  </svg>
)

const IconToggleOn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="22" height="14" rx="7" ry="7"/>
    <circle cx="16" cy="12" r="3" fill="currentColor" stroke="none"/>
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
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

export default function TablaEmpleados({
  empleados = [],
  busqueda = '',
  onBusquedaChange,
  filtroRol = 'todos',
  onFiltroRolChange,
  filtroEstado = 'todos',
  onFiltroEstadoChange,
  sortCol,
  sortDir,
  onSort,
  onEditar,
  onToggle,
  esAdmin = false,
  totalFiltrados = 0,
  totalGeneral = 0,
}) {
  const getSortIcon = (col) => {
    if (sortCol !== col) return <IconChevronsUpDown />
    return sortDir === 'asc' ? <IconChevronUp /> : <IconChevronDown />
  }

  return (
    <div className={styles.wrapper}>
      {/* ── Barra de herramientas / Filtros ── */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><IconSearch /></span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Buscar por nombre, correo o teléfono..."
            value={busqueda}
            onChange={e => onBusquedaChange(e.target.value)}
          />
          {busqueda && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onBusquedaChange('')}
              aria-label="Limpiar búsqueda"
            >
              <IconX />
            </button>
          )}
        </div>

        <div className={styles.filterGroup}>
          <select
            className={styles.filterSelect}
            value={filtroRol}
            onChange={e => onFiltroRolChange(e.target.value)}
          >
            <option value="todos">Todos los roles</option>
            {ROLES.map(r => (
              <option key={r} value={r}>{ROL_LABEL[r]}</option>
            ))}
          </select>

          <select
            className={styles.filterSelect}
            value={filtroEstado}
            onChange={e => onFiltroEstadoChange(e.target.value)}
          >
            <option value="todos">Todos los estados</option>
            <option value="activo">Solo activos</option>
            <option value="inactivo">Solo inactivos</option>
          </select>
        </div>
      </div>

      {/* ── Tabla de empleados ── */}
      {empleados.length === 0 ? (
        <EmptyState
          title="No se encontraron empleados"
          description={
            busqueda || filtroRol !== 'todos' || filtroEstado !== 'todos'
              ? 'Prueba ajustando los filtros o el texto de búsqueda.'
              : 'No hay empleados registrados en la organización.'
          }
        />
      ) : (
        <div className={styles.tableCard}>
          <div className={styles.tableResponsive}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} onClick={() => onSort('nombre')}>
                    <div className={styles.thContent}>
                      Empleado {getSortIcon('nombre')}
                    </div>
                  </th>
                  <th className={styles.th} onClick={() => onSort('correo')}>
                    <div className={styles.thContent}>
                      Correo electrónico {getSortIcon('correo')}
                    </div>
                  </th>
                  <th className={styles.th} onClick={() => onSort('rol')}>
                    <div className={styles.thContent}>
                      Rol {getSortIcon('rol')}
                    </div>
                  </th>
                  <th className={styles.th} onClick={() => onSort('estado')}>
                    <div className={styles.thContent}>
                      Estado {getSortIcon('estado')}
                    </div>
                  </th>
                  <th className={styles.th} onClick={() => onSort('fecha_contratacion')}>
                    <div className={styles.thContent}>
                      Contratación {getSortIcon('fecha_contratacion')}
                    </div>
                  </th>
                  {esAdmin && <th className={`${styles.th} ${styles.thActions}`}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {empleados.map(emp => {
                  const inicial = (emp.nombre?.[0] ?? 'E').toUpperCase()
                  const esActivo = emp.estado === 'activo'
                  return (
                    <tr key={emp.id_empleado} className={styles.tr}>
                      <td className={styles.td}>
                        <div className={styles.userCell}>
                          <div className={styles.userAvatar}>
                            {inicial}
                          </div>
                          <div className={styles.userInfo}>
                            <span className={styles.userName}>{emp.nombre} {emp.apellido}</span>
                            {emp.telefono && <span className={styles.userPhone}>{emp.telefono}</span>}
                          </div>
                        </div>
                      </td>

                      <td className={styles.td}>
                        <span className={styles.correoText}>{emp.correo}</span>
                      </td>

                      <td className={styles.td}>
                        <Badge
                          label={ROL_LABEL[emp.rol] ?? emp.rol}
                          variant={ROL_VARIANT[emp.rol] ?? 'muted'}
                        />
                      </td>

                      <td className={styles.td}>
                        <Badge
                          label={esActivo ? 'Activo' : 'Inactivo'}
                          variant={esActivo ? 'success' : 'muted'}
                        />
                      </td>

                      <td className={styles.td}>
                        <span className={styles.fechaText}>
                          {emp.fecha_contratacion
                            ? new Date(emp.fecha_contratacion + 'T12:00:00').toLocaleDateString('es-GT', {
                                day: '2-digit', month: 'short', year: 'numeric',
                              })
                            : '—'}
                        </span>
                      </td>

                      {esAdmin && (
                        <td className={`${styles.td} ${styles.tdActions}`}>
                          <div className={styles.actionBtns}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onEditar(emp)}
                              title="Editar datos del empleado"
                            >
                              <IconEdit /> Editar
                            </button>
                            <button
                              type="button"
                              className={`btn btn-ghost btn-sm ${esActivo ? styles.btnToggleOff : styles.btnToggleOn}`}
                              onClick={() => onToggle(emp)}
                              title={esActivo ? 'Desactivar acceso' : 'Activar acceso'}
                            >
                              {esActivo ? <IconToggleOff /> : <IconToggleOn />}
                              {esActivo ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.tableFooter}>
            <span className={styles.resultCount}>
              Mostrando {totalFiltrados} de {totalGeneral} colaboradores
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
