/**
 * tests/BitacoraPage.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S9-03 (tarea 6): pantalla de la bitácora de auditoría.
 * - estado de la cadena: íntegra, alterada (aviso rojo) y sin protección
 * - tabla y panel de detalle con el antes/después campo por campo
 * - filtros: cambiar uno vuelve a pedir la página 1; un rango al revés no
 *   llega al backend
 * - exportación con los filtros de la pantalla y el motivo del 400 en un toast
 * ---------------------------------------------------------------------------
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const servicio = vi.hoisted(() => ({
  getBitacora: vi.fn(),
  getCatalogosBitacora: vi.fn(),
  getVerificacionBitacora: vi.fn(),
  descargarBitacoraExcel: vi.fn(),
  detalleDeErrorBlob: vi.fn(),
}))
const descargas = vi.hoisted(() => ({ descargarArchivo: vi.fn() }))

vi.mock('../api/auditoriaService', () => servicio)
vi.mock('../api/asistenciaService', () => ({
  getEmpleadosParaFiltro: vi.fn(async () => [
    { id_empleado: 1, nombre_completo: 'Ada Admin', rol: 'admin' },
    { id_empleado: 5, nombre_completo: 'Tito Técnico', rol: 'tecnico' },
  ]),
}))
vi.mock('../utils/exportarReportes', () => ({
  descargarArchivo: descargas.descargarArchivo,
  nombreDesdeContentDisposition: () => null,
}))

import { ToastProvider } from '../components/ui/Toast'
import BitacoraPage from '../pages/BitacoraPage'

const FILAS = [
  {
    id_bitacora: 40,
    fecha_hora: '2026-10-12T15:04:05+00:00',
    id_actor: 1,
    nombre_actor: 'Ada Admin',
    rol_actor: 'admin',
    ip: '10.0.0.7',
    request_id: 'req-editar',
    accion: 'actualizar',
    entidad: 'empleado',
    id_entidad: 5,
    cambios: { telefono: { antes: '5555-0001', despues: '5555-0002' } },
    hash: 'a'.repeat(64),
    hash_anterior: 'b'.repeat(64),
  },
  {
    id_bitacora: 38,
    fecha_hora: '2026-10-12T15:00:00+00:00',
    id_actor: null,
    nombre_actor: null,
    rol_actor: null,
    ip: '10.0.0.9',
    request_id: 'req-login',
    accion: 'login_fallido',
    entidad: 'empleado',
    id_entidad: null,
    cambios: { correo: 'nadie@teleprogreso.com', bloqueado_s: 0 },
    hash: 'c'.repeat(64),
    hash_anterior: 'd'.repeat(64),
  },
]

const INTEGRA = {
  integra: true,
  filas: 120,
  id_rota: null,
  motivo: null,
  descripcion: 'Cadena íntegra: 120 filas verificadas.',
  protegida: true,
  detalle_proteccion: 'El backend se conecta como «app».',
  ultima_purga: null,
  verificada_en: '2026-10-12T15:10:00+00:00',
}

function pagina(items = FILAS) {
  return { total: items.length, page: 1, page_size: 20, total_pages: 1, items }
}

function montar() {
  return render(
    <ToastProvider>
      <BitacoraPage />
    </ToastProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  servicio.getBitacora.mockResolvedValue(pagina())
  servicio.getCatalogosBitacora.mockResolvedValue({
    acciones: ['actualizar', 'login_fallido'],
    entidades: ['empleado'],
    roles: ['admin'],
  })
  servicio.getVerificacionBitacora.mockResolvedValue(INTEGRA)
})

describe('estado de la cadena', () => {
  it('íntegra: lo dice sin alarmar', async () => {
    montar()
    expect(await screen.findByText(/Cadena íntegra: 120 filas/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('alterada: aviso rojo con la fila rota', async () => {
    servicio.getVerificacionBitacora.mockResolvedValue({
      ...INTEGRA,
      integra: false,
      id_rota: 17,
      motivo: 'contenido_alterado',
      descripcion: 'La fila #17 se modificó después de escribirse.',
    })
    montar()
    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent('La bitácora fue alterada')
    expect(aviso).toHaveTextContent('#17')
  })

  it('sin protección en la base: aviso con el motivo', async () => {
    servicio.getVerificacionBitacora.mockResolvedValue({
      ...INTEGRA,
      protegida: false,
      detalle_proteccion: 'El backend se conecta como superusuario («postgres»).',
    })
    montar()
    expect(await screen.findByText(/Protección incompleta/)).toBeInTheDocument()
    expect(screen.getByText(/superusuario/)).toBeInTheDocument()
  })
})

describe('tabla y detalle', () => {
  it('lista quién, qué y desde dónde', async () => {
    montar()
    await screen.findByText('Ada Admin')
    const tabla = screen.getByRole('table')
    expect(within(tabla).getByText('Ada Admin')).toBeInTheDocument()
    expect(within(tabla).getByText('Sin sesión')).toBeInTheDocument()
    expect(within(tabla).getByText('Modificó')).toBeInTheDocument()
    expect(within(tabla).getByText('Login fallido')).toBeInTheDocument()
    expect(within(tabla).getByText('10.0.0.7')).toBeInTheDocument()
    expect(screen.getByText(/2 acciones/)).toBeInTheDocument()
  })

  it('al elegir una fila enseña el antes y el después de cada campo', async () => {
    const usuario = userEvent.setup()
    montar()
    await usuario.click(await screen.findByText('Ada Admin'))

    const panel = screen.getByRole('complementary', { name: /acción #40/i })
    expect(within(panel).getByText('Cambios campo por campo')).toBeInTheDocument()
    expect(within(panel).getByText('telefono')).toBeInTheDocument()
    expect(within(panel).getByText('5555-0001')).toBeInTheDocument()
    expect(within(panel).getByText('5555-0002')).toBeInTheDocument()
    expect(within(panel).getByText('req-editar')).toBeInTheDocument()

    await usuario.click(within(panel).getByRole('button', { name: /cerrar detalle/i }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('un evento sin diff se enseña como campo y valor', async () => {
    const usuario = userEvent.setup()
    montar()
    await usuario.click(await screen.findByText('Sin sesión'))

    const panel = screen.getByRole('complementary', { name: /acción #38/i })
    expect(within(panel).getByText('Detalle')).toBeInTheDocument()
    expect(within(panel).getByText('nadie@teleprogreso.com')).toBeInTheDocument()
  })

  it('sin resultados: estado vacío', async () => {
    servicio.getBitacora.mockResolvedValue(pagina([]))
    montar()
    expect(await screen.findByText('Sin acciones registradas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeDisabled()
  })
})

describe('filtros', () => {
  it('cambiar un filtro vuelve a pedir la página 1 con ese filtro', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('Ada Admin')
    await usuario.selectOptions(screen.getByLabelText('Acción'), 'login_fallido')

    await waitFor(() =>
      expect(servicio.getBitacora).toHaveBeenLastCalledWith(
        expect.objectContaining({ accion: 'login_fallido' }), 1, 20
      )
    )
  })

  it('un rango al revés se bloquea antes de llamar al backend', async () => {
    montar()
    await screen.findByText('Ada Admin')
    const llamadas = servicio.getBitacora.mock.calls.length

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2099-01-01' } })

    expect(await screen.findByText(/no puede ser posterior/)).toBeInTheDocument()
    expect(servicio.getBitacora.mock.calls.length).toBe(llamadas)
    expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeDisabled()
  })
})

describe('exportación', () => {
  it('descarga con los mismos filtros que la tabla', async () => {
    const usuario = userEvent.setup()
    servicio.descargarBitacoraExcel.mockResolvedValue({ data: new Blob(['x']), headers: {} })
    montar()
    await screen.findByText('Ada Admin')
    await usuario.selectOptions(screen.getByLabelText('Empleado'), '5')
    await usuario.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    await waitFor(() => expect(descargas.descargarArchivo).toHaveBeenCalled())
    expect(servicio.descargarBitacoraExcel).toHaveBeenCalledWith(
      expect.objectContaining({ actor: '5' })
    )
    expect(descargas.descargarArchivo.mock.calls[0][1]).toMatch(/^bitacora_.*\.xlsx$/)
  })

  it('si el backend pide acotar el filtro, se enseña su motivo', async () => {
    const usuario = userEvent.setup()
    servicio.descargarBitacoraExcel.mockRejectedValue({ response: { status: 400 } })
    servicio.detalleDeErrorBlob.mockResolvedValue('El filtro devuelve 60 000 filas. Acota el rango.')
    montar()
    await screen.findByText('Ada Admin')
    await usuario.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    expect(await screen.findByText(/Acota el rango/)).toBeInTheDocument()
    expect(descargas.descargarArchivo).not.toHaveBeenCalled()
  })
})
