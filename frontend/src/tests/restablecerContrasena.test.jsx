/**
 * tests/restablecerContrasena.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S9-02 en la pantalla de personal: el botón «Contraseña» de
 * TablaEmpleados solo aparece donde el backend lo permitiría
 * (backend/app/core/reglas.py → puede_administrar), y si el backend responde
 * 403 de todas formas, el motivo se enseña en un toast.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import { puedeAdministrar, puedeRestablecerContrasena } from '../utils/permisos'

const { getMock, patchMock, auth } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  auth: { user: null },
}))

vi.mock('../api/client', () => ({
  BASE_URL: 'http://backend.test',
  urlArchivo: (ruta) => (ruta ? `http://backend.test${ruta}` : null),
  default: { get: getMock, patch: patchMock, post: vi.fn(), delete: vi.fn() },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, isLoading: false, isAuthenticated: true }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../components/asistencia/HistorialAsistenciaTable', () => ({
  default: () => <div>Historial simulado</div>,
}))

import { ToastProvider } from '../components/ui/Toast'
import EmpleadosPage from '../pages/EmpleadosPage'

const SUPERVISOR = { id_empleado: 2, nombre: 'Sara', rol: 'supervisor' }
const ADMIN = { id_empleado: 1, nombre: 'Ada', rol: 'admin' }

function empleado(id_empleado, nombre, rol) {
  return {
    id_empleado,
    nombre,
    apellido: 'Prueba',
    correo: `${nombre.toLowerCase()}@teleprogreso.com`,
    rol,
    estado: 'activo',
    telefono: null,
    fecha_contratacion: '2025-01-01',
    ultimo_acceso: null,
    placa_vehiculo: null,
  }
}

const PERSONAL = [
  empleado(1, 'Ada', 'admin'),
  empleado(2, 'Sara', 'supervisor'),
  empleado(3, 'Gema', 'gerente'),
  empleado(4, 'Tito', 'tecnico'),
]

function montar(user) {
  auth.user = user
  getMock.mockResolvedValue({ data: { total: PERSONAL.length, empleados: PERSONAL } })
  return render(
    <MemoryRouter>
      <ToastProvider>
        <EmpleadosPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const botonClave = (nombre) =>
  screen.queryByRole('button', { name: `Restablecer contraseña de ${nombre} Prueba` })

describe('puedeRestablecerContrasena (espejo de reglas.puede_administrar)', () => {
  it.each([
    ['admin', 'admin', true],
    ['admin', 'tecnico', true],
    ['supervisor', 'tecnico', true],
    ['supervisor', 'supervisor', false],
    ['supervisor', 'gerente', false],
    ['supervisor', 'admin', false],
    ['gerente', 'supervisor', false],
    ['tecnico', 'tecnico', false],
    ['intruso', 'tecnico', false],
  ])('%s sobre %s → %s', (actor, objetivo, esperado) => {
    expect(puedeAdministrar(actor, objetivo)).toBe(esperado)
  })

  it('nadie se restablece a sí mismo por esta puerta, ni siquiera el admin', () => {
    expect(puedeRestablecerContrasena(ADMIN, { id_empleado: 1, rol: 'admin' })).toBe(false)
  })

  it('el gerente manda sobre el técnico, pero el endpoint es require_supervisor', () => {
    const gerente = { id_empleado: 3, rol: 'gerente' }
    expect(puedeAdministrar('gerente', 'tecnico')).toBe(true)
    expect(puedeRestablecerContrasena(gerente, { id_empleado: 4, rol: 'tecnico' })).toBe(false)
  })
})

describe('TablaEmpleados: botón «Contraseña»', () => {
  beforeEach(() => {
    getMock.mockReset()
    patchMock.mockReset()
  })

  it('el supervisor solo lo ve en las filas de técnicos', async () => {
    montar(SUPERVISOR)
    await screen.findByText(/Tito/)

    expect(botonClave('Tito')).toBeInTheDocument()
    expect(botonClave('Ada')).not.toBeInTheDocument()
    expect(botonClave('Gema')).not.toBeInTheDocument()
    expect(botonClave('Sara')).not.toBeInTheDocument()
    // Editar y Activar/Desactivar siguen siendo solo del admin.
    expect(screen.queryByRole('button', { name: /^Editar a/ })).not.toBeInTheDocument()
  })

  it('el admin lo ve en todas las filas menos la suya', async () => {
    montar(ADMIN)
    await screen.findByText(/Tito/)

    expect(botonClave('Ada')).not.toBeInTheDocument()
    for (const nombre of ['Sara', 'Gema', 'Tito']) {
      expect(botonClave(nombre)).toBeInTheDocument()
    }
  })

  it('si el backend responde 403 igual, enseña su detail en un toast', async () => {
    const usuario = userEvent.setup()
    patchMock.mockRejectedValue({
      response: {
        status: 403,
        data: { detail: 'No tienes permiso para restablecer la contraseña de esta cuenta.' },
      },
    })
    montar(SUPERVISOR)
    await usuario.click(await screen.findByRole('button', {
      name: 'Restablecer contraseña de Tito Prueba',
    }))

    const dialogo = screen.getByRole('dialog')
    await usuario.type(within(dialogo).getByLabelText('Nueva contraseña'), 'ClaveNueva1')
    await usuario.type(within(dialogo).getByLabelText('Confirmar contraseña'), 'ClaveNueva1')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Actualizar contraseña' }))

    expect(patchMock).toHaveBeenCalledWith(
      '/empleados/4/contrasena',
      { contrasena: 'ClaveNueva1', contrasena_confirmacion: 'ClaveNueva1' },
    )
    expect(
      await screen.findByText('No tienes permiso para restablecer la contraseña de esta cuenta.')
    ).toBeInTheDocument()
    // Reintentar no cambia nada: el modal se cierra.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
