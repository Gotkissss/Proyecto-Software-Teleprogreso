/**
 * tests/tareasJornadaUbicacion.test.jsx
 * ---------------------------------------------------------------------------
 * HU-5 — Lado del técnico:
 *
 *   1. Sin jornada abierta no puede iniciar ni finalizar tareas: se le avisa
 *      y los botones quedan deshabilitados (el backend responde 409 igual).
 *   2. Al iniciar una tarea se envía su posición, para que el lugar quede en
 *      el recorrido.
 *   3. El reporte periódico descarta lecturas imprecisas y, sin conexión,
 *      guarda el punto en la cola con su hora real.
 * ---------------------------------------------------------------------------
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { getMock, patchMock, postMock, posicionMock, ubicacion } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
  posicionMock: vi.fn(),
  ubicacion: {
    posicion: null,
    jornadaActiva: false,
    jornadaCargada: true,
    refrescarJornada: vi.fn(),
  },
}))

vi.mock('../api/client', () => ({
  default: { get: getMock, patch: patchMock, post: postMock },
}))

vi.mock('../utils/posicionActual', () => ({ obtenerPosicionActual: posicionMock }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id_empleado: 7, nombre: 'Ana López', rol: 'tecnico' } }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../context/UbicacionContext', () => ({
  useUbicacion: () => ubicacion,
  UbicacionProvider: ({ children }) => children,
}))

import { ToastProvider } from '../components/ui/Toast'
import RutaDiariaPage from '../pages/RutaDiariaPage'
import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'
import { leerCola } from '../utils/colaUbicaciones'

const LUGAR = { lat: 14.4653, lng: -90.4408 }

const TAREA = {
  id_tarea: 1,
  titulo: 'Instalación fibra óptica',
  descripcion: null,
  direccion_servicio: 'Calle 15, Fraijanes',
  estado_tarea: 'pendiente',
  prioridad: 'media',
  fecha_completado: null,
  fecha_finalizacion: null,
  lat: 14.47,
  lng: -90.44,
  distancia_m: null,
}

function montarRuta() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RutaDiariaPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

async function abrirDetalle(user) {
  await user.click(await screen.findByRole('button', { name: /Ver detalles de Instalación/ }))
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue({ data: [TAREA] })
  patchMock.mockReset().mockResolvedValue({ data: {} })
  postMock.mockReset()
  posicionMock.mockReset().mockResolvedValue(LUGAR)
  ubicacion.posicion = null
  ubicacion.jornadaActiva = false
  ubicacion.jornadaCargada = true
  ubicacion.refrescarJornada.mockReset()
  localStorage.clear()
})

describe('RutaDiariaPage — tareas y jornada (HU-5)', () => {
  it('sin jornada avisa y no deja iniciar la tarea', async () => {
    const user = userEvent.setup()
    montarRuta()

    expect(await screen.findByText(/para poder\s+iniciar y finalizar tus tareas/)).toBeInTheDocument()
    await abrirDetalle(user)

    expect(screen.getByRole('button', { name: /Iniciar Tarea/ })).toBeDisabled()
    expect(screen.getByText(/para\s+iniciar esta tarea/)).toBeInTheDocument()
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('consulta la jornada al entrar para no mostrar un bloqueo viejo', async () => {
    montarRuta()

    await screen.findByText('Instalación fibra óptica')
    expect(ubicacion.refrescarJornada).toHaveBeenCalled()
  })

  it('mientras no se sabe si hay jornada no muestra el aviso', async () => {
    ubicacion.jornadaCargada = false
    montarRuta()

    await screen.findByText('Instalación fibra óptica')
    expect(screen.queryByText(/para poder\s+iniciar y finalizar/)).not.toBeInTheDocument()
  })

  it('con jornada abierta inicia la tarea enviando su posición', async () => {
    ubicacion.jornadaActiva = true
    ubicacion.posicion = { lat: 14.4, lng: -90.4, accuracy: 20 }
    const user = userEvent.setup()
    montarRuta()

    await abrirDetalle(user)
    await user.click(screen.getByRole('button', { name: /Iniciar Tarea/ }))

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/tareas/1/iniciar', LUGAR)
    )
    expect(posicionMock).toHaveBeenCalledWith({ respaldo: ubicacion.posicion })
  })

  it('si el backend responde que no hay jornada, lo muestra y revierte', async () => {
    ubicacion.jornadaActiva = true
    patchMock.mockRejectedValue({
      response: { status: 409, data: { detail: 'Registra tu entrada para iniciar la jornada.' } },
    })
    const user = userEvent.setup()
    montarRuta()

    await abrirDetalle(user)
    await user.click(screen.getByRole('button', { name: /Iniciar Tarea/ }))

    expect(await screen.findByText('Registra tu entrada para iniciar la jornada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Iniciar Tarea/ })).toBeInTheDocument()
  })
})

// ─── Reporte periódico: precisión y cola sin conexión ────────────────────────

describe('useGeolocalizacionTecnico — reglas del recorrido (HU-5)', () => {
  let alLeer

  beforeEach(() => {
    alLeer = null
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn((ok) => { alLeer = ok; return 1 }),
        clearWatch: vi.fn(),
      },
    })
  })

  afterEach(() => {
    // Primero se desmonta el hook (su limpieza llama a clearWatch) y después
    // se retira la geolocalización simulada.
    cleanup()
    delete navigator.geolocation
    vi.restoreAllMocks()
  })

  async function leer(coords, timestamp = Date.now()) {
    await act(async () => {
      alLeer({ coords: { accuracy: 10, ...coords }, timestamp })
    })
  }

  it('no reporta una lectura imprecisa, aunque sí la muestra en el mapa', async () => {
    const { result } = renderHook(() =>
      useGeolocalizacionTecnico({ jornadaActiva: true, idEmpleado: 7 })
    )

    await leer({ latitude: 14.47, longitude: -90.44, accuracy: 350 })

    expect(postMock).not.toHaveBeenCalled()
    expect(result.current.posicion).toMatchObject({ lat: 14.47, lng: -90.44 })
  })

  it('sin red guarda el punto en la cola con la hora de la lectura', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { result } = renderHook(() =>
      useGeolocalizacionTecnico({ jornadaActiva: true, idEmpleado: 7 })
    )
    const tomada = Date.parse('2026-09-23T15:00:00.000Z')

    await leer({ latitude: 14.47, longitude: -90.44 }, tomada)

    expect(postMock).not.toHaveBeenCalled()
    expect(leerCola(7)).toEqual([
      { lat: 14.47, lng: -90.44, fecha_hora: '2026-09-23T15:00:00.000Z' },
    ])
    expect(result.current.errorEnvio).toMatch(/Sin conexión/)
  })

  it('si el envío falla por red, el punto tampoco se pierde', async () => {
    postMock.mockRejectedValue(new Error('Network Error'))
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true, idEmpleado: 7 }))

    await leer({ latitude: 14.47, longitude: -90.44 })

    await waitFor(() => expect(leerCola(7)).toHaveLength(1))
  })

  it('al volver la conexión envía la cola en lote', async () => {
    localStorage.setItem(
      'teleprogreso.colaUbicaciones.7',
      JSON.stringify([{ lat: 14.47, lng: -90.44, fecha_hora: '2026-09-23T15:00:00.000Z' }])
    )
    postMock.mockResolvedValue({ data: { guardados: 1, descartados: 0 } })
    renderHook(() => useGeolocalizacionTecnico({ jornadaActiva: true, idEmpleado: 7 }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/ubicaciones/lote', {
        puntos: [{ lat: 14.47, lng: -90.44, fecha_hora: '2026-09-23T15:00:00.000Z' }],
      })
    )
    await waitFor(() => expect(leerCola(7)).toEqual([]))
  })
})
