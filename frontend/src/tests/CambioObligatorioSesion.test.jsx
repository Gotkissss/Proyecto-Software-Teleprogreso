/**
 * tests/CambioObligatorioSesion.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-01 (tarea 4) — AuthContext y el cambio de contraseña obligatorio.
 *
 *   1. Al iniciar sesión con la bandera, se navega a /cambiar-contrasena y no
 *      a la pantalla inicial del rol.
 *   2. Sin la bandera (cuentas del seed) todo sigue igual.
 *   3. Si el backend responde 403 PASSWORD_CHANGE_REQUIRED con la sesión ya
 *      abierta, el usuario queda marcado.
 * ---------------------------------------------------------------------------
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  EVENTO_SESION_CADUCADA: 'teleprogreso:sesion-caducada',
  marcarSesionIniciada: vi.fn(),
  default: { get: getMock, post: postMock, patch: vi.fn() },
}))

import { AuthProvider, useAuth } from '../context/AuthContext'
import { EVENTO_CAMBIO_OBLIGATORIO } from '../utils/cambioObligatorio'

function Sonda() {
  const { user, loginUser } = useAuth()
  return (
    <div>
      <p>Pendiente: {user?.debe_cambiar_contrasena ? 'sí' : 'no'}</p>
      <p>Usuario: {user?.nombre ?? 'ninguno'}</p>
      <button type="button" onClick={() => loginUser('ana@teleprogreso.com', 'clave')}>
        entrar
      </button>
    </div>
  )
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/inicio']}>
      <AuthProvider>
        <Routes>
          <Route path="/inicio" element={<Sonda />} />
          <Route path="/ruta" element={<p>Pantalla inicial del técnico</p>} />
          <Route path="/cambiar-contrasena" element={<p>Pantalla de cambio obligatorio</p>} />
          <Route path="/login" element={<p>Pantalla de login</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  postMock.mockResolvedValue({ data: { access_token: 'token', rol: 'tecnico' } })
})

describe('login', () => {
  it('con el cambio pendiente va a /cambiar-contrasena, no a su pantalla inicial', async () => {
    getMock.mockResolvedValue({
      data: { id_empleado: 7, nombre: 'Ana', rol: 'tecnico', debe_cambiar_contrasena: true },
    })
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'entrar' }))

    expect(await screen.findByText('Pantalla de cambio obligatorio')).toBeInTheDocument()
    expect(screen.queryByText('Pantalla inicial del técnico')).not.toBeInTheDocument()
  })

  it('sin la bandera va a su pantalla inicial', async () => {
    getMock.mockResolvedValue({ data: { id_empleado: 7, nombre: 'Ana', rol: 'tecnico' } })
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'entrar' }))

    expect(await screen.findByText('Pantalla inicial del técnico')).toBeInTheDocument()
  })
})

describe('403 PASSWORD_CHANGE_REQUIRED con la sesión abierta', () => {
  it('marca al usuario como pendiente de cambiar la contraseña', async () => {
    localStorage.setItem('access_token', 'token')
    getMock.mockResolvedValue({ data: { id_empleado: 7, nombre: 'Ana', rol: 'tecnico' } })
    montar()

    expect(await screen.findByText('Usuario: Ana')).toBeInTheDocument()
    expect(screen.getByText('Pendiente: no')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO_OBLIGATORIO))
    })

    await waitFor(() => expect(screen.getByText('Pendiente: sí')).toBeInTheDocument())
    // La sesión sigue en pie: solo cambia la bandera.
    expect(screen.getByText('Usuario: Ana')).toBeInTheDocument()
    expect(localStorage.getItem('access_token')).toBe('token')
  })

  it('sin sesión el evento no inventa un usuario', async () => {
    montar()
    await screen.findByText('Usuario: ninguno')

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO_OBLIGATORIO))
    })

    expect(screen.getByText('Usuario: ninguno')).toBeInTheDocument()
    expect(screen.getByText('Pendiente: no')).toBeInTheDocument()
  })
})