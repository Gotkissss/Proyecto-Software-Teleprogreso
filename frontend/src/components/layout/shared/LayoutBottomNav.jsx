/**
 * components/layout/shared/LayoutBottomNav.jsx
 * ---------------------------------------------------------------------------
 * Tab bar inferior del técnico: barra fija de ancho completo, un <NavLink>
 * por item.
 *
 * Antes tenía además una variante "supervisor" en forma de píldora flotante.
 * El panel de supervisor pasó a navegar con barra lateral (LayoutSidebar),
 * así que esa variante y sus estilos se retiraron.
 * ---------------------------------------------------------------------------
 */

import { NavLink } from 'react-router-dom'
import styles from './LayoutBottomNav.module.css'

export default function LayoutBottomNav({ items }) {
  return (
    <nav className={styles.bottomNav} aria-label="Navegación principal">
      {items.map(({ to, label, Icon }) => (
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
  )
}
