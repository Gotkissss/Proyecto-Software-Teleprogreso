/**
 * components/layout/SupervisorLayout.jsx
 * ---------------------------------------------------------------------------
 * Layout para las rutas del supervisor — diseño desktop a ancho completo.
 * Top bar corporativa con logo real + bottom nav moderna.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAlertasPendientesCount } from '../../hooks/useAlertasPendientesCount'
import styles from './SupervisorLayout.module.css'

const IconDashboard = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
)
const IconAlertas = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)
const IconReasignar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
const IconEmpleados = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const IconBell = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)
const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const IconInventario = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)

const NAV_ITEMS = [
  { to: '/supervisor/dashboard',    label: 'Panel',      Icon: IconDashboard },
  { to: '/supervisor/alertas',      label: 'Alertas',    Icon: IconAlertas },
  { to: '/supervisor/reasignacion', label: 'Reasignar',  Icon: IconReasignar },
  { to: '/supervisor/empleados',    label: 'Empleados',  Icon: IconEmpleados },
  { to: '/supervisor/inventario',   label: 'Inventario', Icon: IconInventario },
]

export default function SupervisorLayout() {
  const { user, logoutUser } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const alertasPendientes = useAlertasPendientesCount()

  const displayName = user?.nombre || 'Supervisor'
  const displayRole = user?.rol ? user.rol.charAt(0).toUpperCase() + user.rol.slice(1) : 'Supervisor'

  return (
    <div className={styles.wrapper}>
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <img
            src="/teleprogreso-logo.png"
            alt="Teleprogreso"
            className={styles.logo}
          />
          <div className={styles.brandText}>
            <span className={styles.brandName}>Teleprogreso</span>
            <span className={styles.brandRole}>Panel · {displayRole}</span>
          </div>
        </div>

        <div className={styles.topBarRight}>
          <button
            className={styles.iconBtn}
            aria-label={`Ver alertas${alertasPendientes > 0 ? ` (${alertasPendientes} pendientes)` : ''}`}
            title="Ver alertas"
            onClick={() => navigate('/supervisor/alertas')}
          >
            <IconBell />
            {alertasPendientes > 0 && (
              <span className={styles.badge}>
                {alertasPendientes > 99 ? '99+' : alertasPendientes}
              </span>
            )}
          </button>

          {user && (
            <div className={styles.userMenu}>
              <button
                className={styles.avatarBtn}
                onClick={() => setMenuOpen((v) => !v)}
                title={displayName}
              >
                <span className={styles.avatarInitial}>
                  {displayName[0]?.toUpperCase() ?? 'S'}
                </span>
                <span className={styles.userInfo}>
                  <span className={styles.userName}>{displayName}</span>
                  <span className={styles.userRole}>{displayRole}</span>
                </span>
              </button>

              {menuOpen && (
                <>
                  <div
                    className={styles.menuBackdrop}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className={styles.dropdown}>
                    <div className={styles.dropdownHeader}>
                      <strong>{displayName}</strong>
                      <span>{user.correo}</span>
                    </div>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => { setMenuOpen(false); logoutUser() }}
                    >
                      <IconLogout />
                      Cerrar sesión
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.bottomNav}>
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.navIcon}><Icon /></span>
            <span className={styles.navLabel}>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}