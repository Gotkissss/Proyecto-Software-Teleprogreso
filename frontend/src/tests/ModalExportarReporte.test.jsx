/**
 * tests/ModalExportarReporte.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S9-04: el Excel sale con los filtros de la pantalla de reportes (rango
 * y persona seleccionada); en el diálogo solo se elige qué reporte bajar.
 * ---------------------------------------------------------------------------
 */
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

const FILTROS = { fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30' }

function montar(props = {}) {
  const handlers = { onClose: vi.fn(), onExportado: vi.fn(), onError: vi.fn() }
  render(<ModalExportarReporte open filtros={FILTROS} {...handlers} {...props} />)
  return handlers
}

describe('ModalExportarReporte', () => {
  beforeEach(() => {
    exportarReporteMock.mockReset()
    exportarReporteMock.mockResolvedValue({ archivo: 'reporte.xlsx' })
  })

  it('enseña los filtros que hereda de la pantalla y abre con el resumen', () => {
    montar()
    expect(screen.getByText(/1 sept\.? – 30 sept\.? 2026/)).toBeInTheDocument()
    expect(screen.getByText('Toda la plantilla')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Resumen operativo/ })).toBeChecked()
    // Ya no pide fechas ni persona: eso lo decide la pantalla.
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument()
  })

  it('descarga el reporte elegido con el rango de la pantalla', async () => {
    const usuario = userEvent.setup()
    const { onExportado, onClose } = montar()

    await usuario.click(screen.getByRole('radio', { name: /Productividad/ }))
    await usuario.click(screen.getByRole('button', { name: 'Descargar Excel' }))

    await waitFor(() => expect(onExportado).toHaveBeenCalledWith('reporte.xlsx'))
    expect(exportarReporteMock).toHaveBeenCalledWith({
      tipo: 'productividad',
      fecha_inicio: '2026-09-01',
      fecha_fin: '2026-09-30',
      empleado: undefined,
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('si hay una persona seleccionada en la pantalla, el Excel sale solo de ella', async () => {
    const usuario = userEvent.setup()
    montar({ empleado: { id: 7, nombre: 'Ana López' } })

    expect(screen.getByText('Ana López')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Descargar Excel' }))

    await waitFor(() =>
      expect(exportarReporteMock).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'resumen', empleado: 7 }))
    )
  })

  it('avisa sin cerrarse cuando la descarga falla', async () => {
    const usuario = userEvent.setup()
    exportarReporteMock.mockRejectedValue({ response: { data: { detail: 'Sin permiso' } } })
    const { onError, onClose } = montar()

    await usuario.click(screen.getByRole('button', { name: 'Descargar Excel' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Sin permiso'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
