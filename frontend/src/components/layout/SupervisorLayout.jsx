/**
 * components/layout/SupervisorLayout.jsx
 * ---------------------------------------------------------------------------
 * Layout para las rutas del supervisor — diseño desktop a ancho completo.
 *
 * La navegación vive en una barra lateral fija (LayoutSidebar) en vez de la
 * píldora flotante que se usaba antes: con siete secciones la píldora se
 * comía el ancho de la pantalla y tapaba el contenido al hacer scroll. En
 * pantallas chicas la barra se pliega en cajón y se abre desde el header.
 *
 * El header (LayoutHeader) se mantiene compartido con AppLayout; aquí pierde
 * el logo, porque la marca pasa a la barra lateral.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAlertasPendientesCount } from '../../hooks/useAlertasPendientesCount'
import LayoutHeader from './shared/LayoutHeader'
import LayoutSidebar from './shared/LayoutSidebar'
import UserMenu from './shared/UserMenu'
import styles from './SupervisorLayout.module.css'

const IconDashboard = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
)

const IconMapa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
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
const IconInventario = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)

const IconHistorialTareas = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
)

const IconMenu = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
)

const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

/* Los enlaces se agrupan por área: en vertical caben las siete secciones, y
   sin separarlas la columna se lee como una lista plana donde cuesta ubicar
   lo que se busca. Son los mismos destinos de siempre, nada nuevo.

   `badgeKey` marca el enlace que lleva contador; el valor se inyecta al
   renderizar para no repetir la lista completa en el componente. */
const NAV_GROUPS = [
  {
    label: 'Operación',
    items: [
      { to: '/supervisor/dashboard', label: 'Panel',   Icon: IconDashboard },
      // HU-165: mapa del equipo, con tareas agrupadas por técnico.
      { to: '/supervisor/mapa',      label: 'Mapa',    Icon: IconMapa },
      { to: '/supervisor/alertas',   label: 'Alertas', Icon: IconAlertas, badgeKey: 'alertas' },
    ],
  },
  {
    label: 'Trabajo',
    items: [
      { to: '/supervisor/reasignacion',     label: 'Reasignar',  Icon: IconReasignar },
      // Historial de lo cerrado por día, con evidencia. Antes el panel solo
      // mostraba las últimas cinco tareas y no había forma de auditar un día.
      { to: '/supervisor/historial-tareas', label: 'Realizadas', Icon: IconHistorialTareas },
    ],
  },
  {
    label: 'Administración',
    items: [
      // El historial de asistencia no tiene entrada propia: vive como tab
      // dentro de Empleados. Tener las dos puertas a la misma tabla obligaba
      // al supervisor a recordar cuál de las dos usar, y la ruta suelta se
      // quedaba sin el contexto del empleado que estaba consultando.
      { to: '/supervisor/empleados',  label: 'Empleados',  Icon: IconEmpleados },
      { to: '/supervisor/inventario', label: 'Inventario', Icon: IconInventario },
    ],
  },
]

export default function SupervisorLayout() {
  const { user, logoutUser } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const alertasPendientes = useAlertasPendientesCount()
  const [menuAbierto, setMenuAbierto] = useState(false)

  const displayRole = user?.rol ? user.rol.charAt(0).toUpperCase() + user.rol.slice(1) : 'Supervisor'

  // El cajón se cierra al navegar. LayoutSidebar ya lo cierra al pulsar uno
  // de sus enlaces, pero no cubre los saltos que dispara la propia pantalla
  // (el botón de alertas del header, por ejemplo).
  useEffect(() => { setMenuAbierto(false) }, [pathname])

  const grupos = NAV_GROUPS.map((grupo) => ({
    ...grupo,
    items: grupo.items.map((item) =>
      item.badgeKey === 'alertas' ? { ...item, badge: alertasPendientes } : item
    ),
  }))

  return (
    <div className={styles.wrapper}>
      <LayoutSidebar
        abierto={menuAbierto}
        onCerrar={() => setMenuAbierto(false)}
        groups={grupos}
        brand={
          <>
            <img src="/teleprogreso-logo.png" alt="Teleprogreso" className={styles.logo} />
            <span className={styles.brand}>
              <span className={styles.brandName}>Teleprogreso</span>
              <span className={styles.brandSub}>Panel · {displayRole}</span>
            </span>
          </>
        }
        footer={
          <button className={styles.logoutBtn} onClick={logoutUser}>
            <IconLogout />
            Cerrar sesión
          </button>
        }
      />

      <div className={styles.content}>
        <LayoutHeader
          variant="supervisor"
          title="Teleprogreso"
          subtitle={`Panel · ${displayRole}`}
          leading={
            <button
              className={styles.menuBtn}
              aria-label="Abrir menú de navegación"
              aria-expanded={menuAbierto}
              onClick={() => setMenuAbierto(true)}
            >
              <IconMenu />
            </button>
          }
          right={
            <>
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

              <UserMenu user={user} onLogout={logoutUser} variant="supervisor" />
            </>
          }
        />

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
