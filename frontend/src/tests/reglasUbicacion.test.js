/**
 * tests/reglasUbicacion.test.js
 * ---------------------------------------------------------------------------
 * HU-5 — Cuándo se guarda un punto del recorrido.
 *
 * Fija las reglas acordadas: lecturas imprecisas fuera, 2 min entre puntos si
 * el técnico se mueve (≥ 30 m) y un punto de control cada 5 min si está quieto.
 * ---------------------------------------------------------------------------
 */
import { describe, expect, it } from 'vitest'
import {
  DISTANCIA_MINIMA_M,
  INTERVALO_MOVIMIENTO_MS,
  INTERVALO_QUIETO_MS,
  PRECISION_MAXIMA_M,
  debeReportar,
  distanciaMetros,
} from '../utils/reglasUbicacion'

const T0 = 1_000_000
const BASE = { lat: 14.4653, lng: -90.4408, t: T0 }
/** ~110 m al norte de BASE (0.001° de latitud). */
const LEJOS = { lat: 14.4663, lng: -90.4408, accuracy: 10 }
/** ~11 m al norte de BASE: por debajo del umbral de movimiento. */
const CERCA = { lat: 14.4654, lng: -90.4408, accuracy: 10 }

describe('distanciaMetros', () => {
  it('mide en metros entre dos coordenadas', () => {
    expect(distanciaMetros(BASE, LEJOS)).toBeGreaterThan(100)
    expect(distanciaMetros(BASE, LEJOS)).toBeLessThan(120)
    expect(distanciaMetros(BASE, BASE)).toBe(0)
  })
})

describe('debeReportar', () => {
  it('la primera lectura válida siempre se guarda', () => {
    expect(debeReportar(null, CERCA, T0)).toBe(true)
  })

  it('descarta lecturas imprecisas aunque sean las primeras', () => {
    const imprecisa = { ...LEJOS, accuracy: PRECISION_MAXIMA_M + 1 }

    expect(debeReportar(null, imprecisa, T0)).toBe(false)
    expect(debeReportar(BASE, imprecisa, T0 + INTERVALO_QUIETO_MS)).toBe(false)
  })

  it('en movimiento guarda un punto cada 2 minutos, no antes', () => {
    expect(debeReportar(BASE, LEJOS, T0 + INTERVALO_MOVIMIENTO_MS - 1)).toBe(false)
    expect(debeReportar(BASE, LEJOS, T0 + INTERVALO_MOVIMIENTO_MS)).toBe(true)
  })

  it('quieto no repite el punto a los 2 minutos, pero sí a los 5', () => {
    expect(distanciaMetros(BASE, CERCA)).toBeLessThan(DISTANCIA_MINIMA_M)

    expect(debeReportar(BASE, CERCA, T0 + INTERVALO_MOVIMIENTO_MS)).toBe(false)
    expect(debeReportar(BASE, CERCA, T0 + INTERVALO_QUIETO_MS)).toBe(true)
  })
})
