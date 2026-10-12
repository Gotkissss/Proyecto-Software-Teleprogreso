/**
 * tests/reportes.test.js
 * ---------------------------------------------------------------------------
 * HU-S9-04: cálculos de la pantalla de reportes (utils/reportes.js) y la
 * comparación con el periodo anterior de api/reporteService.js.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('../api/client', () => ({ default: { get: getMock } }))

import {
  getResumenConComparacion,
  getSerieReporte,
  getReporteTareasCompletadas,
} from '../api/reporteService'
import {
  diasDelRango,
  marcasEje,
  minutosAHoras,
  ordenarFilas,
  periodoAnterior,
  tonoVariacion,
  variacionPorcentual,
} from '../utils/reportes'

describe('periodoAnterior', () => {
  it('"este mes" a medias se compara con los mismos días del mes anterior', () => {
    expect(periodoAnterior({ fecha_inicio: '2026-10-01', fecha_fin: '2026-10-12' })).toEqual({
      fecha_inicio: '2026-09-01',
      fecha_fin: '2026-09-12',
    })
  })

  it('un mes completo contra el mes anterior completo, aunque sea más corto', () => {
    expect(periodoAnterior({ fecha_inicio: '2026-03-01', fecha_fin: '2026-03-31' })).toEqual({
      fecha_inicio: '2026-02-01',
      fecha_fin: '2026-02-28',
    })
  })

  it('enero se compara con diciembre del año anterior', () => {
    expect(periodoAnterior({ fecha_inicio: '2026-01-01', fecha_fin: '2026-01-15' })).toEqual({
      fecha_inicio: '2025-12-01',
      fecha_fin: '2025-12-15',
    })
  })

  it('una semana contra la semana justo antes', () => {
    expect(periodoAnterior({ fecha_inicio: '2026-10-05', fecha_fin: '2026-10-11' })).toEqual({
      fecha_inicio: '2026-09-28',
      fecha_fin: '2026-10-04',
    })
  })

  it('un día contra el día anterior', () => {
    expect(periodoAnterior({ fecha_inicio: '2026-10-12', fecha_fin: '2026-10-12' })).toEqual({
      fecha_inicio: '2026-10-11',
      fecha_fin: '2026-10-11',
    })
  })
})

describe('variación y tono', () => {
  it('calcula el % con un decimal', () => {
    expect(variacionPorcentual(120, 100)).toBe(20)
    expect(variacionPorcentual(2, 3)).toBe(-33.3)
  })

  it('sin base para comparar no inventa un %', () => {
    expect(variacionPorcentual(5, 0)).toBeNull()
    expect(variacionPorcentual(5, undefined)).toBeNull()
  })

  it('el color depende de si subir es bueno', () => {
    expect(tonoVariacion(10, 1)).toBe('bueno')
    expect(tonoVariacion(-10, 1)).toBe('malo')
    expect(tonoVariacion(10, -1)).toBe('malo')
    expect(tonoVariacion(10, 0)).toBe('neutro')
    expect(tonoVariacion(null, 1)).toBe('neutro')
  })
})

describe('formatos y escalas', () => {
  it('minutos a hh:mm', () => {
    expect(minutosAHoras(750)).toBe('12:30')
    expect(minutosAHoras(0)).toBe('00:00')
  })

  it('días del rango, inclusivos', () => {
    expect(diasDelRango({ fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31' })).toBe(31)
  })

  it('las marcas del eje son números limpios que contienen el máximo', () => {
    expect(marcasEje(7.3)).toEqual([0, 2, 4, 6, 8])
    expect(marcasEje(100)).toEqual([0, 25, 50, 75, 100])
    expect(marcasEje(0)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('ordena por número o por texto sin mutar, y desempata por nombre', () => {
    const filas = [
      { nombre_empleado: 'Óscar', tareas: 3 },
      { nombre_empleado: 'Ana', tareas: 3 },
      { nombre_empleado: 'Luis', tareas: 9 },
    ]
    expect(ordenarFilas(filas, 'tareas', 'desc').map((f) => f.nombre_empleado)).toEqual(['Luis', 'Ana', 'Óscar'])
    expect(ordenarFilas(filas, 'nombre_empleado', 'asc').map((f) => f.nombre_empleado)).toEqual(['Ana', 'Luis', 'Óscar'])
    expect(filas[0].nombre_empleado).toBe('Óscar')
  })
})

describe('reporteService', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('pide el periodo actual y el anterior en paralelo y devuelve la variación', async () => {
    let enVuelo = 0
    let maximoEnVuelo = 0
    getMock.mockImplementation(async (_url, { params }) => {
      enVuelo += 1
      maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo)
      await Promise.resolve()
      enVuelo -= 1
      const actual = params.fecha_inicio === '2026-10-05'
      return {
        data: {
          total_tareas_completadas: actual ? 30 : 20,
          total_minutos_trabajados: actual ? 600 : 0,
          items: [],
        },
      }
    })

    const resultado = await getResumenConComparacion({ fecha_inicio: '2026-10-05', fecha_fin: '2026-10-11' })

    expect(maximoEnVuelo).toBe(2)
    expect(getMock).toHaveBeenCalledWith('/reportes/resumen', {
      params: { fecha_inicio: '2026-09-28', fecha_fin: '2026-10-04' },
    })
    expect(resultado.periodoAnterior).toEqual({ fecha_inicio: '2026-09-28', fecha_fin: '2026-10-04' })
    expect(resultado.variaciones.total_tareas_completadas).toBe(50)
    expect(resultado.variaciones.total_minutos_trabajados).toBeNull()
  })

  it('la serie manda métrica y agrupación, y omite los filtros vacíos', async () => {
    getMock.mockResolvedValue({ data: {} })
    await getSerieReporte({ metrica: 'tareas', agrupar: 'semana', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31', empleado: '' })
    expect(getMock).toHaveBeenCalledWith('/reportes/serie', {
      params: { metrica: 'tareas', agrupar: 'semana', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31' },
    })
  })

  it('tareas y productividad se filtran con `tecnico`', async () => {
    getMock.mockResolvedValue({ data: {} })
    await getReporteTareasCompletadas({ fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31', tecnico: 4 })
    expect(getMock.mock.calls[0][1].params.tecnico).toBe(4)
  })
})
