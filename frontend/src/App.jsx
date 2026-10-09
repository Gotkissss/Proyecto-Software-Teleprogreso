import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }    from './context/AuthContext'
import { ToastProvider }   from './components/ui/Toast'
import ProtectedRoute      from './components/layout/ProtectedRoute'
import AppLayout           from './components/layout/AppLayout'
import SupervisorLayout    from './components/layout/SupervisorLayout'
import RedirigirInicio     from './components/layout/RedirigirInicio'

/* Páginas del técnico */
import LoginPage      from './pages/LoginPage'
import RutaDiariaPage from './pages/RutaDiariaPage'
import MapaPage       from './pages/MapaPage'
import PausasPage     from './pages/PausasPage'
import EquipoPage     from './pages/EquipoPage'
/* Historial de tareas completadas — la misma pantalla sirve a técnico y
   supervisor; el backend decide qué puede ver cada rol. */
import HistorialTareasPage from './pages/HistorialTareasPage'
/* Perfil del usuario autenticado — se monta bajo los dos layouts porque se
   abre desde el menú del avatar, que es común a técnico y supervisor. */
import PerfilPage from './pages/PerfilPage'

/* Páginas del supervisor */
import DashboardPage    from './pages/DashboardPage'
import MapaSupervisorPage from './pages/MapaSupervisorPage'
import AlertasPage      from './pages/AlertasPage'
import ReasignacionPage from './pages/ReasignacionPage'
import EmpleadosPage    from './pages/EmpleadosPage'
import NuevaTareaPage from './pages/NuevaTareaPage'
import InventarioPage from './pages/InventarioPage'
import CarroDetallePage from './pages/CarroDetallePage'

import { rolesPermitidos, ROLES_RAMA_TECNICO, ROLES_RAMA_SUPERVISOR } from './utils/permisos'

function protegida(ruta, pagina) {
  return <ProtectedRoute roles={rolesPermitidos(ruta)}>{pagina}</ProtectedRoute>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          {/* ── Pública ─────────────────────────────────── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ── Rutas del técnico (móvil) ───────────────── */}
          <Route
            element={
              <ProtectedRoute roles={ROLES_RAMA_TECNICO}>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/ruta" replace />} />
            <Route path="/ruta"   element={protegida('/ruta', <RutaDiariaPage />)} />
            <Route path="/mapa"   element={protegida('/mapa', <MapaPage />)} />
            <Route path="/pausas" element={protegida('/pausas', <PausasPage />)} />
            <Route path="/historial" element={protegida('/historial', <HistorialTareasPage />)} />
            <Route path="/equipo" element={protegida('/equipo', <EquipoPage />)} />
            <Route path="/perfil" element={protegida('/perfil', <PerfilPage />)} />
          </Route>

          {/* ── Rutas del supervisor (desktop) ──────────── */}
          <Route
            path="/supervisor"
            element={
              <ProtectedRoute roles={ROLES_RAMA_SUPERVISOR}>
                <SupervisorLayout />
              </ProtectedRoute>
            }
          >
            <Route path="carros/:id" element={protegida('/supervisor/carros/:id', <CarroDetallePage />)} />
            {/* HU-S9-01: cada rol entra por su pantalla inicial, no todos por el panel. */}
            <Route index element={<RedirigirInicio />} />
            <Route path="dashboard"    element={protegida('/supervisor/dashboard', <DashboardPage />)} />
            {/* HU-165: mapa del equipo, con tareas agrupadas por técnico. */}
            <Route path="mapa"         element={protegida('/supervisor/mapa', <MapaSupervisorPage />)} />
            <Route path="alertas"      element={protegida('/supervisor/alertas', <AlertasPage />)} />
            <Route path="reasignacion" element={protegida('/supervisor/reasignacion', <ReasignacionPage />)} />
            <Route path="empleados"    element={protegida('/supervisor/empleados', <EmpleadosPage />)} />
            <Route path="nueva-tarea" element={protegida('/supervisor/nueva-tarea', <NuevaTareaPage />)} />
            <Route path="inventario"   element={protegida('/supervisor/inventario', <InventarioPage />)} />
            {/* El historial de asistencia vive dentro de Empleados. Se deja
                la redirección para que los enlaces y marcadores que apuntaban
                a la pantalla suelta sigan funcionando. */}
            <Route
              path="asistencia"
              element={<Navigate to="/supervisor/empleados?tab=historial" replace />}
            />
            <Route path="historial-tareas" element={protegida('/supervisor/historial-tareas', <HistorialTareasPage />)} />
            <Route path="perfil" element={protegida('/supervisor/perfil', <PerfilPage />)} />
            
          </Route>

          {/* ── 404 ──────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}