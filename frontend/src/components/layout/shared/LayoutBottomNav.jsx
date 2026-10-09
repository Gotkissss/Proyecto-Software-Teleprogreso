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
import { puedeAcceder } from '../../../utils/permisos'
import styles from './LayoutBottomNav.module.css'

export default function LayoutBottomNav({ items, rol }) {
  // HU-S9-01: lo que el rol no puede abrir no se enseña. Sin `rol` no se
  // filtra; si llega, incluso vacío, manda la tabla de utils/permisos.js.
  const itemsVisibles = rol === undefined
    ? items
    : items.filter((item) => puedeAcceder(rol, item.to))

  return (
    <nav className={styles.bottomNav} aria-label="Navegación principal">
      {itemsVisibles.map(({ to, label, Icon }) => (
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