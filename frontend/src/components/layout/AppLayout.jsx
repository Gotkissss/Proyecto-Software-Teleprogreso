/**
 * components/layout/AppLayout.jsx
 * ---------------------------------------------------------------------------
 * Layout principal que envuelve todas las páginas protegidas del técnico.
 * Incluye la barra de navegación superior y la inferior (tab bar).
 * ---------------------------------------------------------------------------
 */

import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import styles from './AppLayout.module.css'

/* ── Iconos SVG inline ───────────────────────────────────────────────────── */
const IconRuta   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
const IconMapa   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
const IconPausas = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
const IconEquipo = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const IconMenu   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6"  x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
const IconLogo   = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
)

const NAV_ITEMS = [
  { to: '/ruta',   label: 'Ruta',   Icon: IconRuta },
  { to: '/mapa',   label: 'Mapa',   Icon: IconMapa },
  { to: '/pausas', label: 'Pausas', Icon: IconPausas },
  { to: '/equipo', label: 'Equipo', Icon: IconEquipo },
]

export default function AppLayout() {
  const { user, logoutUser } = useAuth()

  // El backend /auth/me devuelve { nombre: "Nombre Apellido", ... }
  const displayName = user?.nombre || 'Usuario'

  return (
    <div className={styles.wrapper}>
      {/* ── Barra superior ─────────────────────────────── */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.logo}><IconLogo /></span>
          <span className={styles.appName}>Teleprogreso</span>
        </div>
        <div className={styles.topBarRight}>
          {user && (
            <button
              className={styles.avatarBtn}
              title={displayName}
            >
              <span className={styles.avatarInitial}>
                {displayName[0]?.toUpperCase() ?? 'U'}
              </span>
            </button>
          )}
          <button
            className={styles.menuBtn}
            onClick={logoutUser}
            title="Cerrar sesión"
          >
            <IconMenu />
          </button>
        </div>
      </header>

      {/* ── Contenido de la página ─────────────────────── */}
      <main className={styles.main}>
        <Outlet />
      </main>

      {/* ── Barra de navegación inferior ──────────────── */}
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