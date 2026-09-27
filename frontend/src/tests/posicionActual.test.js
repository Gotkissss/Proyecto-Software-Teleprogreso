/**
 * tests/posicionActual.test.js
 * ---------------------------------------------------------------------------
 * HU-4 — Posición al marcar entrada/salida.
 *
 * La regla que se fija aquí: la función nunca rechaza ni se queda colgada.
 * Si no hay lectura nueva a tiempo, usa la última posición conocida, y si
 * tampoco hay, devuelve null para que la marca se registre sin ubicación.
 * ---------------------------------------------------------------------------
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { obtenerPosicionActual } from '../utils/posicionActual'

const RESPALDO = { lat: 14.4653, lng: -90.4408, accuracy: 30 }
const geolocalizacionOriginal = navigator.geolocation

function simularGeolocalizacion(getCurrentPosition) {
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  })
}

describe('obtenerPosicionActual', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(navigator, 'geolocation', {
      value: geolocalizacionOriginal,
      configurable: true,
    })
  })

  it('devuelve la lectura nueva del GPS y la pide sin caché', async () => {
    const getCurrentPosition = vi.fn((ok) =>
      ok({ coords: { latitude: 14.4812, longitude: -90.4523 } })
    )
    simularGeolocalizacion(getCurrentPosition)

    const posicion = await obtenerPosicionActual({ respaldo: RESPALDO })

    expect(posicion).toEqual({ lat: 14.4812, lng: -90.4523 })
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ maximumAge: 0 })
  })

  it('si el GPS falla usa la última posición conocida', async () => {
    simularGeolocalizacion((_ok, error) => error({ code: 1 }))

    const posicion = await obtenerPosicionActual({ respaldo: RESPALDO })

    expect(posicion).toEqual({ lat: 14.4653, lng: -90.4408 })
  })

  it('si el GPS no responde a tiempo usa el respaldo y no se queda esperando', async () => {
    // Nunca llama a ninguna de las dos funciones, como cuando el navegador
    // espera la respuesta del aviso de permiso.
    simularGeolocalizacion(() => {})

    const promesa = obtenerPosicionActual({ respaldo: RESPALDO, timeoutMs: 8000 })
    await vi.advanceTimersByTimeAsync(8000)

    await expect(promesa).resolves.toEqual({ lat: 14.4653, lng: -90.4408 })
  })

  it('sin lectura y sin respaldo devuelve null para marcar sin ubicación', async () => {
    simularGeolocalizacion((_ok, error) => error({ code: 2 }))

    await expect(obtenerPosicionActual()).resolves.toBeNull()
  })

  it('sin soporte de geolocalización usa el respaldo', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    })

    await expect(obtenerPosicionActual({ respaldo: RESPALDO })).resolves.toEqual({
      lat: 14.4653,
      lng: -90.4408,
    })
  })
})
