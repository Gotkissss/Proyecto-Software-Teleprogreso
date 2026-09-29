/**
 * tests/stock.test.js
 * ---------------------------------------------------------------------------
 * utils/stock.js — niveles de existencias y barra de la tarjeta de stock
 * crítico.
 *
 * Estas dos funciones venían de api/materialService.js, que se eliminó por
 * duplicar a api/inventarioService.js. Aquí quedan fijadas para que el cambio
 * de sitio no se lleve por delante lo que pintan Alertas y StockBadge.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { calcularPorcentajeStock, clasificarStock } from '../utils/stock'

describe('clasificarStock', () => {
  it('sin existencias es crítico', () => {
    expect(clasificarStock(0, 20)).toBe('critico')
  })

  it('por debajo del mínimo es bajo', () => {
    expect(clasificarStock(5, 20)).toBe('bajo')
  })

  it('justo en el mínimo ya es normal', () => {
    expect(clasificarStock(20, 20)).toBe('normal')
  })

  it('por encima del mínimo es normal', () => {
    expect(clasificarStock(100, 20)).toBe('normal')
  })
})

describe('calcularPorcentajeStock', () => {
  it('el mínimo cae en la mitad de la barra', () => {
    expect(calcularPorcentajeStock(20, 20)).toBe(50)
  })

  it('crece con lo disponible', () => {
    expect(calcularPorcentajeStock(0, 20)).toBe(0)
    expect(calcularPorcentajeStock(10, 20)).toBe(25)
  })

  it('no se pasa del 100% por mucho stock que haya', () => {
    expect(calcularPorcentajeStock(500, 20)).toBe(100)
  })

  it('sin mínimo configurado la barra va llena, no dividida entre cero', () => {
    expect(calcularPorcentajeStock(7, 0)).toBe(100)
    expect(calcularPorcentajeStock(7, null)).toBe(100)
  })
})
