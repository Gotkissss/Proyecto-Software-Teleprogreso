/**
 * HU-S9-01 (tarea 5): redirección inicial por rol.
 * - AuthContext.getRedirectPath (vía loginUser) usa la tabla de permisos.
 * - El índice de /supervisor manda a cada rol a su pantalla inicial.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const servicio = vi.hoisted(() => ({
  login: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../api/authService', () => servicio)

import { AuthProvider } from '../context/AuthContext'
import { useAuth } from '../context/AuthContext'
import ProtectedRoute from '../components/layout/ProtectedRoute'
import RedirigirInicio from '../components/layout/RedirigirInicio'
import { ROLES_RAMA_SUPERVISOR, puedeAcceder, rutaInicialPorRol } from '../utils/permisos'

function Ubicacion() {
  const { pathname } = useLocation()
  return <p data-testid="ruta">{pathname}</p>
}

function BotonLogin() {
  const { loginUser } = useAuth()
  return <button onClick={() => loginUser('a@b.com', 'x')}>entrar</button>
}

async function iniciarSesionComo(rol) {
  servicio.login.mockResolvedValue({ rol })
  servicio.getMe.mockResolvedValue({ rol })
  localStorage.clear()

  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <BotonLogin />
        <Ubicacion />
      </AuthProvider>
    </MemoryRouter>
  )
  await userEvent.click(screen.getByText('entrar'))
}

describe('loginUser redirige por rol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['admin', '/supervisor/dashboard'],
    ['supervisor', '/supervisor/dashboard'],
    ['gerente', rutaInicialPorRol('gerente')],
    ['tecnico', '/ruta'],
  ])('%s aterriza en %s', async (rol, esperada) => {
    await iniciarSesionComo(rol)
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent(esperada))
  })

  it('el gerente no aterriza en una pantalla que su rol no puede abrir', async () => {
    await iniciarSesionComo('gerente')
    await waitFor(() => expect(screen.getByTestId('ruta')).not.toHaveTextContent('/login'))
    const destino = screen.getByTestId('ruta').textContent
    expect(destino).not.toBe('/supervisor/dashboard')
    expect(puedeAcceder('gerente', destino)).toBe(true)
  })
})

describe('índice de /supervisor', () => {
  async function montarIndice(rol) {
    servicio.getMe.mockResolvedValue({ rol })
    localStorage.setItem('access_token', 'token-de-prueba')

    render(
      <MemoryRouter initialEntries={['/supervisor']}>
        <AuthProvider>
          <Routes>
            {/* Igual que en App.jsx: el índice vive dentro de ProtectedRoute. */}
            <Route
              path="/supervisor"
              element={
                <ProtectedRoute roles={ROLES_RAMA_SUPERVISOR}>
                  <RedirigirInicio />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Ubicacion />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )
  }

  it.each([
    ['admin', '/supervisor/dashboard'],
    ['supervisor', '/supervisor/dashboard'],
    ['gerente', rutaInicialPorRol('gerente')],
  ])('%s cae en %s', async (rol, esperada) => {
    await montarIndice(rol)
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent(esperada))
  })
})