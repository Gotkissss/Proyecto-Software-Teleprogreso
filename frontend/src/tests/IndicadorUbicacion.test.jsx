
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from '@testing-library/react'

const { getEstadoPausasMock, enviarUbicacionMock } = vi.hoisted(() => ({
  getEstadoPausasMock: vi.fn(),
  enviarUbicacionMock: vi.fn(),
}))

vi.mock('../api/asistenciaService', () => ({
  getEstadoPausas: getEstadoPausasMock,
}))

vi.mock('../api/ubicacionService', () => ({
  enviarUbicacion: enviarUbicacionMock,
}))

import { UbicacionProvider } from '../context/UbicacionContext'
import IndicadorUbicacion from '../components/layout/shared/IndicadorUbicacion'

let alLeerPosicion

/** Lectura del GPS con la forma que entrega el navegador. */
function lectura(lat = 14.6349, lng = -90.5069) {
  return { coords: { latitude: lat, longitude: lng, accuracy: 12 } }
}

function montar() {
  return render(
    <UbicacionProvider>
      <IndicadorUbicacion />
    </UbicacionProvider>,
  )
}

/** Simula que el GPS entregó una posición nueva. */
async function emitirLectura(...args) {
  await act(async () => {
    alLeerPosicion?.(lectura(...args))
  })
}

function jornada(activa) {
  return {
    fecha: '2026-09-23',
    id_asistencia: activa ? 10 : null,
    jornada_activa: activa,
    hora_entrada: activa ? '08:00:00' : null,
    hora_salida: null,
    segundos_brutos: 0,
    segundos_trabajados: 0,
    segundos_en_pausa: 0,
    pausa_activa: null,
    tipos_usados: [],
    descansos: [],
  }
}

beforeEach(() => {
  getEstadoPausasMock.mockReset()
  enviarUbicacionMock.mockReset()
  enviarUbicacionMock.mockResolvedValue({ ok: true, id_ubicacion: 1 })

  alLeerPosicion = null

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

describe('IndicadorUbicacion', () => {
  it('sin jornada abierta no pinta nada', async () => {
    getEstadoPausasMock.mockResolvedValue(jornada(false))

    const { container } = montar()

    await waitFor(() => expect(getEstadoPausasMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('con jornada abierta y GPS disponible, avisa que está compartiendo', async () => {
    getEstadoPausasMock.mockResolvedValue(jornada(true))

    montar()
    await waitFor(() => expect(getEstadoPausasMock).toHaveBeenCalled())
    await emitirLectura()

    expect(await screen.findByText('Compartiendo ubicación')).toBeInTheDocument()
  })

  it('con el permiso de ubicación denegado, avisa que no se está compartiendo', async () => {
    getEstadoPausasMock.mockResolvedValue(jornada(true))
    navigator.geolocation.watchPosition = vi.fn((_exito, error) => {
      error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
      return 1
    })

    montar()

    expect(await screen.findByText('Ubicación no disponible')).toBeInTheDocument()
  })

  it('si el último envío al backend falló, lo dice aunque el GPS funcione', async () => {
    getEstadoPausasMock.mockResolvedValue(jornada(true))
    enviarUbicacionMock.mockRejectedValue(new Error('Network Error'))

    montar()
    await waitFor(() => expect(getEstadoPausasMock).toHaveBeenCalled())
    await emitirLectura()

    expect(await screen.findByText('Ubicación sin enviar')).toBeInTheDocument()
  })
})