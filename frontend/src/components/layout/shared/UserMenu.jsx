/**
 * components/layout/shared/UserMenu.jsx
 * ---------------------------------------------------------------------------
 * Avatar + menú desplegable con los datos del usuario y "Cerrar sesión".
 * Compartido por AppLayout (técnico) y SupervisorLayout: antes cada layout
 * tenía su propia versión — el técnico ni siquiera tenía menú, solo un botón
 * que cerraba sesión de golpe sin confirmación visual.
 *
 * variant="app"        → solo el avatar (pantalla angosta del técnico)
 * variant="supervisor" → avatar + nombre y rol al lado
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from 'react'
import styles from './UserMenu.module.css'

const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

export default function UserMenu({ user, onLogout, variant = 'app' }) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef(null)

  // Cerrar con Escape: el backdrop cubre el clic fuera, pero no el teclado.
  useEffect(() => {
    if (!abierto) return
    const alPulsar = (e) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [abierto])

  if (!user) return null

  const nombre = user.nombre || 'Usuario'
  const rol = user.rol
    ? user.rol.charAt(0).toUpperCase() + user.rol.slice(1)
    : 'Usuario'

  return (
    <div className={styles.userMenu} ref={contenedor}>
      <button
        className={`${styles.avatarBtn} ${variant === 'supervisor' ? styles.conInfo : ''}`}
        onClick={() => setAbierto((v) => !v)}
        title={nombre}
        aria-haspopup="menu"
        aria-expanded={abierto}
      >
        <span className={styles.avatarInitial}>
          {nombre[0]?.toUpperCase() ?? 'U'}
        </span>
        {variant === 'supervisor' && (
          <span className={styles.userInfo}>
            <span className={styles.userName}>{nombre}</span>
            <span className={styles.userRole}>{rol}</span>
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div className={styles.menuBackdrop} onClick={() => setAbierto(false)} />
          <div className={styles.dropdown} role="menu">
            <div className={styles.dropdownHeader}>
              <strong>{nombre}</strong>
              <span>{user.correo}</span>
              <span className={styles.dropdownRol}>{rol}</span>
            </div>
            <button
              className={styles.dropdownItem}
              role="menuitem"
              onClick={() => { setAbierto(false); onLogout?.() }}
            >
              <IconLogout />
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  )
}
