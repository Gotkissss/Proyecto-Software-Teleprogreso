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
  REPORTES,
  aYMD,
  exportarReporte,
  rangoRapido,
} from '../utils/exportarReportes'

describe('rangos rápidos', () => {
  // Un miércoles cualquiera de agosto de 2026.
  const REFERENCIA = new Date(2026, 7, 12)

  it('"hoy" es un rango de un solo día', () => {
    expect(rangoRapido('hoy', REFERENCIA)).toEqual({
      fecha_inicio: '2026-08-12',
      fecha_fin: '2026-08-12',
    })
  })

  it('"últimos 7 días" incluye hoy y los seis anteriores', () => {
    expect(rangoRapido('semana', REFERENCIA)).toEqual({
      fecha_inicio: '2026-08-06',
      fecha_fin: '2026-08-12',
    })
  })

  it('"este mes" va del día 1 a hoy, no al fin de mes', () => {
    expect(rangoRapido('mes', REFERENCIA)).toEqual({
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-12',
    })
  })

  it('"mes pasado" cubre el mes anterior completo', () => {
    expect(rangoRapido('mes-pasado', REFERENCIA)).toEqual({
      fecha_inicio: '2026-07-01',
      fecha_fin: '2026-07-31',
    })
  })

  it('resuelve bien febrero de un año bisiesto', () => {
    expect(rangoRapido('mes-pasado', new Date(2024, 2, 10))).toEqual({
      fecha_inicio: '2024-02-01',
      fecha_fin: '2024-02-29',
    })
  })

  it('devuelve null si la clave no existe', () => {
    expect(rangoRapido('trimestre', REFERENCIA)).toBeNull()
  })

  it('formatea la fecha en local, no en UTC', () => {
    // toISOString() sobre esta fecha da el día anterior en Guatemala (UTC-6).
    expect(aYMD(new Date(2026, 7, 12, 1, 0))).toBe('2026-08-12')
  })
})

describe('exportarReporte', () => {
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

  it('pide el tipo y el rango elegidos, y usa el nombre de Content-Disposition', async () => {
    const contenido = new Blob(['xlsx'])
    getMock.mockResolvedValue({
      data: contenido,
      headers: {
        'content-disposition':
          'attachment; filename="reporte_resumen_agosto.xlsx"',
      },
    })

    const resultado = await exportarReporte({
      tipo: 'resumen',
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-12',
    })

    expect(getMock).toHaveBeenCalledWith('/reportes/resumen/exportar', {
      params: {
        fecha_inicio: '2026-08-01',
        fecha_fin: '2026-08-12',
      },
      responseType: 'blob',
    })
    expect(URL.createObjectURL).toHaveBeenCalledWith(contenido)
    expect(enlaceCreado.download).toBe('reporte_resumen_agosto.xlsx')
    expect(enlaceCreado.click).toHaveBeenCalledOnce()
    expect(resultado.archivo).toBe('reporte_resumen_agosto.xlsx')

    vi.runOnlyPendingTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reporte-prueba')
  })

  it('manda el filtro de persona con el nombre que espera cada reporte', async () => {
    getMock.mockResolvedValue({ data: new Blob(['xlsx']), headers: {} })

    // Los reportes de persona se recortan con `empleado`...
    await exportarReporte({
      tipo: 'asistencia',
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-12',
      empleado: '7',
    })
    expect(getMock.mock.calls[0][1].params).toEqual({
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-12',
      empleado: 7,
    })

    // ...y los de trabajo cerrado con `tecnico`. Cruzarlos devuelve 400.
    await exportarReporte({
      tipo: 'productividad',
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-12',
      empleado: '7',
    })
    expect(getMock.mock.calls[1][1].params).toEqual({
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-12',
      tecnico: 7,
    })
  })

  it('usa un nombre local cuando Content-Disposition no está expuesto', async () => {
    getMock.mockResolvedValue({
      data: new Blob(['xlsx']),
      headers: {},
    })

    const resultado = await exportarReporte({
      tipo: 'tareas-completadas',
      fecha_inicio: '2026-12-01',
      fecha_fin: '2026-12-31',
    })

    expect(resultado.archivo).toBe(
      'reporte_tareas_completadas_2026-12-01_2026-12-31.xlsx'
    )
    expect(enlaceCreado.download).toBe(resultado.archivo)
  })

  it('rechaza un tipo de reporte que no existe', async () => {
    await expect(
      exportarReporte({
        tipo: 'inventado',
        fecha_inicio: '2026-08-01',
        fecha_fin: '2026-08-12',
      })
    ).rejects.toThrow('Tipo de reporte desconocido')
    expect(getMock).not.toHaveBeenCalled()
  })

  it('el catálogo declara el filtro de cada reporte', () => {
    expect(REPORTES.map((r) => [r.tipo, r.filtro])).toEqual([
      ['resumen', 'empleado'],
      ['asistencia', 'empleado'],
      ['tareas-completadas', 'tecnico'],
      ['productividad', 'tecnico'],
    ])
  })
})
