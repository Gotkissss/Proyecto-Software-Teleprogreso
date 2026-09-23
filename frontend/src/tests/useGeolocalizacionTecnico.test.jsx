/**
 * tests/useGeolocalizacionTecnico.test.jsx
 * ---------------------------------------------------------------------------
 * Pruebas del reporte periódico de ubicación (SCRUM-219).
 *
 * El control de "una escritura por minuto" es la razón de ser de la tarea y
 * es justo lo que no se nota probando a mano: en el celular el GPS dispara
 * cada pocos segundos, pero en una prueba manual de dos minutos la diferencia
 * entre mandar una vez y mandar cuarenta no se ve.
 *
 * Aquí no hacen falta los fake timers de useTimer.test.jsx: el hook no usa
 * ningún temporizador, compara Date.now() contra el último envío. Mover ese
 * reloj alcanza para simular el paso del tiempo, y así las promesas del envío
 * siguen resolviéndose con normalidad.
 *
 * jsdom no implementa la Geolocation API, así que se sustituye por completo.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { enviarUbicacionMock } = vi.hoisted(() => ({
  enviarUbicacionMock: vi.fn(),
}))

vi.mock('../api/ubicacionService', () => ({
  enviarUbicacion: enviarUbicacionMock,
}))

import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'

const LAT = 14.6349
const LNG = -90.5069
const UN_MINUTO = 60 * 1000
const ID_WATCH = 7

let reloj
let alLeerPosicion
let clearWatchMock

/** Adelanta el reloj que el hook consulta para decidir si toca reportar. */
function avanzar(milisegundos) {
  reloj += milisegundos
}

/** Lectura del GPS con la forma que entrega el navegador. */
function lectura(lat = LAT, lng = LNG) {
  return { coords: { latitude: lat, longitude: lng, accuracy: 12 } }
}

/**
 * Simula que el GPS entregó una posición nueva.
 *
 * El act es asíncrono porque el envío al backend actualiza el estado del hook
 * cuando la promesa se resuelve; con el act sincrónico ese cambio caería
 * fuera y React avisaría de una actualización sin envolver.
 */
async function emitirLectura(...args) {
  await act(async () => {
    alLeerPosicion(lectura(...args))
  })
}

beforeEach(() => {
  reloj = new Date('2026-09-22T09:00:00').getTime()
  vi.spyOn(Date, 'now').mockImplementation(() => reloj)

  enviarUbicacionMock.mockReset()
  enviarUbicacionMock.mockResolvedValue({ ok: true, id_ubicacion: 1 })

  alLeerPosicion = null
  clearWatchMock = vi.fn()

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    writable: true,
    value: {
      watchPosition: vi.fn((exito) => {
        alLeerPosicion = exito
        return ID_WATCH
      }),
      clearWatch: clearWatchMock,
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete navigator.geolocation
})

describe('useGeolocalizacionTecnico — marcador en el mapa', () => {
  it('expone la posición leída aunque no haya jornada abierta', async () => {
    const { result } = renderHook(() => useGeolocalizacionTecnico())

    await emitirLectura()

    expect(result.current.estado).toBe('ok')
    expect(result.current.posicion).toEqual({ lat: LAT, lng: LNG, accuracy: 12 })
  })

  it('sin jornada abierta no reporta nada al backend', async () => {
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: false }))

    await emitirLectura()

    expect(enviarUbicacionMock).not.toHaveBeenCalled()
  })

  it('deja de observar el GPS al desmontar la pantalla', async () => {
    const { unmount } = renderHook(() =>
      useGeolocalizacionTecnico({ jornadaActiva: true })
    )

    unmount()

    expect(clearWatchMock).toHaveBeenCalledWith(ID_WATCH)
  })
})

describe('useGeolocalizacionTecnico — reporte al backend (SCRUM-219)', () => {
  it('reporta la primera lectura en cuanto hay jornada abierta', async () => {
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true }))

    await emitirLectura()

    expect(enviarUbicacionMock).toHaveBeenCalledTimes(1)
    // Solo las coordenadas: ni precisión, ni empleado, ni hora del cliente.
    expect(enviarUbicacionMock).toHaveBeenCalledWith({ lat: LAT, lng: LNG })
  })

  it('no manda una escritura por cada lectura del GPS', async () => {
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true }))

    // Cinco lecturas seguidas, como cuando el técnico va caminando.
    await emitirLectura()
    for (let i = 0; i < 4; i += 1) {
      avanzar(5000)
      await emitirLectura(LAT + i / 1000, LNG)
    }

    expect(enviarUbicacionMock).toHaveBeenCalledTimes(1)
  })

  it('vuelve a reportar pasado el minuto', async () => {
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true }))

    await emitirLectura()
    avanzar(UN_MINUTO)
    await emitirLectura(14.64, -90.51)

    expect(enviarUbicacionMock).toHaveBeenCalledTimes(2)
    expect(enviarUbicacionMock).toHaveBeenLastCalledWith({ lat: 14.64, lng: -90.51 })
  })

  it('empieza a reportar cuando el técnico marca entrada estando en el mapa', async () => {
    const { rerender } = renderHook(
      ({ jornadaActiva }) => useGeolocalizacionTecnico({ jornadaActiva }),
      { initialProps: { jornadaActiva: false } }
    )

    await emitirLectura()
    expect(enviarUbicacionMock).not.toHaveBeenCalled()

    rerender({ jornadaActiva: true })
    await emitirLectura()

    expect(enviarUbicacionMock).toHaveBeenCalledTimes(1)
  })

  it('un fallo de envío no se lleva por delante el marcador', async () => {
    enviarUbicacionMock.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(() =>
      useGeolocalizacionTecnico({ jornadaActiva: true })
    )

    await emitirLectura()

    await waitFor(() => expect(result.current.errorEnvio).toBeTruthy())
    expect(result.current.estado).toBe('ok')
    expect(result.current.posicion).toEqual({ lat: LAT, lng: LNG, accuracy: 12 })
  })

  it('avisa si el backend responde que la jornada no está abierta', async () => {
    enviarUbicacionMock.mockResolvedValue({ ok: false, motivo: 'sin_jornada' })
    const { result } = renderHook(() =>
      useGeolocalizacionTecnico({ jornadaActiva: true })
    )

    await emitirLectura()

    await waitFor(() => expect(result.current.errorEnvio).toContain('jornada'))
  })

  it('reintenta en el siguiente ciclo después de un fallo', async () => {
    enviarUbicacionMock.mockRejectedValueOnce(new Error('Network Error'))
    const { result } = renderHook(() =>
      useGeolocalizacionTecnico({ jornadaActiva: true })
    )

    await emitirLectura()
    await waitFor(() => expect(result.current.errorEnvio).toBeTruthy())

    avanzar(UN_MINUTO)
    await emitirLectura()

    expect(enviarUbicacionMock).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.errorEnvio).toBeNull())
  })
})
