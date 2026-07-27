/**
 * components/layout/shared/LayoutBottomNav.jsx
 * ---------------------------------------------------------------------------
 * Nav inferior compartido por AppLayout (técnico) y SupervisorLayout.
 * Misma estructura DOM para ambos: <nav> con un <NavLink> por item.
 * variant="app" -> barra fija de ancho completo (estilo tab bar móvil).
 * variant="supervisor" -> píldora flotante (estilo desktop), colapsa a
 * barra completa en pantallas chicas vía CSS (ver módulo de estilos).
 * ---------------------------------------------------------------------------
 */

import { NavLink } from 'react-router-dom'
import styles from './LayoutBottomNav.module.css'

export default function LayoutBottomNav({ items, variant = 'app' }) {
  return (
    <nav className={`${styles.bottomNav} ${variant === 'supervisor' ? styles.pill : ''}`}>
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