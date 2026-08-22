import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { exportarReporteMock } = vi.hoisted(() => ({
  exportarReporteMock: vi.fn(),
}))

vi.mock('../utils/exportarReportes', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, exportarReporte: exportarReporteMock }
})

import ModalExportarReporte from '../components/reportes/ModalExportarReporte'

// El componente calcula "hoy" con new Date(); se fija para que los rangos
// sean comprobables.
const HOY = new Date(2026, 7, 12)

function montar(props = {}) {
  return render(
    <ModalExportarReporte
      open
      onClose={vi.fn()}
      onExportado={vi.fn()}
      onError={vi.fn()}
      {...props}
    />
  )
}

describe('ModalExportarReporte', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(HOY)
    exportarReporteMock.mockReset()
    exportarReporteMock.mockResolvedValue({ archivo: 'reporte.xlsx' })
  })

  it('abre con el resumen operativo y el mes en curso', () => {
    montar()

    expect(screen.getByLabelText(/Desde/i)).toHaveValue('2026-08-01')
    expect(screen.getByLabelText(/Hasta/i)).toHaveValue('2026-08-12')
    expect(screen.getByRole('radio', { name: /Resumen operativo/i })).toBeChecked()
  })

  it('un atajo de periodo rellena las dos fechas', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar()

    await user.click(screen.getByRole('button', { name: 'Hoy' }))

    expect(screen.getByLabelText(/Desde/i)).toHaveValue('2026-08-12')
    expect(screen.getByLabelText(/Hasta/i)).toHaveValue('2026-08-12')
  })

  it('descarga el reporte y el rango elegidos', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onExportado = vi.fn()
    const onClose = vi.fn()
    montar({ onExportado, onClose })

    await user.click(screen.getByRole('button', { name: 'Últimos 7 días' }))
    await user.click(screen.getByRole('radio', { name: /Tareas completadas/i }))
    await user.click(screen.getByRole('button', { name: /Descargar Excel/i }))

    await waitFor(() =>
      expect(exportarReporteMock).toHaveBeenCalledWith({
        tipo: 'tareas-completadas',
        fecha_inicio: '2026-08-06',
        fecha_fin: '2026-08-12',
        empleado: undefined,
      })
    )
    expect(onExportado).toHaveBeenCalledWith('reporte.xlsx')
    expect(onClose).toHaveBeenCalled()
  })

  it('no deja descargar con el rango invertido', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar()

    // El input tiene max/min, pero escribir a mano puede saltárselo.
    await user.clear(screen.getByLabelText(/Hasta/i))
    await user.type(screen.getByLabelText(/Hasta/i), '2026-07-01')

    expect(screen.getByRole('alert')).toHaveTextContent(
      /no puede ser posterior/i
    )
    expect(screen.getByRole('button', { name: /Descargar Excel/i })).toBeDisabled()
    expect(exportarReporteMock).not.toHaveBeenCalled()
  })

  it('manda el id de la persona seleccionada', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar({
      empleados: [
        { id: 7, nombre_completo: 'Ana Lopez' },
        { id: 9, nombre_completo: 'Luis Perez' },
      ],
    })

    await user.selectOptions(screen.getByRole('combobox'), '9')
    await user.click(screen.getByRole('button', { name: /Descargar Excel/i }))

    await waitFor(() =>
      expect(exportarReporteMock).toHaveBeenCalledWith(
        expect.objectContaining({ empleado: '9' })
      )
    )
  })

  it('avisa sin cerrarse cuando la descarga falla', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onError = vi.fn()
    const onClose = vi.fn()
    exportarReporteMock.mockRejectedValue({
      response: { data: { detail: 'Rango demasiado grande.' } },
    })
    montar({ onError, onClose })

    await user.click(screen.getByRole('button', { name: /Descargar Excel/i }))

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Rango demasiado grande.')
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
