
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
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

/**
 * Monta con jornada abierta y espera a que la jornada YA esté aplicada.
 *
 * No basta con esperar a que se llame a getEstadoPausas: la llamada ocurre al
 * montar, pero su respuesta llega después. Una lectura de GPS que llegue antes
 * se ignora a propósito (sin jornada confirmada no se reporta), y la prueba
 * fallaba o pasaba según quién ganara esa carrera: sola casi siempre ganaba la
 * jornada; en la suite completa, con más archivos en paralelo, no. El
 * indicador solo aparece con la jornada abierta, así que verlo es la señal.
 *
 * Verlo no alcanza del todo: el hook copia la jornada a una referencia en un
 * useEffect, que corre después del render, y findByText espera fuera de act.
 * El act vacío del final deja que React termine esos efectos antes de que la
 * prueba emita la lectura.
 */
async function montarConJornadaAbierta() {
  montar()
  await screen.findByText('Buscando GPS…')
  await act(async () => {})
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
  // Desmontar ANTES de quitar la geolocalización falsa: al desmontarse, el
  // hook llama a clearWatch. Desde vitest 2 los afterEach corren en orden
  // inverso al de registro, y el cleanup global de setup.js llega al final,
  // cuando navigator.geolocation ya no existe.
  cleanup()
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

    await montarConJornadaAbierta()
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

    // RTF-01 / R3-11: el texto largo salía cortado a media palabra.
    expect(await screen.findByText('Sin ubicación')).toBeInTheDocument()
  })

  it('si el último envío al backend falló, lo dice aunque el GPS funcione', async () => {
    getEstadoPausasMock.mockResolvedValue(jornada(true))
    enviarUbicacionMock.mockRejectedValue(new Error('Network Error'))

    await montarConJornadaAbierta()
    await emitirLectura()

    expect(await screen.findByText('Sin enviar')).toBeInTheDocument()
  })
})