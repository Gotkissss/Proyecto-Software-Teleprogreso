/**
 * tests/RutaDiariaPage.test.jsx
 * ---------------------------------------------------------------------------
 * HU-3 — Ruta diaria ordenada por cercanía y con navegación.
 *
 * El orden lo decide el backend (GET /tareas/mi-ruta): urgentes primero y
 * luego la parada más cercana; sin posición, por prioridad. Lo que se fija
 * aquí es la parte del frontend:
 *
 *   1. Que la posición del técnico viaje al backend solo cuando existe.
 *   2. Que la pantalla respete el orden recibido y muestre la distancia.
 *   3. Que "Cómo llegar" abra Google Maps / Waze con la coordenada correcta.
 *   4. Que sin GPS la pantalla no se rompa y caiga al orden por prioridad.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { getMock, ubicacion } = vi.hoisted(() => ({
  getMock: vi.fn(),
  // Estado mutable del contexto de ubicación: cada test decide si hay GPS.
  ubicacion: { posicion: null, estado: 'cargando' },
}))

vi.mock('../api/client', () => ({
  default: { get: getMock, patch: vi.fn(), post: vi.fn() },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id_empleado: 7, nombre: 'Ana López', rol: 'tecnico' },
    isLoading: false,
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../context/UbicacionContext', () => ({
  useUbicacion: () => ubicacion,
  UbicacionProvider: ({ children }) => children,
}))

import { ToastProvider } from '../components/ui/Toast'
import { getMiRuta } from '../api/rutaService'
import { hoyISO } from '../utils/fecha'
import RutaDiariaPage from '../pages/RutaDiariaPage'

const POSICION = { lat: 14.4653, lng: -90.4408, accuracy: 12 }

/** Tarea tal como la devuelve GET /tareas/mi-ruta. */
function tarea(id, campos = {}) {
  return {
    id_tarea: id,
    titulo: `Tarea ${id}`,
    descripcion: null,
    direccion_servicio: `Calle ${id}, Fraijanes`,
    estado_tarea: 'pendiente',
    prioridad: 'media',
    fecha_completado: null,
    fecha_finalizacion: null,
    lat: 14.47,
    lng: -90.44,
    distancia_m: null,
    ...campos,
  }
}

function montar() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RutaDiariaPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** Títulos de las tarjetas en el orden en que se pintan. */
function titulosEnPantalla() {
  return screen.getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent)
    .filter((t) => t.startsWith('Tarea '))
}

beforeEach(() => {
  getMock.mockReset()
  ubicacion.posicion = null
  ubicacion.estado = 'cargando'
})

describe('getMiRuta', () => {
  it('con posición manda lat y lng a /tareas/mi-ruta', async () => {
    getMock.mockResolvedValue({ data: [] })

    const ruta = await getMiRuta({ lat: POSICION.lat, lng: POSICION.lng })

    expect(getMock).toHaveBeenCalledWith('/tareas/mi-ruta', {
      params: { lat: 14.4653, lng: -90.4408 },
    })
    expect(ruta.ordenadoPorCercania).toBe(true)
  })

  it('sin posición no manda coordenadas', async () => {
    getMock.mockResolvedValue({ data: [] })

    const ruta = await getMiRuta(null)

    expect(getMock).toHaveBeenCalledWith('/tareas/mi-ruta', { params: {} })
    expect(ruta.ordenadoPorCercania).toBe(false)
  })

  it('conserva el orden del backend y trae distancia y coordenada', async () => {
    getMock.mockResolvedValue({
      data: [
        tarea(3, { prioridad: 'urgente', distancia_m: 8800 }),
        tarea(1, { prioridad: 'baja', distancia_m: 80 }),
      ],
    })

    const { servicios } = await getMiRuta({ lat: 14.4, lng: -90.4 })

    expect(servicios.map((s) => s.id_servicio)).toEqual([3, 1])
    expect(servicios[0]).toMatchObject({ distancia_m: 8800, lat: 14.47, lng: -90.44 })
  })
})

describe('RutaDiariaPage — con ubicación', () => {
  beforeEach(() => {
    ubicacion.posicion = POSICION
    ubicacion.estado = 'ok'
  })

  it('pinta las paradas en el orden del backend (urgentes, luego cercanía)', async () => {
    getMock.mockResolvedValue({
      data: [
        tarea(2, { prioridad: 'urgente', distancia_m: 8795 }),
        tarea(1, { prioridad: 'baja', distancia_m: 80 }),
        tarea(3, { prioridad: 'alta', distancia_m: 2632 }),
      ],
    })

    montar()

    await screen.findByText('Tarea 2')
    // Una baja cercana no sube por encima de una alta más lejana ni de la
    // urgente: la pantalla ya no reordena por prioridad.
    expect(titulosEnPantalla()).toEqual(['Tarea 2', 'Tarea 1', 'Tarea 3'])
    expect(getMock).toHaveBeenCalledWith('/tareas/mi-ruta', {
      params: { lat: 14.4653, lng: -90.4408 },
    })
    expect(screen.getByText('Urgentes primero, luego por cercanía')).toBeInTheDocument()
  })

  it('muestra la distancia aproximada en cada tarjeta', async () => {
    getMock.mockResolvedValue({
      data: [
        tarea(1, { distancia_m: 2400 }),
        tarea(2, { distancia_m: 350 }),
      ],
    })

    montar()

    expect(await screen.findByText('a 2.4 km')).toBeInTheDocument()
    expect(screen.getByText('a 350 m')).toBeInTheDocument()
  })

  it('"Cómo llegar" abre Google Maps y Waze con la coordenada de la tarea', async () => {
    getMock.mockResolvedValue({
      data: [tarea(1, { lat: 14.4812, lng: -90.4523, distancia_m: 1500 })],
    })

    montar()

    const maps = await screen.findByRole('link', { name: 'Google Maps' })
    const waze = screen.getByRole('link', { name: 'Waze' })

    expect(maps).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=14.4812,-90.4523'
    )
    expect(waze).toHaveAttribute(
      'href',
      'https://waze.com/ul?ll=14.4812,-90.4523&navigate=yes'
    )
    // Se abre fuera de la PWA para no perder la pantalla de la ruta.
    expect(maps).toHaveAttribute('target', '_blank')
    expect(maps).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('una tarea sin coordenada no ofrece navegación ni distancia', async () => {
    getMock.mockResolvedValue({
      data: [tarea(1, { lat: null, lng: null, distancia_m: null })],
    })

    montar()

    await screen.findByText('Tarea 1')
    expect(screen.queryByRole('link', { name: 'Google Maps' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^a .* (m|km)$/)).not.toBeInTheDocument()
  })

  it('una tarea completada no muestra distancia ni "Cómo llegar"', async () => {
    getMock.mockResolvedValue({
      data: [
        tarea(1, {
          estado_tarea: 'completado',
          // Como la manda el backend: hora de Guatemala y sin zona.
          fecha_completado: `${hoyISO()}T10:00:00`,
          distancia_m: 20,
        }),
      ],
    })

    montar()

    const tarjeta = (await screen.findByText('Tarea 1')).closest('article')
    expect(within(tarjeta).queryByText('a 20 m')).not.toBeInTheDocument()
    expect(within(tarjeta).queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('RutaDiariaPage — sin ubicación', () => {
  it('no se rompe y cae al orden por prioridad sin distancias', async () => {
    getMock.mockResolvedValue({
      data: [
        tarea(1, { prioridad: 'urgente' }),
        tarea(2, { prioridad: 'baja' }),
      ],
    })

    montar()

    await screen.findByText('Tarea 1')
    expect(getMock).toHaveBeenCalledWith('/tareas/mi-ruta', { params: {} })
    expect(titulosEnPantalla()).toEqual(['Tarea 1', 'Tarea 2'])
    expect(
      screen.getByText('Por prioridad · activa tu ubicación para ordenar por cercanía')
    ).toBeInTheDocument()
    expect(screen.queryByText(/^a .* (m|km)$/)).not.toBeInTheDocument()
    // La navegación no depende del GPS del técnico: solo de la coordenada
    // de la tarea.
    expect(screen.getAllByRole('link', { name: 'Google Maps' })).toHaveLength(2)
  })

  it('al llegar la primera posición vuelve a pedir la ruta ordenada por cercanía', async () => {
    getMock
      .mockResolvedValueOnce({
        data: [tarea(1, { prioridad: 'alta' }), tarea(2, { prioridad: 'media' })],
      })
      .mockResolvedValueOnce({
        data: [
          tarea(2, { prioridad: 'media', distancia_m: 300 }),
          tarea(1, { prioridad: 'alta', distancia_m: 5000 }),
        ],
      })

    const { rerender } = montar()
    await screen.findByText('Tarea 1')
    expect(titulosEnPantalla()).toEqual(['Tarea 1', 'Tarea 2'])

    ubicacion.posicion = POSICION
    ubicacion.estado = 'ok'
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <RutaDiariaPage />
        </ToastProvider>
      </MemoryRouter>,
    )

    await screen.findByText('a 300 m')
    expect(titulosEnPantalla()).toEqual(['Tarea 2', 'Tarea 1'])
    expect(getMock).toHaveBeenLastCalledWith('/tareas/mi-ruta', {
      params: { lat: 14.4653, lng: -90.4408 },
    })
  })

  it('las lecturas siguientes del GPS no vuelven a pedir la ruta', async () => {
    ubicacion.posicion = POSICION
    ubicacion.estado = 'ok'
    getMock.mockResolvedValue({ data: [tarea(1, { distancia_m: 500 })] })

    const { rerender } = montar()
    await screen.findByText('a 500 m')

    ubicacion.posicion = { lat: 14.4660, lng: -90.4410, accuracy: 10 }
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <RutaDiariaPage />
        </ToastProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))
  })
})
