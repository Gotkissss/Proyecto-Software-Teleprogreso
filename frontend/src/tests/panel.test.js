/**
 * tests/panel.test.js
 * ---------------------------------------------------------------------------
 * Las cuentas del panel del supervisor (utils/panel.js).
 *
 * Son cuentas pequeñas, pero si salen mal el panel miente, y un panel que
 * miente es peor que uno que no dice nada: un porcentaje de avance que no
 * cuadra con las tarjetas de arriba hace dudar de todas las cifras.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { fechaLarga, hace, proporcion, repartoDelDia, saludoPorHora } from '../utils/panel'

describe('reparto del día', () => {
  const metricas = {
    tareas_completadas_hoy: 6,
    tareas_en_progreso: 2,
    tareas_pendientes: 2,
    tareas_retrasadas: 3,
  }

  it('suma solo los tres tramos que no se solapan', () => {
    const r = repartoDelDia(metricas)
    expect(r.total).toBe(10)
    expect(r.completadas + r.enCurso + r.pendientes).toBe(r.total)
  })

  it('deja las retrasadas fuera del total, porque ya están contadas', () => {
    // Son un subconjunto de pendientes y en curso. Si sumaran, el total
    // seria 13 y el porcentaje no cuadraria con las tarjetas de arriba.
    const r = repartoDelDia(metricas)
    expect(r.retrasadas).toBe(3)
    expect(r.total).toBe(10)
    expect(r.porcentaje).toBe(60)
  })

  it('con el día vacío no divide entre cero', () => {
    const r = repartoDelDia({})
    expect(r.total).toBe(0)
    expect(r.porcentaje).toBe(0)
    expect(Number.isNaN(r.porcentaje)).toBe(false)
  })

  it('sobrevive a que no llegue nada', () => {
    for (const entrada of [null, undefined, {}]) {
      const r = repartoDelDia(entrada)
      expect(r.total).toBe(0)
      expect(r.porcentaje).toBe(0)
    }
  })

  it('un negativo del backend no resta del total', () => {
    const r = repartoDelDia({ tareas_completadas_hoy: 4, tareas_pendientes: -3 })
    expect(r.pendientes).toBe(0)
    expect(r.total).toBe(4)
    expect(r.porcentaje).toBe(100)
  })

  it('el día terminado da 100 y el día sin empezar da 0', () => {
    expect(repartoDelDia({ tareas_completadas_hoy: 5 }).porcentaje).toBe(100)
    expect(repartoDelDia({ tareas_pendientes: 5 }).porcentaje).toBe(0)
  })
})

describe('proporción de una cifra', () => {
  it('devuelve la parte que le toca', () => {
    expect(proporcion(3, 4)).toBe(0.75)
    expect(proporcion(0, 4)).toBe(0)
  })

  it('devuelve null cuando no hay un todo con el que comparar', () => {
    // Es lo que evita pintar una barra con un denominador inventado.
    expect(proporcion(4, 0)).toBeNull()
    expect(proporcion(4, null)).toBeNull()
    expect(proporcion(4, undefined)).toBeNull()
    expect(proporcion(null, 10)).toBeNull()
  })

  it('no se sale de la barra si la parte supera al todo', () => {
    expect(proporcion(12, 10)).toBe(1)
    expect(proporcion(-2, 10)).toBe(0)
  })
})

describe('cuánto hace que se cargó', () => {
  const t0 = new Date('2026-10-30T10:00:00').getTime()
  const mas = (ms) => t0 + ms

  it('lo reciente no se cuenta en minutos', () => {
    expect(hace(t0, mas(0))).toBe('hace un momento')
    expect(hace(t0, mas(59_000))).toBe('hace un momento')
  })

  it('pasa a minutos, luego a horas y luego a días', () => {
    expect(hace(t0, mas(60_000))).toBe('hace 1 min')
    expect(hace(t0, mas(45 * 60_000))).toBe('hace 45 min')
    expect(hace(t0, mas(60 * 60_000))).toBe('hace 1 h')
    expect(hace(t0, mas(5 * 60 * 60_000))).toBe('hace 5 h')
    expect(hace(t0, mas(24 * 60 * 60_000))).toBe('hace 1 día')
    expect(hace(t0, mas(3 * 24 * 60 * 60_000))).toBe('hace 3 días')
  })

  it('sin fecha de carga no inventa una', () => {
    expect(hace(null)).toBeNull()
    expect(hace(undefined)).toBeNull()
  })

  it('un reloj que va hacia atrás no da tiempos negativos', () => {
    // Pasa de verdad: el reloj del equipo se ajusta mientras la pestaña
    // esta abierta, y "hace -3 min" en pantalla queda como un error.
    expect(hace(t0, mas(-90_000))).toBe('hace un momento')
  })
})

describe('cabecera', () => {
  const aLas = (h) => new Date(2026, 9, 30, h, 0, 0)

  it('saluda según la hora', () => {
    expect(saludoPorHora(aLas(7))).toBe('Buenos días')
    expect(saludoPorHora(aLas(11))).toBe('Buenos días')
    expect(saludoPorHora(aLas(12))).toBe('Buenas tardes')
    expect(saludoPorHora(aLas(18))).toBe('Buenas tardes')
    expect(saludoPorHora(aLas(19))).toBe('Buenas noches')
    expect(saludoPorHora(aLas(23))).toBe('Buenas noches')
  })

  it('escribe la fecha larga en español', () => {
    const texto = fechaLarga(aLas(10))
    expect(texto).toContain('30')
    expect(texto.toLowerCase()).toContain('octubre')
  })
})
