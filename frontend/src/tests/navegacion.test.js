/**
 * tests/navegacion.test.js
 * ---------------------------------------------------------------------------
 * HU-3 — Texto de distancia y enlaces "Cómo llegar" de la ruta diaria.
 *
 * Lo delicado es el orden de las coordenadas: Google Maps y Waze esperan
 * "lat,lng". Invertirlas no da ningún error, solo manda al técnico a otro
 * continente, así que se fija aquí.
 * ---------------------------------------------------------------------------
 */
import { describe, expect, it } from 'vitest'
import { formatearDistancia, urlGoogleMaps, urlWaze } from '../utils/navegacion'

describe('formatearDistancia', () => {
  it('usa kilómetros con un decimal desde 1 km', () => {
    expect(formatearDistancia(2400)).toBe('a 2.4 km')
    expect(formatearDistancia(1000)).toBe('a 1.0 km')
    expect(formatearDistancia(12_345)).toBe('a 12.3 km')
  })

  it('usa metros redondeados a la decena por debajo de 1 km', () => {
    expect(formatearDistancia(350)).toBe('a 350 m')
    expect(formatearDistancia(354)).toBe('a 350 m')
    expect(formatearDistancia(3)).toBe('a 10 m')
  })

  it('no inventa una distancia cuando no la hay', () => {
    expect(formatearDistancia(null)).toBeNull()
    expect(formatearDistancia(undefined)).toBeNull()
    expect(formatearDistancia(Number.NaN)).toBeNull()
  })
})

describe('enlaces de navegación', () => {
  it('Google Maps recibe la coordenada como destino lat,lng', () => {
    expect(urlGoogleMaps(14.4653, -90.4408)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.4653,-90.4408'
    )
  })

  it('Waze recibe la coordenada como ll=lat,lng y arranca la navegación', () => {
    expect(urlWaze(14.4653, -90.4408)).toBe(
      'https://waze.com/ul?ll=14.4653,-90.4408&navigate=yes'
    )
  })

  it('sin coordenada no hay enlace', () => {
    expect(urlGoogleMaps(null, null)).toBeNull()
    expect(urlWaze(14.46, null)).toBeNull()
  })
})
