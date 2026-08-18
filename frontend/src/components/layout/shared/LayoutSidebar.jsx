/**
 * components/layout/shared/LayoutSidebar.jsx
 * ---------------------------------------------------------------------------
 * Barra lateral de navegación del panel de supervisor.
 *
 * Sustituye a la píldora flotante de LayoutBottomNav: con siete secciones la
 * píldora ocupaba media pantalla y tapaba el contenido al hacer scroll. En
 * vertical caben todas con espacio de sobra y se pueden agrupar por área, que
 * es lo que se espera de un panel de escritorio.
 *
 * En pantallas chicas (<= 1024px) la barra se comporta como cajón: sale de
 * fuera de pantalla con el botón de menú del header y se cierra al navegar,
 * al pulsar el fondo o con Escape.
 * ---------------------------------------------------------------------------
 */

import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import styles from './LayoutSidebar.module.css'

export default function LayoutSidebar({
  brand,
  groups,
  footer,
  abierto = false,
  onCerrar,
}) {
  // Cerrar el cajón con Escape: el backdrop solo cubre el clic.
  useEffect(() => {
    if (!abierto) return
    const alPulsar = (e) => e.key === 'Escape' && onCerrar?.()
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [abierto, onCerrar])

  return (
    <>
      {abierto && (
        <div
          className={styles.backdrop}
          onClick={onCerrar}
          aria-hidden="true"
        />
      )}

      <aside className={`${styles.sidebar} ${abierto ? styles.abierto : ''}`}>
        <div className={styles.brand}>{brand}</div>

        <nav className={styles.nav} aria-label="Navegación principal">
          {groups.map(({ label, items }) => (
            <div className={styles.group} key={label}>
              <span className={styles.groupLabel}>{label}</span>

              {items.map(({ to, label: itemLabel, Icon, badge, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onCerrar}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.active : ''}`
                  }
                >
                  <span className={styles.navIcon}><Icon /></span>
                  <span className={styles.navLabel}>{itemLabel}</span>
                  {badge > 0 && (
                    <span className={styles.navBadge}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {footer && <div className={styles.footer}>{footer}</div>}
      </aside>
    </>
  )
}
