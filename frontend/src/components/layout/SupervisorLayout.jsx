/**
 * components/layout/SupervisorLayout.jsx
 * ---------------------------------------------------------------------------
 * Layout para las rutas del supervisor — diseño desktop a ancho completo.
 * Usa los componentes compartidos LayoutHeader / LayoutBottomNav (misma
 * estructura que AppLayout) con variant="supervisor".
 * ---------------------------------------------------------------------------
 */

import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAlertasPendientesCount } from '../../hooks/useAlertasPendientesCount'
import LayoutHeader from './shared/LayoutHeader'
import LayoutBottomNav from './shared/LayoutBottomNav'
import UserMenu from './shared/UserMenu'
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

const NAV_ITEMS = [
  { to: '/supervisor/dashboard',        label: 'Panel',      Icon: IconDashboard },
  { to: '/supervisor/alertas',          label: 'Alertas',    Icon: IconAlertas },
  { to: '/supervisor/reasignacion',     label: 'Reasignar',  Icon: IconReasignar },
  // Historial de lo cerrado por día, con evidencia. Antes el panel solo
  // mostraba las últimas cinco tareas y no había forma de auditar un día.
  { to: '/supervisor/historial-tareas', label: 'Realizadas', Icon: IconHistorialTareas },
  // El historial de asistencia no tiene entrada propia: vive como tab dentro
  // de Empleados. Tener las dos puertas a la misma tabla obligaba al
  // supervisor a recordar cuál de las dos usar, y la ruta suelta se quedaba
  // sin el contexto del empleado que estaba consultando.
  { to: '/supervisor/empleados',        label: 'Empleados',  Icon: IconEmpleados },
  { to: '/supervisor/inventario',       label: 'Inventario', Icon: IconInventario },
]

export default function SupervisorLayout() {
  const { user, logoutUser } = useAuth()
  const navigate = useNavigate()
  const alertasPendientes = useAlertasPendientesCount()

  const displayRole = user?.rol ? user.rol.charAt(0).toUpperCase() + user.rol.slice(1) : 'Supervisor'

  return (
    <div className={styles.wrapper}>
      <LayoutHeader
        variant="supervisor"
        logo={<img src="/teleprogreso-logo.png" alt="Teleprogreso" className={styles.logo} />}
        title="Teleprogreso"
        subtitle={`Panel · ${displayRole}`}
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

      <LayoutBottomNav variant="supervisor" items={NAV_ITEMS} />
    </div>
  )
}