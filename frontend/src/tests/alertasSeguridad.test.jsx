/**
 * Alertas de seguridad en la pantalla de Alertas (HU-S10-05, tarea 5).
 *
 * El backend ya no se las manda a quien no es admin; aquí se comprueba lo que
 * hace la pantalla con ellas: pestaña propia solo para el admin, fuera de la
 * lista operativa, con su mensaje y un enlace a la bitácora filtrada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const auth = vi.hoisted(() => ({ estado: { user: { rol: 'admin' } } }))
const api = vi.hoisted(() => ({ getAlertas: vi.fn(), actualizarEstadoAlerta: vi.fn() }))

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.estado }))
vi.mock('../api/alertaService', async (importOriginal) => ({
  ...(await importOriginal()),
  getAlertas: api.getAlertas,
  actualizarEstadoAlerta: api.actualizarEstadoAlerta,
}))
vi.mock('../api/inventarioService', () => ({ getMaterialesBajoStock: vi.fn(async () => []) }))

import { ToastProvider } from '../components/ui/Toast'
import AlertasPage from '../pages/AlertasPage'
import { describirAlertaSeguridad, enlaceBitacora } from '../utils/alertasSeguridad'

const OPERATIVA = {
  id_alerta: 1,
  tipo: 'tarea_vencida',
  severidad: 'critica',
  estado: 'pendiente',
  referencia: 'tarea:7',
  referencia_label: 'Cambio de poste',
  fecha: new Date().toISOString(),
}
const DE_SEGURIDAD = {
  id_alerta: 2,
  tipo: 'seguridad_login_fallido',
  severidad: 'critica',
  estado: 'pendiente',
  referencia: 'correo:admin@teleprogreso.com',
  referencia_label: 'admin@teleprogreso.com',
  fecha: new Date().toISOString(),
}

function Ubicacion() {
  const { pathname, search } = useLocation()
  return <p>EN {pathname}{search}</p>
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/supervisor/alertas']}>
      <ToastProvider>
        <Routes>
          <Route path="/supervisor/alertas" element={<AlertasPage />} />
          <Route path="/supervisor/bitacora" element={<Ubicacion />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.estado = { user: { rol: 'admin' } }
  api.getAlertas.mockResolvedValue([OPERATIVA, DE_SEGURIDAD])
})

describe('pantalla de alertas', () => {
  it('el admin ve la pestaña Seguridad con su contador y la operativa no las mezcla', async () => {
    montar()

    expect(await screen.findByText(/«Cambio de poste» venció/)).toBeInTheDocument()
    expect(screen.queryByText(/inicios de sesión fallidos/)).not.toBeInTheDocument()
    const pestana = screen.getByRole('button', { name: /^Seguridad/ })
    expect(within(pestana).getByText('1')).toBeInTheDocument()
  })

  it('en Seguridad se lee qué pasó y se abre la bitácora ya filtrada', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText(/«Cambio de poste» venció/)

    await usuario.click(screen.getByRole('button', { name: /^Seguridad/ }))

    expect(
      screen.getByText('Muchos inicios de sesión fallidos contra admin@teleprogreso.com en pocos minutos.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/«Cambio de poste» venció/)).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /Ver en la bitácora/ }))
    expect(screen.getByText('EN /supervisor/bitacora?accion=login_fallido')).toBeInTheDocument()
  })

  it.each(['supervisor', 'gerente'])('%s no ve la pestaña Seguridad', async (rol) => {
    auth.estado = { user: { rol } }
    api.getAlertas.mockResolvedValue([OPERATIVA])
    montar()

    await screen.findByText(/«Cambio de poste» venció/)
    expect(screen.queryByRole('button', { name: /^Seguridad/ })).not.toBeInTheDocument()
  })
})

describe('utils/alertasSeguridad', () => {
  it.each([
    [{ tipo: 'seguridad_login_fallido', referencia: 'ip:10.0.0.5' }, '/supervisor/bitacora?accion=login_fallido'],
    [{ tipo: 'seguridad_login_bloqueado', referencia: 'correo:a@b.com' }, '/supervisor/bitacora?accion=login_bloqueado'],
    [{ tipo: 'seguridad_acceso_denegado', referencia: 'empleado:12' }, '/supervisor/bitacora?accion=acceso_denegado&actor=12'],
    [{ tipo: 'seguridad_cuenta_admin', referencia: 'empleado:3' }, '/supervisor/bitacora?entidad=empleado&id_entidad=3'],
    [{ tipo: 'seguridad_bitacora_rota', referencia: 'bitacora:99' }, '/supervisor/bitacora'],
  ])('enlace a la bitácora de %o', (alerta, esperado) => {
    expect(enlaceBitacora(alerta)).toBe(esperado)
  })

  it('distingue un ataque por IP de uno contra un correo', () => {
    expect(describirAlertaSeguridad({ tipo: 'seguridad_login_fallido', referencia: 'ip:10.0.0.5' }))
      .toBe('Muchos inicios de sesión fallidos desde la IP 10.0.0.5 en pocos minutos.')
  })

  it('usa el nombre que resolvió el backend cuando lo hay', () => {
    expect(
      describirAlertaSeguridad({
        tipo: 'seguridad_cuenta_admin', referencia: 'empleado:3', referencia_label: 'Ana López',
      })
    ).toBe('Otra persona cambió la cuenta de administrador de Ana López (contraseña o rol).')
  })

  it('una alerta operativa no es de seguridad', () => {
    expect(describirAlertaSeguridad({ tipo: 'tarea_vencida', referencia: 'tarea:1' })).toBeNull()
  })
})
