/**
 * HU-S9-01 (tarea 6): permisos por ruta de punta a punta.
 *
 * Monta el App.jsx real (con las pantallas y los layouts sustituidos por
 * marcadores, para no tocar la red) y comprueba, rol por rol, que:
 *   - la ruta que el rol no puede usar muestra el 403 del cliente,
 *   - la que sí puede usar muestra la pantalla.
 *
 * Así se prueba el cableado real (ProtectedRoute + utils/permisos.js dentro de
 * App.jsx), no solo cada pieza por separado. El backend sigue siendo quien manda.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const auth = vi.hoisted(() => ({ estado: {} }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth.estado,
  AuthProvider: ({ children }) => children,
}))

/* Layouts: solo dejan pasar a las rutas hijas. */
vi.mock('../components/layout/AppLayout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { default: () => <Outlet /> }
})
vi.mock('../components/layout/SupervisorLayout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { default: () => <Outlet /> }
})

/* Pantallas: un marcador común en lugar de la pantalla real. */
vi.mock('../pages/LoginPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/RutaDiariaPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/MapaPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/PausasPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/EquipoPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/HistorialTareasPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/PerfilPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/DashboardPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/MapaSupervisorPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/AlertasPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/ReasignacionPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/EmpleadosPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/NuevaTareaPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/InventarioPage', () => ({ default: () => <p>PANTALLA_REAL</p> }))
vi.mock('../pages/CarroDetallePage', () => ({ default: () => <p>PANTALLA_REAL</p> }))

import App from '../App'
import ProtectedRoute from '../components/layout/ProtectedRoute'
import {
  PERMISOS_RUTAS,
  ROLES,
  puedeAcceder,
  rolesPermitidos,
} from '../utils/permisos'

/* Rutas de la tabla que todavía no están montadas en App.jsx.
   /supervisor/reportes llega con la HU-S9-04 (ReportesPage). Cuando se monte,
   quitarla de aquí para que el cableado real también la recorra. */
const RUTAS_SIN_MONTAR = ['/supervisor/reportes']

const TODOS_LOS_ROLES = Object.values(ROLES)
const RUTAS_EN_APP = Object.keys(PERMISOS_RUTAS).filter((ruta) => !RUTAS_SIN_MONTAR.includes(ruta))

function conRol(rol) {
  auth.estado = { user: { rol }, isLoading: false, isAuthenticated: true }
}

/* Las rutas con parámetro se visitan con un valor concreto. */
function urlDe(ruta) {
  return ruta.replace(':id', '1')
}

function irA(ruta) {
  window.history.pushState({}, '', urlDe(ruta))
  return render(<App />)
}

function esperarPantalla() {
  expect(screen.getByText('PANTALLA_REAL')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
}

function esperar403() {
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByText('No tienes acceso a esta pantalla')).toBeInTheDocument()
  expect(screen.queryByText('PANTALLA_REAL')).not.toBeInTheDocument()
}

describe('permisos por ruta (casos de la HU-S9-01)', () => {
  beforeEach(() => {
    auth.estado = {}
  })

  it('técnico → /supervisor/empleados da 403', () => {
    conRol(ROLES.TECNICO)
    irA('/supervisor/empleados')
    esperar403()
  })

  it('gerente → /supervisor/reasignacion da 403', () => {
    conRol(ROLES.GERENTE)
    irA('/supervisor/reasignacion')
    esperar403()
  })

  it('gerente → /supervisor/reportes entra', () => {
    // La ruta se monta en la HU-S9-04; mientras tanto se prueba con la misma
    // tabla y el mismo ProtectedRoute que usará App.jsx.
    conRol(ROLES.GERENTE)
    render(
      <MemoryRouter initialEntries={['/supervisor/reportes']}>
        <Routes>
          <Route
            path="/supervisor/reportes"
            element={
              <ProtectedRoute roles={rolesPermitidos('/supervisor/reportes')}>
                <p>PANTALLA_REAL</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    esperarPantalla()
  })

  it('supervisor ve todo lo suyo y nada más', () => {
    conRol(ROLES.SUPERVISOR)
    for (const ruta of RUTAS_EN_APP) {
      const { unmount } = irA(ruta)
      if (puedeAcceder(ROLES.SUPERVISOR, ruta)) {
        esperarPantalla()
      } else {
        esperar403()
      }
      unmount()
    }
  })

  it('gerente → pantallas del panel que sí son suyas entran', () => {
    conRol(ROLES.GERENTE)
    for (const ruta of ['/supervisor/mapa', '/supervisor/alertas', '/supervisor/inventario', '/supervisor/historial-tareas']) {
      const { unmount } = irA(ruta)
      esperarPantalla()
      unmount()
    }
  })
})

describe('reportes: solo admin y gerente', () => {
  function montarReportes() {
    return render(
      <MemoryRouter initialEntries={['/supervisor/reportes']}>
        <Routes>
          <Route
            path="/supervisor/reportes"
            element={
              <ProtectedRoute roles={rolesPermitidos('/supervisor/reportes')}>
                <p>PANTALLA_REAL</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )
  }

  it.each([ROLES.ADMIN, ROLES.GERENTE])('%s entra', (rol) => {
    conRol(rol)
    montarReportes()
    esperarPantalla()
  })

  it.each([ROLES.SUPERVISOR, ROLES.TECNICO])('%s recibe 403', (rol) => {
    conRol(rol)
    montarReportes()
    esperar403()
  })
})

describe('cada ruta de la tabla, para cada rol, se comporta como dice utils/permisos.js', () => {
  const casos = TODOS_LOS_ROLES.flatMap((rol) =>
    RUTAS_EN_APP.map((ruta) => [rol, ruta, puedeAcceder(rol, ruta)])
  )

  it.each(casos)('%s en %s → permitido: %s', (rol, ruta, permitido) => {
    conRol(rol)
    irA(ruta)
    if (permitido) {
      esperarPantalla()
    } else {
      esperar403()
    }
  })
})