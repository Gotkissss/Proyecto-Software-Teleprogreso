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
import { puedeAcceder } from '../../../utils/permisos'
import styles from './LayoutSidebar.module.css'

/* HU-S9-01: lo que el rol no puede llamar no se enseña. Se filtra con la
   misma tabla que usa ProtectedRoute (utils/permisos.js), así el menú y las
   rutas no se desincronizan. Un grupo que se queda sin enlaces desaparece
   entero para no dejar un título huérfano. */
function filtrarGruposPorRol(groups, rol) {
  return groups
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => puedeAcceder(rol, item.to)),
    }))
    .filter((grupo) => grupo.items.length > 0)
}

export default function LayoutSidebar({
  brand,
  groups,
  rol,
  footer,
  abierto = false,
  onCerrar,
}) {
  // Sin `rol` no se filtra (compatibilidad con quien no lo pase); si llega,
  // incluso vacío, manda la tabla de permisos y no se enseña nada ajeno.
  const gruposVisibles = rol === undefined ? groups : filtrarGruposPorRol(groups, rol)

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
          {gruposVisibles.map(({ label, items }) => (
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