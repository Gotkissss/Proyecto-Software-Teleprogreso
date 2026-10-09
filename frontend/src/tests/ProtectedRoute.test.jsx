import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const auth = vi.hoisted(() => ({ estado: {} }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth.estado,
  AuthProvider: ({ children }) => children,
}))

import ProtectedRoute from '../components/layout/ProtectedRoute'
import { rutaInicialPorRol } from '../utils/permisos'

function conSesion(user) {
  auth.estado = { user, isLoading: false, isAuthenticated: !!user }
}

function montar(roles) {
  return render(
    <MemoryRouter initialEntries={['/privada']}>
      <Routes>
        <Route path="/login" element={<p>Pantalla de login</p>} />
        <Route
          path="/privada"
          element={
            <ProtectedRoute roles={roles}>
              <p>Contenido privado</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    conSesion({ rol: 'supervisor' })
  })

  it('muestra el spinner mientras carga la sesión', () => {
    auth.estado = { user: null, isLoading: true, isAuthenticated: false }
    montar(['supervisor'])
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it('sin sesión navega a /login', () => {
    conSesion(null)
    montar(['supervisor'])
    expect(screen.getByText('Pantalla de login')).toBeInTheDocument()
  })

  it('con rol permitido renderiza el hijo', () => {
    montar(['admin', 'supervisor'])
    expect(screen.getByText('Contenido privado')).toBeInTheDocument()
  })

  it('con rol no permitido muestra el 403 y no el hijo', () => {
    conSesion({ rol: 'tecnico' })
    montar(['admin', 'supervisor'])
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('No tienes acceso a esta pantalla')).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it('el enlace del 403 apunta a la pantalla inicial del rol', () => {
    conSesion({ rol: 'gerente' })
    montar(['admin', 'supervisor'])
    const enlace = screen.getByRole('link', { name: 'Ir a mi pantalla de inicio' })
    expect(enlace).toHaveAttribute('href', rutaInicialPorRol('gerente'))
  })

  it('el 403 no revela qué roles sí pueden entrar', () => {
    conSesion({ rol: 'tecnico' })
    montar(['admin', 'supervisor'])
    expect(screen.getByRole('alert').textContent).not.toMatch(/\badmin\b|supervisor/)
  })

  it('roles vacío deniega a todos', () => {
    conSesion({ rol: 'admin' })
    montar([])
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it.each([null, 'admin', { admin: true }])('roles que no es arreglo (%s) deniega', (roles) => {
    conSesion({ rol: 'admin' })
    montar(roles)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it('user sin rol deniega', () => {
    conSesion({ nombre: 'Sin rol' })
    montar(['admin', 'supervisor', 'gerente', 'tecnico'])
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a mi pantalla de inicio' }))
      .toHaveAttribute('href', '/login')
  })

  it('sin prop roles deja pasar a cualquier sesión', () => {
    conSesion({ rol: 'tecnico' })
    montar(undefined)
    expect(screen.getByText('Contenido privado')).toBeInTheDocument()
  })
})
