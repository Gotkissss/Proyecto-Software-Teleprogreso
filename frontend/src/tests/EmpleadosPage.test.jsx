/**
 * tests/EmpleadosPage.test.jsx
 * ---------------------------------------------------------------------------
 * La lista de personal salía siempre vacía: GET /empleados responde
 * `{ total, empleados: [...] }` (EmpleadoListResponse) y la pantalla hacía
 * `Array.isArray(data) ? data : []`, así que descartaba la respuesta entera.
 * Como no había ni error de red ni 4xx, no aparecía ningún aviso: solo el
 * estado "sin resultados", que se lee como "no hay empleados registrados".
 *
 * Este test va contra la forma real de la respuesta, que es lo que se rompió.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { getMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  BASE_URL: 'http://backend.test',
  urlArchivo: (ruta) => (ruta ? `http://backend.test${ruta}` : null),
  default: { get: getMock, patch: patchMock, post: vi.fn(), delete: vi.fn() },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id_empleado: 3, nombre: 'Admin Prueba', rol: 'admin' },
    isLoading: false,
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }) => children,
}))

// El tab de historial pide sus propios datos; aquí solo interesa el listado.
vi.mock('../components/asistencia/HistorialAsistenciaTable', () => ({
  default: () => <div>Historial simulado</div>,
}))

import { ToastProvider } from '../components/ui/Toast'
import EmpleadosPage from '../pages/EmpleadosPage'

const RESPUESTA_LISTA = {
  total: 2,
  empleados: [
    {
      id_empleado: 2,
      nombre: 'Juan',
      apellido: 'Pérez',
      correo: 'tecnico@teleprogreso.com',
      rol: 'tecnico',
      estado: 'activo',
      telefono: '5550-0002',
      fecha_contratacion: '2025-02-01',
      fecha_registro: '2025-02-01T09:00:00',
      ultimo_acceso: null,
      placa_vehiculo: 'P-472BCR',
    },
    {
      id_empleado: 3,
      nombre: 'Marta',
      apellido: 'Ruiz',
      correo: 'supervisor@teleprogreso.com',
      rol: 'supervisor',
      estado: 'inactivo',
      telefono: null,
      fecha_contratacion: '2024-11-20',
      fecha_registro: '2024-11-20T09:00:00',
      ultimo_acceso: '2026-09-01T08:12:00',
      placa_vehiculo: null,
    },
  ],
}

function montar() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <EmpleadosPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('EmpleadosPage', () => {
  beforeEach(() => {
    getMock.mockReset()
    patchMock.mockReset()
  })

  it('lista el personal que viene en { total, empleados }', async () => {
    getMock.mockResolvedValue({ data: RESPUESTA_LISTA })
    montar()

    expect(await screen.findByText(/Juan/)).toBeInTheDocument()
    expect(screen.getByText(/Marta/)).toBeInTheDocument()
    expect(screen.getByText('tecnico@teleprogreso.com')).toBeInTheDocument()
    // El contador del tab sale del mismo estado: si la lista se descarta,
    // este número se queda en 0 aunque haya personal.
    expect(screen.getByRole('button', { name: /Colaboradores \(2\)/ })).toBeInTheDocument()
  })

  it('también acepta un array pelado, por si el endpoint cambia', async () => {
    getMock.mockResolvedValue({ data: RESPUESTA_LISTA.empleados })
    montar()

    expect(await screen.findByText(/Juan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Colaboradores \(2\)/ })).toBeInTheDocument()
  })

  it('muestra el error del backend cuando el rol no tiene permiso', async () => {
    getMock.mockRejectedValue({
      response: {
        status: 403,
        data: { detail: "Rol 'gerente' no tiene permiso para este recurso." },
      },
    })
    montar()

    expect(
      await screen.findByText(/no tiene permiso para este recurso/i)
    ).toBeInTheDocument()
  })
})
