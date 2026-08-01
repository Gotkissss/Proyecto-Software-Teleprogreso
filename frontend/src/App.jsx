import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }    from './context/AuthContext'
import { ToastProvider }   from './components/ui/Toast'
import ProtectedRoute      from './components/layout/ProtectedRoute'
import AppLayout           from './components/layout/AppLayout'
import SupervisorLayout    from './components/layout/SupervisorLayout'

/* Páginas del técnico */
import LoginPage      from './pages/LoginPage'
import RutaDiariaPage from './pages/RutaDiariaPage'
import MapaPage       from './pages/MapaPage'
import PausasPage     from './pages/PausasPage'
import EquipoPage     from './pages/EquipoPage'
/* Historial de tareas completadas — la misma pantalla sirve a técnico y
   supervisor; el backend decide qué puede ver cada rol. */
import HistorialTareasPage from './pages/HistorialTareasPage'

/* Páginas del supervisor */
import DashboardPage    from './pages/DashboardPage'
import AlertasPage      from './pages/AlertasPage'
import ReasignacionPage from './pages/ReasignacionPage'
import EmpleadosPage    from './pages/EmpleadosPage'
import NuevaTareaPage from './pages/NuevaTareaPage'
import InventarioPage from './pages/InventarioPage'
import CarroDetallePage from './pages/CarroDetallePage'
import HistorialAsistenciaPage from './pages/HistorialAsistenciaPage'

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
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/ruta" replace />} />
            <Route path="/ruta"   element={<RutaDiariaPage />} />
            <Route path="/mapa"   element={<MapaPage />} />
            <Route path="/pausas" element={<PausasPage />} />
            <Route path="/historial" element={<HistorialTareasPage />} />
            <Route path="/equipo" element={<EquipoPage />} />
          </Route>

          {/* ── Rutas del supervisor (desktop) ──────────── */}
          <Route
            path="/supervisor"
            element={
              <ProtectedRoute>
                <SupervisorLayout />
              </ProtectedRoute>
            }
          >
            <Route path="carros/:id" element={<CarroDetallePage />} />
            <Route index element={<Navigate to="/supervisor/dashboard" replace />} />
            <Route path="dashboard"    element={<DashboardPage />} />
            <Route path="alertas"      element={<AlertasPage />} />
            <Route path="reasignacion" element={<ReasignacionPage />} />
            <Route path="empleados"    element={<EmpleadosPage />} />
            <Route path="nueva-tarea" element={<NuevaTareaPage />} />
            <Route path="inventario"   element={<InventarioPage />} />
            <Route path="asistencia"   element={<HistorialAsistenciaPage />} />
            <Route path="historial-tareas" element={<HistorialTareasPage />} />
            
          </Route>

          {/* ── 404 ──────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}