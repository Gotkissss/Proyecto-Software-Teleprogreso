import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  default: {
    get: getMock,
  },
}))

import {
  exportarReporteAsistenciaMes,
  rangoMesActual,
} from '../utils/exportarAsistenciaExcel'

describe('exportarReporteAsistenciaMes', () => {
  let enlaceCreado

  beforeEach(() => {
    vi.useFakeTimers()
    getMock.mockReset()
    enlaceCreado = null

    const crearElemento = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((etiqueta) => {
      const elemento = crearElemento(etiqueta)
      if (etiqueta === 'a') enlaceCreado = elemento
      return elemento
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:reporte-prueba'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('calcula correctamente el rango completo de un mes', () => {
    expect(rangoMesActual(new Date(2024, 1, 10))).toEqual({
      fecha_inicio: '2024-02-01',
      fecha_fin: '2024-02-29',
    })
  })

  it('solicita el XLSX al backend y usa el nombre de Content-Disposition', async () => {
    const contenido = new Blob(['xlsx'])
    getMock.mockResolvedValue({
      data: contenido,
      headers: {
        'content-disposition': (
          'attachment; filename="reporte_asistencia_agosto.xlsx"'
        ),
      },
    })

    const resultado = await exportarReporteAsistenciaMes(
      new Date(2026, 7, 15)
    )

    expect(getMock).toHaveBeenCalledWith(
      '/reportes/asistencia/exportar',
      {
        params: {
          fecha_inicio: '2026-08-01',
          fecha_fin: '2026-08-31',
        },
        responseType: 'blob',
      }
    )
    expect(URL.createObjectURL).toHaveBeenCalledWith(contenido)
    expect(enlaceCreado.download).toBe('reporte_asistencia_agosto.xlsx')
    expect(enlaceCreado.click).toHaveBeenCalledOnce()
    expect(resultado.archivo).toBe('reporte_asistencia_agosto.xlsx')

    vi.runOnlyPendingTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reporte-prueba')
  })

  it('usa un nombre local cuando Content-Disposition no está expuesto', async () => {
    getMock.mockResolvedValue({
      data: new Blob(['xlsx']),
      headers: {},
    })

    const resultado = await exportarReporteAsistenciaMes(
      new Date(2026, 11, 2)
    )

    expect(resultado.archivo).toBe(
      'reporte_asistencia_2026-12-01_2026-12-31.xlsx'
    )
    expect(enlaceCreado.download).toBe(resultado.archivo)
  })
})
