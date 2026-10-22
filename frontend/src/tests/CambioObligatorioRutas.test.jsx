/**
 * tests/CambioObligatorioRutas.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-01 (tarea 4) — "quien entra con una contraseña puesta por otro no
 * puede hacer nada hasta cambiarla".
 *
 * Cubre ProtectedRoute (encierra al usuario en /cambiar-contrasena) y la
 * pantalla de cambio obligatorio (formulario reutilizado de Mi perfil).
 * ---------------------------------------------------------------------------
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { auth, cambiarContrasenaMock, cerrarSesionLocalMock, logoutUserMock } = vi.hoisted(() => ({
  auth: { estado: {} },
  cambiarContrasenaMock: vi.fn(),
  cerrarSesionLocalMock: vi.fn(),
  logoutUserMock: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    ...auth.estado,
    cerrarSesionLocal: cerrarSesionLocalMock,
    logoutUser: logoutUserMock,
  }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../api/authService', () => ({
  cambiarContrasena: cambiarContrasenaMock,
}))

import ProtectedRoute from '../components/layout/ProtectedRoute'
import { ToastProvider } from '../components/ui/Toast'
import { mensajeDeValidacion } from '../components/perfil/FormularioCambioContrasena'
import CambioObligatorioPage from '../pages/CambioObligatorioPage'
import { RUTA_CAMBIO_OBLIGATORIO } from '../utils/cambioObligatorio'

function conSesion(user) {
  auth.estado = { user, isLoading: false, isAuthenticated: !!user }
}

function montar(rutaInicial = '/privada', roles = ['tecnico']) {
  return render(
    <MemoryRouter initialEntries={[rutaInicial]}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<p>Pantalla de login</p>} />
          <Route path="/ruta" element={<p>Pantalla inicial del técnico</p>} />
          <Route
            path="/privada"
            element={
              <ProtectedRoute roles={roles}>
                <p>Contenido privado</p>
              </ProtectedRoute>
            }
          />
          <Route
            path={RUTA_CAMBIO_OBLIGATORIO}
            element={
              <ProtectedRoute permitirCambioPendiente>
                <CambioObligatorioPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProtectedRoute con el cambio de contraseña pendiente', () => {
  it('lleva a la pantalla de cambio y no deja ver el contenido', () => {
    conSesion({ rol: 'tecnico', debe_cambiar_contrasena: true })
    montar()

    expect(screen.getByRole('heading', { name: 'Cambia tu contraseña para continuar' })).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it('va antes del 403 por rol: no muestra "sin acceso" a quien solo debe cambiar la clave', () => {
    conSesion({ rol: 'tecnico', debe_cambiar_contrasena: true })
    montar('/privada', ['admin'])

    expect(screen.getByRole('heading', { name: 'Cambia tu contraseña para continuar' })).toBeInTheDocument()
    expect(screen.queryByText('No tienes acceso a esta pantalla')).not.toBeInTheDocument()
  })

  it('sin cambio pendiente deja pasar como siempre', () => {
    conSesion({ rol: 'tecnico', debe_cambiar_contrasena: false })
    montar()
    expect(screen.getByText('Contenido privado')).toBeInTheDocument()
  })

  it('una cuenta sin la bandera (ej. las del seed) no queda bloqueada', () => {
    conSesion({ rol: 'tecnico' })
    montar()
    expect(screen.getByText('Contenido privado')).toBeInTheDocument()
  })

  it('la pantalla de cambio no se redirige a sí misma', () => {
    conSesion({ rol: 'tecnico', debe_cambiar_contrasena: true })
    montar(RUTA_CAMBIO_OBLIGATORIO)
    expect(screen.getByRole('heading', { name: 'Cambia tu contraseña para continuar' })).toBeInTheDocument()
  })

  it('sin sesión sigue mandando a login', () => {
    conSesion(null)
    montar()
    expect(screen.getByText('Pantalla de login')).toBeInTheDocument()
  })
})

describe('CambioObligatorioPage', () => {
  beforeEach(() => {
    conSesion({ rol: 'tecnico', debe_cambiar_contrasena: true })
  })

  it('sin cambio pendiente devuelve a la pantalla inicial del rol', () => {
    conSesion({ rol: 'tecnico', debe_cambiar_contrasena: false })
    montar(RUTA_CAMBIO_OBLIGATORIO)
    expect(screen.getByText('Pantalla inicial del técnico')).toBeInTheDocument()
  })

  it('ofrece cerrar sesión', async () => {
    montar(RUTA_CAMBIO_OBLIGATORIO)
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(logoutUserMock).toHaveBeenCalledTimes(1)
  })

  it('no muestra menú ni enlaces a otras pantallas', () => {
    montar(RUTA_CAMBIO_OBLIGATORIO)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  async function llenar(actual, nueva, confirmacion = nueva) {
    await userEvent.type(screen.getByLabelText(/Contraseña actual/), actual)
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), nueva)
    await userEvent.type(screen.getByLabelText('Repetir contraseña nueva'), confirmacion)
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
  }

  it('al guardar cambia la contraseña y cierra la sesión local', async () => {
    cambiarContrasenaMock.mockResolvedValue({ detail: 'Contraseña actualizada correctamente.' })
    montar(RUTA_CAMBIO_OBLIGATORIO)

    await llenar('la-que-me-dieron', 'Ruta-Segura-2026')

    await waitFor(() => expect(cerrarSesionLocalMock).toHaveBeenCalledTimes(1))
    expect(cambiarContrasenaMock).toHaveBeenCalledWith({
      contrasenaActual: 'la-que-me-dieron',
      nuevaContrasena: 'Ruta-Segura-2026',
      confirmacion: 'Ruta-Segura-2026',
    })
  })

  it('no llama al backend con una contraseña que ya se sabe inválida', async () => {
    montar(RUTA_CAMBIO_OBLIGATORIO)
    await llenar('la-que-me-dieron', 'corta')

    expect(await screen.findByText(/al menos 8 caracteres/)).toBeInTheDocument()
    expect(cambiarContrasenaMock).not.toHaveBeenCalled()
  })

  it('muestra el motivo concreto cuando el backend rechaza por la política (422)', async () => {
    cambiarContrasenaMock.mockRejectedValue({
      response: {
        status: 422,
        data: {
          error: 'VALIDATION_ERROR',
          errors: [{
            field: 'nueva_contrasena',
            message: 'Value error, La contraseña es demasiado común. Elige otra.',
          }],
        },
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    montar(RUTA_CAMBIO_OBLIGATORIO)

    await llenar('la-que-me-dieron', 'Welcome1234')

    const avisos = await screen.findAllByText('La contraseña es demasiado común. Elige otra.')
    expect(avisos.length).toBeGreaterThan(0)
    expect(cerrarSesionLocalMock).not.toHaveBeenCalled()
  })

  it('muestra el mensaje del 400 (igual al correo, igual a la actual)', async () => {
    cambiarContrasenaMock.mockRejectedValue({
      response: { status: 400, data: { detail: 'La contraseña no puede ser igual al correo de la cuenta.' } },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    montar(RUTA_CAMBIO_OBLIGATORIO)

    await llenar('la-que-me-dieron', 'Ruta-Segura-2026')

    const avisos = await screen.findAllByText('La contraseña no puede ser igual al correo de la cuenta.')
    expect(avisos.length).toBeGreaterThan(0)
  })
})

describe('mensajeDeValidacion', () => {
  it('quita el prefijo "Value error, " de Pydantic', () => {
    expect(
      mensajeDeValidacion({ errors: [{ field: 'nueva_contrasena', message: 'Value error, Mensaje.' }] }),
    ).toBe('Mensaje.')
  })

  it('prefiere el error del campo de la contraseña nueva', () => {
    expect(
      mensajeDeValidacion({
        errors: [
          { field: 'otro', message: 'Otro error' },
          { field: 'nueva_contrasena', message: 'Value error, El que importa' },
        ],
      }),
    ).toBe('El que importa')
  })

  it.each([undefined, {}, { errors: [] }, { errors: [{ field: 'x' }] }])(
    'sin mensaje utilizable cae al genérico (%j)',
    (data) => {
      expect(mensajeDeValidacion(data)).toBe('La contraseña nueva no cumple los requisitos mínimos.')
    },
  )
})