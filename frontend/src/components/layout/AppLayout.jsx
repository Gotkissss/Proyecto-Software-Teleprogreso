/**
 * components/layout/AppLayout.jsx
 * ---------------------------------------------------------------------------
 * Layout principal que envuelve todas las páginas protegidas del técnico.
 *
 * Usa los mismos componentes compartidos que SupervisorLayout
 * (LayoutHeader / LayoutBottomNav / UserMenu), así que ambos paneles tienen
 * idéntica estructura de DOM y los mismos tokens de diseño; solo cambia la
 * variante visual.
 * ---------------------------------------------------------------------------
 */

import { Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import LayoutHeader from './shared/LayoutHeader'
import LayoutBottomNav from './shared/LayoutBottomNav'
import UserMenu from './shared/UserMenu'
import styles from './AppLayout.module.css'

/* ── Iconos SVG inline ───────────────────────────────────────────────────── */
const IconRuta = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
)
const IconMapa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)
const IconPausas = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="10" y1="15" x2="10" y2="9" /><line x1="14" y1="15" x2="14" y2="9" />
  </svg>
)
const IconEquipo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const IconHistorial = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
)
const IconLogo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

const NAV_ITEMS = [
  { to: '/ruta',      label: 'Ruta',      Icon: IconRuta },
  { to: '/mapa',      label: 'Mapa',      Icon: IconMapa },
  { to: '/pausas',    label: 'Pausas',    Icon: IconPausas },
  // Lo que el técnico ya cerró, por día: la ruta diaria solo muestra el día
  // en curso, así que sin esto no había forma de revisar el trabajo pasado.
  { to: '/historial', label: 'Historial', Icon: IconHistorial },
  { to: '/equipo',    label: 'Equipo',    Icon: IconEquipo },
]

export default function AppLayout() {
  const { user, logoutUser } = useAuth()

  // El backend /auth/me devuelve { nombre: "Nombre Apellido", ... }
  const primerNombre = (user?.nombre || 'Técnico').split(' ')[0]

  return (
    <div className={styles.wrapper}>
      <LayoutHeader
        variant="app"
        logo={<span className={styles.logoBox}><IconLogo /></span>}
        title="Teleprogreso"
        subtitle={`Hola, ${primerNombre}`}
        right={<UserMenu user={user} onLogout={logoutUser} variant="app" />}
      />

      <main className={styles.main}>
        <Outlet />
      </main>

      <LayoutBottomNav items={NAV_ITEMS} />
    </div>
  )
}
