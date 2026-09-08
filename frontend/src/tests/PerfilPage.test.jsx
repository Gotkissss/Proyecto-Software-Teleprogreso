/**
 * tests/PerfilPage.test.jsx
 * ---------------------------------------------------------------------------
 * Cubre las dos mitades de la pantalla de perfil:
 *
 *   1. Que pinte los datos del empleado que devuelve GET /auth/perfil.
 *   2. Que el formulario de contraseña no deje pasar nada que el backend vaya
 *      a rechazar, y que cuando sí llama, cierre la sesión — porque el backend
 *      invalida el token en cuanto guarda la contraseña nueva.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { getPerfilMock, cambiarContrasenaMock, cerrarSesionLocalMock } = vi.hoisted(() => ({
  getPerfilMock: vi.fn(),
  cambiarContrasenaMock: vi.fn(),
  cerrarSesionLocalMock: vi.fn(),
}))

vi.mock('../api/authService', () => ({
  getPerfil: getPerfilMock,
  cambiarContrasena: cambiarContrasenaMock,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id_empleado: 7, nombre: 'Ana López', rol: 'tecnico' },
    isLoading: false,
    isAuthenticated: true,
    loginUser: vi.fn(),
    logoutUser: vi.fn(),
    cerrarSesionLocal: cerrarSesionLocalMock,
  }),
  AuthProvider: ({ children }) => children,
}))

import { ToastProvider } from '../components/ui/Toast'
import PerfilPage, { validarCambioContrasena } from '../pages/PerfilPage'

const PERFIL = {
  id_empleado: 7,
  nombre: 'Ana',
  apellido: 'López',
  correo: 'ana@teleprogreso.com',
  rol: 'tecnico',
  estado: 'activo',
  telefono: '5555-0101',
  fecha_contratacion: '2025-01-15',
  fecha_registro: '2025-01-10T08:30:00',
  ultimo_acceso: null,
}

function montar() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PerfilPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** Espera a que termine la carga inicial del perfil. */
async function montarCargado() {
  const utils = montar()
  expect(await screen.findByText('Ana López')).toBeInTheDocument()
  return utils
}

describe('validarCambioContrasena', () => {
  const base = { actual: 'Vieja1234', nueva: 'Nueva12345', confirmacion: 'Nueva12345' }

  it('acepta un formulario correcto', () => {
    expect(validarCambioContrasena(base)).toEqual({})
  })

  it('exige la contraseña actual', () => {
    expect(validarCambioContrasena({ ...base, actual: '' }).actual).toMatch(/actual/i)
  })

  it('exige el mínimo de 8 caracteres', () => {
    const errores = validarCambioContrasena({ ...base, nueva: 'Corta1', confirmacion: 'Corta1' })
    expect(errores.nueva).toMatch(/al menos 8/i)
  })

  it('rechaza espacios al principio o al final', () => {
    const conEspacio = ' ClaveLarga1 '
    const errores = validarCambioContrasena({
      ...base, nueva: conEspacio, confirmacion: conEspacio,
    })
    expect(errores.nueva).toMatch(/espacios/i)
  })

  it('rechaza repetir la contraseña actual', () => {
    const errores = validarCambioContrasena({
      actual: 'MismaClave1', nueva: 'MismaClave1', confirmacion: 'MismaClave1',
    })
    expect(errores.nueva).toMatch(/distinta/i)
  })

  it('rechaza una confirmación que no coincide', () => {
    const errores = validarCambioContrasena({ ...base, confirmacion: 'Otra12345' })
    expect(errores.confirmacion).toMatch(/no coinciden/i)
  })
})

describe('PerfilPage', () => {
  beforeEach(() => {
    getPerfilMock.mockReset()
    cambiarContrasenaMock.mockReset()
    cerrarSesionLocalMock.mockReset()
    getPerfilMock.mockResolvedValue(PERFIL)
    cambiarContrasenaMock.mockResolvedValue({ detail: 'Contraseña actualizada correctamente.' })
  })

  it('muestra los datos del empleado autenticado', async () => {
    await montarCargado()

    expect(screen.getAllByText('ana@teleprogreso.com').length).toBeGreaterThan(0)
    expect(screen.getByText('5555-0101')).toBeInTheDocument()
    expect(screen.getByText('15 de enero de 2025')).toBeInTheDocument()
    expect(screen.getByText('Técnico')).toBeInTheDocument()
    expect(screen.getByText('Cuenta activa')).toBeInTheDocument()
  })

  it('muestra un guion cuando el empleado nunca ha entrado', async () => {
    // `ultimo_acceso` llega en null; pintar "Invalid Date" sería peor que
    // decir que no hay dato.
    await montarCargado()

    const ultimoAcceso = screen.getByText('Último acceso').closest('div')
    expect(ultimoAcceso).toHaveTextContent('—')
  })

  it('avisa si el perfil no se pudo cargar y permite reintentar', async () => {
    getPerfilMock.mockRejectedValueOnce({
      response: { data: { detail: 'No se pudo cargar tu perfil.' } },
    })
    const user = userEvent.setup()
    montar()

    expect(await screen.findByText('No se pudo cargar tu perfil.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Ana López')).toBeInTheDocument()
  })

  it('no llama al backend si el formulario está vacío', async () => {
    const user = userEvent.setup()
    await montarCargado()

    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    expect(await screen.findByText('Escribe tu contraseña actual.')).toBeInTheDocument()
    expect(screen.getByText('Escribe la contraseña nueva.')).toBeInTheDocument()
    expect(cambiarContrasenaMock).not.toHaveBeenCalled()
  })

  it('no llama al backend si la confirmación no coincide', async () => {
    const user = userEvent.setup()
    await montarCargado()

    await user.type(screen.getByLabelText('Contraseña actual'), 'Vieja1234')
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Nueva12345')
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), 'Otra12345')
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(cambiarContrasenaMock).not.toHaveBeenCalled()
  })

  it('el error de un campo desaparece al corregirlo', async () => {
    const user = userEvent.setup()
    await montarCargado()

    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))
    expect(await screen.findByText('Escribe tu contraseña actual.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Contraseña actual'), 'V')

    expect(screen.queryByText('Escribe tu contraseña actual.')).not.toBeInTheDocument()
  })

  it('guarda la contraseña, avisa y cierra la sesión', async () => {
    const user = userEvent.setup()
    await montarCargado()

    await user.type(screen.getByLabelText('Contraseña actual'), 'Vieja1234')
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Nueva12345')
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), 'Nueva12345')
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      expect(cambiarContrasenaMock).toHaveBeenCalledWith({
        contrasenaActual: 'Vieja1234',
        nuevaContrasena: 'Nueva12345',
        confirmacion: 'Nueva12345',
      })
    })

    expect(await screen.findByText('Contraseña actualizada correctamente.')).toBeInTheDocument()
    // El backend invalida el token al guardar: quedarse en la pantalla dejaría
    // al usuario con una sesión muerta.
    expect(cerrarSesionLocalMock).toHaveBeenCalled()
  })

  it('muestra el mensaje del backend cuando la contraseña actual es incorrecta', async () => {
    cambiarContrasenaMock.mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'La contraseña actual es incorrecta.' } },
    })
    const user = userEvent.setup()
    await montarCargado()

    await user.type(screen.getByLabelText('Contraseña actual'), 'Equivocada1')
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Nueva12345')
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), 'Nueva12345')
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    expect(
      await screen.findAllByText('La contraseña actual es incorrecta.')
    ).not.toHaveLength(0)
    // La sesión sigue viva: no se cambió nada.
    expect(cerrarSesionLocalMock).not.toHaveBeenCalled()
  })

  it('el botón de ver contraseña alterna entre texto y puntos', async () => {
    const user = userEvent.setup()
    await montarCargado()

    const campo = screen.getByLabelText('Contraseña nueva')
    expect(campo).toHaveAttribute('type', 'password')

    await user.click(screen.getAllByRole('button', { name: /mostrar contraseña/i })[1])

    expect(campo).toHaveAttribute('type', 'text')
  })
})
