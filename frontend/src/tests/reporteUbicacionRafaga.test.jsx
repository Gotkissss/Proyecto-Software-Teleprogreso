import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

vi.mock('../api/client', () => ({ default: { post: postMock } }))

import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'

const LAT = 14.6349
const LNG = -90.5069

let reloj
let alLeerPosicion

function lectura(lat = LAT, lng = LNG) {
  return { coords: { latitude: lat, longitude: lng, accuracy: 10 } }
}

async function emitir(lat, lng) {
  await act(async () => {
    alLeerPosicion(lectura(lat, lng))
  })
}

beforeEach(() => {
  reloj = new Date('2026-09-23T09:00:00').getTime()
  vi.spyOn(Date, 'now').mockImplementation(() => reloj)

  postMock.mockReset()
  postMock.mockResolvedValue({ data: { id_ubicacion: 1, fecha_hora_registro: '2026-09-23T09:00:00' } })

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    writable: true,
    value: {
      watchPosition: vi.fn((exito) => {
        alLeerPosicion = exito
        return 1
      }),
      clearWatch: vi.fn(),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete navigator.geolocation
})

describe('reporte de ubicación con varias lecturas seguidas', () => {
  it('con jornada abierta guarda una sola vez aunque el GPS dispare diez lecturas', async () => {
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true }))

    for (let i = 0; i < 10; i += 1) {
      await emitir(LAT + i / 10000, LNG)
    }

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith('/ubicaciones', { lat: LAT, lng: LNG })
  })

  it('no duplica mientras la primera petición sigue en vuelo', async () => {
    let resolver
    postMock.mockReturnValue(new Promise((res) => { resolver = res }))
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true }))

    await emitir()
    await emitir(LAT + 0.001, LNG)
    await emitir(LAT + 0.002, LNG)

    expect(postMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolver({ data: { id_ubicacion: 1 } })
    })
  })

  it('sin jornada abierta no envía ninguna lectura', async () => {
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: false }))

    for (let i = 0; i < 5; i += 1) {
      await emitir(LAT + i / 10000, LNG)
    }

    expect(postMock).not.toHaveBeenCalled()
  })

  it('si el backend rechaza con 409 avisa y no insiste en la ráfaga', async () => {
    postMock.mockRejectedValue({
      response: { status: 409, data: { detail: 'No tienes una jornada abierta.' } },
    })
    const { result } = renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true }))

    for (let i = 0; i < 5; i += 1) {
      await emitir(LAT + i / 10000, LNG)
    }

    await waitFor(() => expect(result.current.errorEnvio).toContain('jornada'))
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})